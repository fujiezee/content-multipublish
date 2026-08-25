/**
 * After a fill-confirm adapter opens the platform editor, watch that tab.
 * When the user leaves the editor URL or closes the tab, report published so
 * the local editor can leave「待你发布」.
 *
 * @param {{
 *   tabId?: number,
 *   platform: string,
 *   isEditorUrl: (url: string) => boolean,
 *   timeoutMs?: number,
 * }} opts
 */
export function watchFillConfirmTab(opts) {
  const tabId = Number(opts?.tabId);
  const platform = String(opts?.platform || "").trim();
  const isEditorUrl =
    typeof opts?.isEditorUrl === "function" ? opts.isEditorUrl : () => false;
  const timeoutMs = opts?.timeoutMs ?? 45 * 60_000;
  if (!tabId || !platform) return;
  if (typeof chrome === "undefined" || !chrome.tabs?.onRemoved) return;

  let done = false;
  let lastUrl = "";

  const cleanup = () => {
    try {
      chrome.tabs.onRemoved.removeListener(onRemoved);
    } catch {
      // ignore
    }
    try {
      chrome.tabs.onUpdated.removeListener(onUpdated);
    } catch {
      // ignore
    }
    clearTimeout(timer);
  };

  const finish = (url, reason) => {
    if (done) return;
    done = true;
    cleanup();
    reportFillConfirmPublished(platform, url, reason);
  };

  const onRemoved = (id) => {
    if (id === tabId) finish(lastUrl, "tab_closed");
  };

  const onUpdated = (id, info, tab) => {
    if (id !== tabId) return;
    const url = String(info.url || tab?.url || "").trim();
    if (url) lastUrl = url;
    if (
      url &&
      !isEditorUrl(url) &&
      !/\/login|nologin|passport|sso|loginpage/i.test(url)
    ) {
      finish(url, "left_editor");
    }
  };

  try {
    chrome.tabs.get(tabId, (tab) => {
      lastUrl = tab?.url || "";
    });
  } catch {
    // ignore
  }

  chrome.tabs.onRemoved.addListener(onRemoved);
  chrome.tabs.onUpdated.addListener(onUpdated);
  const timer = setTimeout(() => {
    done = true;
    cleanup();
  }, timeoutMs);
}

/**
 * @param {string} platform
 * @param {string} [url]
 * @param {string} [reason]
 */
function reportFillConfirmPublished(platform, url, reason) {
  const href = String(url || "").trim();
  const useUrl =
    href && !/\/login|nologin|passport|sso|news_add|product_add|loginpage/i.test(href)
      ? href
      : undefined;
  const result = {
    platform,
    success: true,
    awaitingUserPublish: false,
    draftOnly: false,
    outcome: "published",
    postUrl: useUrl,
    url: useUrl,
    message:
      reason === "left_editor"
        ? "已离开创作页，记为已发布"
        : "创作页已关闭，记为已发布",
  };

  try {
    chrome.storage.local.get("activeSyncState", (data) => {
      try {
        const state = data?.activeSyncState;
        if (!state || !Array.isArray(state.results)) return;
        const key = platform.toLowerCase();
        let found = false;
        const results = state.results.map((row) => {
          if (String(row?.platform || "").toLowerCase() !== key) return row;
          found = true;
          return { ...row, ...result };
        });
        if (!found) results.push(result);
        chrome.storage.local.set({
          activeSyncState: { ...state, results },
        });
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }

  try {
    chrome.runtime.sendMessage({ type: "SYNC_PROGRESS", result }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // ignore
  }
}
