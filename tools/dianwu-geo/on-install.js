chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.set({ analytics_enabled: false });
  if (details.reason === "install") {
    chrome.tabs.create({ url: "https://dianwu.ai" });
  }
});
