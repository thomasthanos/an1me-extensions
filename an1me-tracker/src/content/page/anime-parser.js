// anime-parser.js — extracts anime info (slug, title, episode number) from the URL and page.
const AnimeParser = {
  parseTimeToSeconds(text) {
    if (!text || typeof text !== "string") return 0;
    const parts = text.trim().split(":").map(Number);
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  },

  extractAnimeInfo(options = {}) {
    const { Logger } = window.AnimeTrackerContent;

    try {
      const pathname = window.location.pathname;

      const pathMatch = pathname.match(/\/watch\/([^/]+)(?:\/([^/]+))?/);

      if (!pathMatch) {
        return null;
      }

      const rawPathSlug = pathMatch[1];
      let animeSlug = rawPathSlug;
      animeSlug = animeSlug.replace(/[-_](?:episodes?|ep)$/i, "").replace(/[-_]+$/g, "");
      let episodeSlug = pathMatch[2] || null;
      let episodeNumber = 1;

      let episodeFound = false;
      let isDoubleEpisode = false;
      let secondEpisodeNumber = null;

      const parseDoubleEpisodeMatch = (value) => (value ? value.match(/^(.+?)[-_](?:ep(?:isode)?)[-_]?(\d+)[-_](\d+)$/i) : null);

      const doubleEpMatch = parseDoubleEpisodeMatch(rawPathSlug) || parseDoubleEpisodeMatch(animeSlug);
      if (doubleEpMatch) {
        const ep1 = parseInt(doubleEpMatch[2], 10);
        const ep2 = parseInt(doubleEpMatch[3], 10);
        const looksLikeDoubleEp = ep2 > ep1 && ep2 - ep1 <= 4;
        if (looksLikeDoubleEp) {
          animeSlug = doubleEpMatch[1];
          episodeNumber = ep1;
          secondEpisodeNumber = ep2;
          episodeSlug = `episode-${episodeNumber}`;
          isDoubleEpisode = true;
          episodeFound = true;
          Logger.debug(`Double episode: ${animeSlug} Ep${episodeNumber}-${secondEpisodeNumber}`);
        }
      }

      const episodePatterns = [
        /^(.+?)[-_]ep(?:isode)?[-_]?(\d+)$/i,
        /^(.+?)[-_]ch(?:apter)?[-_]?(\d+)$/i,
        /^(.+?)[-_]part[-_]?(\d+)$/i,
        /^(.+?)[-_](\d+)$/,
      ];
      const fallbackPattern = episodePatterns[episodePatterns.length - 1];
      // These two read a bare trailing number, which is ambiguous: it is the episode in
      // "one-piece-1015" but the season in "fate-zero-season-2". The explicit -episode-/-chapter-
      // patterns are never ambiguous and stay unguarded.
      const ambiguousPatterns = new Set([episodePatterns[2], fallbackPattern]);

      // A dedicated episode segment (/watch/<slug>/episode-5) is authoritative.
      const episodeSegmentNumber = (() => {
        if (!episodeSlug) return null;
        const m = episodeSlug.match(/ep(?:isode)?[-_]?(\d+)/i) || episodeSlug.match(/^(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      })();
      // Season, part, cour and movie ordinals belong to the series identity, never to an episode.
      const Identity = globalThis.AnimeTrackerAnimeIdentity;
      const slugOrdinalIsIdentity =
        (Identity
          ? Identity.isSeasonLikeSlug(animeSlug)
          : /-(?:season-?\d+|(?:part|cour)-?\d+|s\d+)(?=$|-)/i.test(animeSlug)) ||
        /[-_](?:movie|film)[-_]?\d+$/i.test(animeSlug);

      for (const pattern of episodePatterns) {
        if (episodeFound) break;
        const match = animeSlug.match(pattern);
        if (match) {
          const candidate = parseInt(match[2], 10);

          if (pattern === fallbackPattern && candidate >= 1900 && candidate <= 2099) {
            continue;
          }
          // Without this the trailing number is eaten off the slug and reported as the episode:
          // fate-zero-season-2/episode-5 used to be recorded as fate-zero episode 2.
          if (ambiguousPatterns.has(pattern) && (episodeSegmentNumber !== null || slugOrdinalIsIdentity)) {
            continue;
          }
          animeSlug = match[1];
          episodeNumber = candidate;
          episodeSlug = `episode-${episodeNumber}`;
          episodeFound = true;
          break;
        }
      }

      if (!episodeFound && episodeSlug) {
        const epMatch = episodeSlug.match(/ep(?:isode)?[-_]?(\d+)/i) || episodeSlug.match(/(\d+)/);
        if (epMatch) {
          episodeNumber = parseInt(epMatch[1], 10);
        }
      }

      if (!episodeFound && !episodeSlug) {
        episodeNumber = this.findEpisodeFromDOM() || 1;
        if (episodeNumber > 1) {
          episodeSlug = `episode-${episodeNumber}`;
          episodeFound = true;
        }
      }

      if (!episodeSlug) {
        episodeSlug = "episode-1";
        episodeNumber = 1;
      }

      if (episodeNumber < 1) {
        Logger.warn(`Invalid ep ${episodeNumber}, clamping to 1`);
        episodeNumber = 1;
      } else if (episodeNumber > 9999) {
        Logger.warn(`Invalid ep ${episodeNumber}, clamping to 9999`);
        episodeNumber = 9999;
      }

      const originalSlug = animeSlug;
      const explicitTotalEpisodes = this.detectExplicitTotalEpisodes();
      const releaseStatus = this.detectReleaseStatus(explicitTotalEpisodes, episodeNumber);
      let totalEpisodes = explicitTotalEpisodes || this.detectTotalEpisodes(originalSlug, releaseStatus);
      const mediaType = this.detectMediaType();

      const offsetMapping = window.AnimeTrackerContent?.EPISODE_OFFSET_MAPPING || {};
      const offset = offsetMapping[originalSlug] || 0;
      if (offset > 0) {
        episodeNumber += offset;
        if (secondEpisodeNumber !== null) {
          secondEpisodeNumber += offset;
        }
        if (Number.isFinite(totalEpisodes) && totalEpisodes > 0) {
          totalEpisodes += offset;
        }
      }

      const slugNormalization = window.AnimeTrackerContent?.SLUG_NORMALIZATION || {};
      if (slugNormalization[originalSlug]) {
        animeSlug = slugNormalization[originalSlug];
      }

      let animeTitle = this.extractTitle(animeSlug);

      const canonicalSlug = this.normalizeSlugByTitle(animeSlug, animeTitle);
      if (canonicalSlug !== animeSlug) {
        animeSlug = canonicalSlug;
      }
      animeTitle = this.normalizeTitleBySlug(animeSlug, animeTitle);

      const uniqueId = `${animeSlug}__episode-${episodeNumber}`;

      if (options.silent !== true) {
        Logger.info(`${animeTitle} Ep${episodeNumber}`, { id: uniqueId });
      }

      const coverImage = this.extractCoverImage();

      const siteAnimeId = this.extractSiteAnimeId();
      const nextEpisodeSchedule = this.extractNextEpisodeSchedule();

      return {
        animeSlug,
        animeTitle,
        episodeSlug: `episode-${episodeNumber}`,
        episodeNumber,
        uniqueId,
        url: window.location.href,
        isDoubleEpisode,
        secondEpisodeNumber,
        coverImage,
        totalEpisodes,
        mediaType,
        releaseStatus,
        siteAnimeId,
        nextEpisodeAt: nextEpisodeSchedule.nextEpisodeAt,
        nextEpisodeTimezone: nextEpisodeSchedule.nextEpisodeTimezone,
      };
    } catch (e) {
      Logger.error("extractAnimeInfo failed:", e);
      return null;
    }
  },

  resolveImageUrl(element) {
    if (!element) return null;
    const attr = (name) => element.getAttribute?.(name) || "";
    const firstFromSet = (value) => String(value || "").split(",")[0].trim().split(/\s+/)[0];
    const candidates = [
      element.currentSrc,
      attr("src"),
      attr("data-src"),
      firstFromSet(attr("data-srcset")),
      firstFromSet(attr("srcset")),
    ];
    for (const candidate of candidates) {
      const url = String(candidate || "").trim();
      if (/^https:\/\//i.test(url)) return url;
    }
    return null;
  },

  extractCoverImage() {
    try {
      const selectors = [
        ".anime-featured img",
        "img.anime-main-image",
        "img.wp-post-image",
        ".anime-information img",
      ];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const url = this.resolveImageUrl(element);
          if (url) return url;
        }
      }
      for (const element of document.querySelectorAll("img[style*='aspect-ratio']")) {
        if (!/aspect-ratio:\s*2\s*\/\s*3/i.test(element.getAttribute("style") || "")) continue;
        const url = this.resolveImageUrl(element);
        if (url) return url;
      }
    } catch {}
    return null;
  },

  extractNextEpisodeSchedule() {
    try {
      const element =
        document.querySelector(".next-scheduled-episode [data-countdown]") || document.querySelector("[data-countdown]");
      if (!element) return { nextEpisodeAt: null, nextEpisodeTimezone: null };

      const raw = String(element.getAttribute("data-countdown") || "").trim();
      if (!raw) return { nextEpisodeAt: null, nextEpisodeTimezone: null };

      let normalized = raw.replace(" ", "T");
      if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += "Z";
      const parsed = new Date(normalized);
      if (!Number.isFinite(parsed.getTime())) return { nextEpisodeAt: null, nextEpisodeTimezone: null };

      return {
        nextEpisodeAt: parsed.toISOString(),
        nextEpisodeTimezone: element.getAttribute("data-timezone") || null,
      };
    } catch {
      return { nextEpisodeAt: null, nextEpisodeTimezone: null };
    }
  },

  extractSiteAnimeId() {
    try {
      const scripts = document.querySelectorAll("script:not([src])");
      for (const script of scripts) {
        const text = script.textContent;
        const match = text.match(/\bcurrent_post_data_id\s*=\s*(\d+)/) || text.match(/\bcurrent_anime_id\s*=\s*(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    } catch {}
    return null;
  },

  findEpisodeFromDOM() {
    const activeEpisodeSelectors = [
      ".episode-list .active",
      ".episodes .current",
      '[class*="episode"].active',
      '[class*="episode"].selected',
      ".ep-item.active",
      ".episode.active",
      ".episode.current",
      'li.active a[href*="episode"]',
      'a.active[href*="episode"]',
    ];

    for (const selector of activeEpisodeSelectors) {
      try {
        const activeEpisode = document.querySelector(selector);
        if (activeEpisode) {
          const epText = activeEpisode.textContent || activeEpisode.getAttribute("title") || "";
          const epNumMatch = epText.match(/Episode\s*(\d+)/i) || epText.match(/Ep\s*(\d+)/i) || epText.match(/^\s*(\d+)\s*$/);
          if (epNumMatch) {
            const episodeNumber = parseInt(epNumMatch[1], 10);
            return episodeNumber;
          }
        }
      } catch {}
    }

    return null;
  },

  detectReleaseStatus(totalEpisodes = null, currentEpisode = 0) {
    try {
      let airedText = null;
      const labels = document.querySelectorAll("dt, th");
      for (const label of labels) {
        const labelText = (label.textContent || "").replace(/\s+/g, " ").trim();
        const valueText = (label.nextElementSibling?.textContent || "").replace(/\s+/g, " ").trim();
        if (/^(?:status|κατάσταση)(?=\s|:|$)/i.test(labelText)) {
          if (/Finished\s+Airing|Completed|Finished|Ολοκληρώθηκε|Ολοκληρωμένο/i.test(valueText)) return "FINISHED";
          if (/Currently\s+Airing|Releasing|Ongoing|Airing|Προβάλλεται\s+τώρα|Σε\s+εξέλιξη/i.test(valueText)) return "RELEASING";
        }
        if (/^(?:aired?|προβλήθηκε)(?=\s|:|$)/i.test(labelText)) airedText = valueText;
      }
      if (document.querySelector(".next-scheduled-episode [data-countdown], [data-countdown]")) return "RELEASING";
      if (airedText) {
        if (/\?|\bto\s+(?:\?|present|now|tbd)\b|έως\s+(?:\?|σήμερα)/i.test(airedText)) return "RELEASING";
        if (/\bto\s+(?!\?|present\b|now\b|tbd\b)\S|έως\s+(?!\?|σήμερα\b)\S/i.test(airedText)) return "FINISHED";
        if (Number(totalEpisodes) === 1 && Number(currentEpisode) >= 1) return "FINISHED";
      }
      const statusNodes = document.querySelectorAll("[data-status], .anime-status, .status-label, .airing-status");
      for (const node of statusNodes) {
        const text = (node.getAttribute?.("data-status") || node.textContent || "").replace(/\s+/g, " ").trim();
        if (/Finished\s+Airing|Completed|Finished|Ολοκληρώθηκε|Ολοκληρωμένο/i.test(text)) return "FINISHED";
        if (/Currently\s+Airing|Releasing|Ongoing|Airing|Προβάλλεται\s+τώρα|Σε\s+εξέλιξη/i.test(text)) return "RELEASING";
      }
    } catch {}
    return null;
  },

  detectExplicitTotalEpisodes() {
    try {
      const labelRegex = /^(?:episodes?|επεισόδια)(?=\s|:|$)/i;
      const labelNodes = document.querySelectorAll("dt, th");

      for (const labelNode of labelNodes) {
        const labelText = (labelNode.textContent || "").replace(/\s+/g, " ").trim();
        if (!labelRegex.test(labelText)) continue;

        const valueNode = labelNode.nextElementSibling;
        const valueText = (valueNode?.textContent || "").replace(/\s+/g, " ").trim();
        const match = valueText.match(/\b(\d{1,4})\b/);
        if (!match) continue;

        const total = parseInt(match[1], 10);
        if (Number.isFinite(total) && total > 0 && total <= 9999) {
          return total;
        }
      }
    } catch {}

    return null;
  },

  detectMediaType() {
    try {
      const normalizer = globalThis.AnimeTrackerMediaType?.normalize;
      if (!normalizer) return null;
      const labels = document.querySelectorAll("dt, th");
      for (const label of labels) {
        const text = (label.textContent || "").replace(/\s+/g, " ").trim();
        if (!/^(?:type|τύπος)(?=\s|:|$)/i.test(text)) continue;
        const value = (label.nextElementSibling?.textContent || "").replace(/\s+/g, " ").trim();
        const mediaType = normalizer(value);
        if (mediaType) return mediaType;
      }
    } catch {}
    return null;
  },

  detectTotalEpisodes(animeSlug, releaseStatus = null) {
    try {
      const explicitTotal = this.detectExplicitTotalEpisodes();
      if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
        return explicitTotal;
      }

      const episodeNumbers = new Set();
      const navEpisodeNumbers = new Set();
      const escapedSlug = (animeSlug || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hasSlug = Boolean(escapedSlug);
      const hrefPattern = hasSlug
        ? new RegExp(`/watch/${escapedSlug}-episode-(\\d+)(?:$|[/?#])`, "i")
        : /\/watch\/[^/]+-episode-(\d+)(?:$|[/?#])/i;

      const combinedSelector = hasSlug
        ? `a[href*="${animeSlug}-episode-"], [data-open-nav-episode]`
        : 'a[href*="-episode-"], [data-open-nav-episode]';

      const parseEpisodeNumber = (value) => {
        if (!value) return null;
        const text = String(value);
        const match = text.match(/(?:episode|ep)\s*[-_#:]?\s*(\d{1,4})/i) || text.match(/\b(\d{1,4})\b/);
        if (!match) return null;
        const num = parseInt(match[1], 10);
        return Number.isFinite(num) && num > 0 ? num : null;
      };

      const isLikelyNavigationControl = (node) => {
        const collect = (el) => {
          if (!el) return "";
          return [
            el.getAttribute?.("rel") || "",
            el.getAttribute?.("class") || "",
            el.getAttribute?.("id") || "",
            el.getAttribute?.("aria-label") || "",
            el.getAttribute?.("title") || "",
            el.getAttribute?.("data-action") || "",
            el.textContent || "",
          ]
            .join(" ")
            .toLowerCase();
        };

        const context = [
          collect(node),
          collect(node?.parentElement),
          collect(node?.closest?.('a,button,[role="button"],[class],[id]')),
        ].join(" ");

        return /\b(next|prev|previous|forward|back)\b/.test(context);
      };

      {
        const nodes = document.querySelectorAll(combinedSelector);
        for (const node of nodes) {
          if (isLikelyNavigationControl(node)) continue;

          const href = node.getAttribute("href") || "";
          const hrefMatch = href.match(hrefPattern);
          if (hrefMatch) {
            const hrefNum = parseInt(hrefMatch[1], 10);
            if (Number.isFinite(hrefNum) && hrefNum > 0) {
              episodeNumbers.add(hrefNum);
            }
          }

          if (hrefMatch) {
            const attrNum = parseEpisodeNumber(node.getAttribute("data-open-nav-episode") || node.dataset?.openNavEpisode);
            if (attrNum) navEpisodeNumbers.add(attrNum);
          }
        }
      }

      const sourceNumbers = navEpisodeNumbers.size >= 3 ? navEpisodeNumbers : episodeNumbers;
      if (sourceNumbers.size === 0) return null;

      let maxEpisode = 0;
      for (const n of sourceNumbers) {
        if (Number.isFinite(n) && n > maxEpisode) maxEpisode = n;
      }
      if (!Number.isFinite(maxEpisode) || maxEpisode <= 0 || maxEpisode > 9999) return null;

      if (releaseStatus !== "FINISHED") return null;
      return maxEpisode;
    } catch {
      return null;
    }
  },

  // Both delegate to src/common/data/anime-identity.js so the watch page and the library cannot
  // drift apart on which slug/title a page belongs to.
  normalizeSlugByTitle(slug, title) {
    const Identity = globalThis.AnimeTrackerAnimeIdentity;
    return Identity ? Identity.getCanonicalSlug(slug, title) : slug;
  },

  normalizeTitleBySlug(slug, title) {
    const Identity = globalThis.AnimeTrackerAnimeIdentity;
    return Identity ? Identity.getCanonicalTitle(slug, title) : String(title || "").trim();
  },

  extractTitle(animeSlug) {
    let animeTitle = animeSlug
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const titleSelectors = [
      ".episode-head h1",
      "h1.title",
      ".anime-title",
      ".video-title h1",
      'h1[class*="title"]',
      ".player-title",
      "h1",
      ".anime-info h1",
      ".title-container h1",
    ];

    const SEP = /\s*[-–—~|]\s*/;

    for (const selector of titleSelectors) {
      try {
        const titleElement = document.querySelector(selector);
        if (!titleElement) continue;

        let extractedTitle = titleElement.textContent.trim();

        extractedTitle = extractedTitle
          .replace(new RegExp(`${SEP.source}Episode\\s*\\d+.*$`, "i"), "")
          .replace(new RegExp(`${SEP.source}Ep\\s*\\d+.*$`, "i"), "")
          .replace(new RegExp(`${SEP.source}Part\\s*\\d+.*$`, "i"), "")
          .replace(new RegExp(`${SEP.source}Chapter\\s*\\d+.*$`, "i"), "")
          .replace(/\s+\d+\s*$/, "")
          .replace(/\s+Episode\s*$/i, "")
          .replace(/\s*\(\d{4}\)\s*$/, "")
          .trim();

        if (extractedTitle && extractedTitle.length > 2 && extractedTitle.length < 150) {
          animeTitle = extractedTitle;
          break;
        }
      } catch {}
    }

    return animeTitle;
  },
};

window.AnimeTrackerContent = window.AnimeTrackerContent || {};
window.AnimeTrackerContent.AnimeParser = AnimeParser;
