/** Keep in sync with `tools/dianwu-geo/manifest.json`. */
export const LATEST_EXTENSION_VERSION = "2.12.0";

export function extensionDownloadUrl(version = LATEST_EXTENSION_VERSION) {
  return `/api/extension/download?v=${encodeURIComponent(version)}`;
}

export function compareVersion(a: string, b: string): number {
  const left = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta > 0) return 1;
    if (delta < 0) return -1;
  }
  return 0;
}

/** Missing version counts as outdated so old builds still see the download. */
export function isExtensionOutdated(installed: string | null | undefined) {
  if (!installed?.trim()) return true;
  return compareVersion(installed.trim(), LATEST_EXTENSION_VERSION) < 0;
}
