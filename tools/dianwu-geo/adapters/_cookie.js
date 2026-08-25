/**
 * Read a cookie value via extension runtime (chrome.cookies).
 * @param {{ cookies?: { get: (domain: string) => Promise<Array<{ name: string; value: string }>> } }} runtime
 * @param {string[]} domains
 * @param {string} name
 * @param {string[]} [urls] optional full URLs for chrome.cookies.get({url,name})
 */
export async function getCookieValue(runtime, domains, name, urls = []) {
  // Prefer precise URL lookup (more reliable for host-only cookies)
  if (typeof chrome !== "undefined" && chrome.cookies?.get) {
    for (const url of urls) {
      try {
        const hit = await chrome.cookies.get({ url, name });
        if (hit?.value) return hit.value;
      } catch {
        // try next
      }
    }
  }

  if (!runtime?.cookies?.get) return null;
  for (const domain of domains) {
    try {
      const list = await runtime.cookies.get(domain);
      const hit = (list || []).find((c) => c.name === name);
      if (hit?.value) return hit.value;
    } catch {
      // try next domain
    }
  }
  return null;
}

/**
 * Scan cookies on domains for the first name that matches.
 * @param {string[]} domains
 * @param {RegExp|string} nameMatch
 */
export async function findCookieValue(domains, nameMatch) {
  if (typeof chrome === "undefined" || !chrome.cookies?.getAll) return null;
  const test =
    typeof nameMatch === "string"
      ? (name) => name === nameMatch
      : (name) => nameMatch.test(name);
  for (const domain of domains) {
    try {
      const list = await chrome.cookies.getAll({ domain });
      const hit = (list || []).find((c) => c?.value && test(String(c.name || "")));
      if (hit?.value) return hit.value;
    } catch {
      // try next
    }
  }
  return null;
}
