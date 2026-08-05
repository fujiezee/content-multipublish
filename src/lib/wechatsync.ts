/** Browser SDK bridge for 文章同步助手 (Wechatsync Chrome extension). */

export type WechatSyncArticle = {
  title: string;
  desc?: string;
  content: string;
  thumb?: string;
};

declare global {
  interface Window {
    syncPost?: (article: WechatSyncArticle) => void;
  }
}

const SDK_JS =
  "https://cdn.jsdelivr.net/gh/wechatsync/article-syncjs@latest/dist/main.js";
const SDK_CSS =
  "https://cdn.jsdelivr.net/gh/wechatsync/article-syncjs@latest/dist/styles.css";

function loadCss(href: string) {
  if (document.querySelector(`link[data-wechatsync="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.wechatsync = href;
  document.head.appendChild(link);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[data-wechatsync="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.wechatsync = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("文章同步助手 SDK 加载失败"));
    document.head.appendChild(script);
  });
}

export async function ensureWechatSyncSdk() {
  if (typeof window === "undefined") return;
  if (typeof window.syncPost === "function") return;
  loadCss(SDK_CSS);
  await loadScript(SDK_JS);
  // SDK may attach slightly after onload
  for (let i = 0; i < 20; i++) {
    if (typeof window.syncPost === "function") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (typeof window.syncPost !== "function") {
    throw new Error(
      "未检测到文章同步助手。请先在 Chrome 安装扩展（开发者模式加载 tools/wechatsync）",
    );
  }
}

export async function syncWithWechatSync(article: WechatSyncArticle) {
  await ensureWechatSyncSdk();
  window.syncPost?.(article);
}
