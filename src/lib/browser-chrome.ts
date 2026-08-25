export type BrowserKind = "chrome" | "edge" | "chromium" | "safari" | "firefox" | "other";

export const CHROME_DOWNLOAD_URL = "https://www.google.com/chrome/";

export function detectBrowser(ua = ""): BrowserKind {
  const s = ua.toLowerCase();
  if (s.includes("edg/") || s.includes("edgios")) return "edge";
  if (s.includes("firefox/") || s.includes("fxios")) return "firefox";
  if (s.includes("crios/")) return "chrome";
  if (
    s.includes("safari/") &&
    !s.includes("chrome/") &&
    !s.includes("chromium/") &&
    !s.includes("android")
  ) {
    return "safari";
  }
  if (s.includes("opr/") || s.includes("brave") || s.includes("arc/")) {
    return "chromium";
  }
  if (s.includes("chrome/")) return "chrome";
  if (s.includes("chromium")) return "chromium";
  return "other";
}

export function canLoadUnpackedExtension(kind: BrowserKind): boolean {
  return kind === "chrome" || kind === "edge" || kind === "chromium";
}

export function browserLabel(kind: BrowserKind): string {
  if (kind === "chrome") return "Google Chrome";
  if (kind === "edge") return "Microsoft Edge";
  if (kind === "chromium") return "Chromium 内核浏览器";
  if (kind === "safari") return "Safari";
  if (kind === "firefox") return "Firefox";
  return "当前浏览器";
}
