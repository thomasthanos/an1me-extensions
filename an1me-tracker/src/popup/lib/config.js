// config.js — popup constants (cache durations, delays, display limits).
const CONFIG = {
  SEARCH_DEBOUNCE_MS: 150,
  STORAGE_UPDATE_DEBOUNCE_MS: 600,

  VISIBLE_EPISODES_LIMIT: 10,
  VISIBLE_FILLERS_LIMIT: 6,
  COMPLETED_LIST_MIN_DAYS: 4,

  COMPLETED_PERCENTAGE: 85,

  CLOUD_SAVE_DEBOUNCE_MS: 2000,
  MAX_CLOUD_SAVE_RETRIES: 3,
  MAX_RETRY_DELAY_MS: 30000,
};

const DONATE_LINKS = {
  paypal: "https://www.paypal.me/ThomasThanos",
  revolut: "https://revolut.me/thomas2873",
};

// Derived from the cour layout in src/common/data/multipart-mappings.js, alongside the slug
// renames and episode offsets, so the absolute ranges here cannot drift from the offsets used to
// renumber stored episodes.
function ANIME_PARTS_CONFIG_SOURCE() {
  return (typeof window !== "undefined" && window.AnimeTrackerMultipartMappings?.ANIME_PARTS_CONFIG) || {};
}

const ONE_PIECE_MOVIES = Object.freeze([
  null,
  { number: 1, slug: "one-piece-movie-01", label: "The Movie", releasedAt: "2000-03-04" },
  { number: 2, slug: "one-piece-movie-02-nejimaki-jima-no-daibouken", label: "Clockwork Island Adventure", releasedAt: "2001-03-03" },
  { number: 3, slug: "one-piece-movie-03-chinjuu-jima-no-chopper-oukoku", label: "Chopper's Kingdom on the Island of Strange Animals", releasedAt: "2002-03-02" },
  { number: 4, slug: "one-piece-movie-04-dead-end-no-bouken", label: "Dead End Adventure", releasedAt: "2003-03-01" },
  { number: 5, slug: "one-piece-movie-05-norowareta-seiken", label: "The Curse of the Sacred Sword", releasedAt: "2004-03-06" },
  { number: 6, slug: "one-piece-movie-06-omatsuri-danshaku-to-himitsu-no-shima", label: "Baron Omatsuri and the Secret Island", releasedAt: "2005-03-05" },
  { number: 7, slug: "one-piece-movie-07-karakuri-jou-no-mecha-kyohei", label: "The Giant Mechanical Soldier of Karakuri Castle", releasedAt: "2006-03-04" },
  { number: 8, slug: "one-piece-movie-08-episode-of-alabasta-sabaku-no-oujo-to-kaizoku-tachi", label: "Episode of Alabasta - The Desert Princess and the Pirates", releasedAt: "2007-03-03" },
  { number: 9, slug: "one-piece-movie-09-episode-of-chopper-plus-fuyu-ni-saku-kiseki-no-sakura", label: "Episode of Chopper Plus - Bloom in the Winter, Miracle Sakura", releasedAt: "2008-03-01" },
  { number: 10, slug: "one-piece-film-strong-world", label: "Film: Strong World", releasedAt: "2009-12-12" },
  { number: 11, slug: "one-piece-3d-mugiwara-chase", label: "3D: Straw Hat Chase", releasedAt: "2011-03-19" },
  { number: 12, slug: "one-piece-film-z", label: "Film: Z", releasedAt: "2012-12-15" },
  { number: 13, slug: "one-piece-film-gold", label: "Film: Gold", releasedAt: "2016-07-23" },
  { number: 14, slug: "one-piece-movie-14-stampede", label: "Stampede", releasedAt: "2019-08-09" },
  { number: 15, slug: "one-piece-film-red", label: "Film: Red", releasedAt: "2022-08-06" },
]);

// Franchises whose individual movies need naming, beyond the generic "-movie-N" parsing.
// One entry per movie carrying both its order and its label, because these used to be resolved
// by two different condition sets in getMovieNumber and getMovieLabel: the number keyed off
// "king"/"-1" while the label keyed off "-i-"/"-1-"/"-i" plus the title.
const FRANCHISE_MOVIES = Object.freeze({
  "higashi-no-eden": [
    { number: 1, label: "Movie I: King of Eden", any: ["-i-", "-1-", "king"], endsAny: ["-i", "-1"], titleAny: ["king"] },
    { number: 2, label: "Movie II: Paradise Lost", any: ["-ii-", "-2-", "paradise"], endsAny: ["-ii", "-2"], titleAny: ["paradise"] },
  ],
});

// { number, label } or null.
function resolveFranchiseMovie(slug, title = "") {
  const value = String(slug || "").toLowerCase();
  const titleValue = String(title || "").toLowerCase();
  for (const [prefix, movies] of Object.entries(FRANCHISE_MOVIES)) {
    if (!value.includes(prefix)) continue;
    for (const movie of movies) {
      const hit =
        (movie.any || []).some((token) => value.includes(token)) ||
        (movie.endsAny || []).some((token) => value.endsWith(token)) ||
        (titleValue && (movie.titleAny || []).some((token) => titleValue.includes(token)));
      if (hit) return { number: movie.number, label: movie.label };
    }
  }
  return null;
}

function CANONICAL_EPISODE_OFFSET_MAPPING() {
  return (typeof window !== "undefined" && window.AnimeTrackerMultipartMappings?.EPISODE_OFFSET_MAPPING) || {};
}

const SeasonGrouping = {
  isChronologyGroup(baseSlug) {
    return window.AnimeTracker.FranchiseSeasons.isChronologyGroup(baseSlug);
  },

  isMovie(slug, anime = null) {
    const lowerSlug = String(slug || "").toLowerCase();
    if (!lowerSlug) return false;
    const lowerTitle = String(anime?.title || "").toLowerCase();
    const mediaType = this.getMediaType(lowerSlug, anime);

    if (mediaType) return mediaType === "MOVIE";

    const nonMoviePatterns = [/-ova(-|$)/i, /-ona(-|$)/i, /-special(-|$)/i, /-recap(-|$)/i];
    const titleNonMoviePatterns = [/\bova\b/i, /\bona\b/i, /\bspecial\b/i, /\brecap\b/i];
    const hasNonMovieHint =
      nonMoviePatterns.some((pattern) => pattern.test(lowerSlug)) || titleNonMoviePatterns.some((pattern) => pattern.test(lowerTitle));

    if (lowerSlug === "trinity-seven-nanatsu-no-taizai-to-nana-madoushi") return true;

    const moviePatterns = [
      /-movie(-|$)/i,
      /-film(-|$)/i,
      /-gekijouban/i,
      /-the-movie/i,
      /^.*-movie-\d+/i,
      /-3d-/i,
      /-two-heroes$/i,
      /-heroes-rising$/i,
      /-world-heroes-mission$/i,
      /-super-hero$/i,
      /-broly$/i,
      /-the-last$/i,
      /-mugen-train$/i,
    ];
    if (moviePatterns.some((pattern) => pattern.test(lowerSlug))) {
      return true;
    }

    const titleMoviePatterns = [/\bmovie\b/i, /\bfilm\b/i, /\bthe movie\b/i, /\bgekijouban\b/i];

    const hasTitleMovieHint = titleMoviePatterns.some((pattern) => pattern.test(lowerTitle));
    if (hasTitleMovieHint && !hasNonMovieHint) {
      return true;
    }

    if (!anime || typeof anime !== "object") {
      return false;
    }

    const trackedEpisodes = Array.isArray(anime.episodes) ? anime.episodes.length : 0;
    const totalWatchTimeSeconds = Number(anime.totalWatchTime) || 0;
    const avgMinutes = trackedEpisodes > 0 ? totalWatchTimeSeconds / 60 / trackedEpisodes : 0;

    const hasSeriesSlugHint = /-season-?\d+|-s\d+|-(part|cour)-?\d+|-\d+(st|nd|rd|th)-season|-(ii|iii|iv|v|vi)$/i.test(lowerSlug);
    const hasSeriesTitleHint = /\bseason\b|\bpart\b|\bcour\b/i.test(lowerTitle);

    if (hasSeriesSlugHint || hasSeriesTitleHint || hasNonMovieHint) {
      return false;
    }

    if (trackedEpisodes === 1 && avgMinutes >= 70) return true;

    return false;
  },

  isMovieDisplay(slug, anime = null) {
    if (this.isMovie(slug, anime)) return true;
    if (this.getDisplayMediaType(slug, anime) !== "SPECIAL") return false;
    const siteInfo = window.AnimeTracker?.StatusService?.getAuthoritativeSiteInfo?.(String(slug || "").toLowerCase(), anime);
    const storedSiteTotal = anime?.totalEpisodesSource === "an1me" ? Number(anime.totalEpisodes) || 0 : 0;
    const totalEpisodes = Number(siteInfo?.totalEpisodes) || storedSiteTotal || Number(anime?.totalEpisodes) || 0;
    return totalEpisodes === 1;
  },

  getMediaType(slug, anime = null) {
    const service = window.AnimeTracker?.AnilistService;
    const info = service?.getAuthoritativeInfo?.(String(slug || "").toLowerCase()) || null;
    const compatibleInfo = !info || !anime || service?.isInfoCompatibleWithEntry?.(anime, info) !== false ? info : null;
    return globalThis.AnimeTrackerMediaType?.resolve(slug, anime, compatibleInfo) || null;
  },

  getDisplayMediaType(slug, anime = null) {
    const inferred = globalThis.AnimeTrackerMediaType?.infer(slug, anime?.title || "") || null;
    const resolved = this.getMediaType(slug, anime);
    const siteInfo = window.AnimeTracker?.StatusService?.getAuthoritativeSiteInfo?.(String(slug || "").toLowerCase(), anime);
    const total = Number(siteInfo?.totalEpisodes) || Number(anime?.totalEpisodes) || 0;
    if (globalThis.AnimeTrackerMediaType?.isSupplement(inferred) && (!resolved || (resolved === "TV" && total === 1))) return inferred;
    return resolved || inferred;
  },

  getEntryOrder(slug, anime = null) {
    const type = this.getDisplayMediaType(slug, anime);
    if (type === "SPECIAL") return 700;
    if (type === "OVA") return 710;
    if (type === "ONA") return 720;
    if (type === "MUSIC") return 730;
    return this.getSeasonNumber(slug);
  },

  getOnePieceMovieInfo(slug, title = "") {
    const normalizedSlug = String(slug || "").toLowerCase();
    const normalizedTitle = String(title || "").toLowerCase();
    if (!normalizedSlug.startsWith("one-piece") && !normalizedTitle.startsWith("one piece")) return null;

    const exact = ONE_PIECE_MOVIES.find((movie) => movie?.slug === normalizedSlug);
    if (exact) return exact;

    const context = `${normalizedSlug} ${normalizedTitle}`;
    const numbered = context.match(/\bmovie[-\s_:]*0?(\d{1,2})\b/i);
    if (numbered) return ONE_PIECE_MOVIES[Number(numbered[1])] || null;

    if (/film[-\s:]*red\b/i.test(context)) return ONE_PIECE_MOVIES[15];
    if (/\bstampede\b/i.test(context)) return ONE_PIECE_MOVIES[14];
    if (/film[-\s:]*gold\b/i.test(context)) return ONE_PIECE_MOVIES[13];
    if (/film[-\s:]*z\b/i.test(context)) return ONE_PIECE_MOVIES[12];
    if (/(?:mugiwara|straw[-\s]*hat)[-\s]*(?:no[-\s]*)?chase\b/i.test(context)) return ONE_PIECE_MOVIES[11];
    if (/strong[-\s]*world\b/i.test(context)) return ONE_PIECE_MOVIES[10];
    return null;
  },

  getMovieReleaseTimestamp(slug, title = "") {
    const releasedAt = this.getOnePieceMovieInfo(slug, title)?.releasedAt;
    return releasedAt ? Date.parse(`${releasedAt}T00:00:00Z`) : 0;
  },

  getMovieNumber(slug, title = "") {
    const onePieceMovie = this.getOnePieceMovieInfo(slug, title);
    if (onePieceMovie) return onePieceMovie.number;

    if (slug.includes("one-piece-3d-mugiwara-chase")) return 11;

    let match = slug.match(/-movie-0?(\d+)/i);
    if (match) return parseInt(match[1], 10);

    const romanMatch = slug.match(/-(i{1,3}|iv|v)(?:-|$)/i);
    if (romanMatch) {
      const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
      return romanMap[romanMatch[1].toLowerCase()] || 1;
    }

    const franchiseMovie = resolveFranchiseMovie(slug, title);
    if (franchiseMovie) return franchiseMovie.number;

    const filmOrder = {
      "film-gold": 13,
      "film-red": 15,
      "film-z": 12,
      "film-strong-world": 10,
    };
    for (const [filmSlug, num] of Object.entries(filmOrder)) {
      if (slug.includes(filmSlug)) return num;
    }

    return 1;
  },

  // Franchise + suffix rules now live in src/common/data/anime-identity.js so the content script
  // and the background worker resolve identity exactly the same way.
  getMovieBaseSlug(slug) {
    return window.AnimeTracker.AnimeIdentity.getMovieBaseSlug(slug);
  },

  getBaseSlug(slug, anime = null) {
    return window.AnimeTracker.AnimeIdentity.getBaseSlug(slug, { isMovie: this.isMovie(slug, anime) });
  },

  // Chronology rules are declared in src/common/data/franchise-seasons.js alongside the season
  // rules, so all of a franchise's ordering knowledge sits in one place.
  getChronologyInfo(baseSlug, slug, title = "") {
    return window.AnimeTracker.FranchiseSeasons.resolveChronology(baseSlug, slug, title);
  },

  getGroupDisplayTitle(baseSlug, fallbackTitle = "") {
    const Seasons = window.AnimeTracker.FranchiseSeasons;
    return Seasons.getChronologyDisplayTitle(baseSlug) || fallbackTitle;
  },

  // Pure slug parsing, no franchise knowledge: the ordinal/season/part/roman forms.
  // Returns a number or null. Its POSITION in resolveSeasonInfo is load-bearing.
  parseGenericSeasonNumber(slug) {
    // "part"/"cour" suffixes become a fraction so e.g. season-2-part-2 sorts after season 2
    const partMatch = slug.match(/-(?:part|cour)-?(\d+)/i);
    const partOffset = partMatch ? parseInt(partMatch[1], 10) / 10 : 0;

    // Ordinal form first (unanchored): "-4th-season-2-nensei-hen-1-gakki" must read
    // season 4, not let "-season-2-" below misparse the subtitle's number.
    let match = slug.match(/-(\d+)(?:st|nd|rd|th)-season/i);
    if (match) return parseInt(match[1], 10) + partOffset;

    match = slug.match(/-season-?(\d+)/i);
    if (match) return parseInt(match[1], 10) + partOffset;

    match = slug.match(/-s(\d+)$/i);
    if (match) return parseInt(match[1], 10);

    const romanMatch = slug.match(/-(ii|iii|iv|v|vi)$/i);
    if (romanMatch) {
      const romanMap = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
      return romanMatch[1].toLowerCase() in romanMap ? romanMap[romanMatch[1].toLowerCase()] : 1;
    }

    // A part/cour with no season number of its own belongs to season 1. Without this
    // "<show>-part-2" fell through to the default 1 - the same number as "<show>" itself - so the
    // two sorted identically and both rendered as "Season 1".
    if (partOffset > 0) return 1 + partOffset;

    return null;
  },

  // THE single ordering for "which season is this?", used by both the number and the label so the
  // two can no longer disagree. Franchise layouts are declared once in
  // src/common/data/franchise-seasons.js; a franchise marked "after-generic" is only consulted if
  // the generic rules above found nothing, which is what makes "mashle-season-2" read as 2.
  //
  // A null label means "no franchise-specific name" - the caller formats "Season N" from number.
  resolveSeasonInfo(slug, title = "") {
    const Seasons = window.AnimeTracker.FranchiseSeasons;

    const before = Seasons.resolveSeason(slug, title, "before-generic");
    if (before) return before;

    const generic = this.parseGenericSeasonNumber(slug);
    if (generic !== null) return { number: generic, label: null };

    const after = Seasons.resolveSeason(slug, title, "after-generic");
    if (after) return after;

    return { number: 1, label: null };
  },

  getSeasonNumber(slug, title = "") {
    return this.resolveSeasonInfo(slug, title).number;
  },

  getSeasonLabel(slug, title, anime = null) {
    const displayType = this.getDisplayMediaType(slug, anime || { title });
    const typeLabel = globalThis.AnimeTrackerMediaType?.getLabel(displayType);
    if (typeLabel && !["TV", "TV Short"].includes(typeLabel)) return typeLabel;

    const resolved = this.resolveSeasonInfo(slug, title);
    if (resolved.label) return resolved.label;

    const seasonNum = resolved.number;
    if (Number.isInteger(seasonNum)) return `Season ${seasonNum}`;
    const whole = Math.floor(seasonNum);
    const part = Math.round((seasonNum - whole) * 10);
    return `Season ${whole} Part ${part}`;
  },

  getMovieLabel(slug, title) {
    const onePieceMovie = this.getOnePieceMovieInfo(slug, title);
    if (onePieceMovie) return onePieceMovie.label;

    const franchiseMovie = resolveFranchiseMovie(slug, title);
    if (franchiseMovie) return franchiseMovie.label;

    const filmMatch = slug.match(/-film-([a-z-]+)/i);
    if (filmMatch) {
      const filmName = filmMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return `Film: ${filmName}`;
    }

    const movieMatch = slug.match(/-movie-0?(\d+)/i);
    if (movieMatch) return `Movie ${movieMatch[1]}`;

    const romanMatch = slug.match(/-movie-?(i{1,3}|iv|v)(?:-|$)/i);
    if (romanMatch) {
      const romanMap = { i: "I", ii: "II", iii: "III", iv: "IV", v: "V" };
      return `Movie ${romanMap[romanMatch[1].toLowerCase()] || romanMatch[1].toUpperCase()}`;
    }

    if (title) {
      const romanTitleMatch = title.match(/Movie\s*(I{1,3}|IV|V)\b/i);
      if (romanTitleMatch) return `Movie ${romanTitleMatch[1].toUpperCase()}`;

      const numTitleMatch = title.match(/Movie\s*(\d+)/i);
      if (numTitleMatch) return `Movie ${numTitleMatch[1]}`;

      const leadingNumMovieMatch = title.match(/\b(\d+)\s*Movie\b/i);
      if (leadingNumMovieMatch) return `Movie ${leadingNumMovieMatch[1]}`;

      const filmTitleMatch = title.match(/Film[:\s]+([A-Za-z]+)/i);
      if (filmTitleMatch) return `Film: ${filmTitleMatch[1]}`;
    }

    if (title) {
      const baseSlug = this.getMovieBaseSlug(slug);
      const baseTitle = baseSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const cleaned = title.replace(new RegExp(`^${baseTitle}\\s*[:\\-]?\\s*`, "i"), "").trim();
      if (cleaned) return cleaned;
      return title.trim();
    }

    return "Movie";
  },

  groupByBase(animeEntries) {
    const groups = new Map();
    const movieGroups = new Map();

    for (const [slug, anime] of animeEntries) {
      const isMovie = this.isMovieDisplay(slug, anime);
      const isSpecialMovie = isMovie && !this.isMovie(slug, anime);
      const baseSlug = isMovie ? this.getMovieBaseSlug(slug) : this.getBaseSlug(slug, anime);
      const chronologyInfo = this.getChronologyInfo(baseSlug, slug, anime?.title || "");
      const movieNumber = isSpecialMovie ? 0 : this.getMovieNumber(slug, anime?.title || "");
      const movieReleasedAt = isSpecialMovie ? 0 : this.getMovieReleaseTimestamp(slug, anime?.title || "");

      if (isMovie) {
        const movieGroupKey = baseSlug + "__movies";
        if (!movieGroups.has(movieGroupKey)) movieGroups.set(movieGroupKey, []);
        movieGroups.get(movieGroupKey).push({
          slug,
          anime,
          movieNum: movieNumber,
          movieReleasedAt,
          seasonNum: chronologyInfo?.order ?? movieNumber,
          chronologyLabel: chronologyInfo?.separatorLabel || null,
          chronologyItemLabel: chronologyInfo?.itemLabel || null,
          isMovie: true,
        });
      } else {
        if (!groups.has(baseSlug)) groups.set(baseSlug, []);
        groups.get(baseSlug).push({
          slug,
          anime,
          seasonNum: chronologyInfo?.order ?? this.getEntryOrder(slug, anime),
          chronologyLabel: chronologyInfo?.separatorLabel || null,
          chronologyItemLabel: chronologyInfo?.itemLabel || null,
        });
      }
    }

    this.mergeRelatedGroups(groups);

    for (const [, entries] of groups) {
      entries.sort((a, b) => a.seasonNum - b.seasonNum || String(a.anime?.title || a.slug).localeCompare(String(b.anime?.title || b.slug)));
    }

    for (const [, entries] of movieGroups) {
      if (entries.length > 0 && this.isChronologyGroup(this.getBaseSlug(entries[0].slug, entries[0].anime))) {
        entries.sort((a, b) => (a.seasonNum || 0) - (b.seasonNum || 0));
        continue;
      }

      entries.sort((a, b) => {
        if (a.movieReleasedAt && b.movieReleasedAt && a.movieReleasedAt !== b.movieReleasedAt) {
          return a.movieReleasedAt - b.movieReleasedAt;
        }
        if (a.movieNum !== b.movieNum) return a.movieNum - b.movieNum;
        const aExplicit = /-movie-0?\d+/i.test(a.slug) ? 0 : 1;
        const bExplicit = /-movie-0?\d+/i.test(b.slug) ? 0 : 1;
        if (aExplicit !== bExplicit) return aExplicit - bExplicit;
        const aLabel = this.getMovieLabel(a.slug, a.anime?.title || "");
        const bLabel = this.getMovieLabel(b.slug, b.anime?.title || "");
        const labelOrder = aLabel.localeCompare(bLabel, "en", { numeric: true, sensitivity: "base" });
        return labelOrder || a.slug.localeCompare(b.slug, "en", { numeric: true, sensitivity: "base" });
      });
    }

    for (const [groupKey, entries] of movieGroups) {
      const movieBaseSlug = groupKey.replace(/__movies$/, "");
      const relatedBase = Array.from(groups.keys())
        .filter((candidate) => {
          if (!entries.some((entry) => entry.slug.startsWith(`${candidate}-`))) return false;
          if (candidate.split("-").length >= 2) return true;
          const candidateEntries = groups.get(candidate) || [];
          const seriesTitle = String(
            candidateEntries.find((entry) => entry.slug === candidate)?.anime?.title ||
              candidate.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
          ).trim();
          if (!seriesTitle) return false;
          const escapedTitle = seriesTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const installmentTitle = new RegExp(
            `^${escapedTitle}(?:\\s*[:\\-–—]|\\s+(?:movie|film|theatrical|gekijouban|special|recap|fan[-\\s]*letter)\\b)`,
            "i",
          );
          return entries.some((entry) => installmentTitle.test(String(entry.anime?.title || "").trim()));
        })
        .sort((a, b) => b.length - a.length)[0];
      const baseSlug = groups.has(movieBaseSlug) ? movieBaseSlug : relatedBase || movieBaseSlug;
      if (groups.has(baseSlug)) {
        const seriesGroup = groups.get(baseSlug);
        const maxSeasonNum = seriesGroup.reduce((m, e) => Math.max(m, e.seasonNum || 0), 0);
        entries.forEach((entry, i) => {
          const intrinsicOrder = this.getSeasonNumber(entry.slug);
          const useIntrinsicOrder = /initial-d.*(?:third|3rd)-stage/i.test(entry.slug);
          seriesGroup.push({
            slug: entry.slug,
            anime: entry.anime,
            seasonNum: this.isChronologyGroup(baseSlug)
              ? entry.seasonNum || maxSeasonNum + 1 + i
              : useIntrinsicOrder
                ? intrinsicOrder
                : maxSeasonNum + 1 + i,
            chronologyLabel: entry.chronologyLabel || null,
            chronologyItemLabel: entry.chronologyItemLabel || null,
            isMovie: true,
          });
        });
        seriesGroup.sort((a, b) => (a.seasonNum || 0) - (b.seasonNum || 0));
      } else if (this.isChronologyGroup(baseSlug)) {
        groups.set(
          baseSlug,
          entries.map((entry) => ({
            slug: entry.slug,
            anime: entry.anime,
            seasonNum: entry.seasonNum || 0,
            chronologyLabel: entry.chronologyLabel || null,
            chronologyItemLabel: entry.chronologyItemLabel || null,
            isMovie: false,
          })),
        );
      } else {
        groups.set(groupKey, entries);
      }
    }

    return groups;
  },

  mergeRelatedGroups(groups) {
    const baseSlugs = Array.from(groups.keys()).sort((a, b) => a.length - b.length);
    const merged = new Set();
    const normalizeFamilyTitle = (value) =>
      String(value || "")
        .trim()
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\s*[\[(]?(?:19|20)\d{2}[\])]?\s*$/i, "")
        .trim();
    const isNumberedSeriesEntry = (entry) => {
      if (!entry || entry.isMovie || this.isMovieDisplay(entry.slug, entry.anime)) return false;
      const type = this.getDisplayMediaType(entry.slug, entry.anime);
      return !["MOVIE", "SPECIAL", "MUSIC"].includes(type);
    };

    for (let i = 0; i < baseSlugs.length; i++) {
      const shorter = baseSlugs[i];
      if (merged.has(shorter)) continue;

      for (let j = i + 1; j < baseSlugs.length; j++) {
        const longer = baseSlugs[j];
        if (merged.has(longer)) continue;

        const relationSuffix = longer.startsWith(shorter + "-") ? longer.slice(shorter.length + 1) : "";
        const numericRelationMatch = relationSuffix.match(/^([1-9]\d?)(?:-|$)/);
        const numericRelation = numericRelationMatch ? Number(numericRelationMatch[1]) : 0;
        const hasRelationMarker =
          /^(?:season-?\d+|s\d+|part-?\d+|cour-?\d+|\d+(?:st|nd|rd|th)-season|ii(?:i|v)?|iv|v|vi|ova|oav|ona|special|recap|music|pv)(?:-|$)/i.test(
            relationSuffix,
          );
        const longerIsSupplement = (groups.get(longer) || []).every((entry) =>
          globalThis.AnimeTrackerMediaType?.isSupplement(this.getDisplayMediaType(entry.slug, entry.anime)),
        );
        const shorterEntries = groups.get(shorter) || [];
        const shorterTitle = String(
          shorterEntries.find((entry) => entry.slug === shorter)?.anime?.title ||
            shorter.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        ).trim();
        const escapedShorterTitle = shorterTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const hasTitleBoundary = (groups.get(longer) || []).some((entry) =>
          new RegExp(`^${escapedShorterTitle}(?:\\s*[:\\-–—]|\\s+(?:ova|oav|ona|special|recap|music|pv)\\b)`, "i").test(
            String(entry.anime?.title || "").trim(),
          ),
        );
        const normalizedShorterTitle = normalizeFamilyTitle(shorterTitle);
        const escapedNormalizedTitle = normalizedShorterTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const numberedTitlePattern =
          numericRelation >= 2
            ? new RegExp(
                `^${escapedNormalizedTitle}\\s*(?:[:\\-]\\s*)?(?:season\\s*)?${numericRelation}(?:st|nd|rd|th)?(?:\\s+season)?(?=\\b|\\s*[:\\-])`,
                "i",
              )
            : null;
        const longerEntries = groups.get(longer) || [];
        const isNumberedSeriesRelation =
          !!numberedTitlePattern &&
          normalizedShorterTitle.length > 0 &&
          shorterEntries.length > 0 &&
          shorterEntries.every(isNumberedSeriesEntry) &&
          longerEntries.length > 0 &&
          longerEntries.every(isNumberedSeriesEntry) &&
          longerEntries.some((entry) => numberedTitlePattern.test(normalizeFamilyTitle(entry.anime?.title)));

        if (relationSuffix && (hasRelationMarker || (longerIsSupplement && hasTitleBoundary) || isNumberedSeriesRelation)) {
          if (isNumberedSeriesRelation) {
            shorterEntries.forEach((entry) => {
              const seasonNum = this.getSeasonNumber(entry.slug);
              entry.seasonNum = Number.isFinite(seasonNum) && seasonNum > 0 ? seasonNum : 1;
              entry.groupLabel = `Season ${entry.seasonNum}`;
            });
            longerEntries.forEach((entry) => {
              entry.seasonNum = numericRelation;
              entry.groupLabel = `Season ${numericRelation}`;
            });
          }

          longerEntries.forEach((entry) => {
            if (entry.seasonNum === 1 && longerEntries.length === 1) {
              const seasonNums = shorterEntries.map((e) => e.seasonNum).filter(Number.isFinite);
              const maxSeason = seasonNums.length > 0 ? Math.max(...seasonNums) : 0;
              entry.seasonNum = maxSeason + 1;
            }
            shorterEntries.push(entry);
          });

          groups.delete(longer);
          merged.add(longer);
        }
      }
    }
  },

  hasMultipleSeasons(group) {
    return group.length > 1;
  },

  isMovieGroup(group) {
    return group.length > 0 && group[0].isMovie === true;
  },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.CONFIG = CONFIG;
window.AnimeTracker.DONATE_LINKS = DONATE_LINKS;
Object.defineProperty(window.AnimeTracker, "ANIME_PARTS_CONFIG", {
  get: ANIME_PARTS_CONFIG_SOURCE,
  configurable: true,
});
Object.defineProperty(window.AnimeTracker, "CANONICAL_EPISODE_OFFSET_MAPPING", {
  get: CANONICAL_EPISODE_OFFSET_MAPPING,
  enumerable: true,
  configurable: true,
});
window.AnimeTracker.SeasonGrouping = SeasonGrouping;
