// Characterization test for anime grouping: seasons, movies, base slugs and whole-library groups.
//
//   node test/grouping.test.js              compare against the recorded snapshot
//   node test/grouping.test.js --update     re-record it (only with a reviewed diff)
//
// Why a snapshot rather than hand-written expectations: `baseSlug` is a PERSISTED, cloud-synced
// grouping key. If a franchise rule shifts it, the user's stored progress and cover art are
// silently filed under a key nothing reads any more. Group keys and group membership are therefore
// asserted as hard failures; everything else (season numbers, labels, ordering) is reported as a
// diff for review, because those are display concerns that sometimes SHOULD change.
const fs = require("fs");
const path = require("path");
const { load, snapshot } = require("./lib/grouping-harness.js");

const FIXTURE = path.join(__dirname, "fixtures/grouping-snapshot.json");
const update = process.argv.includes("--update");

const { SeasonGrouping } = load();
const current = snapshot(SeasonGrouping);

if (update) {
  fs.writeFileSync(FIXTURE, JSON.stringify(current, null, 2));
  console.log(`snapshot re-recorded: ${FIXTURE}`);
  process.exit(0);
}

const expected = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

// --- hard failures: the persisted grouping key must not move ---
const expectedKeys = Object.keys(expected.__groups__).sort();
const currentKeys = Object.keys(current.__groups__).sort();
const keyDiff = [...new Set([...expectedKeys, ...currentKeys])].filter(
  (k) => !(expectedKeys.includes(k) && currentKeys.includes(k)),
);

const membershipDiff = [];
for (const key of expectedKeys) {
  if (!current.__groups__[key]) continue;
  const before = expected.__groups__[key].map((m) => m.slug).sort().join(",");
  const after = current.__groups__[key].map((m) => m.slug).sort().join(",");
  if (before !== after) membershipDiff.push(key);
}

// --- soft diffs: display and ordering ---
const FIELDS = [
  "isMovie",
  "isMovieDisplay",
  "seriesBase",
  "movieBase",
  "seasonNumber",
  "seasonLabel",
  "movieNumber",
  "movieLabel",
  "movieReleaseTs",
  "entryOrder",
  "groupDisplayTitle",
  "chronologySeries",
  "chronologyMovie",
  "onePieceMovie",
];
const fieldDiffs = [];
for (const slug of Object.keys(expected)) {
  if (slug === "__groups__") continue;
  if (!current[slug]) {
    fieldDiffs.push({ slug, field: "(missing from corpus)", expected: "present", actual: "absent" });
    continue;
  }
  for (const field of FIELDS) {
    const a = JSON.stringify(expected[slug][field]);
    const b = JSON.stringify(current[slug][field]);
    if (a !== b) fieldDiffs.push({ slug, field, expected: expected[slug][field], actual: current[slug][field] });
  }
}

// INFORMATIONAL, never a failure. Two entries sharing a season number cannot be ordered against
// each other, which is sometimes a real bug (it is how the standalone "-part-2" case was found)
// and sometimes just this corpus, which deliberately includes several alias spellings of the same
// season ("-season-2" and "-2nd-season") that would never coexist in a real library.
const collisions = [];
for (const [key, members] of Object.entries(current.__groups__)) {
  if (members.length < 2) continue;
  const seen = new Map();
  for (const m of members) {
    const n = m.seasonNum;
    if (seen.has(n)) collisions.push({ group: key, seasonNum: n, slugs: [seen.get(n), m.slug].join(" + ") });
    else seen.set(n, m.slug);
  }
}

console.log(`corpus: ${Object.keys(current).length - 1} slugs, ${Object.keys(current.__groups__).length} groups`);
console.log(`group keys changed:       ${keyDiff.length}`);
if (keyDiff.length) console.table(keyDiff);
console.log(`group membership changed: ${membershipDiff.length}`);
if (membershipDiff.length) console.table(membershipDiff);
console.log(`display/ordering diffs:   ${fieldDiffs.length}`);
if (fieldDiffs.length) console.table(fieldDiffs);
console.log(`season-number collisions: ${collisions.length} (informational - see comment)`);
if (collisions.length) console.table(collisions);

const hardFail = keyDiff.length > 0 || membershipDiff.length > 0;
if (hardFail) {
  console.log("\nFAIL: a persisted grouping key moved. This orphans stored user data — do not ship.");
} else if (fieldDiffs.length) {
  console.log("\nFAIL: display/ordering changed. Review each diff, then re-record with --update.");
} else {
  console.log("\nPASS");
}
process.exit(hardFail || fieldDiffs.length ? 1 : 0);
