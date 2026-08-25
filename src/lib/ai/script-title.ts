const MANUAL_SCRIPT_TITLE =
  /指南|攻略|手册|教程|干货|秘籍|五步|三步|四步|六步|七步|从0到1|全面解析|系统性|方法论|评估清单|怎么做|如何做|落地指南|实操/;

export function looksLikeManualScriptTitle(name: string): boolean {
  const t = String(name || "").replace(/\s+/g, "");
  if (!t) return false;
  return MANUAL_SCRIPT_TITLE.test(t);
}

/** First name that is not empty and not a how-to manual title. */
export function pickScriptTitle(
  ...names: Array<string | null | undefined>
): string {
  for (const name of names) {
    const t = String(name || "").trim().slice(0, 16);
    if (t && !looksLikeManualScriptTitle(t)) return t;
  }
  return "";
}

export function cleanScriptTitle(raw: string, max = 16): string {
  return String(raw || "")
    .split("\n")[0]
    .replace(/[《》「」""''：:。！？、，,\s]/g, "")
    .slice(0, max);
}
