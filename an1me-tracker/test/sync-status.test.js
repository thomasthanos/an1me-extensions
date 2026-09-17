// Pins what the popup footer says about cloud sync (src/popup/services/sync-status-controller.js).
//
//   node test/sync-status.test.js
//
// The footer used to stay on "Checking cloud…" while a background metadata sweep was running, which
// on a phone hid a stopped sync for weeks. Activity (a sweep, a manual action) may be shown on top of
// the cloud state, but the cloud state underneath must always be resolved.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");
const HOUR = 60 * 60 * 1000;

function createController(stored, user = { uid: "uid-1" }) {
  const classes = new Set();
  const statusElement = {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    dataset: {},
    title: "",
    removeAttribute(name) {
      if (name === "title") this.title = "";
    },
  };
  const textElement = { textContent: "" };
  const sandbox = {
    chrome: { storage: { local: { get: async () => JSON.parse(JSON.stringify(stored)) } } },
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const rel = "src/popup/services/sync-status-controller.js";
  new vm.Script(fs.readFileSync(path.join(REPO, rel), "utf8"), { filename: rel }).runInContext(ctx);
  const controller = sandbox.AnimeTracker.SyncStatusController;
  controller.init({ statusElement, textElement, getUser: () => user });
  return {
    controller,
    label: () => textElement.textContent,
    tone: () => statusElement.dataset.syncTone,
    title: () => statusElement.title,
  };
}

const session = (overrides = {}) => ({
  firebase_tokens: { idToken: "id", refreshToken: "refresh", expiresAt: Date.now() + HOUR, ...overrides },
});

const cases = [];
const test = (label, fn) => cases.push({ label, fn });

test("starts on Checking cloud until the state is read", async () => {
  const footer = createController(session());
  assert.strictEqual(footer.label(), "Checking cloud…");
  await footer.controller.refreshCloudStatus({ immediate: true });
  assert.strictEqual(footer.label(), "Cloud Connected");
});

test("a running sweep shows on top and the cloud state returns when it ends", async () => {
  const footer = createController({
    ...session(),
    "syncState.cloudStatus": { uid: "uid-1", state: "error", error: "HTTP 503" },
  });
  footer.controller.setActivity("metadata", { label: "Fetching 3 anime...", tone: "busy" });
  await footer.controller.refreshCloudStatus({ immediate: true });
  assert.strictEqual(footer.label(), "Fetching 3 anime...");
  footer.controller.clearActivity("metadata");
  assert.strictEqual(footer.label(), "Sync Error");
  assert.strictEqual(footer.tone(), "error");
});

test("a rejected sign-in is an error with a way out", async () => {
  const footer = createController(session({ needsReauth: true, reauthReason: "INVALID_REFRESH_TOKEN" }));
  await footer.controller.refreshCloudStatus({ immediate: true });
  assert.strictEqual(footer.label(), "Reconnect Required");
  assert.strictEqual(footer.tone(), "error");
  assert.match(footer.title(), /Reconnect/);
});

test("failed refreshes read as unreachable, not as connecting", async () => {
  const footer = createController(session({ expiresAt: Date.now() - HOUR, authRefreshAttempts: 2 }));
  await footer.controller.refreshCloudStatus({ immediate: true });
  assert.strictEqual(footer.label(), "Cloud Unreachable");
  assert.strictEqual(footer.tone(), "busy");
});

test("an expired token with no failed refresh yet is still connecting", async () => {
  const footer = createController(session({ expiresAt: Date.now() - HOUR }));
  await footer.controller.refreshCloudStatus({ immediate: true });
  assert.strictEqual(footer.label(), "Cloud Connecting…");
});

test("signed out reads as local only", async () => {
  const footer = createController({}, null);
  await footer.controller.refreshCloudStatus({ immediate: true });
  assert.strictEqual(footer.label(), "Local Only");
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
