chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.set({
    analytics_enabled: false,
    mcpEnabled: false,
    saasBaseUrl: "https://dianwu.ai",
  });
  const version = chrome.runtime.getManifest()?.version || "";
  if (details.reason === "install") {
    chrome.tabs.create({ url: "https://dianwu.ai" });
    console.info(`[dianwu-geo] installed v${version}`);
    return;
  }
  if (details.reason === "update") {
    console.info(
      `[dianwu-geo] updated ${details.previousVersion || "?"} → v${version}`,
    );
  }
});
