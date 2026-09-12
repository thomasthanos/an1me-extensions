// airing-schedule.js — keeps one batched AniList airing snapshot for the whole library.
//
// Why this exists: the only schedule signal the extension used to have was a `data-countdown`
// attribute scraped off each anime's own HTML page, which meant one full page load per show per
// sweep, a `data-timezone` sibling nobody applied, and no idea which episode number the countdown
// was even for. AniList answers all of that for 50 shows in a single request, with an unambiguous
// epoch, so it becomes authoritative for *when something airs*. an1me.to stays authoritative for
// *what is actually uploaded* (`latestEpisode`) — the two are different questions and conflating
// them is what produced most of the airing bugs.
const AIRING_SCHEDULE_KEY = "airing_schedule";
const AIRING_SCHEDULE_ALARM = "airingScheduleRefresh";
const AIRING_SCHEDULE_TTL_MS = 2 * 60 * 60 * 1000;
const AIRING_SCHEDULE_MINUTES = 120;
const AIRING_SCHEDULE_SCHEMA = 1;
// A show AniList reports as finished, with no next episode, cannot change again — there is no
// point spending a slot in the batch on it every two hours.
const AIRING_SCHEDULE_SETTLED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let _airingRefreshInFlight = null;

function airingScheduleIsFresh(snapshot) {
  if (!snapshot || Number(snapshot.schemaVersion || 0) < AIRING_SCHEDULE_SCHEMA) return false;
  const at = Number(snapshot.cachedAt) || 0;
  if (!at) return false;
  return Date.now() - at < AIRING_SCHEDULE_TTL_MS;
}

// Slugs worth asking about: anything not settled, that we have an AniList media id for.
function collectAiringCandidates(animeData, mediaMap, previous) {
  const now = Date.now();
  const candidates = [];
  for (const [slug, anime] of Object.entries(animeData || {})) {
    const listState = globalThis.AnimeTrackerEntryState?.getResolvedListState?.(anime) || String(anime?.listState || "").toLowerCase();
    if (listState === "dropped") continue;

    const mediaId = Number(mediaMap?.[slug]?.mediaId) || 0;
    if (!mediaId) continue;

    const prior = previous?.[slug];
    if (
      prior &&
      prior.mediaStatus === "FINISHED" &&
      !prior.airingAt &&
      now - (Number(prior.checkedAt) || 0) < AIRING_SCHEDULE_SETTLED_TTL_MS
    ) {
      continue;
    }
    candidates.push({ slug, mediaId });
  }
  return candidates;
}

async function refreshAiringSchedule(options = {}) {
  if (_airingRefreshInFlight) return _airingRefreshInFlight;

  _airingRefreshInFlight = (async () => {
    const stored = await bgStorageGet(["animeData", "anilist_media_map", AIRING_SCHEDULE_KEY]);
    const snapshot = stored[AIRING_SCHEDULE_KEY] || null;
    if (options.force !== true && airingScheduleIsFresh(snapshot)) {
      return { skipped: true, reason: "fresh" };
    }

    const previous = snapshot?.bySlug || {};
    const candidates = collectAiringCandidates(stored.animeData || {}, stored.anilist_media_map || {}, previous);
    if (candidates.length === 0) {
      // Still stamp the snapshot, or an empty library re-queries on every single alarm.
      await bgStorageSet({
        [AIRING_SCHEDULE_KEY]: { schemaVersion: AIRING_SCHEDULE_SCHEMA, cachedAt: Date.now(), bySlug: previous },
      });
      return { skipped: true, reason: "no-candidates" };
    }

    const byId = await self.AniListCore.fetchAiringSchedule(candidates.map((c) => c.mediaId));
    if (byId.size === 0) {
      // Every batch failed (offline, or AniList is down). Leave the previous snapshot in place
      // rather than overwriting good data with nothing, and let the alarm try again.
      return { skipped: true, reason: "no-results", candidates: candidates.length };
    }

    const now = Date.now();
    const bySlug = { ...previous };
    let matched = 0;
    for (const { slug, mediaId } of candidates) {
      const media = byId.get(mediaId);
      if (!media) continue;
      matched++;
      bySlug[slug] = {
        mediaId,
        mediaStatus: media.mediaStatus,
        airingAt: media.airingAt,
        // The episode number the countdown is FOR. Nothing in the scraped path ever knew this,
        // so a countdown could silently be for N+1 or N+2.
        episode: media.episode,
        totalEpisodes: media.episodes,
        checkedAt: now,
      };
    }

    await bgStorageSet({
      [AIRING_SCHEDULE_KEY]: { schemaVersion: AIRING_SCHEDULE_SCHEMA, cachedAt: now, bySlug },
    });
    dlog(`[BG] Airing schedule refreshed: ${matched}/${candidates.length} matched`);
    return { matched, candidates: candidates.length };
  })();

  try {
    return await _airingRefreshInFlight;
  } finally {
    _airingRefreshInFlight = null;
  }
}

async function ensureAiringScheduleAlarm() {
  try {
    const existing = await chrome.alarms.get(AIRING_SCHEDULE_ALARM);
    if (existing && Number(existing.periodInMinutes) === AIRING_SCHEDULE_MINUTES) return;
    await chrome.alarms.create(AIRING_SCHEDULE_ALARM, {
      delayInMinutes: 2,
      periodInMinutes: AIRING_SCHEDULE_MINUTES,
    });
  } catch (e) {
    console.warn("[BG] Could not arm airing schedule alarm:", e?.message || e);
  }
}

// Read side, used by the scraper/status layer in the worker: the AniList view of one slug.
async function getAiringScheduleEntry(slug) {
  try {
    const stored = await bgStorageGet([AIRING_SCHEDULE_KEY]);
    return stored[AIRING_SCHEDULE_KEY]?.bySlug?.[slug] || null;
  } catch {
    return null;
  }
}

try {
  globalThis.airingStats = async () => {
    const stored = await bgStorageGet([AIRING_SCHEDULE_KEY]);
    const snap = stored[AIRING_SCHEDULE_KEY] || null;
    const bySlug = snap?.bySlug || {};
    const upcoming = Object.entries(bySlug)
      .filter(([, v]) => Number(v?.airingAt) > 0)
      .sort((a, b) => Number(a[1].airingAt) - Number(b[1].airingAt))
      .slice(0, 15)
      .map(([slug, v]) => ({
        slug,
        episode: v.episode,
        airsIn: `${((Number(v.airingAt) * 1000 - Date.now()) / 3600000).toFixed(1)}h`,
        status: v.mediaStatus,
      }));
    console.log(`airing_schedule: ${Object.keys(bySlug).length} entries, fresh=${airingScheduleIsFresh(snap)}`);
    console.table(upcoming);
    return { total: Object.keys(bySlug).length, fresh: airingScheduleIsFresh(snap), upcoming };
  };
} catch {}
