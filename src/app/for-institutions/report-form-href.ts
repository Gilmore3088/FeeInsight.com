import { reportRequestHref } from "@/lib/report-request-href";

/** Lead attribution for a request that started here, when the link carried no `src`. */
const DEFAULT_SRC = "for-institutions";

type QueryParams = Record<string, string | string[] | undefined>;

/**
 * The /reports form link for a visitor who landed on `#report`. Older links (sent emails, profile
 * pages, /waitlist) carry the bank, the report type and `src` in the query, so those pass
 * through and the form opens prefilled; with none, it opens on the institution report.
 */
export function reportFormHref(query: QueryParams = {}): string {
  const context: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first !== "") context[key] = first;
  }
  if (!context.src) context.src = DEFAULT_SRC;
  return reportRequestHref(context);
}
