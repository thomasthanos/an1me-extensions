// anime-resolver.js — popup client for the shared background AnimeResolver.
(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});
  const inFlight = new Map();
  const DEFAULT_TIMEOUT_MS = 45000;

  function normalizeSlug(value) {
    return AT.EpisodeParse?.extractSlugFromInput?.(value) || String(value || "").trim().toLowerCase();
  }

  function createAbortError() {
    const error = new Error("Anime lookup cancelled");
    error.name = "AbortError";
    return error;
  }

  function withAbort(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(createAbortError());
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(createAbortError());
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  async function sendResolveMessage(payload, timeoutMs) {
    const response = await window.AnimeTracker.sendRuntimeRequest(payload, {
      timeoutMs,
      timeoutMessage: `Anime lookup timed out after ${Math.ceil(timeoutMs / 1000)}s`,
    });
    if (!response?.success) throw new Error(response?.error || "Anime lookup failed");
    return response.result;
  }

  function applyResolvedCaches(slug, result) {
    if (result?.info && AT.CachePolicy?.isInfoUsableSnapshot?.(result.info)) {
      AT.AnilistService.cache[slug] = result.info;
    }
    if (result?.episodeTypes) {
      AT.FillerService.episodeTypesCache[slug] = result.episodeTypes;
      if (AT.CachePolicy?.isFillerUsableSnapshot?.(result.episodeTypes)) {
        AT.FillerService.updateFromEpisodeTypes(slug, result.episodeTypes);
      } else {
        delete AT.FillerService.KNOWN_FILLERS[String(slug).toLowerCase()];
      }
    }
    return result;
  }

  function resolve(rawSlug, options = {}) {
    const slug = normalizeSlug(rawSlug);
    if (!slug) return Promise.reject(new Error("Missing slug"));
    const requestOptions = {
      title: options.title || null,
      mediaType: options.mediaType || null,
      mediaTypeUpdatedAt: options.mediaTypeUpdatedAt || null,
      includeEpisodeTypes: options.includeEpisodeTypes !== false,
      forceInfoRefresh: options.forceInfoRefresh === true,
      forceFillerRefresh: options.forceFillerRefresh === true,
    };
    const requestKey = [
      slug,
      requestOptions.includeEpisodeTypes ? "full" : "info",
      requestOptions.forceInfoRefresh ? "force-info" : "cached-info",
      requestOptions.forceFillerRefresh ? "force-filler" : "cached-filler",
      String(requestOptions.title || "").toLowerCase(),
      String(requestOptions.mediaType || "").toUpperCase(),
    ].join("|");

    let request = inFlight.get(requestKey);
    if (!request) {
      request = sendResolveMessage(
        { type: "RESOLVE_ANIME", slug, ...requestOptions },
        Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS),
      ).then((result) => applyResolvedCaches(slug, result));
      inFlight.set(requestKey, request);
      const clear = () => {
        if (inFlight.get(requestKey) === request) inFlight.delete(requestKey);
      };
      request.then(clear, clear);
    }

    return withAbort(request, options.signal);
  }

  AT.AnimeResolver = Object.freeze({ resolve });
})();
