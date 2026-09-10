/*
 * Shared Supabase client for the sticker studio pages.
 * Uses the same project URL + anon key (and default localStorage key) as the
 * site's login.html, so the session created there is visible here because
 * both pages live on the same origin.
 */
(function () {
  "use strict";

  const SUPABASE_URL = "https://ifvxhywcfxsobupctezb.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlmdnhoeXdjZnhzb2J1cGN0ZXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk5MDg3MzAsImV4cCI6MjA2NTQ4NDczMH0.hrpnJSZQrPvsrpR3EloWuQgNOo_tMO7CY5t5C1Vdzg8";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("[NetsusSupabase] vendor/supabase/supabase.min.js no cargó.");
    window.NetsusSupabase = null;
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function getSession() {
    try {
      const { data } = await client.auth.getSession();
      return data?.session || null;
    } catch (error) {
      console.error("[NetsusSupabase] getSession", error);
      return null;
    }
  }

  function onAuth(callback) {
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      callback(session || null);
    });
    return () => data?.subscription?.unsubscribe();
  }

  async function signOut() {
    try {
      await client.auth.signOut();
    } catch (error) {
      console.error("[NetsusSupabase] signOut", error);
    }
  }

  // The shared login lives in the Netsus project site (/Netsus/login.html).
  // The studio lives on the user site root (mesgot.com/tools/nsticker-studio/),
  // which is the SAME origin, so the session in localStorage is shared. The
  // redirect param is a same-origin absolute path (login.html validates it:
  // single leading "/", no "//", no "..", no scheme).
  function loginUrl(targetPage) {
    const page = targetPage || "index.html";
    const target = new URL(page, window.location.href).pathname;
    return "/Netsus/login.html?redirect=" + encodeURIComponent(target);
  }

  // Best-effort display name for the header chip.
  async function displayName(session) {
    if (!session?.user) return "";
    const fallback = session.user.email || "Cuenta";
    try {
      const { data } = await client
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .maybeSingle();
      return data?.username || fallback;
    } catch (_error) {
      return fallback;
    }
  }

  window.NetsusSupabase = {
    client,
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    getSession,
    onAuth,
    signOut,
    loginUrl,
    displayName
  };
})();
