// watchlist-sync.js — mirrors watchlist changes to an1me.to: forwards to a live
// tab when one is open, else POSTs to the site's admin-ajax endpoint through the gateway.
async function syncWatchlistToSite(animeId, type, animeSlug = null) {
  dlog(
    `%c WatchlistSync %c ${type} %c anime #${animeId}`,
    "background:#6366f1;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700",
    "background:#818cf8;color:#fff;padding:2px 6px",
    "color:#a5b4fc",
  );

  try {
    const tabs = await chrome.tabs.query({ url: "https://an1me.to/*" });

    const liveTab = (tabs || []).find((t) => t && t.id != null && t.discarded !== true && t.status !== "unloaded");
    if (liveTab) {
      chrome.tabs.sendMessage(
        liveTab.id,
        {
          type: "WATCHLIST_SYNC_EXECUTE",
          animeId,
          watchlistType: type,
          // Lets the content script reset-before-add and persist the synced status, instead of a blind single request.
          animeSlug,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              `%c WatchlistSync %c tab forward failed`,
              "background:#ef4444;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700",
              "color:#fca5a5",
              chrome.runtime.lastError.message,
            );
            directWatchlistFetch(animeId, type).catch((e) => console.warn("[BG] WatchlistSync direct fallback failed:", e.message));
          } else {
            dlog(
              `%c WatchlistSync %c ✓ forwarded to tab`,
              "background:#22c55e;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700",
              "color:#86efac",
            );
          }
        },
      );
    } else {
      dlog(
        `%c WatchlistSync %c no live tab open, direct fetch`,
        "background:#f59e0b;color:#000;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700",
        "color:#fcd34d",
      );
      await directWatchlistFetch(animeId, type);
    }
  } catch (e) {
    console.warn(
      `%c WatchlistSync %c ✗ ${e.message}`,
      "background:#ef4444;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700",
      "color:#fca5a5",
    );
  }
}

async function directWatchlistFetch(animeId, type) {
  const AJAX_URL = "https://an1me.to/wp-admin/admin-ajax.php";
  const action = type === "remove" ? "remove_from_watchlist" : "add_to_watchlist";
  try {
    const formData = new URLSearchParams();
    formData.append("action", action);
    formData.append("anime_id", animeId.toString());
    formData.append("type", type);

    // Routed through the gateway rather than a bare fetch, so this POST gets the same challenge
    // detection, timeout/network retry and tab fallback as every other an1me.to request. A bare
    // SW fetch here had none of that and read a Cloudflare interstitial as a hard failure.
    const res = await an1meFetch(AJAX_URL, {
      method: "POST",
      body: formData.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeoutMs: 10000,
    });

    if (res.unreachable) {
      throw new Error("an1me.to unreachable");
    }

    const text = typeof res.text === "string" ? res.text : "";
    // A 403 from an expired an1me.to session returns an HTML body, so JSON.parse throws and the
    // failure used to disappear into a debug-only log while the caller counted it as a success.
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${text.substring(0, 100)}`);
    }
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response ${text.substring(0, 100)}`);
    }
    if (!data?.success) {
      throw new Error(data?.data?.message || text.substring(0, 100) || "watchlist request rejected");
    }
    dlog(
      `%c WatchlistSync %c ✓ ${data.data?.message || "OK"}`,
      "background:#22c55e;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;font-weight:700",
      "color:#86efac",
    );
  } catch (e) {
    // The caller logs it; rethrow so a failed watchlist change is never counted as applied.
    throw e;
  }
}
