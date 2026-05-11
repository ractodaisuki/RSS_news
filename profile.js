(function () {
  "use strict";

  const EVENT_WEIGHTS = {
    click: 1,
    important: 5,
    unimportant: -3,
    hidden: -5,
    unhidden: 0,
  };

  function addScore(scores, key, value) {
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    if (!normalizedKey || !Number.isFinite(value) || value === 0) {
      return;
    }
    scores[normalizedKey] = (scores[normalizedKey] || 0) + value;
  }

  function sortScoreObject(scores) {
    return Object.fromEntries(
      Object.entries(scores)
        .filter(([, score]) => Number.isFinite(score) && score !== 0)
        .sort((left, right) => {
          const scoreDiff = right[1] - left[1];
          return scoreDiff !== 0 ? scoreDiff : left[0].localeCompare(right[0], "ja");
        })
    );
  }

  function buildInterestProfile(events) {
    const categoryScores = {};
    const keywordScores = {};
    const sourceScores = {};

    for (const event of Array.isArray(events) ? events : []) {
      const weight = EVENT_WEIGHTS[event.event_type] || 0;
      if (!weight) {
        continue;
      }

      addScore(categoryScores, event.category, weight);
      addScore(sourceScores, event.source, weight);

      const keywords = Array.isArray(event.keywords) ? event.keywords : [];
      for (const keyword of keywords) {
        addScore(keywordScores, keyword, weight);
      }
    }

    return {
      favorite_categories: sortScoreObject(categoryScores),
      favorite_keywords: sortScoreObject(keywordScores),
      favorite_sources: sortScoreObject(sourceScores),
    };
  }

  function getTopPositiveKeys(scores, limit) {
    return Object.entries(scores || {})
      .filter(([, score]) => Number(score) > 0)
      .sort((left, right) => Number(right[1]) - Number(left[1]))
      .slice(0, limit)
      .map(([key]) => key);
  }

  function scoreToDelta(score) {
    const value = Number(score) || 0;
    if (value >= 20) {
      return 2;
    }
    if (value >= 5) {
      return 1;
    }
    if (value <= -15) {
      return -2;
    }
    if (value <= -4) {
      return -1;
    }
    return 0;
  }

  function getArticleCategory(article) {
    return article?.gemini_analysis?.category || article?.tags?.[0] || article?.category || "その他";
  }

  function getArticleKeywords(article) {
    const analysisKeywords = article?.gemini_analysis?.keywords;
    if (Array.isArray(analysisKeywords) && analysisKeywords.length > 0) {
      return analysisKeywords;
    }
    return Array.isArray(article?.tags) ? article.tags : [];
  }

  function getBaseImportance(article) {
    const analysisImportance = Number(article?.gemini_analysis?.importance);
    if (Number.isFinite(analysisImportance)) {
      return Math.max(1, Math.min(5, Math.round(analysisImportance)));
    }

    return Math.max(1, Math.min(5, Number(article?.importance) || 1));
  }

  function applyPersonalizedImportance(article, profile) {
    const baseImportance = getBaseImportance(article);
    if (!profile) {
      return baseImportance;
    }

    const category = getArticleCategory(article);
    const keywords = getArticleKeywords(article);
    const source = article?.source || "";

    const categoryDelta = scoreToDelta(profile.favorite_categories?.[category]);
    const sourceDelta = scoreToDelta(profile.favorite_sources?.[source]);
    const keywordScore = keywords.reduce((total, keyword) => total + (Number(profile.favorite_keywords?.[keyword]) || 0), 0);
    const keywordDelta = scoreToDelta(Math.max(-20, Math.min(30, keywordScore)));

    return Math.max(1, Math.min(5, baseImportance + categoryDelta + sourceDelta + keywordDelta));
  }

  function exportGeminiPreferencePrompt(profile) {
    const categories = getTopPositiveKeys(profile?.favorite_categories, 8);
    const keywords = getTopPositiveKeys(profile?.favorite_keywords, 12);
    const sources = getTopPositiveKeys(profile?.favorite_sources, 8);

    return [
      "このユーザーは以下に興味があります。",
      "",
      "よく読むカテゴリ:",
      ...(categories.length ? categories.map((item) => `- ${item}`) : ["- まだ十分な履歴がありません"]),
      "",
      "重要視するキーワード:",
      ...(keywords.length ? keywords.map((item) => `- ${item}`) : ["- まだ十分な履歴がありません"]),
      "",
      "よく読む配信元:",
      ...(sources.length ? sources.map((item) => `- ${item}`) : ["- まだ十分な履歴がありません"]),
      "",
      "この傾向を考慮して、記事の重要度を1〜5で判定してください。",
    ].join("\n");
  }

  window.RSSNewsProfile = {
    EVENT_WEIGHTS,
    buildInterestProfile,
    applyPersonalizedImportance,
    exportGeminiPreferencePrompt,
    getBaseImportance,
    getArticleCategory,
    getArticleKeywords,
  };

  window.buildInterestProfile = buildInterestProfile;
  window.applyPersonalizedImportance = applyPersonalizedImportance;
  window.exportGeminiPreferencePrompt = exportGeminiPreferencePrompt;
}());
