// multipart-mappings.js — anime the site splits across several slugs, declared once.
//
// One fact per franchise: the ordered list of cours and how many episodes each has. Everything
// downstream is DERIVED from it, so the views can no longer drift apart:
//
//   ANIME_PARTS_CONFIG      absolute episode ranges, for the popup's "Parts" expander
//   SLUG_NORMALIZATION      part slug -> the slug everything is stored under
//   EPISODE_OFFSET_MAPPING  part slug -> episodes that precede it, for renumbering
//   toStoredEpisode / toSitePage  page slug + per-part number <-> stored slug + continuous number
//
// These used to be three hand-written tables in two files describing the same two franchises from
// different directions: ANIME_PARTS_CONFIG said Bleach TYBW part 3 covers absolute 27-40 while
// EPISODE_OFFSET_MAPPING separately said its offset is 26. Both were correct, and nothing but
// care kept them that way - while EPISODE_OFFSET_MAPPING drives a migration that renames stored slugs
// and renumbers watched episodes, so a disagreement corrupts the user's history.
(function () {
  "use strict";

  // In each part's `slugs`, the FIRST entry must be the slug an1me.to actually serves: toSitePage builds
  // watch URLs from it. Verified on the live site - /watch/fate-zero-2nd-season-episode-1/ serves while
  // /watch/fate-zero-season-2-episode-1/ is a 404, and part-2 pages number their episodes from 1.
  const FRANCHISE_PARTS = Object.freeze({
    "fate-zero": {
      // Each part restarts at episode 1 on screen even though storage numbers them continuously.
      renumberDisplay: true,
      parts: [
        { name: "Fate/Zero S1", episodes: 13 },
        { name: "Fate/Zero S2", episodes: 12, slugs: ["fate-zero-2nd-season", "fate-zero-season-2"] },
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

  // Page slug + the site's per-part episode number -> the stored slug + continuous number. Unmapped
  // slugs pass through unchanged, so callers can apply this to every page without a special case.
  function toStoredEpisode(pageSlug, pageEpisode) {
    const slug = String(pageSlug || "").toLowerCase();
    const episode = Number(pageEpisode);
    const base = SLUG_NORMALIZATION[slug];
    if (!base || !Number.isFinite(episode)) return { slug, episode };
    return { slug: base, episode: episode + (EPISODE_OFFSET_MAPPING[slug] || 0) };
  }

  // Stored slug + continuous episode number -> the page an1me.to serves. Linking the stored numbering
  // directly sent Fate/Zero S2 episode 6 to /watch/fate-zero-episode-19/, which does not exist; the real
  // page is /watch/fate-zero-2nd-season-episode-6/. Numbers past the last declared part (a cour the table
  // does not know yet) stay with the last part rather than being dropped.
  function toSitePage(storedSlug, storedEpisode) {
    const slug = String(storedSlug || "").toLowerCase();
    const episode = Number(storedEpisode);
    const franchise = FRANCHISE_PARTS[slug];
    if (!franchise || !Number.isFinite(episode) || episode <= 0) return { slug, episode };
    const ranges = ANIME_PARTS_CONFIG[slug];
    let index = ranges.findIndex((range) => episode >= range.start && episode <= range.end);
    if (index === -1) index = episode > ranges[ranges.length - 1].end ? ranges.length - 1 : 0;
    const part = franchise.parts[index];
    return {
      slug: (part.slugs && part.slugs[0]) || slug,
      episode: episode - (ranges[index].start - 1),
    };
  }

  // The raw page slug from a watch URL path, before any normalization: "/watch/<slug>-episode-N",
  // "/watch/<slug>-episode-N-M" (double episode) or "/watch/<slug>/<episode-part>". Null otherwise.
  function pageSlugFromPath(pathname) {
    const path = String(pathname || "").replace(/^\/+|\/+$/g, "");
    const nested = path.match(/^watch\/([^/]+)\/[^/]+$/i);
    if (nested) return nested[1].toLowerCase();
    const flat = path.match(/^watch\/(.+?)-episode-\d+(?:-\d+)?(?:$|[/?#])/i);
    return flat ? flat[1].toLowerCase() : null;
  }

  const exports = {
    FRANCHISE_PARTS,
    SLUG_NORMALIZATION: Object.freeze(SLUG_NORMALIZATION),
    EPISODE_OFFSET_MAPPING: Object.freeze(EPISODE_OFFSET_MAPPING),
    ANIME_PARTS_CONFIG: Object.freeze(ANIME_PARTS_CONFIG),
    toStoredEpisode,
    toSitePage,
    pageSlugFromPath,
  };

  if (typeof self !== "undefined") self.AnimeTrackerMultipartMappings = exports;
  if (typeof window !== "undefined") window.AnimeTrackerMultipartMappings = exports;
})();
