const INITIAL_VISIBLE_COUNT = 50;
const LATEST_VISIBLE_COUNT = 10;
const FEATURED_LIMIT = 5;
const DIGEST_LIMIT = 3;
const INSIGHT_DIGEST_LIMIT = 2;
const STATUS_REFRESH_MS = 60_000;
const STALE_WARNING_HOURS = 6;
const STALE_ERROR_HOURS = 24;
const THEME_STORAGE_KEY = "rss-news-theme";
const ACTIONS_URL = "https://github.com/ractodaisuki/RSS_news/actions";

const state = {
  allItems: [],
  filteredItems: [],
  visibleCount: INITIAL_VISIBLE_COUNT,
  updatedLabel: "",
  analytics: null,
  theme: document.documentElement.dataset.theme || "light",
};

const elements = {
  searchInput: document.getElementById("search-input"),
  sourceFilter: document.getElementById("source-filter"),
  tagFilter: document.getElementById("tag-filter"),
  sortOrder: document.getElementById("sort-order"),
  latestButton: document.getElementById("latest-button"),
  clearButton: document.getElementById("clear-button"),
  updateButton: document.getElementById("updateBtn"),
  themeToggle: document.getElementById("theme-toggle"),
  updateTime: document.getElementById("update-time"),
  resultSummary: document.getElementById("result-summary"),
  homeSummary: document.getElementById("home-summary"),
  topTagsDigest: document.getElementById("top-tags-digest"),
  topSourcesDigest: document.getElementById("top-sources-digest"),
  insightsDigest: document.getElementById("insights-digest"),
  newsList: document.getElementById("news-list"),
  featuredList: document.getElementById("featured-list"),
  loadMoreButton: document.getElementById("load-more-button"),
  newsTemplate: document.getElementById("news-card-template"),
  featuredTemplate: document.getElementById("featured-card-template"),
  statusCard: document.getElementById("updateStatusCard"),
  statusBadge: document.getElementById("statusBadge"),
  statusMessage: document.getElementById("statusMessage"),
  lastCompletedAt: document.getElementById("lastCompletedAt"),
  lastSuccessAt: document.getElementById("lastSuccessAt"),
  lastFailureAt: document.getElementById("lastFailureAt"),
  statusWarning: document.getElementById("statusWarning"),
  runLink: document.getElementById("runLink"),
};

async function init() {
  setupTheme();
  bindEvents();
  await Promise.all([loadPageData(), loadStatus()]);
  window.setInterval(loadStatus, STATUS_REFRESH_MS);
}

function bindEvents() {
  elements.searchInput.addEventListener("input", handleFilterChange);
  elements.sourceFilter.addEventListener("change", handleFilterChange);
  elements.tagFilter.addEventListener("change", handleFilterChange);
  elements.sortOrder.addEventListener("change", handleFilterChange);

  elements.clearButton.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.sourceFilter.value = "all";
    elements.tagFilter.value = "all";
    elements.sortOrder.value = "newest";
    state.visibleCount = INITIAL_VISIBLE_COUNT;
    applyFilters();
  });

  elements.latestButton.addEventListener("click", () => {
    elements.sortOrder.value = "newest";
    state.visibleCount = LATEST_VISIBLE_COUNT;
    applyFilters();
  });

  elements.loadMoreButton.addEventListener("click", () => {
    state.visibleCount += INITIAL_VISIBLE_COUNT;
    renderNews();
  });

  elements.updateButton.addEventListener("click", () => {
    const ok = window.confirm("GitHub Actions のページを開いて RSS 更新を実行します。移動しますか？");
    if (ok) {
      window.open(ACTIONS_URL, "_blank", "noopener");
    }
  });

  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = state.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme, true);
  });
}

function handleFilterChange() {
  state.visibleCount = INITIAL_VISIBLE_COUNT;
  applyFilters();
}

function setupTheme() {
  updateThemeToggle();

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const syncThemeWithSystem = (event) => {
    if (getStoredTheme()) {
      return;
    }

    setTheme(event.matches ? "dark" : "light", false);
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", syncThemeWithSystem);
    return;
  }

  if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(syncThemeWithSystem);
  }
}

function setTheme(theme, persistPreference) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;

  if (persistPreference) {
    storeTheme(theme);
  }

  updateThemeToggle();
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("Failed to store theme preference:", error);
  }
}

function updateThemeToggle() {
  const isDark = state.theme === "dark";
  elements.themeToggle.textContent = isDark ? "ライトモード" : "ダークモード";
  elements.themeToggle.setAttribute("aria-pressed", String(isDark));
  elements.themeToggle.setAttribute("aria-label", isDark ? "ライトモードに切り替える" : "ダークモードに切り替える");
}

async function loadPageData() {
  setLoadingState(true);

  try {
    const [newsData, analyticsData] = await Promise.all([
      fetchJson("./data/news.json"),
      fetchJson("./data/analytics.json").catch(() => null),
    ]);

    state.allItems = Array.isArray(newsData.items) ? newsData.items : [];
    state.updatedLabel = newsData.updated_label || analyticsData?.generated_label || "";
    state.analytics = analyticsData;

    populateSelect(elements.sourceFilter, collectUniqueValues(state.allItems, "source"));
    populateSelect(elements.tagFilter, collectUniqueTags(state.allItems));
    renderHomeSummary();
    renderDigest();
    renderFeatured(state.allItems);
    applyFilters();
  } catch (error) {
    console.error("Failed to load page data:", error);
    elements.updateTime.textContent = "最終更新: 取得失敗";
    elements.resultSummary.textContent = "記事を読み込めませんでした";
    renderMessage(elements.homeSummary, "サマリーを読み込めませんでした");
    renderMessage(elements.topTagsDigest, "読み込めませんでした");
    renderMessage(elements.topSourcesDigest, "読み込めませんでした");
    renderMessage(elements.insightsDigest, "読み込めませんでした");
    renderMessage(elements.newsList, "記事を読み込めませんでした");
    renderMessage(elements.featuredList, "注目記事を読み込めませんでした");
  } finally {
    setLoadingState(false);
  }
}

async function loadStatus() {
  try {
    const status = await fetchJson("./data/status.json");
    renderStatus(status);
  } catch (error) {
    console.error("Failed to load status:", error);
    renderStatus({
      state: "error",
      message: "更新状況を読み込めませんでした",
      last_completed_at: "",
      last_success_at: "",
      last_failure_at: "",
      run_url: ACTIONS_URL,
    });
  }
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }
  return response.json();
}

function collectUniqueValues(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function collectUniqueTags(items) {
  return [...new Set(items.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b, "ja"));
}

function populateSelect(element, values) {
  element.innerHTML = '<option value="all">すべて</option>';

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    element.appendChild(option);
  }
}

function renderHomeSummary() {
  const analytics = state.analytics;
  const highlightedCount = analytics
    ? (analytics.importance_counts?.["4"] || 0) + (analytics.importance_counts?.["5"] || 0)
    : state.allItems.filter((item) => (item.importance || 0) >= 4).length;
  const topTag = analytics?.top_tags?.[0];

  const summaryCards = [
    {
      label: "総記事数",
      value: `${analytics?.total_articles ?? state.allItems.length}件`,
      note: "現在保持している記事数",
    },
    {
      label: "注目記事数",
      value: `${highlightedCount}件`,
      note: "重要度4以上",
    },
    {
      label: "最多タグ",
      value: topTag ? topTag.tag : "情報なし",
      note: topTag ? `${topTag.count}件` : "集計待ち",
    },
    {
      label: "最終更新",
      value: analytics?.generated_label || state.updatedLabel || "情報なし",
      note: "自動更新の最新時刻",
    },
  ];

  const fragment = document.createDocumentFragment();
  for (const card of summaryCards) {
    const node = document.createElement("article");
    node.className = "metric-card";
    node.innerHTML = `
      <p class="metric-label">${card.label}</p>
      <p class="metric-value">${card.value}</p>
      <p class="metric-description">${card.note}</p>
    `;
    fragment.appendChild(node);
  }

  elements.homeSummary.innerHTML = "";
  elements.homeSummary.appendChild(fragment);
}

function renderDigest() {
  const analytics = state.analytics;

  if (!analytics) {
    renderMessage(elements.topTagsDigest, "分析データを読めませんでした");
    renderMessage(elements.topSourcesDigest, "分析データを読めませんでした");
    renderMessage(elements.insightsDigest, "分析データを読めませんでした");
    return;
  }

  renderDigestList(
    elements.topTagsDigest,
    (analytics.top_tags || []).slice(0, DIGEST_LIMIT).map((entry) => `${entry.tag} (${entry.count}件)`)
  );
  renderDigestList(
    elements.topSourcesDigest,
    (analytics.top_sources || []).slice(0, DIGEST_LIMIT).map((entry) => `${entry.source} (${entry.count}件)`)
  );
  renderDigestList(elements.insightsDigest, (analytics.insights || []).slice(0, INSIGHT_DIGEST_LIMIT));
}

function renderDigestList(container, items) {
  if (items.length === 0) {
    renderMessage(container, "表示できる情報がありません");
    return;
  }

  const list = document.createElement("ul");
  list.className = "digest-items";
  for (const item of items) {
    const element = document.createElement("li");
    element.className = "digest-item";
    element.textContent = item;
    list.appendChild(element);
  }

  container.innerHTML = "";
  container.appendChild(list);
}

function renderStatus(status) {
  const normalizedState = status.state || "idle";
  let statusMessage = "状態不明";
  if (normalizedState === "idle") {
    statusMessage = "通常待機中です";
  } else if (normalizedState === "running") {
    statusMessage = "RSS取得と分析を実行しています";
  } else if (normalizedState === "success") {
    statusMessage = status.message || "更新成功";
  } else if (status.message === "更新状況を読み込めませんでした") {
    statusMessage = status.message;
  } else {
    statusMessage = "更新に失敗しました。GitHub Actions のログを確認してください。";
  }
  const labelMap = {
    idle: "待機中",
    running: "更新中",
    success: "更新成功",
    error: "更新失敗",
  };

  applyStatusClass(normalizedState);
  elements.statusBadge.textContent = labelMap[normalizedState] || "不明";
  elements.statusMessage.textContent = statusMessage;
  elements.lastCompletedAt.textContent = formatDateTime(status.last_completed_at);
  elements.lastSuccessAt.textContent = formatDateTime(status.last_success_at);
  elements.lastFailureAt.textContent = formatDateTime(status.last_failure_at);

  const runUrl = status.run_url || ACTIONS_URL;
  elements.runLink.hidden = false;
  elements.runLink.href = runUrl;

  const staleWarning = buildStaleWarning(status.last_success_at);
  if (staleWarning) {
    elements.statusWarning.hidden = false;
    elements.statusWarning.textContent = staleWarning;
  } else {
    elements.statusWarning.hidden = true;
    elements.statusWarning.textContent = "";
  }
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("ja-JP");
}

function buildStaleWarning(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  if (hours >= STALE_ERROR_HOURS) {
    return "長時間更新されていません。GitHub Actions の状態を確認してください。";
  }

  if (hours >= STALE_WARNING_HOURS) {
    return "情報が少し古い可能性があります。必要なら手動更新を実行してください。";
  }

  return "";
}

function applyStatusClass(stateName) {
  elements.statusCard.classList.remove(
    "status-card--idle",
    "status-card--running",
    "status-card--success",
    "status-card--error"
  );
  elements.statusCard.classList.add(`status-card--${stateName}`);
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const selectedSource = elements.sourceFilter.value;
  const selectedTag = elements.tagFilter.value;

  const filtered = state.allItems.filter((item) => {
    if (selectedSource !== "all" && item.source !== selectedSource) {
      return false;
    }

    const itemTags = item.tags || [];
    if (selectedTag !== "all" && !itemTags.includes(selectedTag)) {
      return false;
    }

    if (!query) {
      return true;
    }

    const targetText = [item.title, item.source, item.summary, ...itemTags].join(" ").toLowerCase();
    return targetText.includes(query);
  });

  state.filteredItems = sortItems(filtered, elements.sortOrder.value);
  renderNews();
}

function sortItems(items, sortOrder) {
  return [...items].sort((left, right) => {
    if (sortOrder === "importance") {
      const importanceDiff = (right.importance || 1) - (left.importance || 1);
      if (importanceDiff !== 0) {
        return importanceDiff;
      }
    }

    const publishedDiff = (right.published || "").localeCompare(left.published || "");
    if (publishedDiff !== 0) {
      return publishedDiff;
    }

    return (left.title || "").localeCompare(right.title || "", "ja");
  });
}

function renderFeatured(items) {
  const featuredItems = sortItems(items.filter((item) => (item.importance || 0) >= 4), "newest").slice(0, FEATURED_LIMIT);

  if (featuredItems.length === 0) {
    renderMessage(elements.featuredList, "注目記事はまだありません");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of featuredItems) {
    const node = elements.featuredTemplate.content.firstElementChild.cloneNode(true);
    bindItemToCard(node, item, true);
    node.querySelector(".highlight-title").textContent = item.title || "タイトルなし";
    node.querySelector(".highlight-summary").textContent = item.summary || "概要はありません。";
    fragment.appendChild(node);
  }

  elements.featuredList.innerHTML = "";
  elements.featuredList.appendChild(fragment);
}

function renderNews() {
  const itemsToShow = state.filteredItems.slice(0, state.visibleCount);
  elements.newsList.innerHTML = "";

  elements.updateTime.textContent = state.updatedLabel ? `最終更新: ${state.updatedLabel}` : "最終更新: 情報なし";

  if (state.filteredItems.length === 0) {
    elements.resultSummary.textContent = "0件";
    elements.loadMoreButton.hidden = true;
    renderMessage(elements.newsList, "該当する記事がありません");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of itemsToShow) {
    const node = elements.newsTemplate.content.firstElementChild.cloneNode(true);
    bindItemToCard(node, item, false);
    node.querySelector(".news-title").textContent = item.title || "タイトルなし";
    node.querySelector(".news-summary").textContent = item.summary || "概要はありません。";
    fragment.appendChild(node);
  }

  elements.newsList.appendChild(fragment);
  elements.resultSummary.textContent = `${itemsToShow.length} / ${state.filteredItems.length}件を表示`;
  elements.loadMoreButton.hidden = state.filteredItems.length <= itemsToShow.length;
}

function bindItemToCard(node, item, isFeatured) {
  node.querySelector(".news-source").textContent = item.source || "不明";
  node.querySelector(".news-date").textContent = item.published_label || "日時不明";
  node.href = item.link || "#";
  node.setAttribute("aria-label", `${item.title || "記事"} を開く`);
  applyImportanceBadge(node.querySelector(".importance-badge"), item.importance || 1);

  const accent = node.querySelector(".card-accent");
  accent.className = `card-accent importance-line importance-line-${item.importance || 1}`;
  if (isFeatured && (item.importance || 0) >= 5) {
    node.classList.add("is-top-priority");
  }

  const tagList = node.querySelector(".tag-list");
  tagList.innerHTML = "";
  for (const tag of item.tags || []) {
    tagList.appendChild(createTagChip(tag));
  }

  bindCompactMedia(node, item);
}

function bindCompactMedia(node, item) {
  const media = node.querySelector(".news-card__media");
  if (!media) {
    return;
  }

  const image = node.querySelector(".news-thumbnail");
  const fallback = node.querySelector(".news-media-fallback");
  const label = node.querySelector(".news-media-label");
  const thumbnailUrl = pickThumbnailUrl(item);

  if (label) {
    label.textContent = buildMediaLabel(item);
  }

  if (!image || !fallback) {
    return;
  }

  image.hidden = true;
  image.removeAttribute("src");
  fallback.hidden = false;

  if (!thumbnailUrl) {
    return;
  }

  image.onload = () => {
    image.hidden = false;
    fallback.hidden = true;
  };
  image.onerror = () => {
    image.hidden = true;
    fallback.hidden = false;
  };
  image.src = thumbnailUrl;
}

function pickThumbnailUrl(item) {
  const candidates = [
    item.thumbnail,
    item.image,
    item.image_url,
    item.media_thumbnail,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      return value;
    }
  }

  return "";
}

function buildMediaLabel(item) {
  const preferred = (item.tags || []).find((tag) => tag && tag !== "その他") || item.source || "NEWS";
  return preferred.length <= 8 ? preferred : `${preferred.slice(0, 8)}…`;
}

function createTagChip(tag) {
  const chip = document.createElement("span");
  chip.className = "tag-chip";
  chip.textContent = tag;
  return chip;
}

function applyImportanceBadge(element, importance) {
  element.className = `importance-badge importance-${importance}`;
  element.textContent = `重要度 ${importance}`;
}

function renderMessage(container, message) {
  const card = document.createElement("div");
  card.className = "message-card";
  card.textContent = message;
  container.innerHTML = "";
  container.appendChild(card);
}

function setLoadingState(isLoading) {
  elements.newsList.setAttribute("aria-busy", String(isLoading));
  elements.loadMoreButton.hidden = true;

  if (isLoading) {
    elements.updateTime.textContent = "最終更新: 読み込み中...";
    elements.resultSummary.textContent = "記事を読み込み中です";
    renderMessage(elements.homeSummary, "サマリーを読み込み中です...");
    renderMessage(elements.topTagsDigest, "読み込み中です...");
    renderMessage(elements.topSourcesDigest, "読み込み中です...");
    renderMessage(elements.insightsDigest, "読み込み中です...");
    renderMessage(elements.newsList, "記事を読み込み中です...");
    renderMessage(elements.featuredList, "注目記事を読み込み中です...");
  }
}

init();
