# Changelog

All notable changes to **An1me.to Tracker**.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The version in `manifest.json` is the single source of truth.

---

## [7.4.4] — 2026-09-17

Covers everything since 7.4.0. 7.4.1 to 7.4.3 went out as in-between builds without entries of their own.

### Added

- **Airing schedule from AniList.** One batched query returns the next air time, the episode number
  that time belongs to, and the series status for 50 shows at once, replacing a full HTML page load
  per anime per sweep. an1me.to stays authoritative for what is *uploaded*; AniList becomes
  authoritative for what *airs when*.
- **Live countdowns.** The next-episode countdown ticks while the popup is open instead of freezing
  at render time, shows even when you are an episode behind, and renders *due now* / *delayed* once
  the scheduled time passes rather than silently disappearing. The airing section header now leads
  with the soonest upcoming drop instead of always saying "Caught up".
- **Filler matching against the real AnimeFillerList index.** The site's full show list is fetched
  once, cached for 30 days, and matched with a scored comparison against every title we know —
  including the native title and synonyms, which were being scraped off the page and thrown away.
  This replaced a 17-entry hardcoded table, a Japanese-to-English map, and a chain of regexes that
  guessed at slugs and probed only the first five.
- **Every franchise's season, arc and chronology layout is now declared once.**
  `getSeasonNumber` and `getSeasonLabel` were the same nine-franchise `if`-chain written twice,
  differing only in what they returned, and the Fate chronology was a third chain with "fate"
  hardcoded in two more places. They are now ordered rule tables in
  `src/common/data/franchise-seasons.js`, read by a single resolver that defines the one order in
  which franchise rules, generic slug parsing and defaults are consulted — so a number and its
  label can no longer disagree by construction.
- **Bleach TYBW cours can be ordered.** Parts 1, 2 and 3 all carried season number 2 while having
  three distinct labels, so nothing could sort them against each other.
- **Part ranges, slug renames and episode offsets are derived from one cour layout.** Three tables
  in two files described the same two franchises from different directions: one said Bleach TYBW
  part 3 covers absolute episodes 27–40, the other said its offset is 26. Both were right, and
  nothing but care kept them so — while the offsets drive a migration that renames stored slugs
  and renumbers watched episodes.
- **Grouping regression tests** (`node test/grouping.test.js`, `node test/multipart.test.js`) over a
  135-slug corpus. Group keys and group membership are hard failures, because the grouping key is
  persisted and cloud-synced: moving it silently files your progress and cover art under a key
  nothing reads any more. Display and ordering changes surface as a reviewable diff.

- **A regression test for filler matching** (`node test/filler-match.test.js`, no dependencies) over
  a real index snapshot: 22 hand-verified cases including shows that must stay *unmatched*, plus
  assertions that no OVA/movie listing wins a series query and that every manual override points at
  a slug that exists.
- **Per-card group action bar.** Mark every member of a merged card completed, dropped or on hold, or
  favourite the whole group, in a single transaction instead of row by row.
- **One-time group cover repair.** Cover art previously written under a stale grouping key is copied
  onto the canonical key, so artwork that existed but was unreachable now appears. The repair is
  additive — no existing key is removed or overwritten — and idempotent.

### Fixed

- **Cloud sync stopped for good on mobile.** A run of failed token refreshes (five in a row, or a
  single one once a week had passed without a successful request) marked the session *Reconnect
  required*, and nothing ever retried a marked session, so a phone with a patchy connection kept its
  old library until you signed out and back in. That mark now means only one thing: Firebase rejected
  the sign-in. Network errors, timeouts and server errors are retried on a backoff capped at an hour,
  and on demand whenever a sync needs a token. Sessions marked by an older version are checked again
  once on update, and the mark returns only if Firebase really rejects the sign-in.
- **The footer could stay on *Checking cloud…* forever.** The cloud state was never read while a
  background metadata sweep was marked as running, and on mobile, where the worker is stopped often,
  that sweep can stay "running" for days. That hid the *Reconnect Required* above. The cloud state is
  now always read, and a running sweep still shows its own progress on top. *Reconnect Required* now
  shows as an error rather than as ongoing activity, and a sign-in that cannot be refreshed right now
  reads *Cloud Unreachable* instead of *Cloud Connecting…*.
- **An expired sign-in was handled several different ways.** When the refresh token was rejected for
  good, some code paths (the popup among them) signed you out on the spot while others kept your
  session and showed *Reconnect to sync*, so what you saw depended only on which one noticed first.
  The rejection is now recorded in one place, the background worker's token refresh, and every path
  keeps your local session and data and shows the reconnect prompt. A successful cloud request no
  longer clears that prompt either: a working ID token says nothing about the sign-in behind it.
  Removed along the way: a "permanent 401" sign-out branch in the sync error handler, a popup sign-out
  on an error code the worker never sends, and a popup alarm listener for an alarm nothing creates.
- **Storage-full recovery stopped after its first pass.** Its follow-up passes only ran while more than
  250 progress entries were kept, but normal cleanup already caps progress at 200, so they never ran.
  It also pruned deleted-anime records after 10 days instead of the usual 30, which the next full sync
  undid by copying them back from the cloud, and it misread older records stored as a plain date.
- **The popup and the background undid each other's progress cleanup.** They applied different rules
  (movies, dropped shows, the 200-entry cap), so each sync removed what the other had just kept and
  pushed the difference to the cloud. Both now call one shared function.
- **Saving on tab close disagreed with saving during playback.** An episode imported from AniList stayed
  a placeholder instead of counting as watched, a scraped episode total lower than the episode you were
  on was accepted, and a metadata-only refresh moved the show to the top of *recently watched*.
- **Clear all data left progress that came back.** Partly watched episodes of shows that were never in
  the library had no deletion record, so the next sync restored them from the cloud. Each progress
  entry is now marked deleted the same way removing a single entry does.
- **Start over did not move the resume point back.** Progress saving never lets the stored position go
  down, so after choosing *Start over* the next visit still offered to resume at the old, later time.
- **Settings subtitles changed wording on their own.** The seven toggle subtitles were written in two
  places with different text for five of them, so the wording depended on whether you had just clicked
  the toggle or the page had re-rendered.
- **A quick toast wiped a warning.** The popup had two toast systems, and the simpler one removed every
  toast on screen - including a *Session expired* or *Reconnect to sync* warning - whenever it showed a
  short confirmation. There is now one system, with an `info` style added.
- **Closing a tab could save the same episode twice**, and the *episode completed* toast could appear
  twice for one episode.
- **A library update could drop queued metadata repairs.** The post-update handler emptied the list of
  anime waiting for a targeted repair, and two repairs queued at the same moment could overwrite each
  other's additions. The list is no longer cleared on update and is only read and written under a lock.

- **Progress could stop being saved after switching video server.** One cleanup list held both
  per-video and page-level work, so binding a late-loading video or rebinding after the first server
  switch also removed the server-switch listener itself. The second switch was then never noticed,
  and nothing was tracked for the rest of the episode.
- **Going to the next episode quickly could record the wrong episode.** Tracking the finished episode
  spans several storage round trips; if the next page loaded meanwhile, the write used the new
  episode with the old video's duration, marked it completed and deleted its resume point.
- **Fate/Zero Season 2 and Bleach TYBW parts 2–3 mixed two numbering systems.** an1me.to serves each
  later part under its own slug with episodes numbered from 1 — confirmed on the live site, where the
  Season 2 slug is `fate-zero-2nd-season` — while the library numbers the franchise continuously.
  Watched and filler badges landed on the wrong episodes, skip times captured on S2E5 were filed
  under S1E5, and Continue Watching, the popup's Continue button and the filler auto-skip all linked
  to pages that do not exist. Conversion now goes through one helper in both directions.
- **Resume points were deleted in the background.** Every progress save pruned the shared map to the
  20 most recent entries, dropped anything older than 7 days, and removed any entry with 2 minutes
  or less left even when it was far from finished. It now keeps up to 200 entries, like the rest of
  the extension, and uses the same definition of "finished".
- **Deleted progress came back after a slug change.** Two migrations picked between old and new
  progress by position or date alone and ignored deletion markers; they now use the shared rule.
- **Double-episode pages dropped the second episode** when the first was already recorded.
- **"New Episode" never showed on the home shelf** without cached show info — it read a field that
  library entries never have.
- **One Enter could delete two anime.** A replaced delete prompt kept listening for Enter, so the next
  Enter confirmed both. Enter typed into the search box no longer confirms a prompt either.
- **New-episode notifications were skipped** whenever the library refresh, the popup or a visit to
  an1me.to saw the episode first. Notifications now keep their own record of what they last saw.
- **Watch progress never synced while a video was playing.** Each progress write postponed the sync by
  another 5 minutes, so it only ran after playback stopped.
- **Ad Guard and Auto-resume never picked up changes from the cloud.**
- **The library list did not refresh after watching an episode**, because a follow-up sync-status
  write cancelled the pending re-render.
- **The In Progress card switched to a different episode** a moment after appearing, and **Airing
  badges could show on finished shows**.
- **Edit and delete buttons ran twice per click**, and the edit dialog leaked a key listener each time.
- **Skip Outro disappeared for a week after one rate limit**, and could use another show's timings: its
  MAL lookup took the first search result without checking the title.
- **The periodic AniList sync almost never ran**, **metadata retries never retried**, and **a Fetch
  pressed during a background refresh could be reverted** by the refresh.
- **Watchlist changes the site refused were logged as successes**, and a timed-out watchlist change
  could be sent twice.
- **Duplicate episodes were cleaned up on every load but never saved.**
- **Grouping a large library was slow** — about 700 ms at 600 entries, twice per refresh — because an
  expensive comparison ran for every pair before a cheap test that rules most pairs out.
- **Warnings appeared as red error toasts.** They now have their own amber style.

- **Opening the Completed list, and expanding or collapsing cards, dropped frames.** The list
  sections collapsed by animating `grid-template-rows` under a permanent `will-change`, which forced
  the entire section to be laid out again on every frame of the animation — and the Completed list
  holds every finished anime in the library. While collapsed, that content also stayed in the
  layout tree, merely clipped. A single card expand ran six layout animations at once (the card
  body plus five inner panels animating height, margin and padding), and because a card changing
  height moves every card below it, each frame re-laid-out the visible list. Collapsed sections now
  leave the layout tree entirely, and every expand/collapse changes height in one layout and only
  fades, which the compositor handles without layout or paint.
- **Scrolling a long list was heavy regardless of expanding.** Every card carried several
  `backdrop-filter` blurs (on each badge, the progress bar and the episode panel) over a card
  background that is fully opaque, so the blur only ever sampled a solid colour — full rendering
  cost, no visual effect. Every card was also promoted to its own compositor layer. Both are gone.
- **Every expand/collapse click wrote to the cloud.** Toggling a list section saved the preference
  and immediately pushed it to Firestore, with several storage writes per click that also refreshed
  the sync status. The local save is still immediate; the upload now waits until the clicking stops.

- **A Naruto movie was filed under Boruto's season.** The season number matched `"-3"` anywhere in
  the slug while the label matched it only at the end, so
  `naruto-shippuuden-movie-3-inheritors-of-the-will-of-fire` was numbered season 3 and labelled
  Shippuden at the same time.
- **A standalone `-part-2` sorted identically to part 1.** With no season number of its own it fell
  through to the default 1 — the same number as the base entry — and both rendered as "Season 1".
- **`higashi-no-eden-movie-1` rendered as "Movie 1"** instead of "Movie I: King of Eden", because
  its number and its label were resolved from two different condition sets.

- **Fetching required an an1me.to tab to be open.** The gateway could not tell its own timeout from
  a Cloudflare block: any thrown error, including its own 8-second abort, was counted as a block, and
  three slow page loads disabled the working path for everyone. With no site tab open, the rest of
  the sweep was then written off as unreachable. Timeouts and transport errors are now retried on the
  direct path with a longer budget, and only a genuine interstitial gives up on it. Measured
  afterwards: an1me.to serves the full page to a plain request with no Referer and no Origin, so the
  site was never the obstacle.
- **Tab creation was unreachable code.** The documented last resort was gated behind a storage flag
  nothing in the codebase ever wrote. It is now the default fallback, uses a hidden background tab,
  and is reaped by an alarm plus a startup sweep — an 8-second `setTimeout` routinely died with the
  service worker and orphaned the tab permanently.
- **Cloudflare interstitials could be cached as real metadata.** The interstitial is served *from*
  an1me.to, so the content bridge was injected into it and answered the readiness ping, after which
  the gateway adopted that tab, received 200 plus stub HTML, and stored the stub's absent episode
  counts, status and cover art as authoritative. Bridge replies are now checked too.
- **Every popup open announced a fetch.** Opening the popup awaited a cloud poll and then started a
  metadata sweep. That sweep is gated to 6 hours and airing entries expire on a 6-hour recheck, so
  the two periods lined up: any overnight gap or PC restart landed on "Fetching N anime…". Refresh is
  now alarm-driven with a catch-up shortly after browser startup, and runs silently — cards still
  update live as data lands. The popup paints from local storage first and no longer blocks on the
  cloud.
- **The airing countdown ignored the site's timezone.** `data-timezone` was captured, stored, synced
  and compared, but never applied, while the value itself was read as UTC — skewing every scraped
  countdown by the site's offset (2–3 hours for Europe/Athens), and by a further hour across daylight
  saving.
- **Release status was decided by three heuristics that disagreed by construction.** A leftover
  countdown tag alone could declare a show airing, and "fewer episodes uploaded than declared" could
  flip a finished show back to airing permanently — true of any finished show with one missing or
  unnumbered upload. Sources are now explicitly ranked, with AniList as the tiebreaker, and only the
  strongest available source decides.
- **A finished show could display a phantom countdown.** A stale future air time was carried forward
  whenever a re-scrape found no countdown tag; it is now only kept while AniList still agrees a next
  episode exists.
- **Specials and recaps inflated the latest-episode number**, which drives the New Episode badge, the
  continue-watching prompt and the episode number in notifications. It is now bounded by the episode
  AniList says airs next — but only while that time is still in the future, so a recent upload is
  never hidden.
- **A mixed-case slug resolved on one code path and not the other**, producing an "Airing" badge with
  no countdown, or the reverse.
- **The first episode discovered for a newly added anime never notified.**
- **Three requests bypassed the gateway entirely** — the watchlist POST, the slug-migration probes and
  an1me cover images — so none of them had challenge detection, retries or a fallback. The probe
  fallback was actively harmful: with no challenge detection an interstitial answered 200, so a bad
  slug was confirmed as valid and the library entry renamed under it. Also fixes a `ReferenceError`
  thrown from the search helper's `finally` block.
- **Rate limits were cached as permanent misses.** A 429 from Jikan or the AniSkip MAL lookup was
  recorded as "this show has no data", locking it out for the whole cache lifetime.
- **The cover cache never evicted anything**, keeping every cover any entry had ever pointed at.
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

- Removed eight background message handlers that nothing sent, including `GET_AUTH_STATE`, which
  returned the raw Firebase tokens to anything in the extension that asked.
- The popup's seven copies of the "message the background and wait, with a timeout" helper are now one,
  `src/popup/lib/runtime-request.js`. A reply that arrives after the timeout now has its
  `chrome.runtime.lastError` read instead of being logged as unchecked.
- Dropped two `catch` branches around toast calls that could never run, keeping their clearer message.
- `test/progress-cleanup.test.js` pins the shared progress cleanup rules, run both with the fallback
  list-state logic and with the real `EntryState` module.

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
