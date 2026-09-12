// an1me-scraper.js — scrapes an1me.to anime pages for metadata (episodes, status,
// countdown, cover, id, duration); maps watch→info slugs and backfills animeData.
function isSeasonLikeSlug(slug) {
  return self.AnimeTrackerAnimeIdentity.isSeasonLikeSlug(slug);
}

function toOrdinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  if (num % 100 >= 11 && num % 100 <= 13) return `${num}th`;
  if (num % 10 === 1) return `${num}st`;
  if (num % 10 === 2) return `${num}nd`;
  if (num % 10 === 3) return `${num}rd`;
  return `${num}th`;
}

function buildAnimeInfoSlugCandidates(slug) {
  const input = String(slug || "").toLowerCase();
  if (!input) return [];

  let clean = self.AnimeTrackerAnimeIdentity.getInfoSlug(input);

  const out = [clean];
  const add = (value) => {
    if (!value || out.includes(value)) return;
    out.push(value);
  };

  if (clean.endsWith("-movie")) {
    add(clean.replace(/-movie$/i, ""));
  }
  if (clean.endsWith("-movie-movie")) {
    add(clean.replace(/-movie-movie$/i, ""));
    add(clean.replace(/-movie-movie$/i, "-movie"));
  }

  add(
    clean.replace(/-season-?(\d+)(?=$|-)/i, (_m, num) => {
      const ord = toOrdinal(num);
      return ord ? `-${ord}-season` : _m;
    }),
  );

  add(clean.replace(/-(\d+)(st|nd|rd|th)-season(?=$|-)/i, "-season-$1"));

  add(clean.replace(/-s(\d+)(?=$|-)/i, "-season-$1"));

  if (!isSeasonLikeSlug(clean)) {
    const base = clean.replace(/-(?:season-?\d+|(?:\d+)(?:st|nd|rd|th)-season|s\d+|part-?\d+|cour-?\d+|(?:ii|iii|iv|v|vi))$/i, "");
    add(base);
  }

  return out;
}

const isMobileScraperUA = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod|Orion/i.test(navigator.userAgent || "");
const SCRAPER_TIMEOUT_MS = isMobileScraperUA ? 6000 : 8000;

const SCRAPER_HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeScrapedHtmlEntities(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => SCRAPER_HTML_ENTITIES[name.toLowerCase()] ?? m);
}

function cleanScrapedTitle(raw) {
  const text = decodeScrapedHtmlEntities(String(raw || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 2 || text.length > 300) return null;
  return text;
}

function extractScrapedDetail(html, labelPattern, maxLength = 500) {
  const pattern = new RegExp(
    `<dt\\b[^>]*>\\s*(?:${labelPattern})\\s*</dt>\\s*<dd\\b[^>]*>([\\s\\S]{0,${maxLength}}?)</dd>`,
    "i",
  );
  const match = String(html || "").match(pattern);
  if (!match) return null;
  const value = decodeScrapedHtmlEntities(match[1].replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return value || null;
}

function parseScrapedEpisodeList(value, totalEpisodes = null) {
  const numbers = new Set();
  const limit = Number(totalEpisodes) > 0 ? Number(totalEpisodes) : Infinity;
  const pattern = /(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?/g;
  let match;
  while ((match = pattern.exec(String(value || ""))) !== null) {
    const start = Number(match[1]) || 0;
    const end = Number(match[2]) || start;
    if (start <= 0 || end < start) continue;
    for (let episode = start; episode <= end && episode <= limit; episode++) numbers.add(episode);
  }
  return Array.from(numbers).sort((left, right) => left - right);
}

// The anime page <h1> holds two language spans: the one hidden in en mode
// (group-data-[language=en]) is the romaji title the tracker uses everywhere;
// the one hidden in jp mode is the English title. og:title is the fallback.
function extractAnimeTitlesFromHtml(html) {
  const out = { title: null, englishTitle: null };
  const source = String(html || "");

  const h1Match = source.match(/<h1[^>]*>([\s\S]{0,1500}?)<\/h1>/i);
  if (h1Match) {
    const spanRe = /<span[^>]*class=["'][^"']*group-data-\[language=(en|jp)\][^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
    let m;
    while ((m = spanRe.exec(h1Match[1])) !== null) {
      const cleaned = cleanScrapedTitle(m[2]);
      if (!cleaned) continue;
      if (m[1].toLowerCase() === "en") {
        if (!out.title) out.title = cleaned;
      } else if (!out.englishTitle) {
        out.englishTitle = cleaned;
      }
    }
  }

  if (!out.title) {
    const ogMatch =
      source.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogMatch) {
      const stripped = String(ogMatch[1])
        .replace(/^Παρακολουθήστε\s+/i, "")
        .replace(/\s*[-–—]\s*online Free on An1me\.to.*$/i, "")
        .replace(/\s*[-–—]\s*An1me(\.to)?\s*$/i, "");
      out.title = cleanScrapedTitle(stripped);
    }
  }

  return out;
}

const AN1ME_UNREACHABLE = "an1me_unreachable";

// Release-status sources, strongest first. Three heuristics used to decide this between them with
// no stated precedence, so they disagreed by construction: a leftover countdown tag alone could
// declare RELEASING, and "fewer episodes uploaded than declared" could flip a finished show back
// to RELEASING forever. Now only the highest-ranked available source decides, and anything
// weaker may only fill a gap.
const AN1ME_STATUS_SOURCE_RANK = Object.freeze({
  anilist: 5,
  explicit: 4,
  "aired-finished": 3,
  "aired-finished-single": 3,
  "aired-open": 3,
  countdown: 2,
  availability: 1,
});

function an1meStatusRank(source) {
  return AN1ME_STATUS_SOURCE_RANK[String(source || "")] || 0;
}

function pickImageUrlFromTag(tag) {
  const attr = (name) => String(tag || "").match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1] || null;
  const firstFromSet = (value) => (value ? String(value).split(",")[0].trim().split(/\s+/)[0] : null);
  const url = attr("data-src") || attr("src") || firstFromSet(attr("data-srcset")) || firstFromSet(attr("srcset"));
  if (!url || /^data:/i.test(url)) return null;
  return url;
}

function extractCoverImageFromHtml(html) {
  const source = String(html || "");

  const taggedImage = source.match(/<img\b[^>]*(?:anime-main-image|wp-post-image)[^>]*>/i);
  if (taggedImage) {
    const url = pickImageUrlFromTag(taggedImage[0]);
    if (url) return url;
  }

  const h1At = source.search(/<h1\b/i);
  const candidates = [];
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    if (h1At >= 0 && match.index > h1At) break;
    if (!/aspect-ratio:\s*2\s*\/\s*3/i.test(match[0])) continue;
    const url = pickImageUrlFromTag(match[0]);
    if (url) candidates.push(url);
  }
  if (candidates.length > 0) return candidates[candidates.length - 1];

  const ogMatch =
    source.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return ogMatch?.[1] || null;
}

function extractCountdownTag(html) {
  const source = String(html || "");
  const scheduledBlock = source.match(/<div[^>]+class=["'][^"']*next-scheduled-episode[^"']*["'][\s\S]{0,2000}/i)?.[0] || null;
  const tagPattern = /<[a-z][a-z0-9]*\b[^>]*\bdata-countdown=["'][^"']+["'][^>]*>/i;
  return (scheduledBlock && scheduledBlock.match(tagPattern)?.[0]) || source.match(tagPattern)?.[0] || null;
}

async function fetchAn1mePage(url, timeoutMs) {
  const res = await an1meFetch(url, { timeoutMs });
  if (res.unreachable) throw new Error(AN1ME_UNREACHABLE);
  return res;
}
async function fetchAnimePageInfo(slug) {
  const candidates = buildAnimeInfoSlugCandidates(slug);
  if (candidates.length === 0) {
    throw new Error("Missing slug");
  }

  let resolvedSlug = candidates[0];
  let url = `https://an1me.to/anime/${resolvedSlug}/`;
  let response = await fetchAn1mePage(url, SCRAPER_TIMEOUT_MS);

  if (!response.ok && response.status === 404 && candidates.length > 1) {
    for (const candidateSlug of candidates.slice(1)) {
      try {
        const candidateResponse = await fetchAn1mePage(`https://an1me.to/anime/${candidateSlug}/`, SCRAPER_TIMEOUT_MS);
        if (candidateResponse.ok) {
          response = candidateResponse;
          resolvedSlug = candidateSlug;
          break;
        }
      } catch (error) {
        if (String(error?.message || "").includes(AN1ME_UNREACHABLE)) throw error;
        continue;
      }
    }
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 503) throw new Error(AN1ME_UNREACHABLE);
    throw new Error(`HTTP ${response.status}`);
  }
  const html = response.text;

  let totalEpisodes = null;
  const episodeDetail = extractScrapedDetail(html, "Επεισόδια|Episodes?", 300);
  if (episodeDetail) {
    const numMatch = episodeDetail.match(/\b(\d{1,4})\b/);
    if (numMatch) totalEpisodes = parseInt(numMatch[1], 10);
  }

  const mediaTypeDetail = extractScrapedDetail(html, "Τύπος|Type", 120);
  const mediaType = globalThis.AnimeTrackerMediaType?.normalize(mediaTypeDetail) || null;

  let latestEpisode = null;
  {
    let maxEp = 0;
    for (const watchSlug of new Set([slug, resolvedSlug])) {
      const epPattern = new RegExp(`/watch/${watchSlug}-episode-(\\d+)`, "gi");
      let m;
      while ((m = epPattern.exec(html)) !== null) {
        const n = parseInt(m[1], 10);
        if (n > maxEp) maxEp = n;
      }
    }
    if (maxEp > 0) latestEpisode = maxEp;
  }

  let status = null;
  let statusSource = null;
  const statusDetail = extractScrapedDetail(html, "Κατάσταση|Status", 180);
  if (statusDetail && /Finished\s+Airing|Completed|Finished|Ολοκληρώθηκε|Ολοκληρωμένο/i.test(statusDetail)) {
    status = "FINISHED";
    statusSource = "explicit";
  } else if (statusDetail && /Currently\s+Airing|Releasing|Ongoing|Airing|Προβάλλεται\s+τώρα|Σε\s+εξέλιξη/i.test(statusDetail)) {
    status = "RELEASING";
    statusSource = "explicit";
  }

  const dateText = extractScrapedDetail(html, "Προβλήθηκε|Aired?", 300);

  let nextEpisodeAt = null;
  let nextEpisodeTimezone = null;
  const countdownTag = extractCountdownTag(html);
  if (countdownTag) {
    nextEpisodeTimezone = countdownTag.match(/\bdata-timezone=["']([^"']+)["']/i)?.[1] || null;
    const rawCountdown = countdownTag.match(/\bdata-countdown=["']([^"']+)["']/i)?.[1] || "";
    // data-timezone is what the string is actually in. It used to be captured, stored, synced and
    // compared - but never applied, while the value itself was read as UTC, which skewed every
    // scraped countdown by the site's offset (2-3h for Europe/Athens).
    nextEpisodeAt = globalThis.AnimeTrackerZonedTime.parseZonedDateTime(rawCountdown, nextEpisodeTimezone);
  }

  if (!status && nextEpisodeAt) {
    status = "RELEASING";
    statusSource = "countdown";
  }

  if (!status && dateText) {
    const hasOpenEnd = /\?|\bto\s+(?:\?|present|now|tbd)\b|έως\s+(?:\?|σήμερα)/i.test(dateText);
    const hasClosedRange = /\bto\s+(?!\?|present\b|now\b|tbd\b)\S|έως\s+(?!\?|σήμερα\b)\S/i.test(dateText);
    const singleDateFinished = totalEpisodes && latestEpisode && latestEpisode >= totalEpisodes;
    if (hasOpenEnd) {
      status = "RELEASING";
      statusSource = "aired-open";
    } else if (hasClosedRange || singleDateFinished) {
      status = "FINISHED";
      statusSource = hasClosedRange ? "aired-finished" : "aired-finished-single";
    }
  }

  // Availability is the weakest signal there is: "the site has fewer episodes up than the
  // declared total" is true of any finished show with one unnumbered or missing upload, and it
  // used to flip those to RELEASING permanently. It may only fill a gap, never overrule a
  // ranked source - see AN1ME_STATUS_SOURCE_RANK.
  if (!status && totalEpisodes && latestEpisode && latestEpisode < totalEpisodes) {
    status = "RELEASING";
    statusSource = "availability";
  }

  if (!totalEpisodes && latestEpisode && status === "FINISHED") {
    totalEpisodes = latestEpisode;
  }

  const pageText = decodeScrapedHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const fillerText = pageText.match(/Filler\s+(?:Επεισόδια|Episodes?)\s*:\s*([0-9,\s–—-]+)/i)?.[1] || null;
  const canonText = pageText.match(/Canon\s+(?:Επεισόδια|Episodes?)\s*:\s*([0-9,\s–—-]+)/i)?.[1] || null;
  const hasSiteEpisodeTypes = fillerText !== null || canonText !== null;
  const fillerEpisodes = hasSiteEpisodeTypes ? parseScrapedEpisodeList(fillerText, totalEpisodes) : null;
  const canonEpisodes = hasSiteEpisodeTypes ? parseScrapedEpisodeList(canonText, totalEpisodes) : null;

  const coverImage = extractCoverImageFromHtml(html);

  let siteAnimeId = null;
  const idMatch =
    html.match(/\bcurrent_post_data_id\s*=\s*(\d+)/) ||
    html.match(/\bcurrent_anime_id\s*=\s*(\d+)/) ||
    html.match(/showWatchlistModal\(['"]#watchlist-(\d+)['"]\)/);
  if (idMatch) siteAnimeId = parseInt(idMatch[1], 10);

  let durationSeconds = null;
  const durationDetail = extractScrapedDetail(html, "Διάρκεια|Duration", 200);
  if (durationDetail) {
    const text = durationDetail.toLowerCase();
    let totalMinutes = 0;
    const hourMatches = text.matchAll(/(\d+)\s*(?:h\b|hr\b|hour|ώρ)/g);
    for (const m of hourMatches) totalMinutes += parseInt(m[1], 10) * 60;
    const minMatches = text.matchAll(/(\d+)\s*(?:m\b|min|λεπτ)/g);
    for (const m of minMatches) totalMinutes += parseInt(m[1], 10);
    if (totalMinutes === 0) {
      const bareNum = text.match(/\b(\d{1,4})\b/);
      if (bareNum) totalMinutes = parseInt(bareNum[1], 10);
    }
    if (totalMinutes > 0 && totalMinutes <= 24 * 60) {
      durationSeconds = totalMinutes * 60;
    }
  }

  const titles = extractAnimeTitlesFromHtml(html);

  // AniList is the only source here that authoritatively knows whether a series has finished
  // airing, so it outranks every page heuristic. It is read from the batched airing snapshot,
  // which costs nothing extra: no per-anime request.
  // Keyed by the library slug (what animeData uses), with resolvedSlug as the fallback for the
  // case where a candidate slug won. Guarded because the schedule job is loaded later in the
  // importScripts order and must never be able to take the whole scrape down with it.
  const anilistView =
    typeof getAiringScheduleEntry === "function"
      ? await getAiringScheduleEntry(slug)
          .then((hit) => hit || (resolvedSlug !== slug ? getAiringScheduleEntry(resolvedSlug) : null))
          .catch(() => null)
      : null;
  const anilistStatus =
    anilistView?.mediaStatus === "FINISHED"
      ? "FINISHED"
      : anilistView?.mediaStatus === "RELEASING" || anilistView?.mediaStatus === "NOT_YET_RELEASED"
        ? "RELEASING"
        : null;
  if (anilistStatus && an1meStatusRank("anilist") >= an1meStatusRank(statusSource)) {
    // One deliberate exception: if an1me.to still has episodes to upload, the entry is not
    // "finished" from the user's point of view even once the broadcast has ended.
    const siteStillUploading = anilistStatus === "FINISHED" && totalEpisodes && latestEpisode && latestEpisode < totalEpisodes;
    if (!siteStillUploading) {
      status = anilistStatus;
      statusSource = "anilist";
    }
  }

  return {
    // Single source of truth: a hardcoded 4 here silently diverged from the policy module, so a
    // bump in one place either invalidated every cached snapshot or falsely validated it.
    schemaVersion: globalThis.AnimeTrackerCachePolicy.INFO_SCHEMA_VERSION,
    totalEpisodes,
    mediaType,
    status,
    statusSource,
    latestEpisode,
    nextEpisodeAt,
    nextEpisodeTimezone,
    coverImage,
    siteAnimeId,
    resolvedSlug,
    durationSeconds,
    title: titles.title,
    englishTitle: titles.englishTitle,
    fillerEpisodes,
    canonEpisodes,
    episodeTypesSource: hasSiteEpisodeTypes ? "an1me" : null,
  };
}
