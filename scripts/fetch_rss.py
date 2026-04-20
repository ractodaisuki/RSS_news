#!/usr/bin/env python3

from __future__ import annotations

import json
import logging
import re
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import certifi
import feedparser
from dateutil import parser as date_parser

ROOT_DIR = Path(__file__).resolve().parents[1]
FEEDS_PATH = ROOT_DIR / "feeds.json"
OUTPUT_PATH = ROOT_DIR / "data" / "news.json"
MAX_ITEMS_PER_FEED = 20
MAX_ITEMS_TOTAL = 100
REQUEST_TIMEOUT = 20
USER_AGENT = "RSSNewsApp/1.0 (+https://github.com/)"
DISPLAY_TIMEZONE = ZoneInfo("Asia/Tokyo")
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


class PlainTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data:
            self.parts.append(data)

    def get_text(self) -> str:
        return "".join(self.parts)


@dataclass
class NewsItem:
    title: str
    link: str
    source: str
    published: str
    published_label: str
    summary: str
    sort_key: tuple[int, float]

    def to_dict(self) -> dict[str, str]:
        return {
            "title": self.title,
            "link": self.link,
            "source": self.source,
            "published": self.published,
            "published_label": self.published_label,
            "summary": self.summary,
        }


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


def load_feed_configs(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8") as file:
        configs = json.load(file)

    if not isinstance(configs, list):
        raise ValueError("feeds.json must contain a list of feed definitions.")

    valid_configs: list[dict[str, str]] = []
    for config in configs:
        if not isinstance(config, dict):
            logging.warning("Skipping invalid feed config: %r", config)
            continue

        name = str(config.get("name", "")).strip()
        url = str(config.get("url", "")).strip()
        if not name or not url:
            logging.warning("Skipping feed config with missing name/url: %r", config)
            continue

        valid_configs.append({"name": name, "url": url})

    return valid_configs


def fetch_feed_content(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=REQUEST_TIMEOUT, context=SSL_CONTEXT) as response:
        return response.read()


def parse_feed_datetime(entry: Any) -> datetime | None:
    candidates = [
        getattr(entry, "published", None),
        getattr(entry, "updated", None),
        entry.get("dc_date"),
    ]

    for candidate in candidates:
        parsed = parse_datetime_value(candidate)
        if parsed is not None:
            return parsed

    for struct_key in ("published_parsed", "updated_parsed"):
        struct_value = getattr(entry, struct_key, None)
        if struct_value is None:
            continue

        try:
            return datetime(*struct_value[:6], tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue

    return None


def parse_datetime_value(value: Any) -> datetime | None:
    if not value:
        return None

    text = str(value).strip()
    if not text:
        return None

    try:
        parsed = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        parsed = None

    if parsed is None:
        try:
            parsed = date_parser.parse(text)
        except (TypeError, ValueError, OverflowError):
            return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def normalize_text(value: Any, max_length: int | None = None) -> str:
    # summary/description 由来のHTMLを落として、画面表示向けの素直な文字列に寄せる。
    text = unescape(str(value or ""))
    extractor = PlainTextExtractor()
    extractor.feed(text)
    plain_text = extractor.get_text()
    normalized = re.sub(r"\s+", " ", plain_text).strip()

    if max_length is not None and len(normalized) > max_length:
        return normalized[: max_length - 1].rstrip() + "…"

    return normalized


def normalize_link(link: str) -> str:
    return link.strip()


def format_datetime_label(value: datetime | None) -> tuple[str, str, tuple[int, float]]:
    if value is None:
        return "", "", (1, 0.0)

    utc_value = value.astimezone(timezone.utc)
    local_value = utc_value.astimezone(DISPLAY_TIMEZONE)
    return (
        utc_value.isoformat().replace("+00:00", "Z"),
        local_value.strftime("%Y/%m/%d %H:%M"),
        (0, -utc_value.timestamp()),
    )


def extract_summary(entry: Any) -> str:
    summary_candidates = [
        entry.get("summary"),
        entry.get("description"),
        entry.get("content", [{}])[0].get("value") if entry.get("content") else "",
    ]

    for candidate in summary_candidates:
        summary = normalize_text(candidate, max_length=180)
        if summary:
            return summary

    return ""


def build_news_item(entry: Any, source_name: str) -> NewsItem | None:
    title = normalize_text(entry.get("title"))
    link = normalize_link(entry.get("link", ""))

    if not title or not link:
        return None

    published_value = parse_feed_datetime(entry)
    published, published_label, sort_key = format_datetime_label(published_value)

    return NewsItem(
        title=title,
        link=link,
        source=source_name,
        published=published,
        published_label=published_label,
        summary=extract_summary(entry),
        sort_key=sort_key,
    )


def fetch_feed_items(feed_config: dict[str, str]) -> list[NewsItem]:
    source_name = feed_config["name"]
    url = feed_config["url"]
    logging.info("Fetching feed: %s (%s)", source_name, url)

    try:
        content = fetch_feed_content(url)
        parsed_feed = feedparser.parse(content)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        logging.error("Failed to fetch feed %s: %s", source_name, error)
        return []
    except Exception as error:  # noqa: BLE001
        logging.exception("Unexpected fetch error for %s: %s", source_name, error)
        return []

    if parsed_feed.bozo:
        logging.warning("Feed parse warning for %s: %s", source_name, parsed_feed.bozo_exception)

    items: list[NewsItem] = []
    for entry in parsed_feed.entries[:MAX_ITEMS_PER_FEED]:
        item = build_news_item(entry, source_name)
        if item is not None:
            items.append(item)

    logging.info("Collected %d items from %s", len(items), source_name)
    return items


def deduplicate_and_sort(items: list[NewsItem]) -> list[NewsItem]:
    unique_items: dict[str, NewsItem] = {}

    for item in items:
        normalized_link = item.link.casefold()
        existing = unique_items.get(normalized_link)
        if existing is None or item.sort_key < existing.sort_key:
            unique_items[normalized_link] = item

    sorted_items = sorted(unique_items.values(), key=lambda item: item.sort_key)
    return sorted_items[:MAX_ITEMS_TOTAL]


def write_output(items: list[NewsItem], path: Path) -> None:
    now_utc = datetime.now(timezone.utc)
    payload = {
        "updated_at": now_utc.isoformat().replace("+00:00", "Z"),
        "updated_label": now_utc.astimezone(DISPLAY_TIMEZONE).strftime("%Y/%m/%d %H:%M"),
        "items": [item.to_dict() for item in items],
    }

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def main() -> int:
    setup_logging()

    try:
        feed_configs = load_feed_configs(FEEDS_PATH)
    except Exception as error:  # noqa: BLE001
        logging.exception("Failed to load feed configs: %s", error)
        return 1

    all_items: list[NewsItem] = []
    for config in feed_configs:
        all_items.extend(fetch_feed_items(config))

    sorted_items = deduplicate_and_sort(all_items)
    # 一時的な外部障害で空配列になった場合でも、前回の成功データは残す。
    if not sorted_items and OUTPUT_PATH.exists() and feed_configs:
        logging.warning("No items collected. Keeping existing output file: %s", OUTPUT_PATH)
        return 0

    write_output(sorted_items, OUTPUT_PATH)
    logging.info("Wrote %d items to %s", len(sorted_items), OUTPUT_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
