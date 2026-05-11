const INITIAL_VISIBLE_COUNT = 100;
const LOAD_MORE_COUNT = 100;
const LATEST_VISIBLE_COUNT = 10;
const FEATURED_LIMIT = 2;
const STATUS_REFRESH_MS = 60_000;
const STALE_WARNING_HOURS = 6;
const STALE_ERROR_HOURS = 24;
const SWIPE_THRESHOLD = 60;
const SWIPE_VERTICAL_TOLERANCE = 40;
const SWIPE_MAX_OFFSET = 96;
const THEME_STORAGE_KEY = "rss-news-theme";
const VIEW_MODE_STORAGE_KEY = "rss_view_mode";
const FEEDBACK_TYPES = ["important", "unimportant", "hidden", "unhidden"];
const ACTIONS_URL = "https://github.com/ractodaisuki/RSS_news/actions";
const FOCUS_PRESETS = [
  {
    id: "car-camp",
    label: "車中泊全般",
    tags: ["車中泊", "キャンピングカー", "RVパーク", "ポータブル電源", "防災・避難", "車中泊DIY", "軽バン・ミニバン"],
    keywords: ["車中泊", "キャンピングカー", "rvパーク", "ポータブル電源", "バンライフ", "道の駅", "ffヒーター", "車中泊避難"],
  },
  {
    id: "camper",
    label: "キャンピングカー",
    tags: ["キャンピングカー", "軽バン・ミニバン"],
    keywords: ["キャンピングカー", "軽キャン", "バンコン", "キャブコン", "ハイエース", "n-van", "キャラバン", "nv200"],
  },
  {
    id: "rv-park",
    label: "RVパーク",
    tags: ["RVパーク"],
    keywords: ["rvパーク", "車中泊施設", "道の駅", "宿泊", "くるま旅"],
  },
  {
    id: "power",
    label: "電源・装備",
    tags: ["ポータブル電源", "車中泊DIY"],
    keywords: ["ポータブル電源", "サブバッテリー", "走行充電", "jackery", "bluetti", "ecoflow", "断熱", "ベッドキット"],
  },
  {
    id: "safety",
    label: "防災",
    tags: ["防災・避難"],
    keywords: ["防災", "避難", "車中泊避難", "災害対策", "非常用電源"],
  },
];

const state = {
  allItems: [],
  filteredItems: [],
  readLaterItems: [],
  geminiAnalyses: {},
  focusPreset: "",
  viewMode: "all",
  readLaterEnabled: true,
  visibleCount: INITIAL_VISIBLE_COUNT,
  updatedLabel: "",
  theme: document.documentElement.dataset.theme || "light",
  currentUser: null,
  userEvents: [],
  feedbackByArticleId: new Map(),
  hiddenArticleIds: new Set(),
  showHidden: false,
  interestProfile: null,
  syncStatus: "local",
  syncMessage: "未ログイン: ローカル保存中",
};

const elements = {
  searchInput: document.getElementById("search-input"),
  sourceFilter: document.getElementById("source-filter"),
  tagFilter: document.getElementById("tag-filter"),
  sortOrder: document.getElementById("sort-order"),
  viewAllButton: document.getElementById("view-all-button"),
  viewReadLaterButton: document.getElementById("view-read-later-button"),
  readLaterCountButton: document.getElementById("read-later-count-button"),
  showHiddenToggle: document.getElementById("show-hidden-toggle"),
  latestButton: document.getElementById("latest-button"),
  clearButton: document.getElementById("clear-button"),
  updateButton: document.getElementById("updateBtn"),
  themeToggle: document.getElementById("theme-toggle"),
  authForm: document.getElementById("auth-form"),
  authEmail: document.getElementById("auth-email"),
  authSubmit: document.getElementById("auth-submit"),
  authHelp: document.getElementById("auth-help"),
  authUserPanel: document.getElementById("auth-user"),
  authEmailDisplay: document.getElementById("auth-email-display"),
  authLogout: document.getElementById("auth-logout"),
  syncStatusText: document.getElementById("sync-status-text"),
  syncResultSummary: document.getElementById("sync-result-summary"),
  refreshProfileButton: document.getElementById("refresh-profile-button"),
  preferenceJson: document.getElementById("preference-json"),
  geminiPrompt: document.getElementById("gemini-prompt"),
  updateTime: document.getElementById("update-time"),
  resultSummary: document.getElementById("result-summary"),
  focusPresetButtons: document.getElementById("focus-preset-buttons"),
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
  state.readLaterItems = [];
  state.viewMode = getCurrentViewMode();
  setupTheme();
  bindEvents();
  setupUserSync();
  renderReadLaterCount();
  renderViewMode();
  renderFocusPresetButtons();
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
  elements.showHiddenToggle?.addEventListener("change", () => {
    state.showHidden = Boolean(elements.showHiddenToggle.checked);
    state.visibleCount = INITIAL_VISIBLE_COUNT;
    applyFilters();
  });

  elements.clearButton.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.sourceFilter.value = "all";
    elements.tagFilter.value = "all";
    elements.sortOrder.value = "newest";
    state.focusPreset = "";
    renderFocusPresetButtons();
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

  elements.authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = elements.authEmail.value.trim();
    if (!email) {
      return;
    }

    elements.authSubmit.disabled = true;
    try {
      await signInWithEmail(email);
      elements.authHelp.textContent = "ログインリンクを送信しました。メールを確認してください。";
    } catch (error) {
      console.error("Failed to send magic link:", error);
      elements.authHelp.textContent = "ログインリンクを送信できませんでした。config.js と Supabase Auth 設定を確認してください。";
    } finally {
      elements.authSubmit.disabled = false;
    }
  });

  elements.authLogout?.addEventListener("click", async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Failed to sign out:", error);
      updateSyncStatus({ status: "local", message: "ログアウトに失敗しました" });
    }
  });

  elements.refreshProfileButton?.addEventListener("click", async () => {
    if (!window.RSSNewsUserSync) {
      return;
    }
    await window.RSSNewsUserSync.refreshUserData();
  });
}

function setupUserSync() {
  if (!window.RSSNewsUserSync) {
    updateSyncStatus({ status: "local", message: "未ログイン: ローカル保存中" });
    return;
  }

  window.RSSNewsUserSync.initUserSync({
    auth: renderAuthState,
    events: handleUserEventsChange,
    profile: handleProfileChange,
    status: updateSyncStatus,
  }).catch((error) => {
    console.warn("Failed to initialize user sync:", error);
    updateSyncStatus({ status: "local", message: "未ログイン: ローカル保存中" });
  });
}

function renderAuthState(user) {
  state.currentUser = user || null;
  const loggedIn = Boolean(state.currentUser);

  if (elements.authForm) {
    elements.authForm.hidden = loggedIn;
  }
  if (elements.authUserPanel) {
    elements.authUserPanel.hidden = !loggedIn;
  }
  if (elements.authEmailDisplay) {
    elements.authEmailDisplay.textContent = state.currentUser?.email || "";
  }

  updateSyncStatus({
    status: loggedIn ? "syncing" : "local",
    message: loggedIn ? "ログイン済み: Supabase同期中" : "未ログイン: ローカル保存中",
  });
}

function updateSyncStatus(payload) {
  state.syncStatus = payload?.status || state.syncStatus;
  state.syncMessage = payload?.message || state.syncMessage;
  if (elements.syncStatusText) {
    elements.syncStatusText.textContent = state.syncMessage;
    elements.syncStatusText.dataset.status = state.syncStatus;
  }
  if (elements.syncResultSummary) {
    elements.syncResultSummary.textContent = `同期: ${state.syncMessage}`;
    elements.syncResultSummary.dataset.status = state.syncStatus;
  }
}

function handleUserEventsChange(events) {
  state.userEvents = Array.isArray(events) ? events : [];
  state.feedbackByArticleId = getArticleFeedbackState(state.userEvents);
  state.hiddenArticleIds = window.RSSNewsUserSync?.getHiddenArticleIds(state.userEvents) || new Set();
  state.readLaterItems = buildImportantItemsFromEvents(state.userEvents);
  renderReadLaterCount();
  renderViewMode();
  if (state.allItems.length > 0) {
    renderFeatured(state.allItems);
    applyFilters();
  }
}

function handleProfileChange(profile) {
  state.interestProfile = profile || null;
  renderPreferenceProfile();
  if (state.allItems.length > 0) {
    renderFeatured(state.allItems);
    applyFilters();
  }
}

function renderPreferenceProfile() {
  const profile = state.interestProfile || buildInterestProfile(state.userEvents);
  if (elements.preferenceJson) {
    elements.preferenceJson.textContent = JSON.stringify(profile, null, 2);
  }
  if (elements.geminiPrompt) {
    elements.geminiPrompt.textContent = exportGeminiPreferencePrompt(profile);
  }
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
      fetchJson("./data/analytics.json").catch((error) => {
        console.warn("Failed to load analytics data:", error);
        return {};
      }),
    ]);

    state.geminiAnalyses = normalizeGeminiAnalyses(analyticsData.gemini_analyses);
    state.allItems = attachGeminiAnalyses(Array.isArray(newsData.items) ? newsData.items : []);
    state.readLaterItems = buildImportantItemsFromEvents(state.userEvents);
    state.updatedLabel = newsData.updated_label || "";

    populateSelect(elements.sourceFilter, collectUniqueValues(state.allItems, "source"));
    populateSelect(elements.tagFilter, collectUniqueTags(state.allItems));
    renderFeatured(state.allItems);
    applyFilters();
  } catch (error) {
    console.error("Failed to load page data:", error);
    elements.updateTime.textContent = "最終更新: 取得失敗";
    elements.resultSummary.textContent = "記事を読み込めませんでした";
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

function getFocusPreset(id) {
  return FOCUS_PRESETS.find((preset) => preset.id === id) || null;
}

function matchesFocusPreset(item, presetId) {
  const preset = getFocusPreset(presetId);
  if (!preset) {
    return true;
  }

  const itemTags = item.tags || [];
  if (preset.tags.some((tag) => itemTags.includes(tag))) {
    return true;
  }

  const analysis = item.gemini_analysis || {};
  const searchableText = [
    item.title,
    item.source,
    item.summary,
    analysis.category,
    ...(analysis.keywords || []),
    ...itemTags,
  ].join(" ").toLowerCase();
  return preset.keywords.some((keyword) => searchableText.includes(keyword.toLowerCase()));
}

function normalizeGeminiAnalyses(rawAnalyses) {
  if (!rawAnalyses || typeof rawAnalyses !== "object" || Array.isArray(rawAnalyses)) {
    return {};
  }

  const analyses = {};
  for (const [link, rawAnalysis] of Object.entries(rawAnalyses)) {
    if (!link || !rawAnalysis || typeof rawAnalysis !== "object" || Array.isArray(rawAnalysis)) {
      continue;
    }

    const importance = Number(rawAnalysis.importance);
    const keywords = Array.isArray(rawAnalysis.keywords)
      ? rawAnalysis.keywords.filter((keyword) => typeof keyword === "string" && keyword.trim())
      : [];

    analyses[link] = {
      summary: typeof rawAnalysis.summary === "string" && rawAnalysis.summary ? rawAnalysis.summary : "",
      category: typeof rawAnalysis.category === "string" && rawAnalysis.category ? rawAnalysis.category : "その他",
      importance: Number.isFinite(importance) ? Math.max(1, Math.min(5, Math.round(importance))) : 3,
      keywords,
    };
  }

  return analyses;
}

function attachGeminiAnalyses(items) {
  return items.map((item) => {
    const analysis = state.geminiAnalyses[item.link];
    if (!analysis) {
      return item;
    }

    return {
      ...item,
      gemini_analysis: analysis,
    };
  });
}

function renderFocusPresetButtons() {
  if (!elements.focusPresetButtons) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const buttons = [
    { id: "", label: "全記事" },
    ...FOCUS_PRESETS.map((preset) => ({ id: preset.id, label: preset.label })),
  ];

  for (const buttonConfig of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "focus-filter-button";
    if (state.focusPreset === buttonConfig.id) {
      button.classList.add("focus-filter-button--active");
    }
    button.textContent = buttonConfig.label;
    button.setAttribute("aria-pressed", String(state.focusPreset === buttonConfig.id));
    button.onclick = () => {
      state.focusPreset = buttonConfig.id;
      state.visibleCount = INITIAL_VISIBLE_COUNT;
      renderFocusPresetButtons();
      applyFilters();
    };
    fragment.appendChild(button);
  }

  elements.focusPresetButtons.innerHTML = "";
  elements.focusPresetButtons.appendChild(fragment);
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
    if (!state.showHidden && state.hiddenArticleIds.has(getArticleId(item))) {
      return false;
    }

    if (state.focusPreset && !matchesFocusPreset(item, state.focusPreset)) {
      return false;
    }

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

    const analysis = item.gemini_analysis || {};
    const targetText = [
      item.title,
      item.source,
      item.summary,
      analysis.category,
      ...(analysis.keywords || []),
      ...itemTags,
    ].join(" ").toLowerCase();
    return targetText.includes(query);
  });

  state.filteredItems = state.viewMode === "read-later" ? sortReadLaterItems(filtered) : sortItems(filtered, elements.sortOrder.value);
  renderNews();
}

function sortReadLaterItems(items) {
  return [...items].sort((left, right) => {
    const feedbackDiff = (right.feedback_at || "").localeCompare(left.feedback_at || "");
    if (feedbackDiff !== 0) {
      return feedbackDiff;
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
      const importanceDiff = getItemImportance(right) - getItemImportance(left);
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
  const featuredItems = sortItems(items.filter((item) => getItemImportance(item) >= 4), "newest").slice(0, FEATURED_LIMIT);

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
    elements.resultSummary.textContent = state.viewMode === "read-later" ? "重要 0件" : "0件";
    elements.loadMoreButton.hidden = true;
    renderMessage(
      elements.newsList,
      state.viewMode === "read-later"
        ? "重要に分類した記事はまだありません。"
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
    ? `重要 ${itemsToShow.length} / ${state.filteredItems.length}件`
    : `${itemsToShow.length} / ${state.filteredItems.length}件を表示`;
  elements.loadMoreButton.hidden = state.filteredItems.length <= itemsToShow.length;
}

function bindItemToCard(wrapper, node, item, isFeatured) {
  const importance = getItemImportance(item);
  const baseImportance = getBaseItemImportance(item);
  const articleId = getArticleId(item);
  const feedbackState = state.feedbackByArticleId.get(articleId) || {};
  const isHidden = state.hiddenArticleIds.has(articleId);
  node.querySelector(".news-source").textContent = item.source || "不明";
  node.querySelector(".news-date").textContent = item.published_label || "日時不明";
  node.href = item.link || "#";
  node.setAttribute("aria-label", `${item.title || "記事"} を開く`);
  node.dataset.importance = String(importance);
  node.title = baseImportance === importance
    ? `重要度: ${getImportanceLabel(importance)}`
    : `重要度: ${baseImportance} → あなた向け ${importance}`;
  node.classList.toggle("is-read-later", feedbackState.classification === "important");
  node.classList.toggle("is-marked-important", feedbackState.classification === "important");
  node.classList.toggle("is-marked-unimportant", feedbackState.classification === "unimportant");
  node.classList.toggle("is-hidden-by-user", isHidden);

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

  bindFeedbackButtons(node, item);
  attachSwipeFeedback(wrapper, node, item);
  bindCompactMedia(node, item);
  renderGeminiAnalysis(node, item);

  node.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.target.closest("button") || !item.link) {
      return;
    }
    trackArticleEvent(item, "click").catch((error) => {
      console.warn("Failed to track article click:", error);
    });
  });
}

function getItemImportance(item) {
  if (state.interestProfile) {
    return applyPersonalizedImportance(item, state.interestProfile);
  }

  return getBaseItemImportance(item);
}

function getBaseItemImportance(item) {
  const analysisImportance = Number(item.gemini_analysis?.importance);
  if (Number.isFinite(analysisImportance)) {
    return Math.max(1, Math.min(5, Math.round(analysisImportance)));
  }

  return Math.max(1, Math.min(5, Number(item.importance) || 1));
}

function renderGeminiAnalysis(node, item) {
  const container = node.querySelector(".gemini-analysis");
  if (!container) {
    return;
  }

  const analysis = item.gemini_analysis;
  const category = analysis?.category || item.tags?.[0] || "その他";
  const baseImportance = getBaseItemImportance(item);
  const personalizedImportance = getItemImportance(item);
  const keywords = Array.isArray(analysis?.keywords) && analysis.keywords.length > 0 ? analysis.keywords : (item.tags || []);

  container.hidden = false;
  container.querySelector(".gemini-analysis__category").textContent = category;
  container.querySelector(".gemini-analysis__importance").textContent = state.interestProfile
    ? `重要度: ${baseImportance} → あなた向け ${personalizedImportance}`
    : `重要度 ${baseImportance}`;

  const keywordList = container.querySelector(".gemini-analysis__keywords");
  keywordList.innerHTML = "";
  keywordList.hidden = keywords.length === 0;
  for (const keyword of keywords) {
    const chip = document.createElement("span");
    chip.className = "gemini-keyword";
    chip.textContent = keyword;
    keywordList.appendChild(chip);
  }
}

function bindFeedbackButtons(node, item) {
  const buttons = node.querySelectorAll("[data-feedback-type]");
  if (!buttons.length) {
    return;
  }

  const articleId = getArticleId(item);
  const hidden = state.hiddenArticleIds.has(articleId);
  const feedbackState = state.feedbackByArticleId.get(articleId) || {};

  for (const button of buttons) {
    const type = button.dataset.feedbackType;
    if (!FEEDBACK_TYPES.includes(type)) {
      continue;
    }

    button.classList.toggle("feedback-button--active", feedbackState.classification === type);

    if (type === "hidden") {
      button.hidden = hidden;
    } else if (type === "unhidden") {
      button.hidden = !hidden;
    }

    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleFeedback(item, type);
    };
  }
}

async function handleFeedback(article, eventType) {
  if (!FEEDBACK_TYPES.includes(eventType)) {
    return;
  }

  const articleId = getArticleId(article);
  if (eventType === "important" || eventType === "unimportant") {
    state.feedbackByArticleId.set(articleId, {
      ...(state.feedbackByArticleId.get(articleId) || {}),
      classification: eventType,
      event: {
        ...article,
        article_id: articleId,
        article_url: article.link || article.article_url || article.url || "",
        event_type: eventType,
        created_at: new Date().toISOString(),
      },
    });
  }

  if (eventType === "hidden") {
    state.hiddenArticleIds.add(articleId);
  } else if (eventType === "unhidden") {
    state.hiddenArticleIds.delete(articleId);
  }

  try {
    const trackedEvent = await trackArticleEvent(article, eventType);
    if (trackedEvent && !state.userEvents.some((event) => (
      event.article_id === trackedEvent.article_id
      && event.event_type === trackedEvent.event_type
      && event.created_at === trackedEvent.created_at
    ))) {
      state.userEvents = [...state.userEvents, trackedEvent];
      state.feedbackByArticleId = getArticleFeedbackState(state.userEvents);
      state.hiddenArticleIds = window.RSSNewsUserSync?.getHiddenArticleIds(state.userEvents) || state.hiddenArticleIds;
    }
  } catch (error) {
    console.warn("Failed to track article feedback:", error);
  }

  state.readLaterItems = buildImportantItemsFromEvents(state.userEvents);
  renderReadLaterCount();
  renderViewMode();
  renderFeatured(state.allItems);
  applyFilters();
}

function attachSwipeFeedback(wrapper, node, article) {
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

    swipeBg.textContent = deltaX <= 0 ? "不要" : "重要";
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

    const shouldMarkUnimportant = deltaX <= -SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_VERTICAL_TOLERANCE;
    const shouldMarkImportant = deltaX >= SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_VERTICAL_TOLERANCE;

    resetSwipe();

    if (shouldMarkUnimportant) {
      swipeTriggered = true;
      handleFeedback(article, "unimportant");
      return;
    }

    if (shouldMarkImportant) {
      swipeTriggered = true;
      handleFeedback(article, "important");
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

function getArticleFeedbackState(events) {
  const feedbackByArticleId = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const articleId = event.article_id || getArticleId(event);
    if (!articleId) {
      continue;
    }

    const current = feedbackByArticleId.get(articleId) || {};
    if (event.event_type === "important" || event.event_type === "unimportant") {
      feedbackByArticleId.set(articleId, {
        ...current,
        classification: event.event_type,
        event,
      });
    } else if (event.event_type === "hidden" || event.event_type === "unhidden") {
      feedbackByArticleId.set(articleId, {
        ...current,
        hidden: event.event_type === "hidden",
        hiddenEvent: event,
      });
    }
  }

  return feedbackByArticleId;
}

function buildImportantItemsFromEvents(events) {
  const importantItems = [];
  const currentItemsById = new Map(state.allItems.map((item) => [getArticleId(item), item]));
  const feedbackByArticleId = getArticleFeedbackState(events);

  for (const [articleId, feedbackState] of feedbackByArticleId.entries()) {
    if (feedbackState.classification !== "important") {
      continue;
    }

    const event = feedbackState.event || {};
    const currentItem = currentItemsById.get(articleId);
    importantItems.push({
      ...(currentItem || eventToArticleItem(event)),
      feedback_at: event.created_at || "",
    });
  }

  return attachGeminiAnalyses(importantItems);
}

function eventToArticleItem(event) {
  const keywords = Array.isArray(event.keywords) ? event.keywords : [];
  const link = event.article_url || event.link || "";
  return {
    title: event.title || "タイトルなし",
    link,
    article_url: link,
    source: event.source || "",
    published: event.created_at || "",
    published_label: event.created_at ? formatDateTime(event.created_at) : "日時不明",
    summary: "",
    tags: [event.category, ...keywords].filter(Boolean),
    importance: event.event_type === "important" ? 5 : 1,
  };
}

function renderReadLaterCount() {
  const count = state.readLaterItems.length;
  elements.readLaterCountButton.textContent = state.readLaterEnabled ? `重要（${count}）` : "重要リストは利用不可";
  elements.readLaterCountButton.disabled = !state.readLaterEnabled;
  elements.viewReadLaterButton.textContent = `重要${state.readLaterEnabled ? `（${count}）` : ""}`;
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
