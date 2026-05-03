#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

from fetch_rss import (
    ANALYTICS_OUTPUT_PATH,
    NEWS_OUTPUT_PATH,
    ROOT_DIR,
    WEB_MONITOR_SOURCE,
    NewsItem,
    build_analytics_json,
    build_news_json,
    deduplicate_and_sort,
    format_datetime,
    load_existing_payload,
    load_news_items_from_payload,
    save_json,
)

WATCH_SITES_PATH = ROOT_DIR / "config" / "watch_sites.json"
WATCH_STATE_PATH = ROOT_DIR / "data" / "watch_state.json"
REQUEST_TIMEOUT = 20
USER_AGENT = "RSSNewsApp/1.0 (+https://github.com/)"
DEFAULT_WATCH_TAG = "Web更新"


@dataclass
class WatchSite:
    name: str
    url: str
    selector: str
    tag: str

    @property
    def state_key(self) -> str:
        return f"{self.url}::{self.selector}"


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def load_json_file(path: Path, description: str) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def load_watch_sites(path: Path) -> list[WatchSite]:
    configs = load_json_file(path, "watch sites")
    if not isinstance(configs, list):
        raise ValueError("watch_sites.json must contain a list of site definitions.")

    sites: list[WatchSite] = []
    for config in configs:
        if not isinstance(config, dict):
            logging.warning("Skipping invalid watch site config: %r", config)
            continue

        name = str(config.get("name", "")).strip()
        url = str(config.get("url", "")).strip()
        selector = str(config.get("selector", "")).strip()
        tag = str(config.get("tag", DEFAULT_WATCH_TAG)).strip() or DEFAULT_WATCH_TAG

        if not name or not url:
            logging.warning("Skipping watch site with missing name/url: %r", config)
            continue

        sites.append(WatchSite(name=name, url=url, selector=selector, tag=tag))

    return sites


def load_watch_state(path: Path) -> dict[str, Any]:
    default_state = {"updated_at": "", "sites": {}}
    if not path.exists():
        return default_state

    try:
        payload = load_json_file(path, "watch state")
    except Exception as error:  # noqa: BLE001
        logging.warning("Failed to load watch state %s: %s", path, error)
        return default_state

    if not isinstance(payload, dict):
        logging.warning("watch_state.json must contain an object. Resetting state.")
        return default_state

    sites = payload.get("sites")
    if not isinstance(sites, dict):
        sites = {}

    return {
        "updated_at": str(payload.get("updated_at", "")).strip(),
        "sites": sites,
    }


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def clean_node_text(node: Any) -> str:
    for tag in node.select("script, style, noscript"):
        tag.decompose()
    return normalize_text(node.get_text(" ", strip=True))


def fetch_site_text(site: WatchSite) -> str:
    response = requests.get(site.url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    if site.selector:
        nodes = soup.select(site.selector)
        if not nodes:
            raise ValueError(f"Selector not found: {site.selector}")
        text = " ".join(clean_node_text(node) for node in nodes)
    else:
        root = soup.body or soup
        text = clean_node_text(root)

    normalized = normalize_text(text)
    if not normalized:
        raise ValueError("No text content extracted")

    return normalized


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_watch_item(site: WatchSite, detected_at: datetime) -> NewsItem:
    published, published_label, sort_key = format_datetime(detected_at)
    tags = [DEFAULT_WATCH_TAG]
    if site.tag and site.tag != DEFAULT_WATCH_TAG:
        tags.append(site.tag)

    return NewsItem(
        title=f"{site.name} が更新されました",
        link=site.url,
        source=WEB_MONITOR_SOURCE,
        published=published,
        published_label=published_label,
        summary="RSSがないサイトの更新を検知しました。",
        tags=tags,
        importance=3,
        sort_key=sort_key,
        published_dt=detected_at,
    )


def update_watch_state(
    sites: list[WatchSite],
    previous_state: dict[str, Any],
) -> tuple[list[NewsItem], dict[str, Any]]:
    previous_sites = previous_state.get("sites", {})
    next_sites: dict[str, Any] = {}
    detected_items: list[NewsItem] = []

    for site in sites:
        checked_at = datetime.now(timezone.utc)
        checked_at_iso = checked_at.isoformat().replace("+00:00", "Z")
        previous_site_state = previous_sites.get(site.state_key)
        if not isinstance(previous_site_state, dict):
            previous_site_state = {}

        try:
            extracted_text = fetch_site_text(site)
            content_hash = hash_text(extracted_text)
        except (requests.RequestException, ValueError) as error:
            logging.warning("Failed to check %s (%s): %s", site.name, site.url, error)
            if previous_site_state:
                next_sites[site.state_key] = previous_site_state
            continue
        except Exception as error:  # noqa: BLE001
            logging.warning("Unexpected error while checking %s (%s): %s", site.name, site.url, error)
            if previous_site_state:
                next_sites[site.state_key] = previous_site_state
            continue

        previous_hash = str(previous_site_state.get("hash", "")).strip()
        next_site_state = {
            "name": site.name,
            "url": site.url,
            "selector": site.selector,
            "tag": site.tag,
            "hash": content_hash,
            "last_checked_at": checked_at_iso,
            "last_changed_at": previous_site_state.get("last_changed_at", ""),
        }

        if not previous_hash:
            logging.info("Initialized watch state for %s", site.name)
        elif previous_hash != content_hash:
            next_site_state["last_changed_at"] = checked_at_iso
            detected_items.append(build_watch_item(site, checked_at))
            logging.info("Detected update for %s", site.name)

        next_sites[site.state_key] = next_site_state

    return detected_items, {"updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "sites": next_sites}


def main() -> int:
    setup_logging()

    try:
        watch_sites = load_watch_sites(WATCH_SITES_PATH)
    except Exception as error:  # noqa: BLE001
        logging.exception("Failed to load watch site configuration: %s", error)
        return 1

    previous_news_payload = load_existing_payload(NEWS_OUTPUT_PATH)
    existing_items = load_news_items_from_payload(previous_news_payload)
    previous_watch_state = load_watch_state(WATCH_STATE_PATH)

    detected_items, next_watch_state = update_watch_state(watch_sites, previous_watch_state)
    merged_items = deduplicate_and_sort(existing_items + detected_items)

    news_payload = build_news_json(merged_items, previous_news_payload)
    save_json(NEWS_OUTPUT_PATH, news_payload)
    logging.info("Wrote %d items to %s", len(merged_items), NEWS_OUTPUT_PATH)

    existing_analytics_payload = load_existing_payload(ANALYTICS_OUTPUT_PATH)
    analytics_payload = build_analytics_json(merged_items, existing_analytics_payload)
    save_json(ANALYTICS_OUTPUT_PATH, analytics_payload)
    logging.info("Wrote analytics to %s", ANALYTICS_OUTPUT_PATH)

    save_json(WATCH_STATE_PATH, next_watch_state)
    logging.info("Wrote watch state to %s", WATCH_STATE_PATH)
    logging.info("Detected website updates: %d", len(detected_items))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
