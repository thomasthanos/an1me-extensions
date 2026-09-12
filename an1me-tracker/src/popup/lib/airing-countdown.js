// airing-countdown.js — formats next-episode countdowns and keeps every rendered one ticking.
//
// The countdown used to be baked straight into the card's HTML string, so it froze the moment the
// list rendered and a long-open side panel showed an increasingly wrong number. One interval for
// the whole list (not one per card) rewrites each node from its own data-next-airing-at.
(function () {
  "use strict";

  const AT = (window.AnimeTracker = window.AnimeTracker || {});

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  // How long past the scheduled time we still call it "due" rather than "delayed". A fansub
  // upload lands some time after the Japanese broadcast, so a small positive lag is normal.
  const DUE_WINDOW_MS = 6 * HOUR;
  const TICK_MS = 30 * 1000;
  const SELECTOR = "[data-next-airing-at]";

  let _timer = null;

  // { text, overdue }. An empty text means "no schedule known"; a schedule that has merely passed
  // still formats to something visible, so a delayed episode reads as delayed rather than as
  // having no next episode at all.
  function format(airingAtMs, now = Date.now()) {
    // Number(null) and Number("") are both 0, which is finite - and epoch 0 would render as
    // "delayed 20000d" rather than as the absent value it actually is.
    const at = Number(airingAtMs);
    if (!Number.isFinite(at) || at <= 0) return { text: "", overdue: false };

    const diff = at - now;
    if (diff <= 0) {
      const late = -diff;
      if (late < DUE_WINDOW_MS) return { text: "⏰ due now", overdue: false };
      if (late < DAY) return { text: "⏰ due today", overdue: true };
      const days = Math.floor(late / DAY);
      return { text: `⏰ delayed ${days}d`, overdue: true };
    }

    const totalMinutes = Math.max(1, Math.floor(diff / MINUTE));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return { text: `🚀 ${days}d ${hours}h`, overdue: false };
    if (hours > 0) return { text: `🚀 ${hours}h ${minutes}m`, overdue: false };
    return { text: `🚀 ${minutes}m`, overdue: false };
  }

  function refresh(root = document) {
    let nodes;
    try {
      nodes = root.querySelectorAll(SELECTOR);
    } catch {
      return 0;
    }
    const now = Date.now();
    for (const node of nodes) {
      const label = format(node.dataset.nextAiringAt, now);
      if (!label.text) continue;
      if (node.textContent !== label.text) node.textContent = label.text;
      node.classList.toggle("meta-time-eta-overdue", label.overdue);
    }
    return nodes.length;
  }

  function start() {
    stop();
    // Nothing to tick until a list with countdowns is rendered; the interval is cheap enough that
    // checking on a 30s cadence costs less than wiring render hooks through every view.
    _timer = setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, TICK_MS);
  }

  function stop() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  AT.AiringCountdown = { format, refresh, start, stop, TICK_MS, DUE_WINDOW_MS };

  window.addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => {
    // Catch up immediately on re-show rather than waiting out the remainder of the tick.
    if (!document.hidden) refresh();
  });
})();
