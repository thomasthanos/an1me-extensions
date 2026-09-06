const AN1ME_GATEWAY_URL = "https://an1me.to/";
const AN1ME_TAB_MATCH = ["https://an1me.to/*", "https://*.an1me.to/*"];
const AN1ME_READY_TIMEOUT_MS = 25000;
const AN1ME_EXISTING_TAB_READY_MS = 2500;
const AN1ME_READY_POLL_MS = 250;
const AN1ME_IDLE_CLOSE_MS = 8000;
const AN1ME_CHALLENGE_RETRY_MS = 3000;
const AN1ME_DIRECT_COOLDOWN_MS = 10 * 60 * 1000;
const AN1ME_GATEWAY_COOLDOWN_MS = 5 * 60 * 1000;
const AN1ME_TAB_OPT_IN_KEY = "an1meGatewayTabEnabled";

let _an1meTabId = null;
let _an1meTabOwned = false;
let _an1meLeases = 0;
let _an1meCloseTimer = null;
let _an1meAcquiring = null;

let _an1meDirectBlockedUntil = 0;
let _an1meGatewayBlockedUntil = 0;
let _an1meTabOptIn = false;

try {
  chrome.storage.local
    .get([AN1ME_TAB_OPT_IN_KEY])
    .then((stored) => {
      _an1meTabOptIn = stored?.[AN1ME_TAB_OPT_IN_KEY] === true;
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local" || !changes[AN1ME_TAB_OPT_IN_KEY]) return;
    _an1meTabOptIn = changes[AN1ME_TAB_OPT_IN_KEY].newValue === true;
  });
} catch {}

function sendToAn1meTab(tabId, payload) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, payload, (reply) => {
        void chrome.runtime.lastError;
        resolve(reply || null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function an1meTabReady(tabId, timeoutMs = AN1ME_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reply = await sendToAn1meTab(tabId, { type: "AN1ME_PING" });
    if (reply?.ready === true) return true;
    await new Promise((r) => setTimeout(r, AN1ME_READY_POLL_MS));
  }
  return false;
}

async function findLiveAn1meTab() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: AN1ME_TAB_MATCH });
  } catch {
    return null;
  }
  const tab = (tabs || []).find((t) => t && t.id != null && t.discarded !== true && t.status !== "unloaded");
  return tab || null;
}

async function acquireAn1meTab() {
  if (_an1meCloseTimer) {
    clearTimeout(_an1meCloseTimer);
    _an1meCloseTimer = null;
  }

  if (_an1meTabId != null) {
    try {
      await chrome.tabs.get(_an1meTabId);
      _an1meLeases++;
      return _an1meTabId;
    } catch {
      _an1meTabId = null;
      _an1meTabOwned = false;
    }
  }

  if (_an1meAcquiring) {
    const shared = await _an1meAcquiring;
    if (shared != null) _an1meLeases++;
    return shared;
  }

  _an1meAcquiring = (async () => {
    const existing = await findLiveAn1meTab();
    if (existing && (await an1meTabReady(existing.id, AN1ME_EXISTING_TAB_READY_MS))) {
      _an1meTabId = existing.id;
      _an1meTabOwned = false;
      return _an1meTabId;
    }

    if (!_an1meTabOptIn) return null;

    let created;
    try {
      created = await chrome.tabs.create({ url: AN1ME_GATEWAY_URL, active: false });
    } catch {
      return null;
    }
    if (!created || created.id == null) return null;

    if (!(await an1meTabReady(created.id))) {
      try {
        await chrome.tabs.remove(created.id);
      } catch {}
      return null;
    }

    _an1meTabId = created.id;
    _an1meTabOwned = true;
    return _an1meTabId;
  })();

  try {
    const tabId = await _an1meAcquiring;
    if (tabId != null) _an1meLeases++;
    return tabId;
  } finally {
    _an1meAcquiring = null;
  }
}

function releaseAn1meTab() {
  _an1meLeases = Math.max(0, _an1meLeases - 1);
  if (_an1meLeases > 0 || !_an1meTabOwned || _an1meTabId == null) return;

  if (_an1meCloseTimer) clearTimeout(_an1meCloseTimer);
  _an1meCloseTimer = setTimeout(async () => {
    _an1meCloseTimer = null;
    if (_an1meLeases > 0 || !_an1meTabOwned || _an1meTabId == null) return;
    const tabId = _an1meTabId;
    _an1meTabId = null;
    _an1meTabOwned = false;
    try {
      await chrome.tabs.remove(tabId);
    } catch {}
  }, AN1ME_IDLE_CLOSE_MS);
}

function isAn1meChallenge(reply) {
  return !!reply && reply.ok !== true && (reply.status === 403 || reply.status === 503);
}

function looksLikeChallengeHtml(text) {
  const body = String(text || "");
  if (body.length > 200000) return false;
  return (
    /cf-browser-verification|cf_chl_opt|__cf_chl_|challenge-platform|cdn-cgi\/challenge/i.test(body) ||
    /<title>\s*(?:Just a moment|Attention Required|Please Wait)/i.test(body)
  );
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function an1meDirectAllowed() {
  return Date.now() >= _an1meDirectBlockedUntil;
}

function markAn1meDirectHealthy() {
  _an1meDirectBlockedUntil = 0;
  _an1meGatewayBlockedUntil = 0;
}

function markAn1meDirectBlocked() {
  _an1meDirectBlockedUntil = Date.now() + AN1ME_DIRECT_COOLDOWN_MS;
}

async function an1meDirectFetch(url, as, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept:
          as === "dataUrl"
            ? "image/avif,image/webp,image/png,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "el-GR,el;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (as === "dataUrl") {
      const blob = await res.blob();
      return { ok: res.ok, status: res.status, finalUrl: res.url, dataUrl: await blobToDataUrl(blob), via: "direct" };
    }

    const text = await res.text();
    if (res.ok && looksLikeChallengeHtml(text)) {
      return { ok: false, status: 503, finalUrl: res.url, text: "", challenge: true, via: "direct" };
    }
    return { ok: res.ok, status: res.status, finalUrl: res.url, text, via: "direct" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function an1meTabFetch(url, as, timeoutMs) {
  const tabId = await acquireAn1meTab();
  if (tabId == null) return null;

  try {
    let reply = await sendToAn1meTab(tabId, { type: "AN1ME_FETCH", url, as, timeoutMs });

    if (isAn1meChallenge(reply)) {
      await new Promise((r) => setTimeout(r, AN1ME_CHALLENGE_RETRY_MS));
      reply = await sendToAn1meTab(tabId, { type: "AN1ME_FETCH", url, as, timeoutMs });
    }

    if (!reply) return null;
    return {
      ok: reply.ok === true,
      status: Number(reply.status) || 0,
      text: typeof reply.text === "string" ? reply.text : "",
      dataUrl: typeof reply.dataUrl === "string" ? reply.dataUrl : null,
      finalUrl: reply.finalUrl || url,
      via: "tab",
    };
  } finally {
    releaseAn1meTab();
  }
}

async function an1meFetch(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const as = options.as === "dataUrl" ? "dataUrl" : "text";

  if (!an1meDirectAllowed() && Date.now() < _an1meGatewayBlockedUntil) {
    return { ok: false, status: 0, unreachable: true, needsBrowserContext: true };
  }

  if (an1meDirectAllowed()) {
    const direct = await an1meDirectFetch(url, as, timeoutMs);
    if (direct && !isAn1meChallenge(direct)) {
      markAn1meDirectHealthy();
      return direct;
    }
    markAn1meDirectBlocked();
  }

  const viaTab = await an1meTabFetch(url, as, timeoutMs);
  if (viaTab) {
    if (viaTab.ok) _an1meGatewayBlockedUntil = 0;
    return viaTab;
  }

  _an1meGatewayBlockedUntil = Date.now() + AN1ME_GATEWAY_COOLDOWN_MS;
  return { ok: false, status: 0, unreachable: true, needsBrowserContext: true };
}

function onAn1meTabAvailable() {
  _an1meGatewayBlockedUntil = 0;
  _an1meDirectBlockedUntil = 0;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== _an1meTabId) return;
  _an1meTabId = null;
  _an1meTabOwned = false;
  _an1meLeases = 0;
});

try {
  globalThis.an1meGatewayStats = async () => {
    const tab = await findLiveAn1meTab();
    const info = {
      directPath: an1meDirectAllowed() ? "available" : `cooling down ${Math.round((_an1meDirectBlockedUntil - Date.now()) / 1000)}s`,
      gateway: Date.now() < _an1meGatewayBlockedUntil ? `cooling down ${Math.round((_an1meGatewayBlockedUntil - Date.now()) / 1000)}s` : "available",
      openAn1meTab: tab ? tab.id : null,
      tabCreationOptIn: _an1meTabOptIn,
    };
    console.table([info]);
    return info;
  };
} catch {}
