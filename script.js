const INITIAL_VISIBLE_COUNT = 50;
const LATEST_VISIBLE_COUNT = 10;
const FEATURED_LIMIT = 5;
const DIGEST_LIMIT = 3;
const INSIGHT_DIGEST_LIMIT = 2;
const THEME_STORAGE_KEY = "rss-news-theme";

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
};

async function init() {
  setupTheme();
  bindEvents();
  await loadPageData();
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
  renderDigestList(
    elements.insightsDigest,
    (analytics.insights || []).slice(0, INSIGHT_DIGEST_LIMIT)
  );
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
  node.querySelector(".news-link").href = item.link;
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
