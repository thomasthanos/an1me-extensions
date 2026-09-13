// Pins the tables derived from the cour layout in src/common/data/multipart-mappings.js.
//
//   node test/multipart.test.js
//
// The expectations below are the hand-written literals that used to live in two separate files
// (popup/lib/config.js and multipart-mappings.js). They are kept here verbatim because
// EPISODE_OFFSET_MAPPING drives a migration that renames stored slugs and renumbers watched
// episodes (see storage.js): if a derived offset ever differs from these numbers, the user's
// history is rewritten wrongly.
const assert = require("assert");
const path = require("path");

global.self = global;
require(path.join(__dirname, "..", "src/common/data/multipart-mappings.js"));
const tables = global.self.AnimeTrackerMultipartMappings;

const EXPECTED_PARTS = {
  "fate-zero": [
    { name: "Fate/Zero S1", start: 1, end: 13, displayStart: 1, displayEnd: 13 },
    { name: "Fate/Zero S2", start: 14, end: 25, displayStart: 1, displayEnd: 12 },
  ],
  "bleach-sennen-kessen-hen": [
    { name: "Part 1", start: 1, end: 13 },
    { name: "Part 2: Ketsubetsu-tan", start: 14, end: 26 },
    { name: "Part 3: Soukoku-tan", start: 27, end: 40 },
  ],
};

const EXPECTED_SLUG_NORMALIZATION = {
  "bleach-sennen-kessen-hen-ketsubetsu-tan": "bleach-sennen-kessen-hen",
  "bleach-sennen-kessen-hen-soukoku-tan": "bleach-sennen-kessen-hen",
  "fate-zero-season-2": "fate-zero",
  "fate-zero-2nd-season": "fate-zero",
};

const EXPECTED_EPISODE_OFFSETS = {
  "bleach-sennen-kessen-hen-ketsubetsu-tan": 13,
  "bleach-sennen-kessen-hen-soukoku-tan": 26,
  "fate-zero-season-2": 13,
  "fate-zero-2nd-season": 13,
};

const sorted = (o) => JSON.parse(JSON.stringify(o, Object.keys(o).sort()));

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

check("SLUG_NORMALIZATION", sorted(tables.SLUG_NORMALIZATION), sorted(EXPECTED_SLUG_NORMALIZATION));
check("EPISODE_OFFSET_MAPPING", sorted(tables.EPISODE_OFFSET_MAPPING), sorted(EXPECTED_EPISODE_OFFSETS));
for (const base of Object.keys(EXPECTED_PARTS)) {
  check(`ANIME_PARTS_CONFIG[${base}]`, JSON.parse(JSON.stringify(tables.ANIME_PARTS_CONFIG[base])), EXPECTED_PARTS[base]);
}

// Internal consistency: a part's offset must equal the absolute episode before its range starts,
// which is the invariant the two separate tables could previously violate.
for (const [base, franchise] of Object.entries(tables.FRANCHISE_PARTS)) {
  const ranges = tables.ANIME_PARTS_CONFIG[base];
  franchise.parts.forEach((part, i) => {
    for (const slug of part.slugs || []) {
      check(`offset of ${slug} == start-1 of its range`, tables.EPISODE_OFFSET_MAPPING[slug], ranges[i].start - 1);
      check(`${slug} normalizes to ${base}`, tables.SLUG_NORMALIZATION[slug], base);
    }
    check(`${base} part ${i + 1} length`, ranges[i].end - ranges[i].start + 1, part.episodes);
  });
}

// Page <-> stored conversion. Slugs and per-part numbering were verified against the live site:
// /watch/fate-zero-2nd-season-episode-1/ serves (fate-zero-season-2 is a 404), and part-2 pages list
// their episodes from 1.
const { toStoredEpisode, toSitePage, pageSlugFromPath } = tables;

check("fate-zero S2 site slug is listed first", tables.FRANCHISE_PARTS["fate-zero"].parts[1].slugs[0], "fate-zero-2nd-season");

check("toStoredEpisode fate-zero-2nd-season 6", toStoredEpisode("fate-zero-2nd-season", 6), { slug: "fate-zero", episode: 19 });
check("toStoredEpisode fate-zero-season-2 alias 6", toStoredEpisode("fate-zero-season-2", 6), { slug: "fate-zero", episode: 19 });
check("toStoredEpisode ketsubetsu-tan 3", toStoredEpisode("bleach-sennen-kessen-hen-ketsubetsu-tan", 3), { slug: "bleach-sennen-kessen-hen", episode: 16 });
check("toStoredEpisode base part 5", toStoredEpisode("fate-zero", 5), { slug: "fate-zero", episode: 5 });
check("toStoredEpisode unmapped passthrough", toStoredEpisode("spy-x-family", 4), { slug: "spy-x-family", episode: 4 });

check("toSitePage fate-zero 19", toSitePage("fate-zero", 19), { slug: "fate-zero-2nd-season", episode: 6 });
check("toSitePage fate-zero 13 stays S1", toSitePage("fate-zero", 13), { slug: "fate-zero", episode: 13 });
check("toSitePage bleach 1", toSitePage("bleach-sennen-kessen-hen", 1), { slug: "bleach-sennen-kessen-hen", episode: 1 });
check("toSitePage bleach 27", toSitePage("bleach-sennen-kessen-hen", 27), { slug: "bleach-sennen-kessen-hen-soukoku-tan", episode: 1 });
check("toSitePage bleach 41 past last part", toSitePage("bleach-sennen-kessen-hen", 41), { slug: "bleach-sennen-kessen-hen-soukoku-tan", episode: 15 });
check("toSitePage unmapped passthrough", toSitePage("spy-x-family", 4), { slug: "spy-x-family", episode: 4 });

// Every declared episode must survive stored -> page -> stored unchanged.
for (const base of Object.keys(tables.FRANCHISE_PARTS)) {
  const ranges = tables.ANIME_PARTS_CONFIG[base];
  const last = ranges[ranges.length - 1].end;
  let roundTripFailures = 0;
  for (let n = 1; n <= last; n++) {
    const page = toSitePage(base, n);
    const back = toStoredEpisode(page.slug, page.episode);
    if (back.slug !== base || back.episode !== n) roundTripFailures++;
  }
  check(`${base} round trip for episodes 1..${last}`, roundTripFailures, 0);
}

check("pageSlugFromPath flat", pageSlugFromPath("/watch/fate-zero-2nd-season-episode-6/"), "fate-zero-2nd-season");
check("pageSlugFromPath double episode", pageSlugFromPath("/watch/some-show-episode-5-6"), "some-show");
check("pageSlugFromPath nested", pageSlugFromPath("/watch/fate-zero/episode-5/"), "fate-zero");
check("pageSlugFromPath non-watch", pageSlugFromPath("/anime/fate-zero/"), null);

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
