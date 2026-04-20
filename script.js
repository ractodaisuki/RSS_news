const INITIAL_VISIBLE_COUNT = 50;
const LATEST_VISIBLE_COUNT = 10;

const state = {
  allItems: [],
  filteredItems: [],
  visibleCount: INITIAL_VISIBLE_COUNT,
  updatedLabel: "",
};

const elements = {
  searchInput: document.getElementById("search-input"),
  sourceFilter: document.getElementById("source-filter"),
  latestButton: document.getElementById("latest-button"),
  clearButton: document.getElementById("clear-button"),
  updateTime: document.getElementById("update-time"),
  resultSummary: document.getElementById("result-summary"),
  newsList: document.getElementById("news-list"),
  loadMoreButton: document.getElementById("load-more-button"),
  template: document.getElementById("news-card-template"),
};

async function init() {
  bindEvents();
  await loadNews();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", () => {
    state.visibleCount = INITIAL_VISIBLE_COUNT;
    applyFilters();
  });

  elements.sourceFilter.addEventListener("change", () => {
    state.visibleCount = INITIAL_VISIBLE_COUNT;
    applyFilters();
  });

  elements.clearButton.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.sourceFilter.value = "all";
    state.visibleCount = INITIAL_VISIBLE_COUNT;
    applyFilters();
  });

  elements.latestButton.addEventListener("click", () => {
    state.visibleCount = LATEST_VISIBLE_COUNT;
    renderNews();
  });

  elements.loadMoreButton.addEventListener("click", () => {
    state.visibleCount += INITIAL_VISIBLE_COUNT;
    renderNews();
  });
}

async function loadNews() {
  setLoadingState(true);

  try {
    // GitHub Pages 側で生成済みJSONだけを読む。RSS本体はブラウザから取得しない。
    const response = await fetch("./data/news.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    state.allItems = Array.isArray(data.items) ? data.items : [];
    state.updatedLabel = data.updated_label || "";

    populateSourceFilter(state.allItems);
    applyFilters();
  } catch (error) {
    console.error("Failed to load news:", error);
    elements.updateTime.textContent = "最終更新: 取得失敗";
    elements.resultSummary.textContent = "記事を読み込めませんでした";
    renderMessage("記事を読み込めませんでした");
  } finally {
    setLoadingState(false);
  }
}

function populateSourceFilter(items) {
  const sources = [...new Set(items.map((item) => item.source).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  elements.sourceFilter.innerHTML = '<option value="all">すべて</option>';

  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source;
    elements.sourceFilter.appendChild(option);
  }
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const selectedSource = elements.sourceFilter.value;

  // 検索と配信元フィルターは同時に適用する。
  state.filteredItems = state.allItems.filter((item) => {
    const matchesSource = selectedSource === "all" || item.source === selectedSource;
    if (!matchesSource) {
      return false;
    }

    if (!query) {
      return true;
    }

    const targetText = [item.title, item.source, item.summary].join(" ").toLowerCase();
    return targetText.includes(query);
  });

  renderNews();
}

function renderNews() {
  const itemsToShow = state.filteredItems.slice(0, state.visibleCount);
  elements.newsList.innerHTML = "";

  if (state.updatedLabel) {
    elements.updateTime.textContent = `最終更新: ${state.updatedLabel}`;
  } else {
    elements.updateTime.textContent = "最終更新: 情報なし";
  }

  if (state.filteredItems.length === 0) {
    elements.resultSummary.textContent = "0件";
    elements.loadMoreButton.hidden = true;
    renderMessage("該当する記事がありません");
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const item of itemsToShow) {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    node.querySelector(".news-source").textContent = item.source || "不明";
    node.querySelector(".news-date").textContent = item.published_label || "日時不明";
    node.querySelector(".news-title").textContent = item.title || "タイトルなし";
    node.querySelector(".news-summary").textContent = item.summary || "概要はありません。";

    const link = node.querySelector(".news-link");
    link.href = item.link;

    fragment.appendChild(node);
  }

  elements.newsList.appendChild(fragment);

  const visibleLabel = `${itemsToShow.length} / ${state.filteredItems.length}件を表示`;
  elements.resultSummary.textContent = visibleLabel;
  elements.loadMoreButton.hidden = state.filteredItems.length <= itemsToShow.length;
}

function renderMessage(message) {
  const card = document.createElement("div");
  card.className = "message-card";
  card.textContent = message;
  elements.newsList.innerHTML = "";
  elements.newsList.appendChild(card);
}

function setLoadingState(isLoading) {
  elements.newsList.setAttribute("aria-busy", String(isLoading));
  elements.loadMoreButton.hidden = true;

  if (isLoading) {
    elements.updateTime.textContent = "最終更新: 読み込み中...";
    elements.resultSummary.textContent = "記事を読み込み中です";
    renderMessage("記事を読み込み中です...");
  }
}

init();
