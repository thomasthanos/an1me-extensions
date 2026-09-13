// storage.js — popup storage read/write; also hosts SlugUtils (slug cleanup/canonicalization).
// Thin wrapper over the shared resolver in src/common/data/anime-identity.js. The rules used to be
// copied here and in the content parser; keeping them in one place is what stops the popup and the
// watch page from disagreeing about which slug an episode belongs to.
const SlugUtils = {
  getCanonicalSlug(slug, title = "") {
    const Identity = globalThis.AnimeTrackerAnimeIdentity;
    return Identity ? Identity.getCanonicalSlug(slug, title) : slug;
  },

  getCanonicalTitle(slug, title = "") {
    const Identity = globalThis.AnimeTrackerAnimeIdentity;
    return Identity ? Identity.getCanonicalTitle(slug, title) : String(title || "").trim();
  },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.SlugUtils = SlugUtils;

const _multipartMaps = (typeof window !== "undefined" && window.AnimeTrackerMultipartMappings) || {};
const STORAGE_SLUG_NORMALIZATION = _multipartMaps.SLUG_NORMALIZATION || {};
const STORAGE_EPISODE_OFFSET_MAPPING = _multipartMaps.EPISODE_OFFSET_MAPPING || {};

const LEGACY_SYNC_KEYS = new Set(["animeData", "trackedEpisodes", "videoProgress"]);
const LEGACY_SYNC_MIGRATION_KEY = "legacySyncMigrationV1Complete";
const POPUP_LIBRARY_MUTATION_KEYS = new Set([
  "animeData",
  "videoProgress",
  "deletedAnime",
  "groupCoverImages",
  "anilist_media_map",
  "anilist_pushed",
  "anilist_push_schema",
  "fillerStaySelections",
  "goalSettings",
  "badgeUnlocks",
  "badgeEvaluationBaselineV1",
  "badgeNotificationBaselineV1",
  "anilist_auth",
  "anilist_username",
  "copyGuardEnabled",
  "smartNotificationsEnabled",
  "autoSkipFillers",
  "skiptimeHelperEnabled",
  "auto4kServerEnabled",
  "playbackSettingsUpdatedAt",
]);
const POPUP_LIBRARY_REQUEST_TIMEOUT_MS = 20000;
let legacySyncMigrationPromise = null;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeStorageKeys(keys) {
  if (Array.isArray(keys)) return keys;
  if (typeof keys === "string") return [keys];
  if (keys && typeof keys === "object") return Object.keys(keys);
  return [];
}

function pickStorageKeys(source, keys) {
  const picked = {};
  for (const key of keys) {
    if (hasOwn(source, key)) picked[key] = source[key];
  }
  return picked;
}

function localGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const errorMessage = chrome.runtime.lastError?.message;
      if (errorMessage) {
        reject(new Error(`Local storage read failed: ${errorMessage}`));
        return;
      }
      resolve(result || {});
    });
  });
}

function sendLibraryCoordinatorRequest(message) {
  return window.AnimeTracker.sendRuntimeRequest(message, {
    timeoutMs: POPUP_LIBRARY_REQUEST_TIMEOUT_MS,
    timeoutMessage: "Library mutation coordinator timed out",
  });
}

async function coordinatedLibraryWrite(data) {
  const response = await sendLibraryCoordinatorRequest({ type: "LIBRARY_MUTATION_WRITE", data });
  if (!response?.success) throw new Error(response?.error || "Library mutation write failed");
  return response;
}

async function ensureLegacySyncMigration(initialLocal) {
  if (initialLocal?.[LEGACY_SYNC_MIGRATION_KEY] === true) return;
  if (legacySyncMigrationPromise) return legacySyncMigrationPromise;

  legacySyncMigrationPromise = (async () => {
    const response = await sendLibraryCoordinatorRequest({ type: "LIBRARY_ENSURE_LEGACY_MIGRATION" });
    if (!response?.success) throw new Error(response?.error || "Legacy storage migration failed");
  })().finally(() => {
    legacySyncMigrationPromise = null;
  });

  return legacySyncMigrationPromise;
}

function decodeHtmlEntities(value) {
  if (typeof value !== "string" || !value.includes("&")) return value;

  const textarea = document.createElement("textarea");
  let decoded = value;

  for (let i = 0; i < 3; i += 1) {
    textarea.innerHTML = decoded;
    const next = textarea.value;
    if (next === decoded) break;
    decoded = next;
  }

  return decoded;
}

const Storage = {
  LEGACY_SYNC_KEYS,
  LEGACY_SYNC_MIGRATION_KEY,

  async get(keys) {
    const requestedKeys = normalizeStorageKeys(keys);
    if (requestedKeys.length === 0) return {};

    const needsLegacyMigration = requestedKeys.some((key) => LEGACY_SYNC_KEYS.has(key));
    const readKeys = needsLegacyMigration
      ? [...new Set([...requestedKeys, LEGACY_SYNC_MIGRATION_KEY, ...LEGACY_SYNC_KEYS])]
      : requestedKeys;
    const localResult = await localGet(readKeys);

    if (!needsLegacyMigration || localResult[LEGACY_SYNC_MIGRATION_KEY] === true) {
      return pickStorageKeys(localResult, requestedKeys);
    }

    await ensureLegacySyncMigration(localResult);
    return pickStorageKeys(await localGet(requestedKeys), requestedKeys);
  },

  async set(data) {
    const writesLegacyData = Object.keys(data || {}).some((key) => LEGACY_SYNC_KEYS.has(key));
    const writesLibraryData = Object.keys(data || {}).some((key) => POPUP_LIBRARY_MUTATION_KEYS.has(key));
    if (writesLibraryData) return coordinatedLibraryWrite(data);
    if (writesLegacyData) {
      const migrationState = await localGet([LEGACY_SYNC_MIGRATION_KEY]);
      await ensureLegacySyncMigration(migrationState);
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || "";
          if (
            msg.includes("QUOTA") ||
            msg.includes("quota") ||
            msg.includes("exceeded") ||
            msg.includes("storage capacity") ||
            msg.includes("MAX_ITEMS") ||
            msg.includes("MAX_WRITE_OPERATIONS")
          ) {
            (window.PopupLogger || console).error?.("Storage", "⚠ Quota exceeded! Consider clearing old data.", msg);
          }
          reject(new Error(msg));
        } else {
          resolve();
        }
      });
    });
  },

  async remove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  },

  async invalidateCachedStats(currentVersion) {
    return new Promise((resolve) => {
      chrome.storage.local.get(["cachedStatsVersion"], (result) => {
        const storedVersion = result.cachedStatsVersion || "";
        if (storedVersion !== currentVersion) {
          chrome.storage.local.remove(["cachedStats", "cachedStatsVersion"], () => {
            chrome.storage.local.set({ cachedStatsVersion: currentVersion }, () => {
              resolve(true);
            });
          });
        } else {
          resolve(false);
        }
      });
    });
  },

  async migrateMultiPartAnime() {
    const LOCK_KEY = "_migrationLock";
    const LOCK_MAX_AGE = 30000;
    const myToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const lockResult = await new Promise((r) => chrome.storage.local.get([LOCK_KEY], r));
      const existing = lockResult[LOCK_KEY];
      const existingTime = typeof existing === "object" ? existing?.time : existing;
      if (existingTime && Date.now() - existingTime < LOCK_MAX_AGE) {
        (window.PopupLogger || console).log?.("Storage", "Migration already in progress, skipping");
        return false;
      }
      await new Promise((r) => chrome.storage.local.set({ [LOCK_KEY]: { time: Date.now(), token: myToken } }, r));
      await new Promise((r) => setTimeout(r, 50));
      const verify = await new Promise((r) => chrome.storage.local.get([LOCK_KEY], r));
      if (verify[LOCK_KEY]?.token !== myToken) {
        (window.PopupLogger || console).log?.("Storage", "Migration lock contended, deferring");
        return false;
      }
    } catch {}

    const releaseLock = () => {
      try {
        chrome.storage.local.remove([LOCK_KEY]);
      } catch {}
    };

    try {
      const coordinator = window.AnimeTracker?.LibraryMutations;
      if (!coordinator?.enqueue) throw new Error("Library mutation coordinator unavailable");
      return await coordinator.enqueue("multipart-migration", async ({ commit, snapshot }) => {
        const result = snapshot;
        if (!result.animeData) return false;

        const animeData = result.animeData || {};
        const videoProgress = result.videoProgress || {};
        const deletedAnime = result.deletedAnime || {};
        let migrated = false;

        const mergeByNewer = (current, candidate) => {
          if (!current) return candidate;
          if (!candidate) return current;
          // Use the shared rule. This copy compared position and time but ignored tombstones, so while
          // folding a split multi-part show together a fresh "deleted" marker lost to an older active
          // entry and the deleted progress came back. The fallback below is only for a page that has
          // not loaded merge-utils yet.
          const shared = window.AnimeTracker?.MergeUtils?.selectProgressEntry;
          if (typeof shared === "function") return shared(current, candidate);

          const currentTime = new Date(current.savedAt || current.deletedAt || 0).getTime();
          const candidateTime = new Date(candidate.savedAt || candidate.deletedAt || 0).getTime();
          const currentProgress = typeof current.currentTime === "number" ? current.currentTime : 0;
          const candidateProgress = typeof candidate.currentTime === "number" ? candidate.currentTime : 0;

          if (candidateProgress > currentProgress) return candidate;
          if (candidateProgress < currentProgress) return current;
          return candidateTime >= currentTime ? candidate : current;
        };

        const getCanonicalSlugFromTitle = (slug, title) => window.AnimeTracker.SlugUtils.getCanonicalSlug(slug, title);
        const getCanonicalTitle = (slug, title) => window.AnimeTracker.SlugUtils.getCanonicalTitle(slug, title);

        const normalizeStoredTitle = (title) => {
          if (typeof title !== "string") return title;

          const TITLE_CLEANUP_RE = /(?:\s*[-–—]\s*Episode\s*\d*.*|\s+Episode)\s*$/i;
          return decodeHtmlEntities(title).replace(TITLE_CLEANUP_RE, "").trim();
        };

        const migrateSlug = (oldSlug, newSlug, offset = 0, titleTransform = null) => {
          if (!animeData[oldSlug] || oldSlug === newSlug) return;
          const mergeMigratedEntry = window.AnimeTrackerMergeUtils?.mergeMigratedEntry;
          if (!mergeMigratedEntry) return;

          (window.PopupLogger || console).log?.("Storage", `Migrating ${oldSlug} -> ${newSlug}`);
          migrated = true;

          const oldEntry = animeData[oldSlug];
          const migratedTitle = normalizeStoredTitle(
            getCanonicalTitle(newSlug, (titleTransform ? titleTransform(oldEntry.title || "") : oldEntry.title) || "") || "",
          );
          animeData[newSlug] = mergeMigratedEntry(newSlug, animeData[newSlug], oldEntry, {
            episodeOffset: offset,
            title: migratedTitle || newSlug,
          });

          const oldPrefix = `${oldSlug}__episode-`;
          const progressKeys = Object.keys(videoProgress).filter((key) => key.startsWith(oldPrefix));
          for (const key of progressKeys) {
            const match = key.match(/__episode-(\d+)$/i);
            if (!match) {
              delete videoProgress[key];
              continue;
            }

            const oldEpisodeNum = parseInt(match[1], 10);
            const newEpisodeNum = oldEpisodeNum + offset;
            const newKey = `${newSlug}__episode-${newEpisodeNum}`;
            const migratedProgress = { ...videoProgress[key] };

            videoProgress[newKey] = mergeByNewer(videoProgress[newKey], migratedProgress);
            if (newKey !== key) delete videoProgress[key];
          }

          if (deletedAnime[oldSlug]) {
            const oldDeleted = deletedAnime[oldSlug];
            const currentDeleted = deletedAnime[newSlug];
            const oldDeletedTs = oldDeleted?.deletedAt ? new Date(oldDeleted.deletedAt).getTime() : 0;
            const currentDeletedTs = currentDeleted?.deletedAt ? new Date(currentDeleted.deletedAt).getTime() : 0;
            if (!currentDeleted || oldDeletedTs > currentDeletedTs) {
              deletedAnime[newSlug] = oldDeleted;
            }
            delete deletedAnime[oldSlug];
          }

          delete animeData[oldSlug];
        };

        for (const [oldSlug, newSlug] of Object.entries(STORAGE_SLUG_NORMALIZATION)) {
          const offset = STORAGE_EPISODE_OFFSET_MAPPING[oldSlug] || 0;
          migrateSlug(oldSlug, newSlug, offset, (title) => title.replace(/ Ketsubetsu[ -]tan| Soukoku[ -]tan/gi, "").trim());
        }

        for (const oldSlug of Object.keys(animeData)) {
          const cleanedSlug = oldSlug.replace(/-(?:episodes?|ep)$/i, "").replace(/-+$/g, "");
          if (cleanedSlug && cleanedSlug !== oldSlug) {
            migrateSlug(oldSlug, cleanedSlug, 0, (title) => (title || "").replace(/\s+Episode$/i, "").trim());
          }
        }

        for (const oldSlug of Object.keys(animeData)) {
          const oldEntry = animeData[oldSlug];
          const canonicalSlug = getCanonicalSlugFromTitle(oldSlug, normalizeStoredTitle(oldEntry?.title || ""));
          if (canonicalSlug && canonicalSlug !== oldSlug) {
            migrateSlug(oldSlug, canonicalSlug, 0, (title) => title);
          }
        }

        for (const [slug, entry] of Object.entries(animeData)) {
          if (!entry?.title) continue;
          const cleaned = normalizeStoredTitle(getCanonicalTitle(slug, entry.title));
          if (cleaned && cleaned !== entry.title) {
            entry.title = cleaned;
            migrated = true;
          }
        }

        if (!migrated) return false;
        await commit({ animeData, videoProgress, deletedAnime }, { immediate: false });
        (window.PopupLogger || console).log?.("Storage", "Anime slug migration complete");
        return true;
      });
    } catch (error) {
      (window.PopupLogger || console).error?.("Storage", "Anime slug migration write failed:", error);
      return false;
    } finally {
      releaseLock();
    }
  },

  // One-off repair for group cover keys written by older watch-page code, whose base-slug rule
  // diverged from the library's: covers landed under keys the popup never reads (e.g.
  // "one-piece-movie-01" or "fate-zero" instead of "one-piece" / "fate"). This copies them onto
  // the canonical key and is deliberately additive - the stale key is left in place, so a wrong
  // guess can never lose a cover.
  async repairGroupCoverKeys() {
    const SeasonGrouping = window.AnimeTracker?.SeasonGrouping;
    const coordinator = window.AnimeTracker?.LibraryMutations;
    if (!SeasonGrouping?.getBaseSlug || !coordinator?.enqueue) return { copied: 0 };

    try {
      return await coordinator.enqueue("group-cover-key-repair", async ({ commit, snapshot }) => {
        const animeData = snapshot.animeData || {};
        const covers = snapshot.groupCoverImages || {};
        const next = { ...covers };
        let copied = 0;

        for (const [key, url] of Object.entries(covers)) {
          // Only keys that are themselves library slugs can be re-resolved; anything else is left
          // untouched because we cannot know which group it was meant for.
          const entry = animeData[key];
          if (!entry || typeof url !== "string" || !url) continue;
          const canonical = SeasonGrouping.getBaseSlug(key, entry);
          if (!canonical || canonical === key || next[canonical]) continue;
          next[canonical] = url;
          copied++;
        }

        if (copied === 0) return { copied: 0 };
        await commit({ groupCoverImages: next }, { immediate: false });
        (window.PopupLogger || console).log?.("Storage", `Group cover keys repaired: ${copied}`);
        return { copied };
      });
    } catch (error) {
      (window.PopupLogger || console).error?.("Storage", "Group cover key repair failed:", error);
      return { copied: 0 };
    }
  },
};

window.AnimeTracker = window.AnimeTracker || {};
window.AnimeTracker.Storage = Storage;
