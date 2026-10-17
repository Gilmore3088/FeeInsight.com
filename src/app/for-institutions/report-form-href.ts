/** The one report request form (site v3 brief 05 §3-4, #1171): /reports sells the one-off. */
const REPORT_FORM_PATH = "/reports";
const REPORT_FORM_ANCHOR = "#request";
/** Lead attribution for a request that started here, when the link carried no `src`. */
const DEFAULT_SRC = "for-institutions";

type QueryParams = Record<string, string | string[] | undefined>;

/**
 * The /reports form link for a visitor who landed on `#report`. Older links (sent emails, profile
 * pages, /waitlist) carry the bank, the report type and `src` in the query, so those pass
 * through and the form opens prefilled; with none, it opens on the institution report.
 */
export function reportFormHref(query: QueryParams = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first !== "") params.set(key, first);
  }
  if (!params.has("report")) params.set("report", "institution");
  if (!params.has("src")) params.set("src", DEFAULT_SRC);
  return `${REPORT_FORM_PATH}?${params.toString()}${REPORT_FORM_ANCHOR}`;
}
