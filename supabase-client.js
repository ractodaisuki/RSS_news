(function () {
  "use strict";

  let supabaseClient = null;
  let initialized = false;
  let lastError = null;

  function getConfig() {
    const config = window.APP_CONFIG || {};
    const url = typeof config.SUPABASE_URL === "string" ? config.SUPABASE_URL.trim() : "";
    const anonKey = typeof config.SUPABASE_ANON_KEY === "string" ? config.SUPABASE_ANON_KEY.trim() : "";

    if (!url || !anonKey || url.includes("YOUR_PROJECT") || anonKey.includes("YOUR_SUPABASE")) {
      return null;
    }

    return { url, anonKey };
  }

  async function initSupabase() {
    if (initialized) {
      return supabaseClient;
    }

    initialized = true;
    const config = getConfig();
    if (!config) {
      lastError = new Error("Supabase config is not set. Create config.js from config.example.js.");
      return null;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      lastError = new Error("Supabase SDK is not loaded.");
      return null;
    }

    supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    lastError = null;
    return supabaseClient;
  }

  async function getCurrentUser() {
    const client = await initSupabase();
    if (!client) {
      return null;
    }

    const { data, error } = await client.auth.getUser();
    if (error) {
      lastError = error;
      return null;
    }

    return data.user || null;
  }

  async function signInWithEmail(email) {
    const client = await initSupabase();
    if (!client) {
      throw lastError || new Error("Supabase is not initialized.");
    }

    const redirectUrl = window.location.href.split("#")[0];
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) {
      lastError = error;
      throw error;
    }
  }

  async function signOut() {
    const client = await initSupabase();
    if (!client) {
      return;
    }

    const { error } = await client.auth.signOut();
    if (error) {
      lastError = error;
      throw error;
    }
  }

  function onAuthStateChange(callback) {
    if (!supabaseClient || !supabaseClient.auth) {
      return null;
    }

    const { data } = supabaseClient.auth.onAuthStateChange(callback);
    return data.subscription;
  }

  function getSupabaseClient() {
    return supabaseClient;
  }

  function getSupabaseLastError() {
    return lastError;
  }

  window.RSSNewsSupabase = {
    initSupabase,
    getCurrentUser,
    signInWithEmail,
    signOut,
    onAuthStateChange,
    getSupabaseClient,
    getSupabaseLastError,
  };

  window.initSupabase = initSupabase;
  window.getCurrentUser = getCurrentUser;
  window.signInWithEmail = signInWithEmail;
  window.signOut = signOut;
}());
