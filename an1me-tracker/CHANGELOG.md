# Changelog

All notable changes to **An1me.to Tracker**.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The version in `manifest.json` is the single source of truth.

---

## [Unreleased]

`manifest.json` still reports **7.4.0** — nothing below has been given a version yet.

### Added

- **Per-card group action bar.** Mark every member of a merged card completed, dropped or on hold, or
  favourite the whole group, in a single transaction instead of row by row.
- **One-time group cover repair.** Cover art previously written under a stale grouping key is copied
  onto the canonical key, so artwork that existed but was unreachable now appears. The repair is
  additive — no existing key is removed or overwritten — and idempotent.

### Fixed

- **Wrong episode recorded on two-segment watch URLs.** For a series whose slug ends in a number,
  `/watch/<slug>/episode-N/` had the trailing number chewed off the slug and reported as the episode:
  `fate-zero-season-2/episode-5` was recorded as *Fate/Zero episode 2*. Season, part, cour and movie
  ordinals are no longer read as episode numbers, and a dedicated `episode-N` URL segment now wins
  over anything in the slug.
- **Multi-part episode offsets were silently skipped on those same URLs.** Because the slug had been
  truncated, `EPISODE_OFFSET_MAPPING` never matched and the offset was never applied. Fate/Zero S2
  episode 5 now correctly resolves to absolute episode 18 (5 + 13).
- **The popup and the watch page disagreed about which group an anime belonged to.** Nine slugs across
  four franchises — Fate, Jujutsu Kaisen, Mashle and Hunter × Hunter — resolved to different grouping
  keys in the two layers, so the watch page wrote cover art under keys the popup never read. Sixteen
  One Piece movie entries were affected the same way. Both layers now resolve identically.
- **The resume prompt could seek past the end of the video.** Accepting *resume?* with a saved
  position at or beyond the duration (a stale entry, or a server switch to a shorter encode) jumped to
  the end and instantly re-completed the episode. All three resume paths now share the same clamp.
- **Watchlist changes to an1me.to were silently dropped.** The HTTP status was never checked, so a 403
  from an expired site session — which returns an HTML body — disappeared into a debug-only log while
  the caller counted the change as applied. Failures now propagate and are reported.
- **Deleting an anime leaked its metadata caches.** `animeinfo_`, `episodeTypes_` and `fillerslug_`
  entries survived both a single delete and *clear all data*. `fillerslug_` was additionally invisible
  to the quota reclaimer, so it could never be reclaimed at all.
- **A malformed token refresh response could produce a session that never refreshed.** A non-numeric
  `expires_in` made the expiry `NaN`, and every "is it expired?" comparison against `NaN` is false, so
  the session was only repaired once a request came back 401.
- **an1me.to gateway.** Replaced an over-broad challenge detector that mistook ordinary responses for
  Cloudflare interstitials, and replaced the single-failure cooldown with a fail-streak plus a short
  retry window, so one bad response can no longer cascade into "everything unreachable". The request
  order is now explicit: direct fetch from the service worker, then reuse of an an1me.to tab the user
  already has open, then report `unreachable` and let the alarms retry. A tab is only ever created if
  the user opts in via the `an1meGatewayTabEnabled` flag, which is off by default.
- **Metadata repair chose the wrong UI mode.** It now decides from how much of the library is actually
  being fetched instead of always assuming a full sweep.

### Changed

- **Merged groups are now operable by keyboard.** Eight expandable headers — season and movie groups,
  season rows, part rows, *Watched episodes*, *Parts*, *In Progress*, and the in-progress group — were
  plain `div`s, so keyboard and screen-reader users could not open any of them. They now expose
  `role="button"`, `tabindex` and an `aria-expanded` state kept in sync, and Enter/Space run through
  the same code path as a click. Rows with nothing to reveal, and movie rows, deliberately stay inert
  to match what clicking them actually does.
- **The season status badge moved to the section header.** Cards inside a status-filtered section no
  longer repeat the badge on every row.
- Cover URLs in the add-anime dialog now go through the same image host allowlist the library cards
  use, instead of being assigned straight to an `<img src>`.
- The group card's `data-base-slug` attribute is escaped, matching its sibling `data-slug`.

### Internal

- **All anime identity rules now live in one module** (`src/common/data/anime-identity.js`): the
  grouping base slug, season detection, watch-to-info slug aliases, and the canonical slug/title
  rules. They had been duplicated across the popup, the content scripts and the background worker,
  which is what let the layers drift apart in the first place. The popup's grouping output was
  verified byte-for-byte unchanged, because it is a persisted, cloud-synced key.
- Removed the duplicated copies: 37 lines from `src/popup/lib/config.js`, 11 from
  `episode-highlight.js`, 10 from `an1me-scraper.js`, four copies of the season-suffix regex, one
  watch-to-info alias table, and the canonicalisation rules that existed verbatim in both
  `src/popup/lib/storage.js` and `src/content/page/anime-parser.js`.
- Group cover writes on the watch page now pass the media type they already had on hand, so movies and
  series land on the same key the library reads back.

### Known issues

- The `animeinfo_<slug>` cache can lose a field if the watch page and the background repair job write
  it within the same few milliseconds. It self-heals on the next sweep; a proper fix needs a single
  writer in the background worker.
- `playbackSettingsUpdatedAt` is written outside the library mutation coordinator in one place
  (`src/popup/main.js`). Reviewed and deliberately left as is: routing it through the coordinator adds
  a revision bump to a hot UI path, which costs more than the near-unreachable race it would close.
- Watchlist failures are now visible but still not retried — mirroring the site watchlist stays
  best-effort by design.

---

## [7.4.0] — 2026-09-06

### Added

- **Tab-free metadata fetching.** Metadata is fetched from the background worker instead of opening a
  tab. If an1me.to answers with a challenge, the tracker borrows a tab that is already open rather
  than creating one, and otherwise waits for the next attempt.
- **Autonomous background refresh.** Covers, episode counts, airing status and new-episode checks keep
  updating on a timer, so opening the extension is no longer required to get fresh data.
- **Mark complete by hand** for individual seasons, parts and movies from their own row inside a
  merged group, in addition to whole series from the card.

### Fixed

- Cover extraction on the watch page now handles lazy-loaded images and remote-`src` page variants.
- The airing countdown selector tolerates a missing `data-timezone` attribute, and the watch-page
  countdown is persisted into the metadata cache.
- A transient outage while probing slug candidates is no longer cached as a permanent 404.
- An empty AniSkip/Jikan match is no longer cached as a 30-day success, and an empty AnimeFillerList
  parse is reported as transient instead of as "no data".
- Repeated per-series notification failures back off instead of re-checking every 20 minutes.
- The AniList sync heartbeat is stopped before the terminal status write, so it can no longer
  overwrite the final status.
- The Continue Watching section disconnects its previous `ResizeObserver` when it is rebuilt.
- The capture-phase click handler injected on the site guards against non-Element event targets.
