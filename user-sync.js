(function () {
  "use strict";

  const LOCAL_EVENTS_KEY = "rss_news_local_events_v1";
  const VALID_EVENT_TYPES = new Set(["click", "important", "unimportant", "saved", "hidden", "unhidden"]);

  const syncState = {
    user: null,
    events: [],
    profile: null,
    initialized: false,
    syncing: false,
    listeners: {
      auth: [],
      events: [],
      profile: [],
      status: [],
    },
  };

  function emit(type, payload) {
    for (const listener of syncState.listeners[type] || []) {
      try {
        listener(payload);
      } catch (error) {
        console.warn(`RSS sync ${type} listener failed:`, error);
      }
    }
  }

  function setSyncStatus(status, message) {
    emit("status", { status, message });
  }

  function on(type, listener) {
    if (syncState.listeners[type]) {
      syncState.listeners[type].push(listener);
    }
  }

  async function initUserSync(options) {
    const callbacks = options || {};
    for (const [type, listener] of Object.entries(callbacks)) {
      if (typeof listener === "function") {
        on(type, listener);
      }
    }

    if (syncState.initialized) {
      emit("auth", syncState.user);
      emit("events", syncState.events);
      emit("profile", syncState.profile);
      return syncState;
    }

    syncState.initialized = true;
    const client = await window.initSupabase();
    if (!client) {
      syncState.events = readLocalEvents();
      syncState.profile = window.buildInterestProfile(syncState.events);
      emit("events", syncState.events);
      emit("profile", syncState.profile);
      setSyncStatus("local", "未ログイン: ローカル保存中");
      return syncState;
    }

    syncState.user = await window.getCurrentUser();
    emit("auth", syncState.user);

    window.RSSNewsSupabase.onAuthStateChange(async (_event, session) => {
      syncState.user = session?.user || null;
      emit("auth", syncState.user);
      if (syncState.user) {
        await refreshUserData();
      } else {
        syncState.events = [];
        syncState.profile = null;
        emit("events", syncState.events);
        emit("profile", syncState.profile);
        setSyncStatus("local", "未ログイン: ローカル保存中");
      }
    });

    if (syncState.user) {
      await refreshUserData();
    } else {
      syncState.events = readLocalEvents();
      syncState.profile = window.buildInterestProfile(syncState.events);
      emit("events", syncState.events);
      emit("profile", syncState.profile);
      setSyncStatus("local", "未ログイン: ローカル保存中");
    }

    return syncState;
  }

  async function refreshUserData() {
    if (!syncState.user) {
      setSyncStatus("local", "未ログイン: ローカル保存中");
      return;
    }

    setSyncStatus("syncing", "ログイン済み: Supabase同期中");
    await syncLocalEventsToSupabase();
    await loadUserEvents();
    const profile = window.buildInterestProfile(syncState.events);
    syncState.profile = profile;
    emit("profile", profile);
    await saveInterestProfile(profile);
    setSyncStatus("synced", "同期済み");
  }

  function getArticleId(article) {
    const link = article?.link || article?.article_url || article?.url || "";
    if (link) {
      return link;
    }

    const sourceText = [
      article?.title || "",
      article?.source || "",
      article?.published || article?.published_label || "",
    ].join("|");
    return `hash:${hashString(sourceText)}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function buildEventPayload(article, eventType, extra) {
    if (!VALID_EVENT_TYPES.has(eventType)) {
      throw new Error(`Invalid article event type: ${eventType}`);
    }

    const profile = window.RSSNewsProfile;
    const analysis = article?.gemini_analysis || {};
    const keywords = Array.isArray(analysis.keywords) && analysis.keywords.length > 0
      ? analysis.keywords
      : (Array.isArray(article?.tags) ? article.tags : []);

    return {
      article_id: getArticleId(article),
      article_url: article?.link || article?.article_url || article?.url || null,
      title: article?.title || "タイトルなし",
      source: article?.source || null,
      category: analysis.category || article?.category || article?.tags?.[0] || "その他",
      keywords: keywords.filter((keyword) => typeof keyword === "string" && keyword.trim()),
      event_type: eventType,
      read_duration_seconds: Number.isFinite(extra?.read_duration_seconds) ? extra.read_duration_seconds : null,
      created_at: extra?.created_at || new Date().toISOString(),
      base_importance: profile?.getBaseImportance ? profile.getBaseImportance(article) : undefined,
    };
  }

  function readLocalEvents() {
    try {
      const raw = localStorage.getItem(LOCAL_EVENTS_KEY);
      if (!raw) {
        return [];
      }
      const events = JSON.parse(raw);
      return Array.isArray(events) ? events : [];
    } catch (error) {
      console.warn("Failed to read local article events:", error);
      return [];
    }
  }

  function writeLocalEvents(events) {
    try {
      localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(events));
      return true;
    } catch (error) {
      console.warn("Failed to write local article events:", error);
      return false;
    }
  }

  function saveEventToLocal(article, eventType, extra) {
    const event = buildEventPayload(article, eventType, extra);
    const localEvents = readLocalEvents();
    writeLocalEvents([...localEvents, event]);
    setSyncStatus("local", syncState.user ? "同期失敗: ローカルに保存しました" : "未ログイン: ローカル保存中");
    return event;
  }

  async function trackArticleEvent(article, eventType, extra) {
    let event;
    try {
      event = buildEventPayload(article, eventType, extra);
    } catch (error) {
      console.warn(error);
      return null;
    }

    if (!syncState.user) {
      const localEvent = saveEventToLocal(article, eventType, extra);
      syncState.events = [...syncState.events, localEvent];
      emit("events", syncState.events);
      return localEvent;
    }

    const client = window.RSSNewsSupabase.getSupabaseClient();
    if (!client) {
      return saveEventToLocal(article, eventType, extra);
    }

    try {
      setSyncStatus("syncing", "ログイン済み: Supabase同期中");
      const { error } = await client.from("article_events").insert({
        user_id: syncState.user.id,
        article_id: event.article_id,
        article_url: event.article_url,
        title: event.title,
        source: event.source,
        category: event.category,
        keywords: event.keywords,
        event_type: event.event_type,
        read_duration_seconds: event.read_duration_seconds,
        created_at: event.created_at,
      });

      if (error) {
        throw error;
      }

      syncState.events = [...syncState.events, event];
      emit("events", syncState.events);
      const profile = window.buildInterestProfile(syncState.events);
      syncState.profile = profile;
      emit("profile", profile);
      await saveInterestProfile(profile);
      setSyncStatus("synced", "同期済み");
      return event;
    } catch (error) {
      console.warn("Failed to save article event to Supabase:", error);
      return saveEventToLocal(article, eventType, extra);
    }
  }

  async function syncLocalEventsToSupabase() {
    if (!syncState.user || syncState.syncing) {
      return false;
    }

    const localEvents = readLocalEvents();
    if (localEvents.length === 0) {
      return true;
    }

    const client = window.RSSNewsSupabase.getSupabaseClient();
    if (!client) {
      return false;
    }

    syncState.syncing = true;
    try {
      const rows = localEvents.map((event) => ({
        user_id: syncState.user.id,
        article_id: event.article_id,
        article_url: event.article_url || null,
        title: event.title || "タイトルなし",
        source: event.source || null,
        category: event.category || "その他",
        keywords: Array.isArray(event.keywords) ? event.keywords : [],
        event_type: event.event_type,
        read_duration_seconds: Number.isFinite(event.read_duration_seconds) ? event.read_duration_seconds : null,
        created_at: event.created_at || new Date().toISOString(),
      }));

      const { error } = await client.from("article_events").insert(rows);
      if (error) {
        throw error;
      }

      localStorage.removeItem(LOCAL_EVENTS_KEY);
      setSyncStatus("synced", "同期済み");
      return true;
    } catch (error) {
      console.warn("Failed to sync local events:", error);
      setSyncStatus("local", "同期失敗: ローカルに保存しました");
      return false;
    } finally {
      syncState.syncing = false;
    }
  }

  async function loadUserEvents() {
    if (!syncState.user) {
      syncState.events = readLocalEvents();
      emit("events", syncState.events);
      return syncState.events;
    }

    const client = window.RSSNewsSupabase.getSupabaseClient();
    if (!client) {
      syncState.events = readLocalEvents();
      emit("events", syncState.events);
      return syncState.events;
    }

    try {
      const { data, error } = await client
        .from("article_events")
        .select("article_id, article_url, title, source, category, keywords, event_type, read_duration_seconds, created_at")
        .order("created_at", { ascending: true })
        .limit(5000);

      if (error) {
        throw error;
      }

      syncState.events = Array.isArray(data) ? data : [];
      emit("events", syncState.events);
      return syncState.events;
    } catch (error) {
      console.warn("Failed to load user events:", error);
      syncState.events = readLocalEvents();
      emit("events", syncState.events);
      setSyncStatus("local", "同期失敗: ローカルに保存しました");
      return syncState.events;
    }
  }

  async function saveInterestProfile(profile) {
    if (!syncState.user) {
      return false;
    }

    const client = window.RSSNewsSupabase.getSupabaseClient();
    if (!client) {
      return false;
    }

    const payload = {
      user_id: syncState.user.id,
      favorite_categories: profile?.favorite_categories || {},
      favorite_keywords: profile?.favorite_keywords || {},
      favorite_sources: profile?.favorite_sources || {},
      updated_at: new Date().toISOString(),
    };

    const { error } = await client.from("user_interest_profiles").upsert(payload, {
      onConflict: "user_id",
    });

    if (error) {
      console.warn("Failed to save interest profile:", error);
      return false;
    }

    return true;
  }

  async function loadInterestProfile() {
    if (!syncState.user) {
      return null;
    }

    const client = window.RSSNewsSupabase.getSupabaseClient();
    if (!client) {
      return null;
    }

    const { data, error } = await client
      .from("user_interest_profiles")
      .select("favorite_categories, favorite_keywords, favorite_sources, updated_at")
      .eq("user_id", syncState.user.id)
      .maybeSingle();

    if (error) {
      console.warn("Failed to load interest profile:", error);
      return null;
    }

    syncState.profile = data || null;
    emit("profile", syncState.profile);
    return syncState.profile;
  }

  function getHiddenArticleIds(events) {
    const hiddenByArticleId = new Map();
    for (const event of Array.isArray(events) ? events : []) {
      if (event.event_type !== "hidden" && event.event_type !== "unhidden") {
        continue;
      }
      hiddenByArticleId.set(event.article_id, event.event_type === "hidden");
    }

    return new Set(
      [...hiddenByArticleId.entries()]
        .filter(([, hidden]) => hidden)
        .map(([articleId]) => articleId)
    );
  }

  function getLocalEventsKey() {
    return LOCAL_EVENTS_KEY;
  }

  window.RSSNewsUserSync = {
    initUserSync,
    refreshUserData,
    getArticleId,
    trackArticleEvent,
    saveEventToLocal,
    syncLocalEventsToSupabase,
    loadUserEvents,
    saveInterestProfile,
    loadInterestProfile,
    getHiddenArticleIds,
    getLocalEventsKey,
    readLocalEvents,
    state: syncState,
  };

  window.getArticleId = getArticleId;
  window.trackArticleEvent = trackArticleEvent;
  window.saveEventToLocal = saveEventToLocal;
  window.syncLocalEventsToSupabase = syncLocalEventsToSupabase;
  window.loadUserEvents = loadUserEvents;
  window.saveInterestProfile = saveInterestProfile;
  window.loadInterestProfile = loadInterestProfile;
}());
