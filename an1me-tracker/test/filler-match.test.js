// Regression test for filler auto-matching, run against a real AnimeFillerList index snapshot.
//
//   node test/filler-match.test.js
//
// Exists because a wrong match here is silent and expensive: the user sees canon episodes marked
// as filler, or a right show whose episode numbers are off by a season. Every expectation below
// was verified by hand against the live listing. Refresh the fixture with:
//   curl -A "Mozilla/5.0" https://www.animefillerlist.com/shows -o test/fixtures/animefillerlist-shows.html
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
global.globalThis = global;
global.self = global;
require(path.join(REPO, "src/common/data/title-match.js"));
const { bestMatch } = globalThis.AnimeTrackerTitleMatch;

// Lift the pure index helpers out of the worker module, which expects a service-worker global.
const src = fs.readFileSync(path.join(REPO, "src/background/fetchers/filler-discovery.js"), "utf8");
const body = src.slice(src.indexOf("// AnimeFillerList titles routinely"), src.indexOf("// Resolves to { shows, version }"));
const mod = new Function(
  "return (function(){" + body + "; return {expandAflTitles,parseAflShowIndex,buildAflCandidates,AFL_SUPPLEMENT_RE};})()",
)();

const html = fs.readFileSync(path.join(__dirname, "fixtures/animefillerlist-shows.html"), "utf8");
const shows = mod.parseAflShowIndex(html);
const THRESHOLD = 0.82;

// [an1me slug, titles we would actually have, expected AFL slug or null]
// Expectations were verified by hand against the live index listing.
const CASES = [
  ["shingeki-no-kyojin", ["Shingeki no Kyojin", "Attack on Titan"], "attack-titan"],
  ["kimetsu-no-yaiba", ["Kimetsu no Yaiba", "Demon Slayer: Kimetsu no Yaiba"], "demon-slayer-kimetsu-no-yaiba"],
  ["boku-no-hero-academia", ["Boku no Hero Academia", "My Hero Academia"], "my-hero-academia"],
  ["naruto", ["Naruto"], "naruto"],
  ["naruto-shippuuden", ["Naruto Shippuuden"], "naruto-shippuden"],
  ["nanatsu-no-taizai", ["Nanatsu no Taizai", "The Seven Deadly Sins"], "nanatsu-no-taizai"],
  ["ansatsu-kyoushitsu", ["Ansatsu Kyoushitsu", "Assassination Classroom"], "ansatsu-kyoushitsu-assassination-classroom"],
  ["yakusoku-no-neverland", ["Yakusoku no Neverland", "The Promised Neverland"], "promised-neverland"],
  ["tensei-shitara-slime-datta-ken", ["Tensei Shitara Slime Datta Ken", "That Time I Got Reincarnated as a Slime"], "time-i-got-reincarnated-slime"],
  ["hagane-no-renkinjutsushi", ["Hagane no Renkinjutsushi", "Fullmetal Alchemist: Brotherhood"], "fullmetal-alchemist-brotherhood"],
  // The fan re-edit "One Pace (One Piece)" must not win over the real series.
  ["one-piece", ["One Piece"], "one-piece"],
  ["bleach", ["Bleach"], "bleach"],
  ["jujutsu-kaisen", ["Jujutsu Kaisen"], "jujutsu-kaisen"],
  ["spy-x-family", ["Spy x Family"], "spy-x-family"],
  ["chainsaw-man", ["Chainsaw Man"], "chainsaw-man"],
  ["dragon-ball-z", ["Dragon Ball Z"], "dragon-ball-z"],
  ["black-clover", ["Black Clover"], "black-clover"],
  ["fairy-tail", ["Fairy Tail"], "fairy-tail"],
  ["boruto", ["Boruto: Naruto Next Generations"], "boruto-naruto-next-generations"],
  ["one-punch-man", ["One Punch Man", "One-Punch Man"], "one-punch-man"],
  // Genuinely absent from the index: must stay unmatched rather than grab a near neighbour.
  ["sousou-no-frieren", ["Sousou no Frieren", "Frieren: Beyond Journey's End"], null],
  ["totally-made-up", ["Totally Made Up Show Title"], null],
];

function run(label, candidates, keysFor) {
  let pass = 0;
  const failures = [];
  for (const [slug, keys, expected] of CASES) {
    const m = bestMatch(keysFor(slug, keys), candidates, THRESHOLD);
    const got = m ? m.id : null;
    if (got === expected) pass++;
    else failures.push({ slug, got, expected, score: m ? Number(m.score.toFixed(3)) : null, kind: m?.kind });
  }
  console.log(`${label}: ${pass}/${CASES.length} pass`);
  if (failures.length) console.table(failures);
  return failures.length === 0;
}

console.log(`index: ${shows.length} shows`);
const candidates = mod.buildAflCandidates(shows);
console.log(`candidates: ${candidates.length}`);
const ok = run("real index", candidates, (_slug, keys) => keys);

// Guard: no supplement listing should ever beat a main series for a plain series query.
const supplementLeaks = [];
for (const [slug, keys, expected] of CASES) {
  if (!expected) continue;
  const m = bestMatch(keys, candidates, THRESHOLD);
  if (m && mod.AFL_SUPPLEMENT_RE.test(shows.find((s) => s.id === m.id)?.title || "")) {
    supplementLeaks.push({ slug, matched: m.id });
  }
}
console.log(`supplement leaks: ${supplementLeaks.length}`);
if (supplementLeaks.length) console.table(supplementLeaks);

// Every manual override must point at a slug that actually exists, or the lookup 404s silently.
// The table shipped with exactly that bug before ("hunter-x-hunter-2011" is not a real slug).
const overrideBlock = src.slice(src.indexOf("const KNOWN_FILLER_SLUGS"), src.indexOf("};", src.indexOf("const KNOWN_FILLER_SLUGS")));
const overrideTargets = [...overrideBlock.matchAll(/:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
const ids = new Set(shows.map((s) => s.id));
const badOverrides = overrideTargets.filter((t) => !ids.has(t));
console.log(`overrides: ${overrideTargets.length}, pointing at a missing slug: ${badOverrides.length}`);
if (badOverrides.length) console.table(badOverrides);

process.exit(ok && supplementLeaks.length === 0 && badOverrides.length === 0 ? 0 : 1);
