/**
 * Parse query-string helpers for scenario pages.
 */

/**
 * @param {string} [search] location.search or full query including `?`
 * @returns {Record<string, string>}
 */
export function getUrlParams(search = typeof location !== "undefined" ? location.search : "") {
  const q = search.startsWith("?") ? search.slice(1) : search;
  /** @type {Record<string, string>} */
  const out = {};
  if (!q) return out;
  for (const part of q.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const rawKey = eq >= 0 ? part.slice(0, eq) : part;
    const rawVal = eq >= 0 ? part.slice(eq + 1) : "";
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      const val = decodeURIComponent(rawVal.replace(/\+/g, " "));
      out[key] = val;
    } catch {
      // keep raw on decode failure
      out[rawKey] = rawVal;
    }
  }
  return out;
}

/**
 * Truthy check for URL flags: 1, true, yes (case-insensitive).
 * @param {string | undefined} v
 */
export function isTruthyParam(v) {
  if (v == null || v === "") return false;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
