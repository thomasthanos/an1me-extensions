// Loads the popup's SeasonGrouping in a stubbed browser environment so its franchise logic can be
// exercised outside Chrome.
//
// Grouping is the riskiest logic in the extension to change: baseSlug is a PERSISTED, cloud-synced
// key, so a rule that shifts it silently orphans the user's stored progress and cover art. This
// harness exists so any change to the franchise tables can be diffed against a recorded snapshot
// before it ships.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..", "..");

function load() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.console = console;
  sandbox.window = sandbox;
  sandbox.Intl = Intl;
  sandbox.Date = Date;
  sandbox.Math = Math;
  sandbox.RegExp = RegExp;
  sandbox.Number = Number;
  sandbox.String = String;
  sandbox.Array = Array;
  sandbox.Object = Object;
  sandbox.Map = Map;
  sandbox.Set = Set;
  sandbox.JSON = JSON;
  sandbox.Boolean = Boolean;
  sandbox.Error = Error;
  sandbox.isNaN = isNaN;
  sandbox.parseInt = parseInt;
  sandbox.parseFloat = parseFloat;

  const ctx = vm.createContext(sandbox);
  const run = (rel) => new vm.Script(fs.readFileSync(path.join(REPO, rel), "utf8"), { filename: rel }).runInContext(ctx);

  // Real dependencies of the grouping logic.
  run("src/common/data/multipart-mappings.js");
  run("src/common/data/media-type.js");
  run("src/common/data/anime-identity.js");
  run("src/common/data/franchise-seasons.js");

  // Stubs for the services config.js consults. Returning nothing models the common case: no
  // cached site info yet, so grouping falls back to slug/title heuristics - which is exactly the
  // franchise logic under test.
  sandbox.window.AnimeTracker = sandbox.window.AnimeTracker || {};
  sandbox.window.AnimeTracker.AnimeIdentity = sandbox.AnimeTrackerAnimeIdentity;
  sandbox.window.AnimeTracker.FranchiseSeasons = sandbox.AnimeTrackerFranchiseSeasons;
  sandbox.window.AnimeTracker.AnilistService = {
    getAuthoritativeInfo: () => null,
    isInfoCompatibleWithEntry: () => true,
  };
  sandbox.window.AnimeTracker.StatusService = { getAuthoritativeSiteInfo: () => null };
  sandbox.window.AnimeTrackerMultipartMappings = sandbox.AnimeTrackerMultipartMappings;

  run("src/popup/lib/config.js");
  return { SeasonGrouping: sandbox.window.AnimeTracker.SeasonGrouping, sandbox };
}

// A corpus wide enough to pin the behaviour that matters: every franchise branch in both
// if-chains, the generic season/part/roman rules, movie forms, and the ordering interactions
// between them.
const SLUGS = [
  // one-piece
  "one-piece", "one-piece-new-world", "one-piece-movie-01", "one-piece-film-red", "one-piece-film-z",
  "one-piece-film-gold", "one-piece-film-strong-world", "one-piece-3d-mugiwara-chase",
  "one-piece-movie-14-stampede", "one-piece-movie-08-episode-of-alabasta-sabaku-no-oujo-to-kaizoku-tachi",
  "one-piece-heroines", "one-piece-episode-of-luffy",
  // one-punch-man
  "one-punch-man", "one-punch-man-season-2", "one-punch-man-2nd-season", "one-punch-man-season-3", "one-punch-man-3",
  // jujutsu kaisen
  "jujutsu-kaisen", "jujutsu-kaisen-0", "jujutsu-kaisen-0-movie", "jujutsu-kaisen-season-2",
  "jujutsu-kaisen-2nd-season", "jujutsu-kaisen-shibuya-incident", "jujutsu-kaisen-kaigyoku-gyokusetsu",
  "jujutsu-kaisen-season-3", "jujutsu-kaisen-culling-game", "jujutsu-kaisen-shimetsu-kaiyuu",
  "jujutsu-kaisen-shimetsu-kaiyuu-zenpen", "jujutsu-kaisen-shimetsu-kaiyuu-koupen",
  "jujutsu-kaisen-culling-game-part-1", "jujutsu-kaisen-culling-game-part-2",
  // naruto
  "naruto", "naruto-shippuuden", "naruto-shippuden", "naruto-2", "naruto-season-2",
  "boruto-naruto-next-generations", "naruto-3", "naruto-movie-1", "naruto-shippuuden-movie-6-road-to-ninja",
  // kimetsu
  "kimetsu-no-yaiba", "kimetsu-no-yaiba-mugen-ressha-hen", "kimetsu-no-yaiba-yuukaku-hen",
  "kimetsu-no-yaiba-katanakaji-no-sato-hen", "kimetsu-no-yaiba-hashira-geiko-hen",
  "kimetsu-no-yaiba-mugen-train-movie",
  // shingeki
  "shingeki-no-kyojin", "shingeki-no-kyojin-season-2", "shingeki-no-kyojin-season-3",
  "shingeki-no-kyojin-season-3-part-2", "shingeki-no-kyojin-final-season",
  "shingeki-no-kyojin-final-season-part-2", "shingeki-no-kyojin-final-season-kanketsu-hen",
  // initial d
  "initial-d", "initial-d-second-stage", "initial-d-third-stage", "initial-d-fourth-stage",
  "initial-d-fifth-stage", "initial-d-final-stage", "initial-d-final-stage-255", "initial-d-6th-stage",
  // blue lock
  "blue-lock", "blue-lock-season-2", "blue-lock-vs-u-20-japan", "blue-lock-vs-u20",
  "blue-lock-season-3", "blue-lock-3rd-season", "blue-lock-2", "blue-lock-3",
  // bleach
  "bleach", "bleach-sennen-kessen-hen", "bleach-sennen-kessen-hen-ketsubetsu-tan",
  "bleach-sennen-kessen-hen-soukoku-tan", "bleach-movie-1-memories-of-nobody",
  // mashle
  "mashle", "mashle-shinkakusha-kouho-senbatsu-shiken-hen", "mashle-season-2",
  // hunter x hunter
  "hunter-x-hunter", "hunter-x-hunter-2011", "hunterhunter",
  "hunter-x-hunter-movie-1-phantom-rouge", "hunter-x-hunter-movie-2-the-last-mission",
  // fate
  "fate-zero", "fate-zero-season-2", "fate-zero-2nd-season", "fate-stay-night",
  "fate-stay-night-unlimited-blade-works", "fate-stay-night-unlimited-blade-works-prologue",
  "fate-stay-night-unlimited-blade-works-season-2", "fate-stay-night-unlimited-blade-works-2nd-season",
  "fate-stay-night-movie-heavens-feel-i-presage-flower",
  "fate-stay-night-movie-heavens-feel-ii-lost-butterfly",
  "fate-stay-night-movie-heavens-feel-iii-spring-song",
  "fate-apocrypha", "fate-grand-order",
  // trinity seven / higashi / dragon ball
  "trinity-seven", "trinity-seven-nanatsu-no-taizai-to-nana-madoushi",
  "higashi-no-eden", "higashi-no-eden-movie-i-king-of-eden", "higashi-no-eden-movie-ii-paradise-lost",
  "dragon-ball", "dragon-ball-z", "dragon-ball-super", "dragon-ball-super-broly",
  "dragon-ball-daima",
  // generic season/part/roman forms
  "spy-x-family", "spy-x-family-season-2", "spy-x-family-part-2", "spy-x-family-cour-2",
  "chainsaw-man", "chainsaw-man-movie-reze-hen", "sousou-no-frieren", "sousou-no-frieren-season-2",
  "some-anime-s2", "some-anime-ii", "some-anime-iii", "some-anime-4th-season",
  "some-anime-4th-season-2-nensei-hen-1-gakki", "some-anime-season-2-part-2",
  "some-anime-2nd-season", "some-anime-2020", "some-anime-arc-hen",
  "generic-show-movie", "generic-show-film-something", "generic-show-the-movie",
  "generic-show-gekijouban", "generic-show-ova", "generic-show-ona", "generic-show-special",
  "mushoku-tensei-2nd-season-part-2", "re-zero-kara-hajimeru-isekai-seikatsu-season-3",
];

// Titles matter for naruto/fate/one-piece/higashi label paths and for the movie heuristics.
const TITLES = {
  "naruto-2": "Naruto Shippuden",
  "naruto-3": "Boruto: Naruto Next Generations",
  "fate-zero-season-2": "Fate/Zero Season 2",
  "fate-zero-2nd-season": "Fate Zero 2nd Season",
  "one-piece-film-red": "One Piece Film: Red",
  "higashi-no-eden-movie-i-king-of-eden": "Higashi no Eden Movie I: King of Eden",
  "higashi-no-eden-movie-ii-paradise-lost": "Higashi no Eden Movie II: Paradise Lost",
  "generic-show-movie": "Generic Show Movie",
  "dragon-ball-super-broly": "Dragon Ball Super: Broly",
};

function snapshot(SeasonGrouping) {
  const out = {};
  for (const slug of SLUGS) {
    const title = TITLES[slug] || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const anime = { title, episodes: [], totalWatchTime: 0 };
    const safe = (fn) => {
      try {
        const v = fn();
        return typeof v === "undefined" ? null : v;
      } catch (e) {
        return `THREW: ${e.message}`;
      }
    };
    out[slug] = {
      isMovie: safe(() => SeasonGrouping.isMovie(slug, anime)),
      isMovieDisplay: safe(() => SeasonGrouping.isMovieDisplay(slug, anime)),
      seriesBase: safe(() => SeasonGrouping.getBaseSlug(slug, anime)),
      movieBase: safe(() => SeasonGrouping.getMovieBaseSlug(slug)),
      seasonNumber: safe(() => SeasonGrouping.getSeasonNumber(slug)),
      seasonLabel: safe(() => SeasonGrouping.getSeasonLabel(slug, title, anime)),
      movieNumber: safe(() => SeasonGrouping.getMovieNumber(slug, title)),
      movieLabel: safe(() => SeasonGrouping.getMovieLabel(slug, title)),
      movieReleaseTs: safe(() => SeasonGrouping.getMovieReleaseTimestamp(slug, title)),
      entryOrder: safe(() => SeasonGrouping.getEntryOrder(slug, anime)),
      chronologySeries: safe(() => SeasonGrouping.getChronologyInfo(SeasonGrouping.getBaseSlug(slug, anime), slug, title)),
      chronologyMovie: safe(() => SeasonGrouping.getChronologyInfo(SeasonGrouping.getMovieBaseSlug(slug), slug, title)),
      groupDisplayTitle: safe(() => SeasonGrouping.getGroupDisplayTitle(SeasonGrouping.getBaseSlug(slug, anime), title)),
      onePieceMovie: safe(() => SeasonGrouping.getOnePieceMovieInfo(slug, title)),
    };
  }

  // The whole-library grouping result: keys and member order are what actually ships.
  const entries = SLUGS.map((slug) => [slug, { title: TITLES[slug] || slug.replace(/-/g, " "), episodes: [], totalWatchTime: 0 }]);
  const grouped = SeasonGrouping.groupByBase(entries);
  const groupsOut = {};
  for (const [key, members] of grouped) {
    groupsOut[key] = members.map((m) => ({ slug: m.slug, seasonNum: m.seasonNum, isMovie: m.isMovie === true }));
  }
  out.__groups__ = groupsOut;
  return out;
}

module.exports = { load, snapshot, SLUGS, TITLES };
