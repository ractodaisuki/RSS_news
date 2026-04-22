const THEME_STORAGE_KEY = "rss-news-theme";

const state = {
  theme: document.documentElement.dataset.theme || "light",
};

const elements = {
  themeToggle: document.getElementById("theme-toggle"),
  summary: document.getElementById("analytics-summary"),
  updatedAt: document.getElementById("analytics-updated-at"),
  insights: document.getElementById("insights-list"),
  recentHighList: document.getElementById("recent-high-list"),
  tagChart: document.getElementById("tag-chart"),
  sourceChart: document.getElementById("source-chart"),
  importanceChart: document.getElementById("importance-chart"),
  dailyChart: document.getElementById("daily-chart"),
  crossTagList: document.getElementById("cross-tag-list"),
};

async function init() {
  setupTheme();
  bindEvents();
  await loadAnalytics();
}

function bindEvents() {
  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = state.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme, true);
  });
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

function updateThemeToggle() {
  const isDark = state.theme === "dark";
  elements.themeToggle.textContent = isDark ? "ライトモード" : "ダークモード";
  elements.themeToggle.setAttribute("aria-pressed", String(isDark));
  elements.themeToggle.setAttribute("aria-label", isDark ? "ライトモードに切り替える" : "ダークモードに切り替える");
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

async function loadAnalytics() {
  try {
    const response = await fetch("./data/analytics.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    elements.updatedAt.textContent = `分析更新: ${data.generated_label || "情報なし"}`;
    renderSummary(data);
    renderInsights(data.insights || []);
    renderRecentHighImportance(data.recent_high_importance || []);
    renderBarList(elements.tagChart, data.top_tags || [], "tag", "件");
    renderBarList(elements.sourceChart, data.top_sources || [], "source", "件");
    renderBarList(elements.importanceChart, buildImportanceEntries(data.importance_counts || {}), "label", "件");
    renderBarList(elements.dailyChart, buildDailyEntries(data.daily_counts || {}), "label", "件");
    renderBarList(elements.crossTagList, data.cross_tag_counts || [], "pair", "件");
  } catch (error) {
    console.error("Failed to load analytics:", error);
    renderMessage(elements.summary, "分析データを読み込めませんでした");
    renderMessage(elements.insights, "分析コメントを読み込めませんでした");
    renderMessage(elements.recentHighList, "注目記事を読み込めませんでした");
    renderMessage(elements.tagChart, "分析データを読み込めませんでした");
    renderMessage(elements.sourceChart, "分析データを読み込めませんでした");
    renderMessage(elements.importanceChart, "分析データを読み込めませんでした");
    renderMessage(elements.dailyChart, "分析データを読み込めませんでした");
    renderMessage(elements.crossTagList, "分析データを読み込めませんでした");
    elements.updatedAt.textContent = "分析更新: 取得失敗";
  }
}

function renderSummary(data) {
  const topTag = data.top_tags?.[0];
  const topSource = data.top_sources?.[0];
  const highImportanceCount = (data.importance_counts?.["4"] || 0) + (data.importance_counts?.["5"] || 0);
  const summaryCards = [
    {
      label: "総記事数",
      value: `${data.total_articles || 0}件`,
      description: "現在保持している最新記事数",
    },
    {
      label: "最多タグ",
      value: topTag ? topTag.tag : "情報なし",
      description: topTag ? `${topTag.count}件` : "集計待ち",
    },
    {
      label: "最多配信元",
      value: topSource ? topSource.source : "情報なし",
      description: topSource ? `${topSource.count}件` : "集計待ち",
    },
    {
      label: "注目記事数",
      value: `${highImportanceCount}件`,
      description: "重要度4以上の新着記事",
    },
  ];

  const fragment = document.createDocumentFragment();
  for (const card of summaryCards) {
    const article = document.createElement("article");
    article.className = "metric-card";
    article.innerHTML = `
      <p class="metric-label">${card.label}</p>
      <p class="metric-value">${card.value}</p>
      <p class="metric-description">${card.description}</p>
    `;
    fragment.appendChild(article);
  }

  elements.summary.innerHTML = "";
  elements.summary.appendChild(fragment);
}

function renderInsights(insights) {
  if (insights.length === 0) {
    renderMessage(elements.insights, "分析コメントはまだありません");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const insight of insights) {
    const item = document.createElement("article");
    item.className = "insight-card";
    item.textContent = insight;
    fragment.appendChild(item);
  }

  elements.insights.innerHTML = "";
  elements.insights.appendChild(fragment);
}

function renderRecentHighImportance(items) {
  if (items.length === 0) {
    renderMessage(elements.recentHighList, "注目記事はまだありません");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const article = document.createElement("article");
    article.className = "highlight-card";
    if ((item.importance || 0) >= 5) {
      article.classList.add("is-top-priority");
    }

    const accent = document.createElement("div");
    accent.className = `card-accent importance-line importance-line-${item.importance || 1}`;
    article.appendChild(accent);

    const meta = document.createElement("div");
    meta.className = "news-meta";
    meta.innerHTML = `
      <div class="news-meta-main">
        <span class="news-source">${item.source || "不明"}</span>
        <time class="news-date">${item.published_label || "日時不明"}</time>
      </div>
      <span class="importance-badge importance-${item.importance || 1}">重要度 ${item.importance || 1}</span>
    `;
    article.appendChild(meta);

    const title = document.createElement("h3");
    title.className = "highlight-title";
    title.textContent = item.title || "タイトルなし";
    article.appendChild(title);

    const tagList = document.createElement("div");
    tagList.className = "tag-list";
    for (const tag of item.tags || []) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      tagList.appendChild(chip);
      }

    article.appendChild(tagList);

    const actionWrap = document.createElement("div");
    actionWrap.className = "card-actions";

    const link = document.createElement("a");
    link.className = "news-link action-link";
    link.href = item.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "記事を開く";
    actionWrap.appendChild(link);
    article.appendChild(actionWrap);

    fragment.appendChild(article);
  }

  elements.recentHighList.innerHTML = "";
  elements.recentHighList.appendChild(fragment);
}

function buildImportanceEntries(counts) {
  return ["5", "4", "3", "2", "1"].map((key) => ({
    label: `重要度 ${key}`,
    count: counts[key] || 0,
  }));
}

function buildDailyEntries(counts) {
  return Object.entries(counts).map(([label, count]) => ({ label, count }));
}

function renderBarList(container, entries, labelKey, suffix) {
  if (entries.length === 0) {
    renderMessage(container, "表示できるデータがありません");
    return;
  }

  const maxCount = Math.max(...entries.map((entry) => entry.count), 1);
  const fragment = document.createDocumentFragment();

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label">${entry[labelKey]}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${(entry.count / maxCount) * 100}%"></div>
      </div>
      <div class="bar-value">${entry.count}${suffix}</div>
    `;
    fragment.appendChild(row);
  }

  container.innerHTML = "";
  container.appendChild(fragment);
}

function renderMessage(container, message) {
  const card = document.createElement("div");
  card.className = "message-card";
  card.textContent = message;
  container.innerHTML = "";
  container.appendChild(card);
}

init();
