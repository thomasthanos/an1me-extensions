// episode-highlight.js — decorates the watch-page episode list: highlights watched/
// filler episodes, injects badge styles, marks the current episode.
(function () {
  "use strict";

  if (window.self !== window.top) return;

  const AT = window.AnimeTrackerContent;

  // The episode list numbers episodes the way the SITE does - per part, from 1 - while storage and the
  // filler data use one continuous numbering. Convert before comparing, or on Fate/Zero S2 and Bleach
  // TYBW parts 2-3 the badges land on the wrong items: Season 1 watches marked S2 episodes 1-12 as
  // WATCHED while real S2 watches never showed, and filler marks shifted the same way. Unmapped shows
  // pass through unchanged.
  function toStoredListNumber(storedSlug, pageNumber) {
    const mappings = window.AnimeTrackerMultipartMappings;
    const pageSlug = mappings?.pageSlugFromPath?.(location.pathname);
    if (!pageSlug) return pageNumber;
    const stored = mappings.toStoredEpisode(pageSlug, pageNumber);
    return stored.slug === storedSlug ? stored.episode : pageNumber;
  }

  // Delegates to the shared resolver so the watch page groups exactly like the library does; this
  // value is also used as the groupCoverImages key, which the popup reads back. Callers pass
  // `options.isMovie` when the media type is known, because movies resolve through different base
  // rules (one-piece-movie-01 -> one-piece, not one-piece-movie-01).
  function getBaseSlug(slug, options = {}) {
    if (!slug || typeof slug !== "string") return slug || "";
    const Identity = globalThis.AnimeTrackerAnimeIdentity;
    return Identity ? Identity.getBaseSlug(slug, options) : slug;
  }

  let _highlightStorageListener = null;
  function clearHighlightStorageListener() {
    if (_highlightStorageListener) {
      try {
        chrome.storage.onChanged.removeListener(_highlightStorageListener);
      } catch {}
      _highlightStorageListener = null;
    }
  }

  function highlightWatchedEpisodes(slug) {
    const { Logger } = AT;
    clearHighlightStorageListener();
    injectEpisodeBadgeStyles();

    function applyHighlights(watchedSet) {
      const items = document.querySelectorAll(".episode-list-item[data-episode-search-query]");
      let highlighted = 0;
      for (const item of items) {
        const epNum = parseInt(item.getAttribute("data-episode-search-query"), 10);
        if (isNaN(epNum)) continue;
        if (watchedSet.has(toStoredListNumber(slug, epNum))) {
          item.style.opacity = "";
          item.style.color = "";
          if (!item.classList.contains("at-watched-episode")) {
            item.classList.add("at-watched-episode");
            if (!item.querySelector(".at-watched-badge")) {
              const badge = document.createElement("span");
              badge.className = "at-watched-badge";
              badge.textContent = "WATCHED";
              item.appendChild(badge);
            }
          }
          highlighted++;
        } else if (item.classList.contains("at-watched-episode")) {
          item.classList.remove("at-watched-episode");
          item.querySelector(".at-watched-badge")?.remove();
        }
      }
      return highlighted;
    }

    chrome.storage.local.get(["animeData"], (result) => {
      if (chrome.runtime.lastError || !result.animeData) return;
      const anime = result.animeData[slug];
      if (!anime?.episodes?.length) return;

      const watchedSet = new Set(anime.episodes.map((ep) => Number(ep.number)));
      if (watchedSet.size === 0) return;

      const count = applyHighlights(watchedSet);
      if (count > 0) {
        Logger.debug(`Highlighted ${count} watched episodes in episode list`);
      } else {
        const container = document.querySelector(".episode-list-display-box");
        const target = container || document.body;
        let retryDebounce = null;
        const obs = new MutationObserver(() => {
          if (retryDebounce) return;
          retryDebounce = setTimeout(() => {
            retryDebounce = null;
            const retry = applyHighlights(watchedSet);
            if (retry > 0) obs.disconnect();
          }, 150);
        });
        obs.observe(target, { childList: true, subtree: true });
        setTimeout(() => {
          obs.disconnect();
          if (retryDebounce) clearTimeout(retryDebounce);
        }, 10000);
      }
    });

    _highlightStorageListener = (changes) => {
      if (!changes.animeData) return;
      const newData = changes.animeData.newValue || {};
      const anime = newData[slug];
      if (!anime?.episodes?.length) return;
      const watchedSet = new Set(anime.episodes.map((ep) => Number(ep.number)));
      applyHighlights(watchedSet);
    };
    chrome.storage.onChanged.addListener(_highlightStorageListener);
  }

  function injectEpisodeBadgeStyles() {
    if (document.querySelector("#anime-tracker-episode-styles")) return;

    let proxonUrl = "",
      comicSansUrl = "";
    try {
      proxonUrl = chrome.runtime.getURL("src/fonts/PROXON.ttf");
      comicSansUrl = chrome.runtime.getURL("src/fonts/comic_sans.ttf");
    } catch {}

    const style = document.createElement("style");
    style.id = "anime-tracker-episode-styles";
    style.textContent = `
            @font-face { font-family: 'AT-PROXON'; src: url('${proxonUrl}') format('truetype'); font-weight: 400 900; font-display: swap; }
            @font-face { font-family: 'AT-ComicSans'; src: url('${comicSansUrl}') format('truetype'); font-weight: 400 900; font-display: swap; }
            .episode-list-item.at-watched-episode { border: 1px solid rgba(233, 171, 56, 0.22) !important; border-left: 3px solid #e9ab38 !important; border-radius: 4px !important; }
            .episode-list-item.at-watched-episode:not(.current-episode) { opacity: 0.78 !important; background: linear-gradient(90deg, rgba(233, 171, 56, 0.12), transparent 70%) !important; }
            .episode-list-item.at-watched-episode .episode-list-item-title, .episode-list-item.at-watched-episode .episode-list-item-number { color: #e9ab38 !important; }
            .episode-list-item.at-watched-episode .episode-list-item-title { font-family: 'AT-PROXON', inherit !important; letter-spacing: 0.3px !important; }
            .episode-list-item.at-watched-episode .episode-list-item-number { font-family: 'AT-ComicSans', inherit !important; }
            .episode-list-item.at-watched-episode .at-watched-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #1a1a1a; background: linear-gradient(135deg, #f5c66e, #e9ab38); border-radius: 4px; letter-spacing: 0.3px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
            .episode-list-item.at-filler-episode { border: 1px solid rgba(168, 85, 247, 0.22) !important; border-left: 3px solid #a855f7 !important; border-radius: 4px !important; }
            .episode-list-item.at-filler-episode:not(.current-episode) { background: linear-gradient(90deg, rgba(168, 85, 247, 0.12), transparent 70%) !important; }
            .episode-list-item.at-filler-episode .at-filler-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #fff; background: linear-gradient(135deg, #c084fc, #a855f7); border-radius: 4px; letter-spacing: 0.3px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
            .episode-list-item.at-watched-episode.at-filler-episode { border-left-color: #a855f7 !important; }
            .episode-head .episode-list-display-box .episode-list-item.current-episode, .episode-list-item.current-episode { color: inherit !important; }
            .episode-head .episode-list-display-box .episode-list-item.current-episode::after, .episode-list-item.current-episode::after,
            .episode-head .episode-list-display-box .episode-list-item.current-episode::before, .episode-list-item.current-episode::before { content: none !important; display: none !important; background-color: transparent !important; border: 0 !important; width: 0 !important; height: 0 !important; }
            .episode-list-item.current-episode { border: 1px solid rgba(79, 195, 247, 0.38) !important; border-left: 3px solid #4fc3f7 !important; border-radius: 4px !important; background: linear-gradient(90deg, rgba(79, 195, 247, 0.22), rgba(79, 195, 247, 0.05) 70%) !important; box-shadow: 0 0 0 1px rgba(79, 195, 247, 0.18), 0 2px 12px rgba(79, 195, 247, 0.15) !important; position: relative !important; }
            .episode-list-item.current-episode .episode-list-item-title { color: #e8f6ff !important; font-family: 'AT-PROXON', inherit !important; letter-spacing: 0.3px !important; font-weight: 600 !important; }
            .episode-list-item.current-episode .episode-list-item-number { color: #4fc3f7 !important; font-family: 'AT-ComicSans', inherit !important; font-weight: 700 !important; }
            .episode-list-item.current-episode .at-current-badge { display: inline-block; margin-left: 6px; padding: 1px 7px; font-size: 10px; font-weight: 700; line-height: 1.2; color: #0e1117; background: linear-gradient(135deg, #7dd3fc, #4fc3f7); border-radius: 4px; letter-spacing: 0.5px; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(79, 195, 247, 0.45); text-transform: uppercase; animation: at-current-pulse 2.2s ease-in-out infinite; }
            @keyframes at-current-pulse { 0%, 100% { box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(79, 195, 247, 0.45); } 50% { box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 14px rgba(79, 195, 247, 0.75); } }
            .episode-list-item.current-episode.at-watched-episode, .episode-list-item.current-episode.at-filler-episode { border-left-color: #4fc3f7 !important; opacity: 1 !important; }
            @media (prefers-reduced-motion: reduce) {
                .episode-list-item.current-episode .at-current-badge { animation: none !important; }
            }
        `;
    (document.head || document.documentElement).appendChild(style);
    decorateCurrentEpisode();
  }

  let _currentEpisodeObserver = null;
  let _currentEpisodeObserverTimeout = null;
  function decorateCurrentEpisode() {
    const apply = () => {
      document.querySelectorAll(".at-current-badge").forEach((badge) => {
        const item = badge.closest(".episode-list-item");
        if (!item || !item.classList.contains("current-episode")) badge.remove();
      });
      const items = document.querySelectorAll(".episode-list-item.current-episode");
      items.forEach((item) => {
        if (item.querySelector(".at-current-badge")) return;
        const badge = document.createElement("span");
        badge.className = "at-current-badge";
        badge.textContent = "NOW";
        item.appendChild(badge);
      });
    };
    apply();

    if (_currentEpisodeObserver) {
      try {
        _currentEpisodeObserver.disconnect();
      } catch {}
      _currentEpisodeObserver = null;
    }
    if (_currentEpisodeObserverTimeout) {
      clearTimeout(_currentEpisodeObserverTimeout);
      _currentEpisodeObserverTimeout = null;
    }

    const target = document.querySelector(".episode-list-display-box") || document.querySelector(".episode-head") || document.body;
    let _applyDebounce = null;
    _currentEpisodeObserver = new MutationObserver(() => {
      if (_applyDebounce) return;
      _applyDebounce = setTimeout(() => {
        _applyDebounce = null;
        apply();
      }, 150);
    });
    _currentEpisodeObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    _currentEpisodeObserverTimeout = setTimeout(() => {
      try {
        _currentEpisodeObserver?.disconnect();
      } catch {}
      _currentEpisodeObserver = null;
      _currentEpisodeObserverTimeout = null;
    }, 60000);
  }

  function highlightFillerEpisodes(slug, title) {
    const { Logger } = AT;
    if (!slug) return;

    try {
      chrome.runtime.sendMessage({ type: "GET_FILLER_EPISODES", animeSlug: slug, animeTitle: title || null }, (response) => {
        if (chrome.runtime.lastError || !response?.fillers) return;
        const fillerSet = new Set(response.fillers.map(Number).filter((n) => Number.isFinite(n)));
        if (fillerSet.size === 0) return;

        injectEpisodeBadgeStyles();

        const applyFiller = () => {
          const items = document.querySelectorAll(".episode-list-item[data-episode-search-query]");
          let tagged = 0;
          for (const item of items) {
            const epNum = parseInt(item.getAttribute("data-episode-search-query"), 10);
            if (!Number.isFinite(epNum)) continue;
            const isFiller = fillerSet.has(toStoredListNumber(slug, epNum));
            if (isFiller && !item.classList.contains("at-filler-episode")) {
              item.classList.add("at-filler-episode");
              if (!item.querySelector(".at-filler-badge")) {
                const badge = document.createElement("span");
                badge.className = "at-filler-badge";
                badge.textContent = "FILLER";
                item.appendChild(badge);
              }
              tagged++;
            } else if (!isFiller && item.classList.contains("at-filler-episode")) {
              item.classList.remove("at-filler-episode");
              item.querySelector(".at-filler-badge")?.remove();
            }
          }
          return tagged;
        };

        if (applyFiller() === 0) {
          const target = document.querySelector(".episode-list-display-box") || document.body;
          let fillerRetryDebounce = null;
          const obs = new MutationObserver(() => {
            if (fillerRetryDebounce) return;
            fillerRetryDebounce = setTimeout(() => {
              fillerRetryDebounce = null;
              if (applyFiller() > 0) obs.disconnect();
            }, 150);
          });
          obs.observe(target, { childList: true, subtree: true });
          setTimeout(() => {
            obs.disconnect();
            if (fillerRetryDebounce) clearTimeout(fillerRetryDebounce);
          }, 10000);
        } else {
          Logger.debug(`Tagged filler episodes for ${slug}`);
        }
      });
    } catch (e) {
      Logger.debug("Filler coloring failed:", e.message);
    }
  }

  function detectPageMaxEpisode(animeSlug, currentEpisodeNumber) {
    let pageMax = 0;
    try {
      const escaped = String(animeSlug || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!escaped) return Number(currentEpisodeNumber) || 0;
      const hrefPattern = new RegExp(`/watch/${escaped}-episode-(\\d+)`, "i");

      const grid = document.querySelector("#episodeGrid");
      if (grid) {
        const items = grid.querySelectorAll('a[data-search], a[href*="-episode-"]');
        for (const a of items) {
          // data-search is the site's per-part number; convert it so it is comparable with the stored
          // current episode it is max()ed against below. On a Bleach TYBW part-2 page the raw grid max
          // (13) otherwise lost to - or under-reported - the real stored latest episode (26).
          const ds = toStoredListNumber(animeSlug, parseInt(a.getAttribute("data-search") || "", 10));
          if (Number.isFinite(ds) && ds > pageMax) pageMax = ds;
          const m = (a.getAttribute("href") || "").match(hrefPattern);
          if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > pageMax) pageMax = n;
          }
        }
      }

      const cssSlug = animeSlug.replace(/["\\]/g, "\\$&");
      const allLinks = document.querySelectorAll(`a[href*="${cssSlug}-episode-"]`);
      for (const a of allLinks) {
        const m = (a.getAttribute("href") || "").match(hrefPattern);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (!Number.isFinite(n) || n <= 0 || n > 9999) continue;
        if (n > pageMax) pageMax = n;
      }
    } catch {}

    const cur = Number(currentEpisodeNumber) || 0;
    if (cur > pageMax) pageMax = cur;
    return pageMax;
  }

  async function bumpLatestEpisodeFromPage(info) {
    if (!info?.animeSlug) return;
    try {
      const pageMax = detectPageMaxEpisode(info.animeSlug, info.episodeNumber);
      const scheduleAtMs = info.nextEpisodeAt ? new Date(info.nextEpisodeAt).getTime() : NaN;
      const nextEpisodeAt = Number.isFinite(scheduleAtMs) && scheduleAtMs > Date.now() ? info.nextEpisodeAt : null;
      if (!(pageMax > 0) && !nextEpisodeAt) return;

      const key = `animeinfo_${info.animeSlug}`;
      const result = await AT.Storage.get([key]);
      if (AT.Storage.isAbortResult(result)) return;
      const cached = (result && result[key]) || null;
      const cachedLatest = Number(cached?.latestEpisode) || 0;
      const wantsEpisodeBump = pageMax > cachedLatest;
      const wantsScheduleWrite = !!nextEpisodeAt && cached?.nextEpisodeAt !== nextEpisodeAt;
      if (!wantsEpisodeBump && !wantsScheduleWrite) return;
      const latestRead = await AT.Storage.get([key]);
      if (AT.Storage.isAbortResult(latestRead)) return;
      const base = (latestRead && latestRead[key]) || cached || {};

      const payload = { ...base };
      let changed = false;
      if (pageMax > 0 && pageMax > (Number(base.latestEpisode) || 0)) {
        payload.latestEpisode = pageMax;
        changed = true;
      }
      if (nextEpisodeAt && base.nextEpisodeAt !== nextEpisodeAt) {
        payload.nextEpisodeAt = nextEpisodeAt;
        if (info.nextEpisodeTimezone) payload.nextEpisodeTimezone = info.nextEpisodeTimezone;
        changed = true;
      }
      if (!changed) return;

      await AT.Storage.set({ [key]: payload });
      AT.Logger?.debug?.(`Updated ${key} from page`, { latestEpisode: payload.latestEpisode, nextEpisodeAt: payload.nextEpisodeAt });
    } catch (e) {
      AT.Logger?.warn?.("bumpLatestEpisodeFromPage failed:", e?.message || e);
    }
  }

  window.AnimeTrackerContent = window.AnimeTrackerContent || {};
  window.AnimeTrackerContent.EpisodeHighlight = {
    getBaseSlug,
    clearHighlightStorageListener,
    highlightWatchedEpisodes,
    injectEpisodeBadgeStyles,
    decorateCurrentEpisode,
    highlightFillerEpisodes,
    detectPageMaxEpisode,
    bumpLatestEpisodeFromPage,
  };
})();
