# Privacy policy - An1me.to Tracker

**Last updated:** 6 September 2026  
**Publisher:** Thomas Thanos

There is no analytics SDK, advertising SDK, tracking pixel, telemetry, data sale, or profiling in An1me.to Tracker. The source is published without minification so these claims can be audited.

## Data stored on your device

- Your library, episode progress, playback positions, categories, and notes.
- Cached metadata such as covers, episode counts, filler lists, and skip timings.
- Settings, goals, and achievement progress.
- Authentication tokens when you choose to sign in.

This data is stored with the browser extension storage API. It stays on the device unless you enable cloud sync.

## Optional cloud sync

If you sign in with Google or email and password, Firebase Authentication receives the credentials needed for sign-in and Cloud Firestore stores your library and settings in a private document keyed to your account. Cloud sync is optional; the extension works locally without an account.

Metadata lookups may send a series title or ID to AniList, Jikan/MyAnimeList, AniSkip, AnimeFillerList, an1me.to, and image CDNs. These lookups do not include your email, account identifier, browsing history, or a device fingerprint. They also run on a background timer while the browser is open, so covers, episode counts and airing status stay current without the popup being opened.

## Your controls

- Export and import your library from Settings.
- Clear local data from Settings.
- Sign out to stop cloud synchronization while keeping the local library.
- Disable notifications to stop the new-episode checker. The library metadata refresh is a separate
  background job: it keeps running on its timer, and it only contacts an1me.to and the metadata
  providers listed above.
- Request help or deletion of cloud account data through the repository's issue tracker.

The `identity` permission is used only for Google sign-in. It does not grant access to Gmail, Drive, Contacts, or other Google account data.

Material changes to this policy will be reflected in its update date and in the public commit history.
