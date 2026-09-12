// multipart-mappings.js — anime the site splits across several slugs, declared once.
//
// One fact per franchise: the ordered list of cours and how many episodes each has. Everything
// downstream is DERIVED from it, so the three views can no longer drift apart:
//
//   ANIME_PARTS_CONFIG      absolute episode ranges, for the popup's "Parts" expander
//   SLUG_NORMALIZATION      part slug -> the slug everything is stored under
//   EPISODE_OFFSET_MAPPING  part slug -> episodes that precede it, for renumbering
//
// These used to be three hand-written tables in two files describing the same two franchises from
// different directions: ANIME_PARTS_CONFIG said Bleach TYBW part 3 covers absolute 27-40 while
// EPISODE_OFFSET_MAPPING separately said its offset is 26. Both were correct, and nothing but
// care kept them that way - while EPISODE_OFFSET_MAPPING drives a migration that renames stored
// slugs and renumbers watched episodes, so a disagreement corrupts the user's history.
(function () {
  "use strict";

  const FRANCHISE_PARTS = Object.freeze({
    "fate-zero": {
      // Each part restarts at episode 1 on screen even though storage numbers them continuously.
      renumberDisplay: true,
      parts: [
        { name: "Fate/Zero S1", episodes: 13 },
        { name: "Fate/Zero S2", episodes: 12, slugs: ["fate-zero-season-2", "fate-zero-2nd-season"] },
      ],
    },
    "bleach-sennen-kessen-hen": {
      // TYBW is shown with its absolute numbering, so no display renumbering.
      renumberDisplay: false,
      parts: [
        { name: "Part 1", episodes: 13 },
        { name: "Part 2: Ketsubetsu-tan", episodes: 13, slugs: ["bleach-sennen-kessen-hen-ketsubetsu-tan"] },
        { name: "Part 3: Soukoku-tan", episodes: 14, slugs: ["bleach-sennen-kessen-hen-soukoku-tan"] },
      ],
    },
  });

  const ANIME_PARTS_CONFIG = {};
  const SLUG_NORMALIZATION = {};
  const EPISODE_OFFSET_MAPPING = {};

  for (const [baseSlug, franchise] of Object.entries(FRANCHISE_PARTS)) {
    let before = 0;
    const ranges = [];
    for (const part of franchise.parts) {
      const episodes = Number(part.episodes) || 0;
      const range = { name: part.name, start: before + 1, end: before + episodes };
      if (franchise.renumberDisplay) {
        range.displayStart = 1;
        range.displayEnd = episodes;
      }
      ranges.push(range);

      // The first part lives under the base slug itself, so it needs neither a rename nor an
      // offset; only the later ones do.
      for (const slug of part.slugs || []) {
        SLUG_NORMALIZATION[slug] = baseSlug;
        EPISODE_OFFSET_MAPPING[slug] = before;
      }
      before += episodes;
    }
    ANIME_PARTS_CONFIG[baseSlug] = Object.freeze(ranges.map((r) => Object.freeze(r)));
  }

  const exports = {
    FRANCHISE_PARTS,
    SLUG_NORMALIZATION: Object.freeze(SLUG_NORMALIZATION),
    EPISODE_OFFSET_MAPPING: Object.freeze(EPISODE_OFFSET_MAPPING),
    ANIME_PARTS_CONFIG: Object.freeze(ANIME_PARTS_CONFIG),
  };

  if (typeof self !== "undefined") self.AnimeTrackerMultipartMappings = exports;
  if (typeof window !== "undefined") window.AnimeTrackerMultipartMappings = exports;
})();
