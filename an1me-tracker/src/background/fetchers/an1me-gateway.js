// an1me-gateway.js - single entry point for every an1me.to request.
//
// Order of attempts:
//   1. Direct fetch from the service worker (host permissions + cookies, with Referer/Origin
//      normalized by the static declarativeNetRequest ruleset). This is the normal path and costs
//      nothing - no tab, no page load, no flicker. A timeout or a transport error is retried here
//      with a longer budget; ONLY a real Cloudflare interstitial gives up on this path.
//
//      On the DNR ruleset, measured rather than assumed: an1me.to serves the full page (HTTP 200,
//      ~189KB) to a plain non-browser request carrying no Referer and no Origin, and the response
//      is byte-identical with those headers set. So the ruleset is NOT what makes this path work -
//      the retry/backoff logic below is. It is kept only to normalize the one difference a plain
//      client cannot reproduce, an extension-origin request advertising
//      "Origin: chrome-extension://..." and "Sec-Fetch-Site: none". Sec-Fetch-* are deliberately
//      NOT in the ruleset: they are browser-controlled fetch metadata that DNR is not documented
//      to allow setting, and one rejected header can invalidate the whole ruleset.
//   2. An an1me.to tab, whose content bridge does the fetch from the page's own network context so
//      it carries cf_clearance/__cf_bm and the WordPress session cookie: a tab the user already
//      has open if there is one, otherwise a hidden background tab we create and reap.
//   3. Nothing usable -> report unreachable so the caller backs off. Pending work is picked up
//      again by the alarms, or immediately when the user opens an1me.to (AN1ME_TAB_READY).
//
// The single most important invariant here: a timeout is NOT a block. Conflating the two used to
// let three slow page loads disable the working path for everyone, after which a sweep with no
// an1me.to tab open reported every remaining entry as unreachable.
const AN1ME_GATEWAY_URL = "https://an1me.to/";
const AN1ME_TAB_MATCH = ["https://an1me.to/*", "https://*.an1me.to/*"];
const AN1ME_URL_RE = /^https:\/\/(?:[a-z0-9-]+\.)?an1me\.to\//i;
const AN1ME_READY_TIMEOUT_MS = 25000;
// A tab the user already has open may be mid-navigation; 2.5s used to time out on it and fall
// straight through to "no tab", even though a perfectly good tab existed.
const AN1ME_EXISTING_TAB_READY_MS = 6000;
const AN1ME_READY_POLL_MS = 250;
const AN1ME_IDLE_CLOSE_MS = 8000;
// MV3 tears the worker down on idle and an 8s setTimeout routinely dies with it, orphaning the tab
// we created. The alarm is the backstop that survives teardown; the storage key is how a fresh
// worker knows the orphan was ours.
const AN1ME_IDLE_CLOSE_ALARM = "an1meGatewayTabClose";
const AN1ME_OWNED_TAB_KEY = "an1meGatewayOwnedTabId";
const AN1ME_CHALLENGE_RETRY_MS = 3000;
// Consecutive direct-path CHALLENGES tolerated before a short backoff. Both values are kept small
// on purpose: a single bad response must never cascade into "everything unreachable" for the
// rest of a sweep, which is exactly what a long blanket cooldown used to cause.
const AN1ME_DIRECT_FAIL_STREAK = 3;
const AN1ME_DIRECT_COOLDOWN_MS = 30 * 1000;
const AN1ME_TAB_OPT_IN_KEY = "an1meGatewayTabEnabled";
// Creating a hidden background tab is now the default last resort rather than an undiscoverable
// opt-in nothing ever set. Set the storage key to false to forbid it.
const AN1ME_TAB_CREATE_DEFAULT = true;
const AN1ME_DEFAULT_TIMEOUT_MS = 15000;
// A slow page is the normal reason a first attempt times out (the episode index for a
// 1000-episode series is genuinely large), so the retry gets a longer budget, not a shorter one.
const AN1ME_SLOW_RETRY_TIMEOUT_MS = 20000;
const AN1ME_DIRECT_RETRY_BASE_MS = 1200;
const AN1ME_DIRECT_RETRY_JITTER = 0.3;
// Wall-clock guard for chrome.tabs.sendMessage, which otherwise relies entirely on the port
// closing and can hang a lease indefinitely.
const AN1ME_SEND_TIMEOUT_PAD_MS = 5000;

let _an1meTabId = null;
let _an1meTabOwned = false;
let _an1meLeases = 0;
let _an1meCloseTimer = null;
let _an1meAcquiring = null;

let _an1meDirectFailStreak = 0;
let _an1meDirectRetryAt = 0;
let _an1meTabOptIn = AN1ME_TAB_CREATE_DEFAULT;
let _an1meLastChallengeLogAt = 0;
let _an1meSuppressedChallengeLogs = 0;

const _an1meInflight = new Map();
const _an1meCounters = {
  directOk: 0,
  directChallenge: 0,
  directTimeout: 0,
  directNetwork: 0,
  tabOk: 0,
  tabChallenge: 0,
  tabFail: 0,
  unreachable: 0,
  coalesced: 0,
};

try {
  chrome.storage.local
    .get([AN1ME_TAB_OPT_IN_KEY])
    .then((stored) => {
      const value = stored?.[AN1ME_TAB_OPT_IN_KEY];
      _an1meTabOptIn = value === undefined ? AN1ME_TAB_CREATE_DEFAULT : value === true;
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local" || !changes[AN1ME_TAB_OPT_IN_KEY]) return;
    const value = changes[AN1ME_TAB_OPT_IN_KEY].newValue;
    _an1meTabOptIn = value === undefined ? AN1ME_TAB_CREATE_DEFAULT : value === true;
  });
} catch {}

function isAn1meUrl(url) {
  return AN1ME_URL_RE.test(String(url || ""));
}

function an1meJitter(ms) {
  const spread = ms * AN1ME_DIRECT_RETRY_JITTER;
  return Math.max(0, Math.round(ms - spread + Math.random() * spread * 2));
}

function an1meSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// Resolves null on timeout instead of hanging on a port that never closes.
function sendToAn1meTab(tabId, payload, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), Math.max(1000, timeoutMs || AN1ME_SEND_TIMEOUT_PAD_MS));
    try {
      chrome.tabs.sendMessage(tabId, payload, (reply) => {
        void chrome.runtime.lastError;
        clearTimeout(timer);
        finish(reply || null);
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

async function an1meTabReady(tabId, timeoutMs = AN1ME_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reply = await sendToAn1meTab(tabId, { type: "AN1ME_PING" }, 2000);
    if (reply?.ready === true) return true;
    await an1meSleep(AN1ME_READY_POLL_MS);
  }
  return false;
}

// Every usable an1me.to tab, fully-loaded ones first. Picking the single first match meant one
// mid-navigation tab could mask several perfectly good ones.
async function findLiveAn1meTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: AN1ME_TAB_MATCH });
  } catch {
    return [];
  }
  const usable = (tabs || []).filter((t) => t && t.id != null && t.discarded !== true && t.status !== "unloaded");
  usable.sort((a, b) => Number(b.status === "complete") - Number(a.status === "complete"));
  return usable;
}

async function rememberOwnedAn1meTab(tabId) {
  try {
    await chrome.storage.local.set({ [AN1ME_OWNED_TAB_KEY]: tabId });
  } catch {}
}

async function forgetOwnedAn1meTab() {
  try {
    await chrome.storage.local.remove([AN1ME_OWNED_TAB_KEY]);
  } catch {}
}

// Closes a tab this extension created but never got to reap - because the worker was torn down
// before its close timer fired, or the browser restarted. Without this the orphan is re-adopted
// with _an1meTabOwned = false and then lives forever.
async function reapOrphanAn1meGatewayTab() {
  let stored;
  try {
    stored = await chrome.storage.local.get([AN1ME_OWNED_TAB_KEY]);
  } catch {
    return;
  }
  const raw = stored?.[AN1ME_OWNED_TAB_KEY];
  const tabId = Number(raw);
  if (!Number.isFinite(tabId)) return;
  if (_an1meLeases > 0 && tabId === _an1meTabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && isAn1meUrl(tab.url)) await chrome.tabs.remove(tabId);
  } catch {}
  if (tabId === _an1meTabId) {
    _an1meTabId = null;
    _an1meTabOwned = false;
  }
  await forgetOwnedAn1meTab();
}

function scheduleAn1meTabClose() {
  if (_an1meCloseTimer) clearTimeout(_an1meCloseTimer);
  _an1meCloseTimer = setTimeout(() => {
    _an1meCloseTimer = null;
    void closeOwnedAn1meTab();
  }, AN1ME_IDLE_CLOSE_MS);
  try {
    chrome.alarms.create(AN1ME_IDLE_CLOSE_ALARM, { when: Date.now() + AN1ME_IDLE_CLOSE_MS });
  } catch {}
}

function cancelAn1meTabClose() {
  if (_an1meCloseTimer) {
    clearTimeout(_an1meCloseTimer);
    _an1meCloseTimer = null;
  }
  try {
    chrome.alarms.clear(AN1ME_IDLE_CLOSE_ALARM).catch(() => {});
  } catch {}
}

async function closeOwnedAn1meTab() {
  if (_an1meLeases > 0 || !_an1meTabOwned || _an1meTabId == null) return;
  const tabId = _an1meTabId;
  _an1meTabId = null;
  _an1meTabOwned = false;
  try {
    await chrome.tabs.remove(tabId);
  } catch {}
  await forgetOwnedAn1meTab();
}

async function handleAn1meGatewayAlarm(name) {
  if (name !== AN1ME_IDLE_CLOSE_ALARM) return false;
  await closeOwnedAn1meTab();
  await reapOrphanAn1meGatewayTab();
  return true;
}

// Resolves to a usable an1me.to tab, creating a hidden one as a last resort.
async function acquireAn1meTab() {
  cancelAn1meTabClose();

  if (_an1meTabId != null) {
    try {
      const tab = await chrome.tabs.get(_an1meTabId);
      // chrome.tabs.get still succeeds after the user navigates the tab off an1me.to, at which
      // point the content bridge is gone and every send silently resolves null - forever, with
      // no rescan of the other tabs that might be open.
      if (tab && isAn1meUrl(tab.url)) {
        _an1meLeases++;
        return _an1meTabId;
      }
      _an1meTabId = null;
      _an1meTabOwned = false;
    } catch {
      _an1meTabId = null;
      _an1meTabOwned = false;
    }
  }

  if (_an1meAcquiring) {
    try {
      const shared = await _an1meAcquiring;
      if (shared != null) _an1meLeases++;
      return shared;
    } catch {
      return null;
    }
  }

  _an1meAcquiring = (async () => {
    for (const existing of await findLiveAn1meTabs()) {
      if (await an1meTabReady(existing.id, AN1ME_EXISTING_TAB_READY_MS)) {
        _an1meTabId = existing.id;
        _an1meTabOwned = false;
        return _an1meTabId;
      }
    }

    if (!_an1meTabOptIn) return null;

    let created;
    try {
      created = await chrome.tabs.create({ url: AN1ME_GATEWAY_URL, active: false });
    } catch {
      return null;
    }
    if (!created || created.id == null) return null;
    await rememberOwnedAn1meTab(created.id);

    if (!(await an1meTabReady(created.id))) {
      try {
        await chrome.tabs.remove(created.id);
      } catch {}
      await forgetOwnedAn1meTab();
      return null;
    }

    _an1meTabId = created.id;
    _an1meTabOwned = true;
    return _an1meTabId;
  })();

  // A rejection here used to escape an1meTabFetch's try/finally, so an1meFetch threw a raw error
  // instead of returning {unreachable:true} and the caller never saw an1me_unreachable.
  try {
    const tabId = await _an1meAcquiring;
    if (tabId != null) _an1meLeases++;
    return tabId;
  } catch {
    return null;
  } finally {
    _an1meAcquiring = null;
  }
}

function releaseAn1meTab() {
  _an1meLeases = Math.max(0, _an1meLeases - 1);
  if (_an1meLeases > 0 || !_an1meTabOwned || _an1meTabId == null) return;
  scheduleAn1meTabClose();
}

function isAn1meChallengeStatus(status) {
  const code = Number(status) || 0;
  return code === 403 || code === 503;
}

// Cloudflare can answer 200 with an interstitial instead of the page, and such a body must not
// reach the scraper or it would cache empty metadata as truth.
//
// The detection has to be narrow: EVERY page on a Cloudflare site embeds the benign detection
// beacon /cdn-cgi/challenge-platform/scripts/jsd/main.js, so the mere word "challenge-platform"
// is not evidence of a block. A real interstitial is a small stub carrying none of the site's
// own markup, so the size limit and the real-page markers below do the actual work.
const AN1ME_REAL_PAGE_MARKERS = /current_post_data_id|current_anime_id|anime-main-image|wp-content\/uploads|og:title|<\/dd>/i;
const AN1ME_CHALLENGE_MARKERS = /cf-browser-verification|cf_chl_opt|__cf_chl_|\/cdn-cgi\/challenge-platform\/h\//i;
const AN1ME_CHALLENGE_TITLES =
  /<title>\s*(?:Just a moment|Attention Required|Please Wait|Verifying you are human|Access denied)/i;
const AN1ME_CHALLENGE_MAX_BYTES = 80000;

function looksLikeChallengeHtml(text) {
  const body = String(text || "");
  if (body.length > AN1ME_CHALLENGE_MAX_BYTES) return false;
  if (AN1ME_REAL_PAGE_MARKERS.test(body)) return false;
  return AN1ME_CHALLENGE_MARKERS.test(body) || AN1ME_CHALLENGE_TITLES.test(body);
}

// Visible in the service-worker console: if the direct path is ever genuinely blocked, this is
// what tells us instead of the sweep silently reporting an1me_unreachable. Rate-limited to one
// line a minute, but the suppressed count rides along so a 50-entry blocked sweep no longer looks
// like a single isolated hiccup.
function logAn1meBlocked(url, status, bytes) {
  const now = Date.now();
  if (now - _an1meLastChallengeLogAt < 60000) {
    _an1meSuppressedChallengeLogs++;
    return;
  }
  const suppressed = _an1meSuppressedChallengeLogs;
  _an1meSuppressedChallengeLogs = 0;
  _an1meLastChallengeLogAt = now;
  const extra = suppressed > 0 ? ` (+${suppressed} more suppressed in the last minute)` : "";
  console.warn(`[BG] an1me.to blocked the direct request (status ${status}, ${bytes} bytes): ${url}${extra}`);
}

async function blobToDataUrl(blob) {
  // FileReader does not exist in a service worker - encode manually.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function an1meDirectAllowed() {
  return Date.now() >= _an1meDirectRetryAt;
}

function markAn1meDirectHealthy() {
  _an1meDirectFailStreak = 0;
  _an1meDirectRetryAt = 0;
}

// Only ever called for a real interstitial. A timeout or a transport error must not land here -
// that conflation is what made slow pages look like a site-wide block.
function markAn1meDirectBlocked() {
  _an1meDirectFailStreak++;
  if (_an1meDirectFailStreak >= AN1ME_DIRECT_FAIL_STREAK) {
    _an1meDirectRetryAt = Date.now() + AN1ME_DIRECT_COOLDOWN_MS;
    _an1meDirectFailStreak = 0;
  }
}

function an1meAcceptHeader(as) {
  return as === "dataUrl"
    ? "image/avif,image/webp,image/png,image/*,*/*;q=0.8"
    : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
}

// Returns a discriminated outcome rather than null-for-everything, so the caller can tell a
// Cloudflare interstitial (give up on this path) from a slow page (retry it) from the network
// being down (report it).
async function an1meDirectFetch(url, req, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      Accept: an1meAcceptHeader(req.as),
      "Accept-Language": "el-GR,el;q=0.9,en-US;q=0.8,en;q=0.7",
      ...(req.headers || {}),
    };
    const res = await fetch(url, {
      method: req.method,
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers,
      ...(req.body != null ? { body: req.body } : {}),
    });

    if (req.as === "dataUrl") {
      const blob = await res.blob();
      if (isAn1meChallengeStatus(res.status)) {
        logAn1meBlocked(url, res.status, blob.size);
        return { kind: "challenge" };
      }
      return {
        kind: "ok",
        result: { ok: res.ok, status: res.status, finalUrl: res.url, dataUrl: await blobToDataUrl(blob), via: "direct" },
      };
    }

    const text = await res.text();
    if (res.ok && looksLikeChallengeHtml(text)) {
      logAn1meBlocked(url, `${res.status} (interstitial)`, text.length);
      return { kind: "challenge" };
    }
    if (isAn1meChallengeStatus(res.status)) {
      logAn1meBlocked(url, res.status, text.length);
      return { kind: "challenge" };
    }
    return { kind: "ok", result: { ok: res.ok, status: res.status, finalUrl: res.url, text, via: "direct" } };
  } catch (error) {
    // controller.abort() surfaces as AbortError, which is our own timeout firing - not a block.
    return { kind: error?.name === "AbortError" ? "timeout" : "network", error };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAn1meTabReply(reply, url) {
  return {
    ok: reply.ok === true,
    status: Number(reply.status) || 0,
    text: typeof reply.text === "string" ? reply.text : "",
    dataUrl: typeof reply.dataUrl === "string" ? reply.dataUrl : null,
    finalUrl: reply.finalUrl || url,
    via: "tab",
  };
}

// Worth one retry if the status says challenge, if the body is an interstitial stub, or if the
// bridge reported a transport error. The last case used to be coerced to status 0, which the old
// challenge check rejected, so transport errors never retried at all.
function an1meTabReplyIsRetryable(reply, as) {
  if (!reply) return true;
  if (reply.ok !== true) return true;
  return as !== "dataUrl" && looksLikeChallengeHtml(reply.text);
}

async function an1meTabFetch(url, req, timeoutMs, deadline) {
  const tabId = await acquireAn1meTab();
  if (tabId == null) return null;

  const payload = {
    type: "AN1ME_FETCH",
    url,
    as: req.as,
    timeoutMs,
    method: req.method,
    body: req.body ?? null,
    headers: req.headers || null,
  };
  try {
    let reply = await sendToAn1meTab(tabId, payload, timeoutMs + AN1ME_SEND_TIMEOUT_PAD_MS);

    if (an1meTabReplyIsRetryable(reply, req.as) && Date.now() + AN1ME_CHALLENGE_RETRY_MS < deadline) {
      await an1meSleep(AN1ME_CHALLENGE_RETRY_MS);
      const retry = await sendToAn1meTab(tabId, payload, timeoutMs + AN1ME_SEND_TIMEOUT_PAD_MS);
      if (retry) reply = retry;
    }

    if (!reply) {
      _an1meCounters.tabFail++;
      return null;
    }

    // The interstitial is served FROM an1me.to, so site-fetch-bridge.js is injected into it and
    // answers AN1ME_PING with {ready:true}. Without this check the gateway happily adopts a tab
    // sitting on an interstitial, gets 200 + stub HTML, and the scraper writes the stub's absent
    // metadata into the cache as authoritative truth.
    if (req.as !== "dataUrl" && reply.ok === true && looksLikeChallengeHtml(reply.text)) {
      logAn1meBlocked(url, "200 (interstitial via tab)", String(reply.text || "").length);
      _an1meCounters.tabChallenge++;
      return null;
    }

    if (reply.ok === true) _an1meCounters.tabOk++;
    else _an1meCounters.tabFail++;
    return normalizeAn1meTabReply(reply, url);
  } finally {
    releaseAn1meTab();
  }
}

async function an1meFetchUncoalesced(url, options) {
  const req = {
    as: options.as === "dataUrl" ? "dataUrl" : "text",
    method: String(options.method || "GET").toUpperCase(),
    body: options.body ?? null,
    headers: options.headers || null,
  };
  const firstTimeout = Number(options.timeoutMs) || AN1ME_DEFAULT_TIMEOUT_MS;
  // One wall-clock budget for the whole logical fetch. Without it, readiness polling plus two
  // per-attempt timeouts plus a challenge sleep could run past 50s while the popup's caller had
  // already given up at 45s.
  const totalBudget = Number(options.totalBudgetMs) || Math.min(Math.max(firstTimeout * 3, 20000), 40000);
  const deadline = Date.now() + totalBudget;
  const remaining = () => deadline - Date.now();

  if (an1meDirectAllowed()) {
    let attempt = 0;
    while (attempt < 2 && remaining() > 1000) {
      const budget = Math.min(
        attempt === 0 ? firstTimeout : Math.max(firstTimeout, AN1ME_SLOW_RETRY_TIMEOUT_MS),
        remaining(),
      );
      const outcome = await an1meDirectFetch(url, req, budget);

      if (outcome.kind === "ok") {
        _an1meCounters.directOk++;
        markAn1meDirectHealthy();
        return outcome.result;
      }
      if (outcome.kind === "challenge") {
        _an1meCounters.directChallenge++;
        markAn1meDirectBlocked();
        break;
      }

      // timeout | network: the direct path is fine, this one request was not. Retry it here
      // rather than condemning the path and falling through to the tab rung.
      if (outcome.kind === "timeout") _an1meCounters.directTimeout++;
      else _an1meCounters.directNetwork++;
      attempt++;
      if (attempt < 2) {
        const backoff = an1meJitter(AN1ME_DIRECT_RETRY_BASE_MS * Math.pow(2, attempt - 1));
        if (backoff >= remaining()) break;
        await an1meSleep(backoff);
      }
    }
  }

  if (remaining() > 1000) {
    const viaTab = await an1meTabFetch(url, req, Math.min(firstTimeout, Math.max(1000, remaining())), deadline);
    if (viaTab) return viaTab;
  }

  _an1meCounters.unreachable++;
  return { ok: false, status: 0, unreachable: true, needsBrowserContext: true };
}

// Coalesces concurrent identical GETs. The repair sweep, smart-notifications (which forces a
// refresh), GET_FILLER_EPISODES from the watch page, slug migration and the cover cache can all
// ask for the same /anime/<slug>/ at once; the layers above only coalesce per-caller and key on
// the force flag, so a forced request never joined an in-flight cached one.
function an1meFetch(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET") return an1meFetchUncoalesced(url, options);

  const key = `${method} ${options.as === "dataUrl" ? "dataUrl" : "text"} ${url}`;
  const existing = _an1meInflight.get(key);
  if (existing) {
    _an1meCounters.coalesced++;
    return existing;
  }

  const request = an1meFetchUncoalesced(url, options);
  _an1meInflight.set(key, request);
  const clear = () => {
    if (_an1meInflight.get(key) === request) _an1meInflight.delete(key);
  };
  request.then(clear, clear);
  return request;
}

// The user just landed on an1me.to: a real browser context exists again, so drop the backoff and
// let the deferred jobs run right away.
function onAn1meTabAvailable() {
  markAn1meDirectHealthy();
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== _an1meTabId) return;
  // Leases are decremented by releaseAn1meTab in an1meTabFetch's finally, so zeroing the counter
  // here would desync it against requests still in flight.
  _an1meTabId = null;
  _an1meTabOwned = false;
  void forgetOwnedAn1meTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== _an1meTabId || !changeInfo.url) return;
  if (isAn1meUrl(changeInfo.url)) return;
  _an1meTabId = null;
  _an1meTabOwned = false;
});

try {
  globalThis.an1meGatewayStats = async () => {
    const tabs = await findLiveAn1meTabs();
    const coolingFor = Math.max(0, Math.round((_an1meDirectRetryAt - Date.now()) / 1000));
    const info = {
      directPath: an1meDirectAllowed() ? "available" : `cooling down ${coolingFor}s`,
      challengeStreak: _an1meDirectFailStreak,
      openAn1meTabs: tabs.map((t) => t.id).join(",") || null,
      usingTabId: _an1meTabId,
      tabOwnedByUs: _an1meTabOwned,
      leases: _an1meLeases,
      tabCreationAllowed: _an1meTabOptIn,
      inflight: _an1meInflight.size,
      ..._an1meCounters,
    };
    console.table([info]);
    // An invalid static ruleset is skipped with only a warning in chrome://extensions, so surface
    // it here rather than letting it look like it is doing something.
    try {
      const rulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
      console.log(`[BG] DNR rulesets enabled: ${rulesets.join(", ") || "(none)"}`);
    } catch (e) {
      console.log("[BG] DNR ruleset status unavailable:", e?.message || e);
    }
    return info;
  };
} catch {}
