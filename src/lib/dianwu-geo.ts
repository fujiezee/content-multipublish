/** Browser SDK bridge for 点物GEO Chrome extension (dianwu.ai). */

export type DianwuGeoArticle = {
  title: string;
  desc?: string;
  content: string;
  thumb?: string;
};

declare global {
  interface Window {
    syncPost?: (article: DianwuGeoArticle) => void;
  }
}

const SDK_JS = "/geo-sync/main.js";
const SDK_CSS = "/geo-sync/styles.css";
const EXTENSION_DIR = "tools/dianwu-geo";

function loadCss(href: string) {
  if (document.querySelector(`link[data-dianwu-geo="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.dianwuGeo = href;
  document.head.appendChild(link);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[data-dianwu-geo="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.dianwuGeo = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("点物GEO SDK 加载失败"));
    document.head.appendChild(script);
  });
}

export async function ensureDianwuGeoSdk() {
  if (typeof window === "undefined") return;
  if (typeof window.syncPost === "function") return;
  loadCss(SDK_CSS);
  await loadScript(SDK_JS);
  for (let i = 0; i < 20; i++) {
    if (typeof window.syncPost === "function") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (typeof window.syncPost !== "function") {
    throw new Error(
      `未检测到点物GEO 扩展。请在 Chrome 开发者模式加载 ${EXTENSION_DIR}（https://dianwu.ai）`,
    );
  }
}

export async function syncWithDianwuGeo(article: DianwuGeoArticle) {
  await ensureDianwuGeoSdk();
  window.syncPost?.(article);
}
