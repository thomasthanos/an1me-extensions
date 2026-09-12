// franchise-seasons.js — ONE declaration of every franchise's season/arc layout.
//
// This replaces two hand-maintained if-chains in popup/lib/config.js (getSeasonNumber and
// getSeasonLabel) that tested the same franchise prefixes against the same conditions and
// differed only in what they returned. Keeping ~230 lines of conditions in sync by hand had
// already failed in three places:
//
//   * mashle had a branch in getSeasonNumber and none in getSeasonLabel, so the arc-named S2 slug
//     was numbered 2 but labelled the generic "Season 2".
//   * Bleach TYBW Part 2 and Part 3 both numbered 2 while carrying distinct labels, so they could
//     not be ordered against each other.
//   * naruto matched "-3" with includes() for the number but endsWith() for the label, so
//     naruto-shippuuden-movie-3-* was numbered season 3 while labelled "Naruto Shippuden".
//
// Every rule below is matched IN ORDER, first hit wins, exactly as the if-chains were. A rule can
// match on:
//   any      - substring of the slug (the old `slug.includes(...)`)
//   endsAny  - slug suffix (the old `slug.endsWith(...)`)
//   titleAny - substring of the lowercased title
//   parts    - nested rules checked only after the parent matched, for season-with-parts arcs
//
// `stage` preserves a load-bearing ordering detail: getSeasonNumber ran the GENERIC season/part
// regexes in the middle of its chain, so franchises listed after that point were only consulted if
// the generic rules found nothing. "mashle-season-2" depends on this - generic wins there and
// yields 2, while mashle's own rules would have said 1.
(function () {
  "use strict";

  const FRANCHISES = Object.freeze([
    {
      id: "one-piece",
      prefixes: ["one-piece"],
      stage: "before-generic",
      seasons: [{ any: ["new-world"], number: 2, label: "New World" }],
      default: { number: 1, label: "East Blue & Grandline" },
    },
    {
      id: "one-punch-man",
      prefixes: ["one-punch-man"],
      stage: "before-generic",
      seasons: [
        { any: ["season-3"], endsAny: ["-3"], number: 3, label: "Season 3" },
        { any: ["season-2", "2nd-season"], number: 2, label: "Season 2" },
      ],
      default: { number: 1, label: "Season 1" },
    },
    {
      id: "jujutsu-kaisen",
      prefixes: ["jujutsu-kaisen"],
      stage: "before-generic",
      seasons: [
        {
          any: ["culling-game", "season-3", "dead-culling-game", "shimetsu-kaiyuu"],
          number: 3,
          label: "Season 3",
          parts: [
            { any: ["koupen", "part-2", "part2"], number: 3.2, label: "Season 3 Part 2" },
            { any: ["zenpen", "part-1", "part1"], number: 3.1, label: "Season 3 Part 1" },
          ],
        },
        { any: ["season-2", "2nd-season", "shibuya-incident", "kaigyoku-gyokusetsu"], number: 2, label: "Season 2" },
        { any: ["0", "movie"], number: 0, label: "Movie 0" },
      ],
      default: { number: 1, label: "Season 1" },
    },
    {
      id: "naruto",
      prefixes: ["naruto", "boruto"],
      stage: "before-generic",
      seasons: [
        // endsWith rather than includes: the old getSeasonNumber used includes("-3"), which read
        // naruto-shippuuden-movie-3-* as season 3 while the label chain called it Shippuden.
        { any: ["boruto", "season-3"], endsAny: ["-3"], titleAny: ["boruto"], number: 3, label: "Naruto Boruto" },
        {
          any: ["shippuden", "shippuuden", "season-2"],
          endsAny: ["-2"],
          titleAny: ["shippuden", "shippuuden"],
          number: 2,
          label: "Naruto Shippuden",
        },
      ],
      default: { number: 1, label: "Naruto" },
    },
    {
      id: "kimetsu-no-yaiba",
      prefixes: ["kimetsu-no-yaiba"],
      stage: "before-generic",
      seasons: [
        { any: ["hashira-geiko-hen"], number: 5, label: "Hashira Training Arc" },
        { any: ["katanakaji-no-sato-hen"], number: 4, label: "Swordsmith Village Arc" },
        { any: ["yuukaku-hen"], number: 3, label: "Entertainment District Arc" },
        { any: ["mugen-ressha-hen"], number: 2, label: "Mugen Train Arc" },
      ],
      default: { number: 1, label: "Season 1" },
    },
    {
      id: "shingeki-no-kyojin",
      prefixes: ["shingeki-no-kyojin"],
      stage: "before-generic",
      seasons: [
        { any: ["final-season-kanketsu-hen"], number: 7, label: "Final Season Part 3" },
        { any: ["final-season-part-2"], number: 6, label: "Final Season Part 2" },
        { any: ["final-season"], number: 5, label: "Final Season Part 1" },
        { any: ["season-3-part-2"], number: 4, label: "Season 3 Part 2" },
        { any: ["season-3"], number: 3, label: "Season 3 Part 1" },
        { any: ["season-2"], number: 2, label: "Season 2" },
      ],
      default: { number: 1, label: "Season 1" },
    },
    {
      id: "initial-d",
      prefixes: ["initial-d"],
      stage: "before-generic",
      seasons: [
        { any: ["final-stage", "sixth-stage", "6th-stage"], number: 6, label: "Final Stage" },
        { any: ["fifth-stage", "5th-stage"], number: 5, label: "Fifth Stage" },
        { any: ["fourth-stage", "4th-stage"], number: 4, label: "Fourth Stage" },
        { any: ["third-stage", "3rd-stage"], number: 3, label: "Third Stage (Movie)" },
        { any: ["second-stage", "2nd-stage"], number: 2, label: "Second Stage" },
      ],
      default: { number: 1, label: "First Stage" },
    },
    {
      id: "blue-lock",
      prefixes: ["blue-lock"],
      stage: "before-generic",
      seasons: [
        { any: ["season-3", "3rd-season"], endsAny: ["-3"], number: 3, label: "Season 3" },
        {
          any: ["vs-u-20", "vs-u20", "u-20-japan", "season-2", "2nd-season"],
          endsAny: ["-2"],
          number: 2,
          label: "Season 2: vs. U-20 Japan",
        },
      ],
      default: { number: 1, label: "Season 1" },
    },

    // --- consulted only if the generic season/part rules found nothing ---
    {
      id: "bleach",
      prefixes: ["bleach"],
      stage: "after-generic",
      seasons: [
        // Distinct numbers so the three TYBW cours can be ordered; they previously all read 2.
        { any: ["soukoku-tan"], number: 2.3, label: "TYBW Part 3" },
        { any: ["ketsubetsu-tan"], number: 2.2, label: "TYBW Part 2" },
        { any: ["sennen-kessen-hen"], number: 2.1, label: "Thousand-Year Blood War" },
      ],
      default: { number: 1, label: "Season 1" },
    },
    {
      id: "mashle",
      prefixes: ["mashle"],
      stage: "after-generic",
      // S2 on an1me.to is the arc-named slug mashle-shinkakusha-kouho-senbatsu-shiken-hen.
      seasons: [{ any: ["shinkakusha"], number: 2, label: "Season 2" }],
      default: { number: 1, label: "Season 1" },
    },
    {
      id: "trinity-seven",
      prefixes: ["trinity-seven"],
      stage: "after-generic",
      seasons: [
        {
          exact: ["trinity-seven-nanatsu-no-taizai-to-nana-madoushi"],
          number: 2,
          label: "Movie: Nanatsu no Taizai to Nana Madoushi",
        },
      ],
      default: { number: 1, label: "Season 1" },
    },
    {
      id: "hunter-x-hunter",
      prefixes: ["hunter-x-hunter", "hunterhunter"],
      stage: "after-generic",
      seasons: [{ any: ["2011"], number: 2, label: "2011 Version" }],
      default: { number: 1, label: "1999 Version" },
    },
  ]);

  const lower = (value) => String(value || "").toLowerCase();

  function ruleMatches(rule, slug, title) {
    if (rule.exact && rule.exact.includes(slug)) return true;
    if (rule.any && rule.any.some((token) => slug.includes(token))) return true;
    if (rule.endsAny && rule.endsAny.some((token) => slug.endsWith(token))) return true;
    if (rule.titleAny && title && rule.titleAny.some((token) => title.includes(token))) return true;
    return false;
  }

  function findFranchise(slug, stage) {
    const value = lower(slug);
    if (!value) return null;
    for (const franchise of FRANCHISES) {
      if (stage && franchise.stage !== stage) continue;
      if (franchise.prefixes.some((prefix) => value.startsWith(prefix))) return franchise;
    }
    return null;
  }

  // { number, label, franchiseId } for the matching season, or null when no franchise owns the
  // slug at this stage. One lookup serves both the number and the label, which is the whole point.
  function resolveSeason(slug, title = "", stage = null) {
    const franchise = findFranchise(slug, stage);
    if (!franchise) return null;

    const value = lower(slug);
    const titleValue = lower(title);
    for (const rule of franchise.seasons || []) {
      if (!ruleMatches(rule, value, titleValue)) continue;
      for (const part of rule.parts || []) {
        if (ruleMatches(part, value, titleValue)) {
          return { number: part.number, label: part.label, franchiseId: franchise.id };
        }
      }
      return { number: rule.number, label: rule.label, franchiseId: franchise.id };
    }
    return { number: franchise.default.number, label: franchise.default.label, franchiseId: franchise.id };
  }

  const exports = { FRANCHISES, resolveSeason, findFranchise };
  const root = typeof globalThis !== "undefined" ? globalThis : self;
  root.AnimeTrackerFranchiseSeasons = exports;
  if (typeof window !== "undefined") {
    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.FranchiseSeasons = exports;
  }
})();
