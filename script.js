const INITIAL_VISIBLE_COUNT = 100;
const LOAD_MORE_COUNT = 100;
const LATEST_VISIBLE_COUNT = 10;
const FEATURED_LIMIT = 4;
const DIGEST_LIMIT = 3;
const INSIGHT_DIGEST_LIMIT = 2;
const STATUS_REFRESH_MS = 60_000;
const STALE_WARNING_HOURS = 6;
const STALE_ERROR_HOURS = 24;
const SWIPE_THRESHOLD = 60;
const SWIPE_VERTICAL_TOLERANCE = 40;
const SWIPE_MAX_OFFSET = 96;
const THEME_STORAGE_KEY = "rss-news-theme";
const READ_LATER_STORAGE_KEY = "rss_read_later_items";
const VIEW_MODE_STORAGE_KEY = "rss_view_mode";
const ACTIONS_URL = "https://github.com/ractodaisuki/RSS_news/actions";

const state = {
  allItems: [],
  filteredItems: [],
  readLaterItems: [],
  viewMode: "all",
  readLaterEnabled: true,
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
  viewAllButton: document.getElementById("view-all-button"),
  viewReadLaterButton: document.getElementById("view-read-later-button"),
  readLaterCountButton: document.getElementById("read-later-count-button"),
  latestButton: document.getElementById("latest-button"),
  clearButton: document.getElementById("clear-button"),
  updateButton: document.getElementById("updateBtn"),
  themeToggle: document.getElementById("theme-toggle"),
  updateTime: document.getElementById("update-time"),
  resultSummary: document.getElementById("result-summary"),
  homeSummary: document.getElementById("home-summary"),
  topTagsDigest: document.getElementById("top-tags-digest"),
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
  lastFailureItem: document.getElementById("lastFailureItem"),
  lastFailureAt: document.getElementById("lastFailureAt"),
  statusWarning: document.getElementById("statusWarning"),
  runLink: document.getElementById("runLink"),
};

async function init() {
  state.readLaterItems = getReadLaterItems();
  state.viewMode = getCurrentViewMode();
  setupTheme();
  bindEvents();
  renderReadLaterCount();
  renderViewMode();
  await Promise.all([loadPageData(), loadStatus()]);
  window.setInterval(loadStatus, STATUS_REFRESH_MS);
}

function bindEvents() {
  elements.searchInput.addEventListener("input", handleFilterChange);
  elements.sourceFilter.addEventListener("change", handleFilterChange);
  elements.tagFilter.addEventListener("change", handleFilterChange);
  elements.sortOrder.addEventListener("change", handleFilterChange);
  elements.viewAllButton.addEventListener("click", () => setCurrentViewMode("all"));
  elements.viewReadLaterButton.addEventListener("click", () => setCurrentViewMode("read-later"));
  elements.readLaterCountButton.addEventListener("click", () => setCurrentViewMode("read-later"));

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
    state.visibleCount += LOAD_MORE_COUNT;
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
    renderMessage(elements.insightsDigest, "分析データを読めませんでした");
    return;
  }

  renderDigestList(
    elements.topTagsDigest,
    (analytics.top_tags || []).slice(0, DIGEST_LIMIT).map((entry) => `${entry.tag} (${entry.count}件)`)
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
  let statusMessage = "更新状況を確認してください";
  if (normalizedState === "idle") {
    statusMessage = "次回更新を待機しています";
  } else if (normalizedState === "running") {
    statusMessage = "RSS取得と分析を実行中です";
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
  elements.lastFailureItem.hidden = normalizedState !== "error" && !status.last_failure_at;

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
  const baseItems = state.viewMode === "read-later" ? state.readLaterItems : state.allItems;

  const filtered = baseItems.filter((item) => {
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

  state.filteredItems = state.viewMode === "read-later" ? sortReadLaterItems(filtered) : sortItems(filtered, elements.sortOrder.value);
  renderNews();
}

function sortReadLaterItems(items) {
  return [...items].sort((left, right) => {
    const savedDiff = (right.saved_at || "").localeCompare(left.saved_at || "");
    if (savedDiff !== 0) {
      return savedDiff;
    }

    const publishedDiff = (right.published || "").localeCompare(left.published || "");
    if (publishedDiff !== 0) {
      return publishedDiff;
    }

    return (left.title || "").localeCompare(right.title || "", "ja");
  });
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
    const wrapper = elements.featuredTemplate.content.firstElementChild.cloneNode(true);
    const node = wrapper.querySelector(".news-item");
    bindItemToCard(wrapper, node, item, true);
    node.querySelector(".highlight-title").textContent = item.title || "タイトルなし";
    node.querySelector(".highlight-summary").textContent = item.summary || "概要はありません。";
    fragment.appendChild(wrapper);
  }

  elements.featuredList.innerHTML = "";
  elements.featuredList.appendChild(fragment);
}

function renderNews() {
  const itemsToShow = state.filteredItems.slice(0, state.visibleCount);
  elements.newsList.innerHTML = "";

  elements.updateTime.textContent = state.updatedLabel ? `最終更新: ${state.updatedLabel}` : "最終更新: 情報なし";

  if (state.filteredItems.length === 0) {
    elements.resultSummary.textContent = state.viewMode === "read-later" ? "あとで読む 0件" : "0件";
    elements.loadMoreButton.hidden = true;
    renderMessage(
      elements.newsList,
      state.viewMode === "read-later"
        ? "あとで読む記事はまだありません。気になる記事を保存するとここに表示されます。"
        : "該当する記事がありません"
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of itemsToShow) {
    const wrapper = elements.newsTemplate.content.firstElementChild.cloneNode(true);
    const node = wrapper.querySelector(".news-item");
    bindItemToCard(wrapper, node, item, false);
    node.querySelector(".news-title").textContent = item.title || "タイトルなし";
    node.querySelector(".news-summary").textContent = item.summary || "概要はありません。";
    fragment.appendChild(wrapper);
  }

  elements.newsList.appendChild(fragment);
  elements.resultSummary.textContent = state.viewMode === "read-later"
    ? `あとで読む ${itemsToShow.length} / ${state.filteredItems.length}件`
    : `${itemsToShow.length} / ${state.filteredItems.length}件を表示`;
  elements.loadMoreButton.hidden = state.filteredItems.length <= itemsToShow.length;
}

function bindItemToCard(wrapper, node, item, isFeatured) {
  const importance = item.importance || 1;
  node.querySelector(".news-source").textContent = item.source || "不明";
  node.querySelector(".news-date").textContent = item.published_label || "日時不明";
  node.href = item.link || "#";
  node.setAttribute("aria-label", `${item.title || "記事"} を開く`);
  node.dataset.importance = String(importance);
  node.title = `重要度: ${getImportanceLabel(importance)}`;
  node.classList.toggle("is-read-later", isReadLater(item.link));

  if (isFeatured && importance >= 5) {
    node.classList.add("is-top-priority");
  } else {
    node.classList.remove("is-top-priority");
  }

  const tagList = node.querySelector(".tag-list");
  tagList.innerHTML = "";
  for (const tag of item.tags || []) {
    tagList.appendChild(createTagChip(tag));
  }

  bindReadLaterButton(node, item);
  attachSwipeReadLater(wrapper, node, item);
  bindCompactMedia(node, item);
}

function bindReadLaterButton(node, item) {
  const button = node.querySelector(".read-later-btn");
  const savedBadge = node.querySelector(".saved-badge");
  if (!button || !savedBadge) {
    return;
  }

  const saved = isReadLater(item.link);
  button.textContent = saved ? "★" : "☆";
  button.classList.toggle("read-later-btn--active", saved);
  button.setAttribute("aria-pressed", String(saved));
  button.setAttribute("aria-label", saved ? "あとで読むから削除" : "あとで読むに保存");
  button.disabled = !state.readLaterEnabled;
  savedBadge.hidden = !saved;

  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleReadLater(item);
  };
}

function attachSwipeReadLater(wrapper, node, article) {
  if (!wrapper || !node) {
    return;
  }

  const swipeBg = wrapper.querySelector(".news-item__swipe-bg");
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let tracking = false;
  let swiping = false;
  let swipeTriggered = false;

  const resetSwipe = () => {
    wrapper.classList.remove("is-swiping", "is-swipe-left", "is-swipe-right");
    node.style.transform = "";
    deltaX = 0;
    deltaY = 0;
    tracking = false;
    swiping = false;
  };

  const setSwipeLabel = () => {
    if (!swipeBg) {
      return;
    }

    if (deltaX <= 0) {
      swipeBg.textContent = isReadLater(article.link) ? "保存済み" : "あとで読む";
    } else {
      swipeBg.textContent = isReadLater(article.link) ? "保存解除" : "戻る";
    }
  };

  wrapper.ontouchstart = (event) => {
    if (!window.matchMedia("(max-width: 720px)").matches || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    deltaX = 0;
    deltaY = 0;
    tracking = true;
    swiping = false;
    swipeTriggered = false;
    setSwipeLabel();
  };

  wrapper.ontouchmove = (event) => {
    if (!tracking || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    deltaX = touch.clientX - startX;
    deltaY = touch.clientY - startY;

    if (Math.abs(deltaY) > Math.abs(deltaX) || Math.abs(deltaY) > SWIPE_VERTICAL_TOLERANCE) {
      return;
    }

    swiping = true;
    wrapper.classList.add("is-swiping");
    wrapper.classList.toggle("is-swipe-left", deltaX < 0);
    wrapper.classList.toggle("is-swipe-right", deltaX > 0);
    setSwipeLabel();
    node.style.transform = `translateX(${Math.max(-SWIPE_MAX_OFFSET, Math.min(deltaX, SWIPE_MAX_OFFSET))}px)`;
  };

  wrapper.ontouchend = () => {
    if (!tracking) {
      return;
    }

    const shouldSave = deltaX <= -SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_VERTICAL_TOLERANCE && !isReadLater(article.link);
    const shouldRemove = deltaX >= SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_VERTICAL_TOLERANCE && isReadLater(article.link);

    resetSwipe();

    if (shouldSave) {
      swipeTriggered = true;
      saveReadLaterItem(article);
      state.readLaterItems = getReadLaterItems();
      renderReadLaterCount();
      renderViewMode();
      renderFeatured(state.allItems);
      applyFilters();
      return;
    }

    if (shouldRemove) {
      swipeTriggered = true;
      removeReadLaterItem(article.link);
      state.readLaterItems = getReadLaterItems();
      renderReadLaterCount();
      renderViewMode();
      renderFeatured(state.allItems);
      applyFilters();
      return;
    }

    swipeTriggered = false;
  };

  wrapper.ontouchcancel = () => {
    resetSwipe();
    swipeTriggered = false;
  };

  node.onclick = (event) => {
    if (swipeTriggered || swiping) {
      event.preventDefault();
      event.stopPropagation();
      swipeTriggered = false;
    }
  };
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

function getImportanceLabel(importance) {
  if (importance >= 5) {
    return "かなり高い";
  }
  if (importance >= 4) {
    return "高め";
  }
  if (importance >= 3) {
    return "標準";
  }
  if (importance >= 2) {
    return "控えめ";
  }
  return "低め";
}

function getReadLaterItems() {
  try {
    const raw = localStorage.getItem(READ_LATER_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch (error) {
    state.readLaterEnabled = false;
    console.error("Failed to read read-later items:", error);
    return [];
  }
}

function persistReadLaterItems(items) {
  try {
    localStorage.setItem(READ_LATER_STORAGE_KEY, JSON.stringify(items));
    state.readLaterEnabled = true;
    return true;
  } catch (error) {
    state.readLaterEnabled = false;
    console.error("Failed to persist read-later items:", error);
    return false;
  }
}

function saveReadLaterItem(article) {
  const existingItems = getReadLaterItems();
  if (existingItems.some((item) => item.link === article.link)) {
    state.readLaterItems = existingItems;
    return;
  }

  const nextItems = [
    {
      title: article.title || "",
      link: article.link || "",
      source: article.source || "",
      published: article.published || "",
      published_label: article.published_label || "",
      summary: article.summary || "",
      tags: [...(article.tags || [])],
      importance: article.importance || 1,
      saved_at: new Date().toISOString(),
    },
    ...existingItems,
  ];

  if (persistReadLaterItems(nextItems)) {
    state.readLaterItems = nextItems;
  }
}

function removeReadLaterItem(link) {
  const nextItems = getReadLaterItems().filter((item) => item.link !== link);
  if (persistReadLaterItems(nextItems)) {
    state.readLaterItems = nextItems;
  }
}

function isReadLater(link) {
  return state.readLaterItems.some((item) => item.link === link);
}

function toggleReadLater(article) {
  if (!state.readLaterEnabled && !getReadLaterItems().length) {
    return;
  }

  if (isReadLater(article.link)) {
    removeReadLaterItem(article.link);
  } else {
    saveReadLaterItem(article);
  }

  state.readLaterItems = getReadLaterItems();
  renderReadLaterCount();
  renderViewMode();
  renderFeatured(state.allItems);
  applyFilters();
}

function renderReadLaterCount() {
  const count = state.readLaterItems.length;
  elements.readLaterCountButton.textContent = state.readLaterEnabled ? `あとで読む（${count}）` : "あとで読むは利用不可";
  elements.readLaterCountButton.disabled = !state.readLaterEnabled;
  elements.viewReadLaterButton.textContent = `あとで読む${state.readLaterEnabled ? `（${count}）` : ""}`;
  elements.viewReadLaterButton.disabled = !state.readLaterEnabled;
}

function getCurrentViewMode() {
  try {
    const value = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return value === "read-later" ? "read-later" : "all";
  } catch (error) {
    return "all";
  }
}

function setCurrentViewMode(mode) {
  state.viewMode = mode === "read-later" && state.readLaterEnabled ? "read-later" : "all";
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, state.viewMode);
  } catch (error) {
    console.warn("Failed to store view mode:", error);
  }
  state.visibleCount = INITIAL_VISIBLE_COUNT;
  renderViewMode();
  applyFilters();
}

function renderViewMode() {
  const isReadLaterMode = state.viewMode === "read-later";
  elements.viewAllButton.classList.toggle("view-toggle__button--active", !isReadLaterMode);
  elements.viewReadLaterButton.classList.toggle("view-toggle__button--active", isReadLaterMode);
  elements.viewAllButton.setAttribute("aria-pressed", String(!isReadLaterMode));
  elements.viewReadLaterButton.setAttribute("aria-pressed", String(isReadLaterMode));
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
    elements.updateTime.textContent = "最終更新を確認中";
    elements.resultSummary.textContent = "記事を読み込み中";
    renderLoadingBlocks(elements.homeSummary, 4, "metric-card skeleton-block");
    renderLoadingBlocks(elements.topTagsDigest, 3, "skeleton-line");
    renderLoadingBlocks(elements.insightsDigest, 2, "skeleton-line");
    renderLoadingBlocks(elements.newsList, 4, "message-card skeleton-block");
    renderLoadingBlocks(elements.featuredList, 2, "message-card skeleton-block");
  }
}

function renderLoadingBlocks(container, count, className) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const node = document.createElement("div");
    node.className = className;
    fragment.appendChild(node);
  }
  container.innerHTML = "";
  container.appendChild(fragment);
}

init();
