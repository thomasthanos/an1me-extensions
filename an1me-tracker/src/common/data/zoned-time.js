// zoned-time.js — interprets an1me.to's `data-countdown` wall-clock string in the zone its
// sibling `data-timezone` attribute names.
//
// The old code appended "Z" and called it UTC. That attribute exists precisely because the
// string is NOT UTC, so every scraped countdown was skewed by the site's offset (2-3h for
// Europe/Athens). There is no Temporal in this runtime, so the offset is recovered by asking
// Intl to format a candidate instant in the target zone and correcting by the difference —
// iterated twice so a DST boundary between the guess and the answer settles.
(function () {
  "use strict";

  const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

  function hasExplicitOffset(value) {
    return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || "").trim());
  }

  const _formatters = new Map();
  function formatterFor(timeZone) {
    let fmt = _formatters.get(timeZone);
    if (fmt) return fmt;
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    _formatters.set(timeZone, fmt);
    return fmt;
  }

  // The wall-clock time, as a UTC-based millisecond count, that `instant` reads as in `timeZone`.
  function zonedWallClockMs(instant, timeZone) {
    const parts = formatterFor(timeZone).formatToParts(instant);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    let hour = get("hour");
    if (hour === 24) hour = 0;
    return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  }

  function isValidTimeZone(timeZone) {
    if (!timeZone || typeof timeZone !== "string") return false;
    try {
      formatterFor(timeZone);
      return true;
    } catch {
      return false;
    }
  }

  // Returns an ISO string, or null when the input is unparseable.
  //
  // - An explicit offset in the string always wins; nothing to infer.
  // - A valid IANA zone name is applied properly, DST included.
  // - No usable zone: fall back to UTC, matching the site's own script (`new Date(str + 'Z')`),
  //   because a wrong-but-consistent reading beats reading it as the viewer's local time.
  function parseZonedDateTime(raw, timeZone) {
    const text = String(raw || "").trim();
    if (!text) return null;

    if (hasExplicitOffset(text)) {
      const direct = new Date(text.replace(" ", "T"));
      return Number.isFinite(direct.getTime()) ? direct.toISOString() : null;
    }

    const m = text.match(DATETIME_RE);
    if (!m) return null;
    const wallMs = Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0),
    );
    if (!Number.isFinite(wallMs)) return null;

    if (!isValidTimeZone(timeZone)) return new Date(wallMs).toISOString();

    let instant = wallMs;
    for (let i = 0; i < 2; i++) {
      const drift = zonedWallClockMs(new Date(instant), timeZone) - wallMs;
      if (drift === 0) break;
      instant -= drift;
    }
    const resolved = new Date(instant);
    return Number.isFinite(resolved.getTime()) ? resolved.toISOString() : null;
  }

  const exports = { parseZonedDateTime, isValidTimeZone, hasExplicitOffset };
  const root = typeof globalThis !== "undefined" ? globalThis : self;
  root.AnimeTrackerZonedTime = exports;
  if (typeof window !== "undefined") {
    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.ZonedTime = exports;
  }
})();
