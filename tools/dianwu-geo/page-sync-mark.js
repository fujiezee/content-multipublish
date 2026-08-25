/**
 * Runs in the page (MAIN) world at document_start.
 * Sets markers the Next.js app can read even before inject-api.js loads.
 */
(function () {
  if (window.__DWGEO_EXTENSION_INSTALLED__) return;

  window.__DWGEO_EXTENSION_INSTALLED__ = true;

  function applyInit(detail) {
    if (!detail || typeof detail !== "object") return;
    if (detail.extensionId) {
      window.__DWGEO_EXTENSION_ID__ = detail.extensionId;
    }
    if (detail.version) {
      window.__DWGEO_EXTENSION_VERSION__ = detail.version;
      document.documentElement?.setAttribute(
        "data-dwgeo-extension-version",
        detail.version,
      );
    }
    if (detail.injectUrl && !window.$syncer) {
      const script = document.createElement("script");
      script.src = detail.injectUrl;
      script.async = false;
      (document.documentElement || document.head || document.body).appendChild(
        script,
      );
    }
  }

  document.addEventListener("dianwu-geo-init", (event) => {
    applyInit(event.detail);
  });

  const root = document.documentElement;
  if (root) {
    const extensionId = root.getAttribute("data-dwgeo-extension-id");
    const injectUrl = root.getAttribute("data-dwgeo-inject-url");
    const version = root.getAttribute("data-dwgeo-extension-version");
    if (extensionId || injectUrl || version) {
      applyInit({ extensionId, injectUrl, version });
    }
  }
})();
