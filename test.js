// test.js — basic session token manager for RomanPie + n8n + Saleor
(function () {
    // ===== CONFIG =====
    const N8N_BASE = "https://n8n-20r4.onrender.com/webhook"; // <= change this
    const SALEOR_CHANNEL = "default-channel";     // <= change this
    const STORAGE_KEY = "rp.checkoutToken";
    const COOKIE_NAME = "rp_ct";
    const TOKEN_TTL_DAYS = 14; // optional soft TTL; can be ignored by backend
  
    // ===== UTILS =====
    const now = () => Date.now();
    const days = (n) => n * 24 * 60 * 60 * 1000;
  
    function setCookie(name, value, maxAgeDays = 30) {
      document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.floor(
        days(maxAgeDays) / 1000
      )}; SameSite=Lax`;
    }
    function getCookie(name) {
      const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
      return m ? decodeURIComponent(m[2]) : null;
    }
  
    function saveToken(token) {
      const record = { token, lastSeen: now(), version: 1 };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      setCookie(COOKIE_NAME, token, 30);
      return token;
    }
  
    function readTokenRecord() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
  
    async function postJSON(url, payload) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "cors",
        credentials: "omit",
      });
      // n8n might return 200 with JSON or non-200; we handle both
      if (!res.ok) {
        // try read json for error detail
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          msg = j?.error || msg;
        } catch {}
        throw new Error(msg);
      }
      // try JSON, fallback to text
      try {
        return await res.json();
      } catch {
        return await res.text();
      }
    }
  
    async function validateTokenWithBackend(token) {
      try {
        const data = await postJSON(`${N8N_BASE}/checkout/get`, { token });
        // Accept several possible shapes:
        // 1) { checkout: {..., token: "..." } }
        // 2) { data: { checkout: {...} } }
        // 3) { ok: true, token: "..." } (your own)
        const t =
          data?.checkout?.token ||
          data?.data?.checkout?.token ||
          data?.token ||
          null;
  
        // Consider valid if the backend echoes the same token (or returns a checkout object)
        if (t && typeof t === "string") return true;
  
        // if backend returns null checkout (e.g., completed/expired), treat as invalid
        return false;
      } catch (e) {
        // If 404 or known error, treat as invalid; if network hiccup, still treat as invalid to be safe.
        return false;
      }
    }
  
    async function createCheckoutOnBackend() {
      // Your n8n workflow should call Saleor `checkoutCreate` and return the new token
      // Expected response shapes (any one is fine):
      // { token: "..." } or { checkout: { token: "..." } } or { data: { checkoutCreate: { checkout: { token: "..." }}}}
      const payload = { channel: SALEOR_CHANNEL };
      const data = await postJSON(`${N8N_BASE}/checkout/create`, payload);
  
      const token =
        data?.token ||
        data?.checkout?.token ||
        data?.data?.checkoutCreate?.checkout?.token ||
        null;
  
      if (!token) {
        throw new Error("No token in create response");
      }
      return token;
    }
  
    async function ensureSessionToken() {
      // 1) try read from localStorage
      let rec = readTokenRecord();
      let token = rec?.token || getCookie(COOKIE_NAME);
  
      // Optional soft TTL check; if very old, you might decide to create a fresh checkout
      // (you can also ignore and let backend decide)
      const tooOld = rec?.lastSeen && now() - rec.lastSeen > days(TOKEN_TTL_DAYS);
  
      if (token && !tooOld) {
        const valid = await validateTokenWithBackend(token);
        if (valid) {
          // refresh lastSeen
          saveToken(token);
          return token;
        }
        // invalid token => discard
        localStorage.removeItem(STORAGE_KEY);
        setCookie(COOKIE_NAME, "", -1);
        token = null;
      }
  
      // 2) create a new checkout
      token = await createCheckoutOnBackend();
      saveToken(token);
      return token;
    }
  
    // ===== PUBLIC API =====
    async function initSession() {
      const token = await ensureSessionToken();
      // expose globally if needed by Webflow custom embeds
      window.RomanPie = window.RomanPie || {};
      window.RomanPie.getSessionToken = () => token;
      window.RomanPie.refreshSession = () => ensureSessionToken(); // returns Promise<string>
      return token;
    }
  
    // Cross-tab sync: if another tab updates the token, keep this tab in sync
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const rec = JSON.parse(e.newValue);
          if (rec?.token) setCookie(COOKIE_NAME, rec.token, 30);
        } catch {}
      }
    });
  
    // Auto-init on DOM ready
    document.addEventListener("DOMContentLoaded", () => {
      initSession()
        .then((t) => console.log("[RomanPie] session token ready:", t))
        .catch((e) => console.error("[RomanPie] session error:", e));
    });
  })();
  