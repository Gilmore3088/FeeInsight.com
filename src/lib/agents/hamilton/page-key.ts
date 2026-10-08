const VERSION_WORDS = new Set([
  "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul", "july",
  "aug", "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec", "december",
  "final", "update", "updated", "updates", "rev", "revised", "r", "v", "new", "current", "copy", "wp", "content", "uploads", "pdf", "html", "htm", "php", "aspx",
]);

/**
 * Which page a price was read on, ignoring what changes between copies of one page: the
 * scheme, "www.", the port, letter case, dates and version numbers ("Fee Schedule Oct 1 2024"
 * and "Fee Schedule 08.15.2026 final" are one page). A business schedule and a consumer
 * disclosure are different pages; null when the URL is unknown.
 */
export function feePageKey(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  let host: string;
  let path: string;
  try {
    const parsed = new URL(raw);
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const words = path
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .split(/[^a-z]+/)
    .filter((word) => word && !VERSION_WORDS.has(word));
  return `${host}/${words.join(" ")}`;
}
