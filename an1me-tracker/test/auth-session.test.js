// Pins how the background worker treats a failed Firebase token refresh.
//
//   node test/auth-session.test.js
//
// needsReauth ("Reconnect required") must mean only that Firebase rejected the refresh token. It used
// to be raised after a run of transient failures too, and since nothing retried a flagged session,
// a phone with a flaky connection stopped syncing for good. Loads the real background.js in a
// sandbox with an in-memory chrome.storage and a scripted fetch.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");
const HOUR = 60 * 60 * 1000;

function createWorker(initialStore = {}) {
  const store = JSON.parse(JSON.stringify(initialStore));
  const alarms = new Map();
  const fetchQueue = [];
  const fetchLog = [];
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  const pick = (keys) => {
    const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
    const out = {};
    for (const key of list) if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = clone(store[key]);
    return out;
  };
  const settle = (value, callback) => {
    if (typeof callback === "function") {
      setImmediate(() => callback(value));
      return undefined;
    }
    return Promise.resolve(value);
  };
  const event = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });

  // Any API the worker touches that the test does not care about: callable, awaitable, and able to
  // hand out listeners, at any depth.
  const anything = () =>
    new Proxy(function () {}, {
      get: (_target, prop) => (prop === "then" ? undefined : prop === "addListener" ? () => {} : anything()),
      apply: (_target, _this, args) => {
        const callback = args.find((arg) => typeof arg === "function");
        return settle(undefined, callback);
      },
    });

  const chrome = new Proxy(
    {
      runtime: {
        lastError: undefined,
        id: "test-extension",
        getManifest: () => JSON.parse(fs.readFileSync(path.join(REPO, "manifest.json"), "utf8")),
        getURL: (p) => `chrome-extension://test-extension/${p}`,
        sendMessage: (...args) => settle(undefined, args.find((arg) => typeof arg === "function")),
        onMessage: event(),
        onInstalled: event(),
        onStartup: event(),
        onConnect: event(),
      },
      storage: {
        local: {
          get: (keys, callback) => settle(pick(keys), callback),
          set: (data, callback) => {
            Object.assign(store, clone(data));
            return settle(undefined, callback);
          },
          remove: (keys, callback) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
            return settle(undefined, callback);
          },
        },
        sync: {
          get: (_keys, callback) => settle({}, callback),
          remove: (_keys, callback) => settle(undefined, callback),
        },
        onChanged: event(),
      },
      alarms: {
        create: (name, info) => {
          alarms.set(name, info);
          return Promise.resolve();
        },
        clear: (name) => Promise.resolve(alarms.delete(name)),
        get: (name) => Promise.resolve(alarms.get(name)),
        getAll: () => Promise.resolve([...alarms.values()]),
        onAlarm: event(),
      },
    },
    { get: (target, prop) => (prop in target ? target[prop] : anything()) },
  );

  const fetch = async (url, options = {}) => {
    fetchLog.push(String(url));
    const next = fetchQueue.shift();
    if (!next) throw new TypeError(`Unexpected fetch: ${url}`);
    if (next.networkError) throw new TypeError("Load failed");
    const body = JSON.stringify(next.body ?? {});
    return new Response(body, { status: next.status, headers: { "Content-Type": "application/json" } });
  };

  const sandbox = {
    console: { log() {}, info() {}, debug() {}, warn() {}, error: console.error },
    chrome,
    fetch,
    Response,
    Headers,
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone,
    atob,
    btoa,
    crypto,
    setTimeout: (fn, ms, ...args) => {
      const timer = setTimeout(fn, ms, ...args);
      timer.unref?.();
      return timer;
    },
    clearTimeout,
    setInterval: (fn, ms, ...args) => {
      const timer = setInterval(fn, ms, ...args);
      timer.unref?.();
      return timer;
    },
    clearInterval,
    queueMicrotask,
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const run = (rel) => new vm.Script(fs.readFileSync(path.join(REPO, rel), "utf8"), { filename: rel }).runInContext(ctx);
  sandbox.importScripts = (...files) => files.forEach(run);
  run("background.js");

  return {
    store,
    alarms,
    fetchLog,
    queueFetch: (...responses) => fetchQueue.push(...responses),
    call: (name, ...args) => vm.runInContext(name, ctx)(...args),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));
const tokens = (worker) => worker.store.firebase_tokens;

// Boots a worker on top of an existing session, the way a browser restart or a wake-up finds it.
async function bootWithSession(overrides = {}) {
  const worker = createWorker({
    firebase_user: { uid: "uid-1", email: "user@example.com" },
    firebase_tokens: {
      idToken: "id-old",
      refreshToken: "refresh-old",
      expiresAt: Date.now() - HOUR,
      version: 3,
      lastAuthCheck: Date.now() - 30 * 24 * HOUR,
      needsReauth: false,
      authRefreshAttempts: 0,
      authRefreshLastAttemptAt: 0,
      ...overrides,
    },
  });
  await flush();
  assert.deepStrictEqual(worker.fetchLog, [], "booting must not refresh on its own");
  return worker;
}

const REJECTED = { status: 400, body: { error: { message: "INVALID_REFRESH_TOKEN" } } };
const UNAVAILABLE = { status: 503, body: { error: { message: "UNAVAILABLE" } } };
const REFRESHED = {
  status: 200,
  body: { id_token: "id-new", refresh_token: "refresh-new", expires_in: "3600" },
};

const cases = [];
const test = (label, fn) => cases.push({ label, fn });

test("transient failures never flag the session, even a month after the last good request", async () => {
  const worker = await bootWithSession();
  for (let i = 0; i < 8; i++) {
    worker.queueFetch(i % 2 ? UNAVAILABLE : { networkError: true });
    const idToken = await worker.call("getFirebaseToken");
    assert.strictEqual(idToken, null);
  }
  assert.strictEqual(tokens(worker).needsReauth, false);
  assert.strictEqual(tokens(worker).authRefreshAttempts, 8);
  assert.strictEqual(worker.alarms.get("auth-refresh-retry-bg").delayInMinutes, 60, "backoff caps at 60 min");
});

test("a later successful refresh resumes the session and clears the backoff", async () => {
  const worker = await bootWithSession({ authRefreshAttempts: 6 });
  worker.alarms.set("auth-refresh-retry-bg", { delayInMinutes: 60 });
  worker.queueFetch(REFRESHED);
  assert.strictEqual(await worker.call("getFirebaseToken"), "id-new");
  assert.strictEqual(tokens(worker).needsReauth, false);
  assert.strictEqual(tokens(worker).authRefreshAttempts, 0);
  assert.strictEqual(worker.alarms.has("auth-refresh-retry-bg"), false);
});

test("a rejected refresh token flags the session once, with the reason, and is not retried", async () => {
  const worker = await bootWithSession();
  worker.queueFetch(REJECTED);
  assert.strictEqual(await worker.call("getFirebaseToken"), null);
  assert.strictEqual(tokens(worker).needsReauth, true);
  assert.strictEqual(tokens(worker).reauthReason, "INVALID_REFRESH_TOKEN");
  assert.strictEqual(tokens(worker).refreshToken, "refresh-old", "tokens are kept for the reconnect prompt");

  const fetchesBefore = worker.fetchLog.length;
  assert.strictEqual(await worker.call("getFirebaseToken"), null);
  await worker.call("_bgAuthRefreshRetryTick");
  assert.strictEqual(worker.fetchLog.length, fetchesBefore, "a rejected token is not sent again");
});

test("the retry alarm flags a rejected token through the same path", async () => {
  const worker = await bootWithSession();
  worker.queueFetch(REJECTED);
  await worker.call("_bgAuthRefreshRetryTick");
  assert.strictEqual(tokens(worker).needsReauth, true);
  assert.strictEqual(tokens(worker).reauthReason, "INVALID_REFRESH_TOKEN");
});

test("a pre-v3 needsReauth flag is dropped and the token is tried again", async () => {
  const worker = await bootWithSession({ version: 2, needsReauth: true, authRefreshAttempts: 5 });
  worker.queueFetch(REFRESHED);
  assert.strictEqual(await worker.call("getFirebaseToken"), "id-new");
  assert.strictEqual(tokens(worker).version, 3);
  assert.strictEqual(tokens(worker).needsReauth, false);
});

test("a pre-v3 flag on a token Firebase really rejects comes back with a reason", async () => {
  const worker = await bootWithSession({ version: 2, needsReauth: true });
  worker.queueFetch(REJECTED);
  assert.strictEqual(await worker.call("getFirebaseToken"), null);
  assert.strictEqual(tokens(worker).needsReauth, true);
  assert.strictEqual(tokens(worker).reauthReason, "INVALID_REFRESH_TOKEN");
});

test("a v3 flag survives the migration untouched", async () => {
  const worker = await bootWithSession({ needsReauth: true, reauthReason: "USER_DISABLED" });
  await worker.call("ensureAuthTokensMigrated");
  const result = await worker.call("bgMutateFirebaseAuth", { operation: "migrate_tokens" });
  assert.strictEqual(result.applied, false);
  assert.strictEqual(tokens(worker).needsReauth, true);
  assert.strictEqual(tokens(worker).reauthReason, "USER_DISABLED");
});

test("a successful Firestore request does not clear a rejection", async () => {
  const worker = await bootWithSession({ expiresAt: Date.now() + HOUR, needsReauth: true, reauthReason: "TOKEN_EXPIRED" });
  await worker.call("markFirebaseAuthRequestOk", "id-old");
  assert.strictEqual(tokens(worker).needsReauth, true);
});

test("signing in again replaces a flagged session with a clean one", async () => {
  const worker = await bootWithSession({ needsReauth: true, reauthReason: "INVALID_REFRESH_TOKEN", authRefreshAttempts: 3 });
  await worker.call("bgMutateFirebaseAuth", {
    operation: "replace_session",
    user: { uid: "uid-1", email: "user@example.com" },
    tokens: { idToken: "id-2", refreshToken: "refresh-2", expiresAt: Date.now() + HOUR },
  });
  assert.strictEqual(tokens(worker).needsReauth, false);
  assert.strictEqual(tokens(worker).reauthReason, null);
  assert.strictEqual(tokens(worker).authRefreshAttempts, 0);
  assert.strictEqual(tokens(worker).version, 3);
});

(async () => {
  let failures = 0;
  for (const { label, fn } of cases) {
    try {
      await fn();
      console.log(`  PASS  ${label}`);
    } catch (error) {
      failures += 1;
      console.log(`  FAIL  ${label}\n        ${error.message}`);
    }
  }
  console.log(failures ? `\n${failures} FAILED` : "\nPASS");
  process.exit(failures ? 1 : 0);
})();
