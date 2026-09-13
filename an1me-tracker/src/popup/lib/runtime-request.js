// runtime-request.js — the popup's one "message the background worker and wait for the reply" helper.
//
// Six popup files carried seven copies of this: a timer, a settled flag, and
// chrome.runtime.lastError turned into a rejection. They differed only in the timeout and its message,
// so they now call this. It loads before every other popup script that sends a request.
(function () {
  "use strict";

  // Resolves with the reply (null when the worker sent none) or rejects on a runtime error or timeout.
  function sendRuntimeRequest(message, { timeoutMs = 30000, timeoutMessage = "Runtime message timeout" } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error(timeoutMessage)), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          // Read lastError even when the timeout already won, so Chrome does not log it as unchecked.
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            finish(reject, new Error(runtimeError.message));
            return;
          }
          finish(resolve, response || null);
        });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  const AT = (window.AnimeTracker = window.AnimeTracker || {});
  AT.sendRuntimeRequest = sendRuntimeRequest;
})();
