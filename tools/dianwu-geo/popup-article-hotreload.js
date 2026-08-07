/**
 * Keep the action popup in sync with the latest editor article.
 * The stock popup recovers activeSyncState first and may skip pendingArticle
 * when status is syncing/completed — clear that state and reload on updates.
 */
let reloadTimer = null;
let lastPendingFingerprint = "";

function articleFingerprint(article) {
  if (!article || typeof article !== "object") return "";
  return [
    article._openedAt || "",
    article.title || "",
    (article.content || article.html || "").slice(0, 80),
    article.source?.url || "",
  ].join("|");
}

async function applyPendingArticle(article) {
  const fingerprint = articleFingerprint(article);
  if (!fingerprint || fingerprint === lastPendingFingerprint) return;
  lastPendingFingerprint = fingerprint;

  try {
    await chrome.storage.local.remove("activeSyncState");
  } catch {
    // ignore
  }
  try {
    await chrome.runtime.sendMessage({ type: "CLEAR_SYNC_STATE" });
  } catch {
    // ignore
  }

  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    try {
      location.reload();
    } catch {
      // ignore
    }
  }, 40);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.pendingArticle?.newValue) return;
  void applyPendingArticle(changes.pendingArticle.newValue);
});

// First paint: if a fresher pending article is already waiting, prefer it.
chrome.storage.local.get(["pendingArticle", "activeSyncState"], (data) => {
  if (!data?.pendingArticle) return;
  const pendingTitle = data.pendingArticle.title || "";
  const recoveredTitle = data.activeSyncState?.article?.title || "";
  if (pendingTitle && pendingTitle !== recoveredTitle) {
    void applyPendingArticle(data.pendingArticle);
  } else {
    lastPendingFingerprint = articleFingerprint(data.pendingArticle);
  }
});
