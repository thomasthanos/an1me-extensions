// anime-identity.js - the ONE place that decides anime identity from a slug.
//
// Before this module the same questions ("is this a season of something?", "which franchise does
// it belong to?", "which page slug should I fetch?") were answered by four independent
// implementations whose rules had drifted apart, so the same slug could group one way in the
// library and another way on the watch page.
//
// Behaviour here is deliberately identical to what popup/lib/config.js produced, because baseSlug
// is a persisted, cloud-synced grouping key: changing it would orphan stored data. The other
// layers were brought up to match it.
(function () {
  "use strict";

  // Franchises the site splits across slugs that generic suffix rules cannot join.
  // `series` / `movie` = base slug to use in that context; a missing one means "fall through to
  // the generic rules", which mirrors the two original if-chains.
  const FRANCHISES = Object.freeze([
    { id: "jujutsu-kaisen", prefixes: ["jujutsu-kaisen"], series: "jujutsu-kaisen" },
    { id: "fate", prefixes: ["fate-zero", "fate-stay-night"], series: "fate", movie: "fate" },
    { id: "naruto", prefixes: ["naruto"], series: "naruto", movie: "naruto" },
    { id: "one-punch-man", prefixes: ["one-punch-man"], series: "one-punch-man" },
    { id: "one-piece", prefixes: ["one-piece"], series: "one-piece", movie: "one-piece" },
    { id: "kimetsu-no-yaiba", prefixes: ["kimetsu-no-yaiba"], series: "kimetsu-no-yaiba", movie: "kimetsu-no-yaiba" },
    { id: "shingeki-no-kyojin", prefixes: ["shingeki-no-kyojin"], series: "shingeki-no-kyojin" },
    { id: "initial-d", prefixes: ["initial-d"], series: "initial-d", movie: "initial-d" },
    { id: "blue-lock", prefixes: ["blue-lock"], series: "blue-lock" },
    { id: "bleach", prefixes: ["bleach"], series: "bleach" },
    { id: "mashle", prefixes: ["mashle"], series: "mashle" },
    { id: "hunter-x-hunter", prefixes: ["hunter-x-hunter", "hunterhunter"], series: "hunter-x-hunter", movie: "hunter-x-hunter" },
    { id: "trinity-seven", prefixes: ["trinity-seven-nanatsu"], movie: "trinity-seven" },
    { id: "higashi-no-eden", prefixes: ["higashi-no-eden"], movie: "higashi-no-eden" },
    { id: "dragon-ball", prefixes: ["dragon-ball"], movie: "dragon-ball" },
  ]);

  const SEASON_LIKE = /-(?:season-?\d+|(?:\d+)(?:st|nd|rd|th)-season|s\d+|(?:part|cour)-?\d+|(?:ii|iii|iv|v|vi))(?=$|-)/i;

  // Order is behaviour-defining: each rule strips one kind of season/part suffix.
  const SERIES_SUFFIX_RULES = Object.freeze([
    [/-\d+(st|nd|rd|th)-season(-.+)?$/i, ""],
    [/-season-?\d+(-[a-z-]+)?$/i, ""],
    [/-s\d+$/i, ""],
    [/-(part|cour)-?\d+(-[a-z-]+)?$/i, ""],
    [/-20\d{2}$/i, ""],
    [/-(ii|iii|iv|v|vi)$/i, ""],
    [/-[a-z]+-hen$/i, ""],
  ]);

  const MOVIE_SUFFIX_RULES = Object.freeze([
    [/-movie.*$/i, ""],
    [/-film.*$/i, ""],
    [/-3d.*$/i, ""],
    [/-gekijouban.*$/i, ""],
    [/-the-movie.*$/i, ""],
  ]);

  // an1me.to watch slugs that do not match their own /anime/<slug>/ page.
  const WATCH_TO_INFO_SLUGS = Object.freeze({
    hunterhunter: "hunter-x-hunter-2011",
    "hunter-x-hunter-movie-1-phantom-rouge-movie": "hunter-x-hunter-movie-1-phantom-rouge",
    "hunter-x-hunter-movie-2-the-last-mission-movie": "hunter-x-hunter-movie-2-the-last-mission",
    "initial-d-final-stage-255": "initial-d-final-stage",
  });

  const lower = (value) => String(value || "").trim().toLowerCase();

  function applyRules(slug, rules) {
    let out = String(slug || "");
    for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
    return out;
  }

  function findFranchise(slug, context) {
    const value = lower(slug);
    if (!value) return null;
    for (const franchise of FRANCHISES) {
      if (!franchise[context]) continue;
      if (franchise.prefixes.some((prefix) => value.startsWith(prefix))) return franchise;
    }
    return null;
  }

  function isSeasonLikeSlug(slug) {
    return SEASON_LIKE.test(String(slug || ""));
  }

  function getMovieBaseSlug(slug) {
    const franchise = findFranchise(slug, "movie");
    if (franchise) return franchise.movie;
    return applyRules(slug, MOVIE_SUFFIX_RULES);
  }

  function getSeriesBaseSlug(slug) {
    const franchise = findFranchise(slug, "series");
    if (franchise) return franchise.series;
    return applyRules(slug, SERIES_SUFFIX_RULES);
  }

  // `isMovie` is decided by the caller: media-type and title heuristics live in the popup's
  // SeasonGrouping and in media-type.js, because the same slug can be a movie or a series
  // depending on metadata this resolver does not own.
  function getBaseSlug(slug, options = {}) {
    return options.isMovie === true ? getMovieBaseSlug(slug) : getSeriesBaseSlug(slug);
  }

  function getInfoSlug(slug) {
    const value = lower(slug);
    return WATCH_TO_INFO_SLUGS[value] || value;
  }

  function getFranchiseId(slug, options = {}) {
    const franchise = findFranchise(slug, options.isMovie === true ? "movie" : "series");
    return franchise ? franchise.id : getBaseSlug(slug, options);
  }

  // Canonical slug for franchises whose an1me slugs and titles disagree about which entry a page
  // belongs to. Unlike getBaseSlug this does not group seasons together - it picks the ONE slug a
  // given (slug, title) pair should be stored under, which is why it needs the title too.
  function getCanonicalSlug(slug, title = "") {
    // Deliberately not the module's lower() helper: that one trims, and these two values are used
    // to pick a stored slug, so the comparison has to stay byte-for-byte what it always was.
    const safeSlug = String(slug || "").toLowerCase();
    const safeTitle = String(title || "").toLowerCase();
    const context = `${safeSlug} ${safeTitle}`;

    if (safeSlug.startsWith("jujutsu-kaisen") || safeTitle.includes("jujutsu kaisen")) {
      if (/(?:^|-)0(?:-|$)/.test(safeSlug) || /\b(?:0|zero)\b/.test(safeTitle)) return "jujutsu-kaisen-0";
      const mediaType = globalThis.AnimeTrackerMediaType?.infer(safeSlug, safeTitle);
      if (mediaType && !["TV", "TV_SHORT"].includes(mediaType)) return safeSlug;
      if (safeSlug.includes("shimetsu-kaiyuu") || safeSlug.includes("culling-game")) return safeSlug;
      if (/season\s*3|part\s*3|culling\s*game|dead[-\s]*culling|shimetsu|kaiyuu/.test(context)) return "jujutsu-kaisen-season-3";
      if (/season\s*2|2nd\s*season|shibuya|kaigyoku|gyokusetsu/.test(context)) return "jujutsu-kaisen-season-2";
      return "jujutsu-kaisen";
    }

    if (safeSlug.startsWith("fate-zero") || safeTitle.includes("fate/zero") || safeTitle.includes("fate zero")) {
      return "fate-zero";
    }

    return slug;
  }

  // The title that goes with getCanonicalSlug: when several an1me titles collapse onto one slug,
  // the stored title has to collapse with them or the library shows the same entry twice.
  function getCanonicalTitle(slug, title = "") {
    const canonicalSlug = getCanonicalSlug(slug, title);
    const rawTitle = String(title || "").trim();
    if (!rawTitle) return rawTitle;

    if (canonicalSlug === "fate-zero") {
      const cleaned = rawTitle.replace(/\s+(?:season\s*2|2nd\s*season|second\s*season)\s*$/i, "").trim();
      const lowerTitle = cleaned.toLowerCase();
      if (lowerTitle === "fate zero" || lowerTitle === "fate/zero") {
        return "Fate/Zero";
      }
      return cleaned;
    }

    return rawTitle;
  }

  const exports = {
    FRANCHISES,
    SEASON_LIKE,
    WATCH_TO_INFO_SLUGS,
    isSeasonLikeSlug,
    getBaseSlug,
    getSeriesBaseSlug,
    getMovieBaseSlug,
    getInfoSlug,
    getFranchiseId,
    getCanonicalSlug,
    getCanonicalTitle,
  };

  const root = typeof globalThis !== "undefined" ? globalThis : self;
  root.AnimeTrackerAnimeIdentity = exports;

  if (typeof window !== "undefined") {
    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.AnimeIdentity = exports;
  }
})();
