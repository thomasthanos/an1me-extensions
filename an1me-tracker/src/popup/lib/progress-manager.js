// progress-manager.js — progress management: canonical slugs, dedupe episodes, cleanup.
const ProgressManager = {
  getCanonicalSlug(slug, title = "") {
    return window.AnimeTracker.SlugUtils.getCanonicalSlug(slug, title);
  },

  getCanonicalTitle(slug, title = "") {
    return window.AnimeTracker.SlugUtils.getCanonicalTitle(slug, title);
  },

  normalizeCanonicalSlugs(animeData, videoProgress = {}, deletedAnime = {}) {
    const normalizedAnime = { ...(animeData || {}) };
    const normalizedProgress = { ...(videoProgress || {}) };
    const normalizedDeleted = { ...(deletedAnime || {}) };
    const canonicalEpisodeOffsets = window.AnimeTracker?.CANONICAL_EPISODE_OFFSET_MAPPING || {};
    let changed = false;

    const pickNewerProgress = (current, candidate) => {
      if (!current) return candidate;
      if (!candidate) return current;
      const currentTime = Number(current.currentTime) || 0;
      const candidateTime = Number(candidate.currentTime) || 0;
      if (candidateTime > currentTime) return candidate;
      if (candidateTime < currentTime) return current;
      const currentSaved = new Date(current.savedAt || current.deletedAt || 0).getTime();
      const candidateSaved = new Date(candidate.savedAt || candidate.deletedAt || 0).getTime();
      return candidateSaved >= currentSaved ? candidate : current;
    };

    const pickNewerDeleted = (current, candidate) => {
      if (!current) return candidate;
      if (!candidate) return current;
      const currentDeleted = new Date(current.deletedAt || 0).getTime();
      const candidateDeleted = new Date(candidate.deletedAt || 0).getTime();
      return candidateDeleted >= currentDeleted ? candidate : current;
    };

    for (const oldSlug of Object.keys(normalizedAnime)) {
      const oldAnime = normalizedAnime[oldSlug];
      const canonicalSlug = this.getCanonicalSlug(oldSlug, oldAnime?.title || "");
      if (!canonicalSlug || canonicalSlug === oldSlug) continue;
      const episodeOffset = Number(canonicalEpisodeOffsets[oldSlug]) || 0;

      const mergeMigratedEntry = window.AnimeTrackerMergeUtils?.mergeMigratedEntry;
      if (!mergeMigratedEntry) continue;
      changed = true;
      const target = mergeMigratedEntry(canonicalSlug, normalizedAnime[canonicalSlug], oldAnime, {
        episodeOffset,
        title: this.getCanonicalTitle(canonicalSlug, oldAnime?.title || canonicalSlug),
      });
      normalizedAnime[canonicalSlug] = target;

      const oldPrefix = `${oldSlug}__episode-`;
      for (const key of Object.keys(normalizedProgress)) {
        if (!key.startsWith(oldPrefix)) continue;
        const match = key.match(/__episode-(\d+)$/i);
        if (!match) {
          delete normalizedProgress[key];
          continue;
        }
        const epNum = parseInt(match[1], 10) + episodeOffset;
        const newKey = `${canonicalSlug}__episode-${epNum}`;
        normalizedProgress[newKey] = pickNewerProgress(normalizedProgress[newKey], normalizedProgress[key]);
        if (newKey !== key) delete normalizedProgress[key];
      }

      if (normalizedDeleted[oldSlug]) {
        normalizedDeleted[canonicalSlug] = pickNewerDeleted(normalizedDeleted[canonicalSlug], normalizedDeleted[oldSlug]);
        delete normalizedDeleted[oldSlug];
      }

      delete normalizedAnime[oldSlug];
    }

    return {
      animeData: normalizedAnime,
      videoProgress: normalizedProgress,
      deletedAnime: normalizedDeleted,
      changed,
    };
  },

  removeDuplicateEpisodes(animeData) {
    const log = (window.PopupLogger && window.PopupLogger.warn) || console.warn;
    if (!animeData || typeof animeData !== "object") {
      log("Cleanup", "Invalid animeData provided");
      return {};
    }

    const cleaned = { ...animeData };

    for (const [slug, anime] of Object.entries(cleaned)) {
      if (!anime || typeof anime !== "object") {
        log("Cleanup", "Invalid anime entry:", slug);
        delete cleaned[slug];
        continue;
      }

      // Every change below builds a NEW entry object instead of editing the input in place. The input
      // entries are the same objects the maintenance pipeline later counts as its "before" baseline,
      // so in-place edits made the removal invisible to change detection: duplicate episodes were
      // cleaned in memory on every load and never persisted or synced.
      if (!anime.episodes) {
        cleaned[slug] = { ...anime, episodes: [], totalWatchTime: 0 };
        continue;
      }

      if (!Array.isArray(anime.episodes)) {
        log("Cleanup", "Episodes is not an array for:", slug);
        cleaned[slug] = { ...anime, episodes: [], totalWatchTime: 0 };
        continue;
      }

      const episodeMap = new Map();
      anime.episodes.forEach((ep) => {
        if (ep && typeof ep === "object" && typeof ep.number === "number" && !isNaN(ep.number)) {
          if (!episodeMap.has(ep.number)) {
            episodeMap.set(ep.number, ep);
          }
        }
      });

      const episodes = Array.from(episodeMap.values()).sort((a, b) => a.number - b.number);
      const totalWatchTime = episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);
      const sameEpisodes = episodes.length === anime.episodes.length && episodes.every((ep, i) => ep === anime.episodes[i]);
      if (!sameEpisodes || anime.totalWatchTime !== totalWatchTime) {
        cleaned[slug] = { ...anime, episodes, totalWatchTime };
      }
    }

    return cleaned;
  },

  removeAutoRepairedEpisodes(animeData) {
    if (!animeData || typeof animeData !== "object") {
      return { cleanedData: {}, removedCount: 0 };
    }

    const cleanedData = { ...animeData };
    let removedCount = 0;

    for (const [slug, anime] of Object.entries(cleanedData)) {
      if (!anime || !Array.isArray(anime.episodes)) continue;

      const originalEpisodes = anime.episodes;
      const filteredEpisodes = originalEpisodes.filter((ep) => !ep?.autoRepaired);

      if (filteredEpisodes.length === originalEpisodes.length) continue;

      removedCount += originalEpisodes.length - filteredEpisodes.length;
      anime.episodes = filteredEpisodes.sort((a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0));
      anime.totalWatchTime = anime.episodes.reduce((sum, ep) => sum + (Number(ep?.duration) || 0), 0);

      const latestWatchedAt = anime.episodes.reduce((latest, ep) => {
        const ts = new Date(ep?.watchedAt || 0).getTime();
        return ts > latest ? ts : latest;
      }, 0);
      // Recompute from the remaining episodes, but never blank an existing lastWatched —
      // it may also record legit non-episode activity (manual add, state change).
      if (latestWatchedAt > 0) anime.lastWatched = new Date(latestWatchedAt).toISOString();
    }

    return { cleanedData, removedCount };
  },

  // The keep/remove rules live in merge-utils (cleanTrackedProgress), shared with the background sync.
  // The two used to be separate copies that disagreed about movies and dropped shows, so each context
  // undid the other's cleanup on every sync.
  cleanTrackedProgress(animeData, videoProgress, deletedAnime = {}) {
    const { CONFIG, SeasonGrouping, MergeUtils } = window.AnimeTracker;
    if (!videoProgress || Object.keys(videoProgress).length === 0) {
      return { cleaned: videoProgress, removedCount: 0 };
    }
    return MergeUtils.cleanTrackedProgress(animeData || {}, videoProgress, deletedAnime, {
      isMovie: (slug, entry) => !!SeasonGrouping?.isMovie?.(slug, entry),
      completedPercentage: CONFIG.COMPLETED_PERCENTAGE,
      tombstoneKeepMs: 7 * 24 * 60 * 60 * 1000,
      // Same cap as the background sync and the content script.
      maxEntries: 200,
    });
  },

  getInProgressAnime(animeData, videoProgress) {
    const inProgressMap = new Map();
    const completedPercentage = window.AnimeTracker?.CONFIG?.COMPLETED_PERCENTAGE || 85;
    const trackedEpsBySlug = new Map();

    for (const [id, progress] of Object.entries(videoProgress)) {
      const slugMatch = id.match(/^(.+)__episode-(\d+)$/);
      if (!slugMatch) continue;

      const animeSlug = slugMatch[1];
      const episodeNum = parseInt(slugMatch[2], 10);

      if (isNaN(episodeNum) || episodeNum <= 0) continue;
      if (!progress || progress.deleted) continue;
      if ((Number(progress.percentage) || 0) >= completedPercentage) continue;

      const trackedAnime = animeData?.[animeSlug];

      const listState =
        globalThis.AnimeTrackerEntryState?.getResolvedListState?.(trackedAnime) || String(trackedAnime?.listState || "").toLowerCase();
      if (["completed", "dropped", "on_hold"].includes(listState)) continue;
      let trackedEpisodeNumbers = trackedEpsBySlug.get(animeSlug);
      if (!trackedEpisodeNumbers) {
        trackedEpisodeNumbers = new Set(
          listState !== "on_hold" && Array.isArray(trackedAnime?.episodes)
            ? trackedAnime.episodes

                .filter((ep) => ep?.durationSource !== "anilist")
                .map((ep) => Number(ep?.number))
                .filter((n) => Number.isFinite(n) && n > 0)
            : [],
        );
        trackedEpsBySlug.set(animeSlug, trackedEpisodeNumbers);
      }

      if (trackedEpisodeNumbers.has(episodeNum)) continue;
      let existing = inProgressMap.get(animeSlug);
      if (!existing) {
        const hasTrackedEpisodes = Array.isArray(trackedAnime?.episodes) && trackedAnime.episodes.length > 0;
        existing = {
          slug: animeSlug,
          title: trackedAnime?.title || animeSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          episodes: [],
          lastProgress: progress.savedAt || new Date(0).toISOString(),
          coverImage: progress.coverImage || trackedAnime?.coverImage || null,
          isTracked: !!trackedAnime,
          hasTrackedEpisodes,
          isResumeOnly: !hasTrackedEpisodes,
        };
        inProgressMap.set(animeSlug, existing);
      }

      existing.episodes.push({
        number: episodeNum,
        currentTime: progress.currentTime,
        duration: progress.duration,
        percentage: progress.percentage,
        savedAt: progress.savedAt,
        watchedAt: progress.watchedAt || progress.savedAt,
        pagePath: progress.pagePath || null,
      });

      if (progress.savedAt && progress.savedAt > existing.lastProgress) {
        existing.lastProgress = progress.savedAt;
      }

      if (progress.coverImage && !existing.coverImage) {
        existing.coverImage = progress.coverImage;
      }
    }

    return Array.from(inProgressMap.values());
  },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.ProgressManager = ProgressManager;
