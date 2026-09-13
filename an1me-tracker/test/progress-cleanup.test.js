// Pins the progress cleanup rules in src/common/data/merge-utils.js (cleanTrackedProgress).
//
//   node test/progress-cleanup.test.js
//
// The background sync and the popup each used to carry their own copy of these rules. The copies
// disagreed (movies, dropped shows, the entry cap), so each context removed entries the other had just
// kept and the difference was pushed to the cloud on every sync. Both now call this one function.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.self = global;
require(path.join(__dirname, "..", "src/common/data/merge-utils.js"));
const { cleanTrackedProgress } = global.self.AnimeTrackerMergeUtils;

const NOW = Date.parse("2026-09-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const OPTS = {
  completedPercentage: 85,
  tombstoneKeepMs: 7 * DAY,
  now: NOW,
  isMovie: (slug) => slug.includes("movie"),
};

let failures = 0;
function check(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`  PASS  ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        actual   ${JSON.stringify(actual)}`);
  }
}

const keys = (o) => Object.keys(o).sort();

function libraryCase(label) {
  const library = {
    "spy-x-family": {
      episodes: [
        { number: 1, durationSource: "video" },
        { number: 2, durationSource: "anilist" },
      ],
    },
    "some-movie": { episodes: [{ number: 1, durationSource: "video" }] },
    "paused-show": { listState: "on_hold", onHoldAt: iso(NOW - DAY), episodes: [{ number: 1 }] },
    "dropped-show": { listState: "dropped", droppedAt: iso(NOW - DAY), episodes: [{ number: 1 }] },
  };
  const progress = {
    __slugIndex: { anything: true },
    // Watched and tracked: the library entry is the record, the progress entry is redundant.
    "spy-x-family__episode-1": { currentTime: 600, percentage: 50, savedAt: iso(NOW - DAY) },
    // An AniList import is a placeholder, not a watch, so its progress stays - minus the duplicate cover.
    "spy-x-family__episode-2": { currentTime: 300, percentage: 20, savedAt: iso(NOW - DAY), coverImage: "c.jpg" },
    // Past the completion threshold.
    "spy-x-family__episode-3": { currentTime: 1300, percentage: 95, savedAt: iso(NOW - DAY) },
    // A tracked movie keeps its position so it can be resumed.
    "some-movie__episode-1": { currentTime: 2000, percentage: 40, savedAt: iso(NOW - DAY) },
    // On-hold and dropped shows keep their progress.
    "paused-show__episode-1": { currentTime: 100, percentage: 30, savedAt: iso(NOW - DAY) },
    "dropped-show__episode-1": { currentTime: 100, percentage: 30, savedAt: iso(NOW - DAY) },
    // Not in the library: kept, cover included (nothing else carries it).
    "not-in-library__episode-4": { currentTime: 100, percentage: 30, savedAt: iso(NOW - DAY), coverImage: "keep.jpg" },
    // Tombstones live for the keep window so the deletion reaches the other devices, then go.
    "fresh-tombstone__episode-1": { deleted: true, deletedAt: iso(NOW - 2 * DAY) },
    "old-tombstone__episode-1": { deleted: true, deletedAt: iso(NOW - 8 * DAY) },
  };

  const { cleaned, removedCount } = cleanTrackedProgress(library, progress, {}, OPTS);
  check(`${label}: kept entries`, keys(cleaned), [
    "dropped-show__episode-1",
    "fresh-tombstone__episode-1",
    "not-in-library__episode-4",
    "paused-show__episode-1",
    "some-movie__episode-1",
    "spy-x-family__episode-2",
  ]);
  check(`${label}: removed count`, removedCount, 3);
  check(`${label}: cover stripped when the library has the entry`, "coverImage" in cleaned["spy-x-family__episode-2"], false);
  check(`${label}: cover kept when there is no library entry`, cleaned["not-in-library__episode-4"].coverImage, "keep.jpg");
  check(`${label}: input not mutated`, progress["spy-x-family__episode-2"].coverImage, "c.jpg");
}

libraryCase("fallback list state");

// The background loads the real EntryState, so run the same case through it as well.
const entryStatePath = path.join(__dirname, "..", "src/common/data/entry-state.js");
if (fs.existsSync(entryStatePath)) {
  require(entryStatePath);
  if (global.AnimeTrackerEntryState?.getResolvedListState) libraryCase("EntryState list state");
  else console.log("  SKIP  EntryState list state (module did not register getResolvedListState)");
} else {
  console.log(`  SKIP  EntryState list state (${path.relative(process.cwd(), entryStatePath)} not found)`);
}

// Deleted anime: progress from before the deletion goes, a watch after it (past the grace) stays.
{
  const deletedAnime = { "gone-show": { deletedAt: iso(NOW - DAY) } };
  const progress = {
    "gone-show__episode-1": { currentTime: 100, percentage: 30, savedAt: iso(NOW - 2 * DAY) },
    "gone-show__episode-2": { currentTime: 100, percentage: 30, savedAt: iso(NOW - DAY + 60000) },
  };
  const { cleaned } = cleanTrackedProgress({}, progress, deletedAnime, OPTS);
  check("deleted anime: only the later watch survives", keys(cleaned), ["gone-show__episode-2"]);
}

// Legacy anime tombstone: a bare date string instead of { deletedAt }.
{
  const progress = { "legacy-show__episode-1": { currentTime: 100, percentage: 30, savedAt: iso(NOW - 2 * DAY) } };
  const { cleaned } = cleanTrackedProgress({}, progress, { "legacy-show": iso(NOW - DAY) }, OPTS);
  check("legacy anime tombstone string is honoured", keys(cleaned), []);
}

// The cap keeps the most recent activity, and a fresh tombstone counts as activity so it is not the
// first thing evicted before it has propagated.
{
  const progress = { "tomb__episode-1": { deleted: true, deletedAt: iso(NOW) } };
  for (let i = 1; i <= 5; i++) {
    progress[`show-${i}__episode-1`] = { currentTime: 100, percentage: 10, savedAt: iso(NOW - i * 60000) };
  }
  const { cleaned, removedCount } = cleanTrackedProgress({}, progress, {}, { ...OPTS, maxEntries: 3 });
  check("cap keeps newest activity", keys(cleaned), ["show-1__episode-1", "show-2__episode-1", "tomb__episode-1"]);
  check("cap evictions are counted", removedCount, 3);

  const uncapped = cleanTrackedProgress({}, progress, {}, { ...OPTS, maxEntries: 0 });
  check("maxEntries 0 means no cap", Object.keys(uncapped.cleaned).length, 6);
}

check("null progress passes through", cleanTrackedProgress({}, null, {}, OPTS), { cleaned: null, removedCount: 0 });

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
