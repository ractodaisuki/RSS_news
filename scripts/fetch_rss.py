#!/usr/bin/env python3

from __future__ import annotations

import json
import logging
import re
import ssl
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from itertools import combinations
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
TAG_RULES_PATH = ROOT_DIR / "config" / "tag_rules.json"
NEWS_OUTPUT_PATH = ROOT_DIR / "data" / "news.json"
ANALYTICS_OUTPUT_PATH = ROOT_DIR / "data" / "analytics.json"
MAX_ITEMS_PER_FEED = 20
MAX_ITEMS_TOTAL = 300
MAX_SUMMARY_LENGTH = 180
MAX_TAGS_PER_ITEM = 3
MAX_RECENT_HIGH_IMPORTANCE = 10
MAX_TOP_TAGS = 8
MAX_TOP_SOURCES = 8
MAX_CROSS_TAGS = 8
REQUEST_TIMEOUT = 20
USER_AGENT = "RSSNewsApp/1.0 (+https://github.com/)"
DISPLAY_TIMEZONE = ZoneInfo("Asia/Tokyo")
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
DEFAULT_TAG = "その他"
MIN_KEYWORD_LENGTH = 3
IGNORED_GENERIC_KEYWORDS = {"ai", "api", "x"}
GAME_TAG_PRIORITY = {
    "インディーゲーム": 1,
    "新作ゲーム": 2,
    "ゲーム発表・イベント": 3,
    "ゲームハード": 4,
    "ゲーム業界": 5,
    "ゲーム": 6,
}
GENERIC_GAME_TAG = "ゲーム"
NON_GENERIC_GAME_TAGS = set(GAME_TAG_PRIORITY) - {GENERIC_GAME_TAG}
GAME_EVENT_CONTEXT_FREE_KEYWORDS = {
    "ニンテンドーダイレクト",
    "nintendo direct",
    "state of play",
    "ゲームショウ",
    "tgs",
    "e3",
    "gamescom",
}
GAME_CONTEXT_HINTS = {
    "ゲーム",
    "ゲームソフト",
    "ゲーム機",
    "新作ゲーム",
    "新作タイトル",
    "インディーゲーム",
    "同人ゲーム",
    "itch.io",
    "steam",
    "switch",
    "switch2",
    "switch 2",
    "playstation",
    "ps5",
    "xbox",
    "steam deck",
    "任天堂",
    "nintendo",
    "ニンテンドースイッチ",
    "ゲームスタジオ",
    "ゲーム業界",
    "ゲームハード",
}
STRONG_TITLE_KEYWORDS = (
    "発表",
    "公開",
    "開始",
    "導入",
    "判明",
    "決定",
    "規制",
    "障害",
    "脆弱性",
)
IMPORTANCE_BONUS_TAGS = {"AI", "医療", "セキュリティ", "規制・法律"}
PRIMARY_SOURCES = {"NHK NEWS WEB", "ITmedia NEWS", "Impress Watch", "Gigazine"}
LONG_SUMMARY_THRESHOLD = 80
SHORT_SUMMARY_THRESHOLD = 24


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
    tags: list[str]
    importance: int
    sort_key: tuple[int, float]
    published_dt: datetime | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "link": self.link,
            "source": self.source,
            "published": self.published,
            "published_label": self.published_label,
            "summary": self.summary,
            "tags": self.tags,
            "importance": self.importance,
        }


@dataclass
class FetchStats:
    total_feeds: int = 0
    successful_feeds: int = 0
    failed_feeds: int = 0


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def load_json(path: Path, description: str) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def load_feed_configs(path: Path) -> list[dict[str, str]]:
    configs = load_json(path, "feed configs")
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


def load_tag_rules(path: Path) -> dict[str, list[str]]:
    rules = load_json(path, "tag rules")
    if not isinstance(rules, dict):
        raise ValueError("tag_rules.json must contain an object.")

    normalized_rules: dict[str, list[str]] = {}
    for tag, keywords in rules.items():
        if not isinstance(tag, str) or not isinstance(keywords, list):
            logging.warning("Skipping invalid tag rule: %r -> %r", tag, keywords)
            continue

        clean_keywords: list[str] = []
        for keyword in keywords:
            normalized_keyword = normalize_text(keyword).casefold()
            if should_ignore_keyword(normalized_keyword):
                continue

            clean_keywords.append(normalized_keyword)

        if clean_keywords:
            normalized_rules[tag.strip()] = clean_keywords

    return normalized_rules


def should_ignore_keyword(keyword: str) -> bool:
    if not keyword:
        return True

    if len(keyword) < MIN_KEYWORD_LENGTH:
        return True

    return keyword in IGNORED_GENERIC_KEYWORDS


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


def format_datetime(value: datetime | None) -> tuple[str, str, tuple[int, float]]:
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
        summary = normalize_text(candidate, max_length=MAX_SUMMARY_LENGTH)
        if summary:
            return summary

    return ""


def detect_tags(title: str, summary: str, rules: dict[str, list[str]]) -> list[str]:
    normalized_title = normalize_text(title).casefold()
    normalized_summary = normalize_text(summary).casefold()
    has_game_context = contains_any_keyword(normalized_title, GAME_CONTEXT_HINTS) or contains_any_keyword(
        normalized_summary, GAME_CONTEXT_HINTS
    )
    scored_tags: list[tuple[str, int, int, int]] = []

    for order, (tag, keywords) in enumerate(rules.items()):
        title_hits = 0
        summary_hits = 0

        for keyword in keywords:
            if not keyword_matches(tag, keyword, normalized_title, has_game_context):
                title_match = False
            else:
                title_match = keyword in normalized_title

            if title_match:
                title_hits += 1
                continue

            if keyword_matches(tag, keyword, normalized_summary, has_game_context):
                summary_hits += 1

        if title_hits or summary_hits:
            scored_tags.append((tag, title_hits, summary_hits, order))

    if not scored_tags:
        return [DEFAULT_TAG]

    matched_tags = {tag for tag, _, _, _ in scored_tags}
    if GENERIC_GAME_TAG in matched_tags and matched_tags & NON_GENERIC_GAME_TAGS:
        scored_tags = [item for item in scored_tags if item[0] != GENERIC_GAME_TAG]

    scored_tags.sort(
        key=lambda item: (
            -(item[1] > 0),
            -item[1],
            game_tag_rank(item[0]),
            -item[2],
            item[3],
            item[0],
        )
    )
    return [tag for tag, _, _, _ in scored_tags[:MAX_TAGS_PER_ITEM]]


def contains_any_keyword(text: str, keywords: set[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def keyword_matches(tag: str, keyword: str, text: str, has_game_context: bool) -> bool:
    if keyword not in text:
        return False

    if tag != "ゲーム発表・イベント":
        return True

    if keyword in GAME_EVENT_CONTEXT_FREE_KEYWORDS:
        return True

    return has_game_context


def game_tag_rank(tag: str) -> int:
    return GAME_TAG_PRIORITY.get(tag, len(GAME_TAG_PRIORITY) + 1)


def calc_importance(title: str, summary: str, source: str, tags: list[str]) -> int:
    score = 2
    title_text = title.casefold()

    if any(keyword.casefold() in title_text for keyword in STRONG_TITLE_KEYWORDS):
        score += 2

    if len(summary) >= LONG_SUMMARY_THRESHOLD:
        score += 1

    if any(tag in IMPORTANCE_BONUS_TAGS for tag in tags):
        score += 1

    if source in PRIMARY_SOURCES:
        score += 1

    if len(summary) < SHORT_SUMMARY_THRESHOLD:
        score -= 1

    return max(1, min(5, score))


def build_news_item(entry: Any, source_name: str, tag_rules: dict[str, list[str]]) -> NewsItem | None:
    title = normalize_text(entry.get("title"))
    link = normalize_link(entry.get("link", ""))

    if not title or not link:
        return None

    summary = extract_summary(entry)
    tags = detect_tags(title, summary, tag_rules)
    importance = calc_importance(title, summary, source_name, tags)
    published_dt = parse_feed_datetime(entry)
    published, published_label, sort_key = format_datetime(published_dt)

    return NewsItem(
        title=title,
        link=link,
        source=source_name,
        published=published,
        published_label=published_label,
        summary=summary,
        tags=tags,
        importance=importance,
        sort_key=sort_key,
        published_dt=published_dt,
    )


def fetch_feed_items(feed_config: dict[str, str], tag_rules: dict[str, list[str]]) -> tuple[list[NewsItem], bool]:
    source_name = feed_config["name"]
    url = feed_config["url"]
    logging.info("Fetching feed: %s (%s)", source_name, url)

    try:
        content = fetch_feed_content(url)
        parsed_feed = feedparser.parse(content)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        logging.error("Failed to fetch feed %s: %s", source_name, error)
        return [], False
    except Exception as error:  # noqa: BLE001
        logging.exception("Unexpected fetch error for %s: %s", source_name, error)
        return [], False

    if parsed_feed.bozo:
        logging.warning("Feed parse warning for %s: %s", source_name, parsed_feed.bozo_exception)

    items: list[NewsItem] = []
    for entry in parsed_feed.entries[:MAX_ITEMS_PER_FEED]:
        item = build_news_item(entry, source_name, tag_rules)
        if item is not None:
            items.append(item)

    logging.info("Collected %d items from %s", len(items), source_name)
    return items, True


def deduplicate_and_sort(items: list[NewsItem]) -> list[NewsItem]:
    unique_items: dict[str, NewsItem] = {}

    for item in items:
        normalized_link = item.link.casefold()
        existing = unique_items.get(normalized_link)
        if existing is None or item.sort_key < existing.sort_key:
            unique_items[normalized_link] = item

    return sorted(unique_items.values(), key=lambda item: item.sort_key)[:MAX_ITEMS_TOTAL]


def get_now_labels() -> tuple[str, str]:
    now_utc = datetime.now(timezone.utc)
    return (
        now_utc.isoformat().replace("+00:00", "Z"),
        now_utc.astimezone(DISPLAY_TIMEZONE).strftime("%Y/%m/%d %H:%M"),
    )


def load_existing_payload(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None

    try:
        payload = load_json(path, f"existing payload {path.name}")
    except Exception as error:  # noqa: BLE001
        logging.warning("Failed to load existing JSON %s: %s", path, error)
        return None

    return payload if isinstance(payload, dict) else None


def build_news_json(items: list[NewsItem], existing_payload: dict[str, Any] | None) -> dict[str, Any]:
    updated_at, updated_label = get_now_labels()
    payload = {
        "updated_at": updated_at,
        "updated_label": updated_label,
        "items": [item.to_dict() for item in items],
    }

    if existing_payload and existing_payload.get("items") == payload["items"]:
        payload["updated_at"] = existing_payload.get("updated_at", updated_at)
        payload["updated_label"] = existing_payload.get("updated_label", updated_label)

    return payload


def build_top_entries(
    counter: Counter[str],
    label_key: str,
    limit: int,
    demote_labels: set[str] | None = None,
) -> list[dict[str, Any]]:
    demote_labels = demote_labels or set()
    sorted_items = sorted(counter.items(), key=lambda item: (item[0] in demote_labels, -item[1], item[0]))
    return [{label_key: name, "count": count} for name, count in sorted_items[:limit]]


def build_recent_high_importance(items: list[NewsItem]) -> list[dict[str, Any]]:
    recent_items = [item for item in items if item.importance >= 4]
    return [
        {
            "title": item.title,
            "link": item.link,
            "source": item.source,
            "published_label": item.published_label,
            "importance": item.importance,
            "tags": item.tags,
        }
        for item in recent_items[:MAX_RECENT_HIGH_IMPORTANCE]
    ]


def build_cross_tag_counts(items: list[NewsItem]) -> list[dict[str, Any]]:
    counter: Counter[str] = Counter()

    for item in items:
        clean_tags = sorted(set(tag for tag in item.tags if tag != DEFAULT_TAG))
        for left, right in combinations(clean_tags, 2):
            counter[f"{left} × {right}"] += 1

    return [
        {"pair": pair, "count": count}
        for pair, count in sorted(counter.items(), key=lambda entry: (-entry[1], entry[0]))[:MAX_CROSS_TAGS]
    ]


def build_insights(analytics: dict[str, Any]) -> list[str]:
    insights: list[str] = []
    total_articles = analytics["total_articles"]

    if total_articles <= 0:
        return ["記事がまだないため、分析結果は次回更新後に増えていきます。"]

    top_tags = analytics["top_tags"]
    top_sources = analytics["top_sources"]
    high_importance_count = sum(
        count for score, count in analytics["importance_counts"].items() if int(score) >= 4
    )

    if top_tags:
        top_tag = top_tags[0]
        ratio = round(top_tag["count"] / total_articles * 100)
        insights.append(f"最も多いテーマは {top_tag['tag']} で、全体の約{ratio}%を占めています。")

    if len(top_tags) > 1 and top_tags[1]["count"] >= max(3, total_articles // 8):
        insights.append(f"{top_tags[1]['tag']} 関連も多く、複数テーマが並行して目立っています。")

    if high_importance_count:
        ratio = round(high_importance_count / total_articles * 100)
        insights.append(f"重要度4以上の記事は {high_importance_count} 件で、全体の約{ratio}%です。")

    if top_sources:
        top_source = top_sources[0]
        ratio = round(top_source["count"] / total_articles * 100)
        insights.append(f"{top_source['source']} 由来の記事が最も多く、全体の約{ratio}%を占めています。")

    if analytics["cross_tag_counts"]:
        top_pair = analytics["cross_tag_counts"][0]
        insights.append(f"{top_pair['pair']} の組み合わせが {top_pair['count']} 件あり、分野横断の話題が見られます。")

    return insights[:4]


def build_analytics_json(items: list[NewsItem], existing_payload: dict[str, Any] | None) -> dict[str, Any]:
    generated_at, generated_label = get_now_labels()
    tag_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    importance_counts: Counter[str] = Counter({str(score): 0 for score in range(1, 6)})
    daily_counts: Counter[str] = Counter()

    for item in items:
        for tag in item.tags:
            tag_counts[tag] += 1

        source_counts[item.source] += 1
        importance_counts[str(item.importance)] += 1

        if item.published_dt is not None:
            local_day = item.published_dt.astimezone(DISPLAY_TIMEZONE).strftime("%Y-%m-%d")
            daily_counts[local_day] += 1

    analytics = {
        "generated_at": generated_at,
        "generated_label": generated_label,
        "total_articles": len(items),
        "tag_counts": dict(sorted(tag_counts.items(), key=lambda item: (-item[1], item[0]))),
        "source_counts": dict(sorted(source_counts.items(), key=lambda item: (-item[1], item[0]))),
        "importance_counts": {key: importance_counts[key] for key in map(str, range(1, 6))},
        "daily_counts": dict(sorted(daily_counts.items())),
        "top_tags": build_top_entries(tag_counts, "tag", MAX_TOP_TAGS, demote_labels={DEFAULT_TAG}),
        "top_sources": build_top_entries(source_counts, "source", MAX_TOP_SOURCES),
        "recent_high_importance": build_recent_high_importance(items),
        "cross_tag_counts": build_cross_tag_counts(items),
    }
    analytics["insights"] = build_insights(analytics)

    if existing_payload:
        previous_body = {key: value for key, value in existing_payload.items() if key not in {"generated_at", "generated_label"}}
        current_body = {key: value for key, value in analytics.items() if key not in {"generated_at", "generated_label"}}
        if previous_body == current_body:
            analytics["generated_at"] = existing_payload.get("generated_at", generated_at)
            analytics["generated_label"] = existing_payload.get("generated_label", generated_label)

    return analytics


def save_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")


def print_fetch_summary(stats: FetchStats, article_count: int) -> None:
    print(f"Fetched feeds: {stats.total_feeds}")
    print(f"Successful feeds: {stats.successful_feeds}")
    print(f"Failed feeds: {stats.failed_feeds}")
    print(f"Articles collected: {article_count}")


def main() -> int:
    setup_logging()

    try:
        feed_configs = load_feed_configs(FEEDS_PATH)
        tag_rules = load_tag_rules(TAG_RULES_PATH)
    except Exception as error:  # noqa: BLE001
        logging.exception("Failed to load configuration: %s", error)
        return 1

    all_items: list[NewsItem] = []
    stats = FetchStats(total_feeds=len(feed_configs))
    for config in feed_configs:
        items, fetched = fetch_feed_items(config, tag_rules)
        if fetched:
            stats.successful_feeds += 1
        else:
            stats.failed_feeds += 1

        all_items.extend(items)

    sorted_items = deduplicate_and_sort(all_items)
    if not sorted_items and NEWS_OUTPUT_PATH.exists() and feed_configs:
        logging.warning("No items collected. Keeping existing output files.")
        print_fetch_summary(stats, 0)
        return 1

    existing_news = load_existing_payload(NEWS_OUTPUT_PATH)
    news_payload = build_news_json(sorted_items, existing_news)
    save_json(NEWS_OUTPUT_PATH, news_payload)
    logging.info("Wrote %d items to %s", len(sorted_items), NEWS_OUTPUT_PATH)

    try:
        existing_analytics = load_existing_payload(ANALYTICS_OUTPUT_PATH)
        analytics_payload = build_analytics_json(sorted_items, existing_analytics)
        save_json(ANALYTICS_OUTPUT_PATH, analytics_payload)
        logging.info("Wrote analytics to %s", ANALYTICS_OUTPUT_PATH)
    except Exception as error:  # noqa: BLE001
        logging.exception("Failed to build analytics.json: %s", error)
        print_fetch_summary(stats, len(sorted_items))
        return 1

    print_fetch_summary(stats, len(sorted_items))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
