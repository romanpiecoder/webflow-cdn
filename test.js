// test.js — session + cart cache (no preflight; form-encoded POSTs)
(function () {
    // ===== CONFIG (override via <script data-*> or window.RomanPieConfig) =====
    const defaults = {
      n8nBase: "https://YOUR-N8N.onrender.com/webhook",
      saleorChannel: "default-channel",
      storageKeyToken: "rp.checkoutToken",
      storageKeyCart: "rp.cart",
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
          debug:
            s?.dataset?.debug === "true"
              ? true
              : s?.dataset?.debug === "false"
              ? false
              : undefined,
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
      try { localStorage.setItem(cfg.storageKeyToken, JSON.stringify({ token: String(token), t: Date.now() })); } catch {}
      setCookie(cfg.cookieName, String(token), cfg.cookieDays);
      return token;
    }
    function readToken() {
      try {
        const rec = JSON.parse(localStorage.getItem(cfg.storageKeyToken) || "null");
        return (rec?.token || getCookie(cfg.cookieName) || "").trim() || null;
      } catch { return (getCookie(cfg.cookieName) || "").trim() || null; }
    }
  
    function saveCart(lines) {
      // lines: [{ variantId, quantity }]
      const safe = Array.isArray(lines) ? lines.map(l => ({ variantId: String(l.variantId), quantity: Number(l.quantity)||0 })) : [];
      try { localStorage.setItem(cfg.storageKeyCart, JSON.stringify({ lines: safe, t: Date.now() })); } catch {}
      // Dispatch a DOM event so Webflow or other scripts can react
      try {
        document.dispatchEvent(new CustomEvent("rp:cart-updated", { detail: { lines: safe } }));
      } catch {}
      return safe;
    }
    function readCart() {
      try {
        const rec = JSON.parse(localStorage.getItem(cfg.storageKeyCart) || "null");
        return Array.isArray(rec?.lines) ? rec.lines : [];
      } catch { return []; }
    }
  
    // ===== HTTP helper: form-encoded, no headers (no preflight) =====
    async function postForm(url, obj) {
      const body = new URLSearchParams();
      Object.entries(obj || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null) body.append(k, String(v));
      });
      const res = await fetch(url, { method: "POST", body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try { return await res.json(); } catch { return await res.text(); }
    }
  
    // ===== Response parsing =====
    // Accepts a variety of shapes from n8n → Saleor
    // We try to find a "checkout" object and extract lines [{variantId, quantity}]
    function parseCheckoutPayload(data) {
      // normalize text → json fallback
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return { token: null, lines: [] }; }
      }
      const checkout =
        data?.checkout ||
        data?.data?.checkout ||
        data?.data?.checkoutCreate?.checkout ||
        null;
  
      const token =
        checkout?.token ||
        data?.token || // if backend echoed token alone
        null;
  
      const rawLines =
        checkout?.lines ||
        data?.lines ||
        [];
  
      const lines = Array.isArray(rawLines)
        ? rawLines.map(l => {
            const variantId = l?.variant?.id || l?.variantId || l?.variant?.globalId || null;
            const quantity = Number(l?.quantity || 0);
            return variantId ? { variantId, quantity } : null;
          }).filter(Boolean)
        : [];
  
      return { token, lines, checkout };
    }
  
    // ===== Backend interactions =====
    async function validateTokenAndFetch(token) {
      if (!token) return { ok: false, lines: [], checkout: null };
      try {
        const data = await postForm(`${cfg.n8nBase}/checkout/get`, { token: String(token).trim() });
        const { token: echoed, lines, checkout } = parseCheckoutPayload(data);
        const ok = !!(echoed || checkout); // treat presence of a checkout as valid
        log("validate+fetch:", ok ? "✅ valid" : "❌ invalid", "lines:", lines);
        if (ok) saveCart(lines);
        return { ok, lines, checkout };
      } catch (e) {
        log("validate+fetch error:", e.message);
        return { ok: false, lines: [], checkout: null };
      }
    }
  
    async function createCheckout() {
      const data = await postForm(`${cfg.n8nBase}/checkout/create`, { channel: cfg.saleorChannel });
      const { token, lines, checkout } = parseCheckoutPayload(data);
      if (!token) throw new Error("No token returned by create");
      log("createCheckout: ✅ token", token, "lines:", lines);
      saveCart(lines || []);
      return { token, lines, checkout };
    }
  
    async function ensureSessionAndCart() {
      // 1) token
      let token = readToken();
  
      // 2) validate + fetch cart
      if (token) {
        const { ok } = await validateTokenAndFetch(token);
        if (ok) {
          saveToken(token); // refresh timestamps/cookie
          return token;
        }
        // invalid -> clear and recreate
        try { localStorage.removeItem(cfg.storageKeyToken); } catch {}
        setCookie(cfg.cookieName, "", -1);
        token = null;
      }
  
      // 3) create
      const created = await createCheckout();
      token = created.token;
      saveToken(token);
      return token;
    }
  
    // Cross-tab sync: mirror token storage changes into cookie
    window.addEventListener("storage", (e) => {
      if (e.key === cfg.storageKeyToken && e.newValue) {
        try {
          const rec = JSON.parse(e.newValue);
          if (rec?.token) setCookie(cfg.cookieName, rec.token, cfg.cookieDays);
        } catch {}
      }
    });
  
    // ===== Public API =====
    async function init() {
      if (!cfg.n8nBase) {
        console.error("[RomanPie] Missing n8nBase. Add data-n8n-base on the <script> tag.");
        return null;
      }
      const token = await ensureSessionAndCart();
      window.RomanPie = window.RomanPie || {};
      window.RomanPie.getSessionToken = () => token;                 // string
      window.RomanPie.refreshSession = () => ensureSessionAndCart(); // Promise<string>
      window.RomanPie.getCart = () => readCart();                    // [{variantId, quantity}]
      log("session ready:", token, "cart:", readCart());
      return token;
    }
  
    document.addEventListener("DOMContentLoaded", () => {
      init().catch((e) => console.error("[RomanPie] init error:", e));
    });
  })();
  