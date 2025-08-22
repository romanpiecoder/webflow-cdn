// test.js — persistent checkout token (no CORS preflight: form-encoded POSTs)
(function () {
    // ===== CONFIG (override via <script data-*> or window.RomanPieConfig) =====
    const defaults = {
      n8nBase: "https://n8n-20r4.onrender.com/webhook", // <-- change this
      saleorChannel: "default-channel",
      storageKey: "rp.checkoutToken",
      cookieName: "rp_ct",
      cookieDays: 30,
      debug: true
    };
  
    function readDataset() {
      try {
        const s = document.currentScript;
        return {
          n8nBase: s?.dataset?.n8nBase,
          saleorChannel: s?.dataset?.saleorChannel,
          debug: s?.dataset?.debug === "true" ? true : s?.dataset?.debug === "false" ? false : undefined,
        };
      } catch { return {}; }
    }
  
    const cfg = Object.assign({}, defaults, readDataset(), (window.RomanPieConfig || {}));
    const log = (...a) => cfg.debug && console.log("[RomanPie]", ...a);
  
    // ===== UTIL: cookie + storage =====
    function setCookie(name, value, days) {
      const maxAge = Math.floor(days * 24 * 60 * 60);
      document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    }
    function getCookie(name) {
      const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
      return m ? decodeURIComponent(m[2]) : null;
    }
    function saveToken(token) {
      try {
        localStorage.setItem(cfg.storageKey, JSON.stringify({ token: String(token), t: Date.now() }));
      } catch {}
      setCookie(cfg.cookieName, String(token), cfg.cookieDays);
      return token;
    }
    function readToken() {
      try {
        const rec = JSON.parse(localStorage.getItem(cfg.storageKey) || "null");
        return (rec?.token || getCookie(cfg.cookieName) || "").trim() || null;
      } catch { return (getCookie(cfg.cookieName) || "").trim() || null; }
    }
  
    // ===== HTTP helper: form-encoded, no headers (no preflight) =====
    async function postForm(url, obj) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(obj || {})) {
        if (v !== undefined && v !== null) body.append(k, String(v));
      }
      const res = await fetch(url, { method: "POST", body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Try JSON, fallback to text
      try { return await res.json(); } catch { return await res.text(); }
    }
  
    // ===== Backend interactions =====
    async function validateToken(token) {
      if (!token) return false;
      try {
        const data = await postForm(`${cfg.n8nBase}/checkout/get`, { token: String(token).trim() });
        const echoed =
          data?.token ||
          data?.checkout?.token ||
          data?.data?.checkout?.token ||
          null;
        const ok = typeof echoed === "string" && echoed.trim().length > 10;
        log("validateToken:", token, ok ? "✅ valid" : "❌ invalid");
        return ok;
      } catch (e) {
        log("validateToken error:", e.message);
        return false;
      }
    }
  
    async function createToken() {
      const data = await postForm(`${cfg.n8nBase}/checkout/create`, { channel: cfg.saleorChannel });
      const token =
        data?.token ||
        data?.checkout?.token ||
        data?.data?.checkoutCreate?.checkout?.token ||
        null;
      if (!token) throw new Error("No token returned by create");
      log("createToken: ✅", token);
      return String(token).trim();
    }
  
    async function ensureToken() {
      let token = readToken();
      if (token && (await validateToken(token))) {
        saveToken(token); // refresh timestamps/cookie
        return token;
      }
      // missing or invalid -> create new
      token = await createToken();
      saveToken(token);
      return token;
    }
  
    // Cross-tab sync: mirror localStorage -> cookie
    window.addEventListener("storage", (e) => {
      if (e.key === cfg.storageKey && e.newValue) {
        try {
          const rec = JSON.parse(e.newValue);
          if (rec?.token) setCookie(cfg.cookieName, rec.token, cfg.cookieDays);
        } catch {}
      }
    });
  
    // ===== Public API =====
    async function initSession() {
      if (!cfg.n8nBase) {
        console.error("[RomanPie] Missing n8nBase. Add data-n8n-base on the <script> tag.");
        return null;
      }
      const token = await ensureToken();
      window.RomanPie = window.RomanPie || {};
      window.RomanPie.getSessionToken = () => token;            // returns last-resolved token
      window.RomanPie.refreshSession = () => ensureToken();      // returns Promise<string>
      log("session ready:", token);
      return token;
    }
  
    document.addEventListener("DOMContentLoaded", () => {
      initSession().catch((e) => console.error("[RomanPie] session error:", e));
    });
  })();
  