(function () {
  "use strict";

  const MAX_TIMEOUT_MS = 30000;
  const AN1ME_URL = /^https:\/\/(?:[a-z0-9-]+\.)?an1me\.to\//i;
  const ALLOWED_METHODS = new Set(["GET", "POST"]);

  try {
    chrome.runtime.sendMessage({ type: "AN1ME_TAB_READY", url: location.href }, () => void chrome.runtime.lastError);
  } catch {}

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;

    if (message.type === "AN1ME_PING") {
      sendResponse({ ready: true });
      return false;
    }

    if (message.type !== "AN1ME_FETCH") return false;

    const url = String(message.url || "");
    if (!AN1ME_URL.test(url)) {
      sendResponse({ ok: false, error: "url_not_allowed" });
      return false;
    }

    const method = String(message.method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      sendResponse({ ok: false, error: "method_not_allowed" });
      return false;
    }

    // The port can already be closed by the time we answer (the service worker was torn down
    // mid-request). sendResponse then throws, the .catch below fires, and without this guard it
    // would call sendResponse a second time and throw again as an unhandled page rejection.
    let settled = false;
    const reply = (payload) => {
      if (settled) return;
      settled = true;
      try {
        sendResponse(payload);
      } catch {}
    };

    const ctrl = new AbortController();
    const timeoutMs = Math.min(Number(message.timeoutMs) || 15000, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const init = {
      method,
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      signal: ctrl.signal,
    };
    // Bodies arrive as an already-encoded string: FormData is not structured-cloneable across
    // chrome.runtime messaging, so the caller serializes and sets its own Content-Type.
    if (method === "POST" && typeof message.body === "string") {
      init.body = message.body;
      init.headers = message.headers || { "Content-Type": "application/x-www-form-urlencoded" };
    } else if (message.headers) {
      init.headers = message.headers;
    }

    fetch(url, init)
      .then(async (res) => {
        if (message.as === "dataUrl") {
          const blob = await res.blob();
          const dataUrl = await new Promise((resolve, rejectRead) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => rejectRead(reader.error || new Error("read_failed"));
            reader.readAsDataURL(blob);
          });
          reply({ ok: res.ok, status: res.status, finalUrl: res.url, dataUrl });
          return;
        }
        reply({ ok: res.ok, status: res.status, finalUrl: res.url, text: await res.text() });
      })
      .catch((error) => reply({ ok: false, status: 0, error: error?.message || String(error) }))
      .finally(() => clearTimeout(timer));

    return true;
  });
})();
