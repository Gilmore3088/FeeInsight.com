/**
 * The one report request form: /reports, opened on the institution report (#1171). Every report
 * button links here directly, so a visitor reaches the form in one click.
 */
const REPORT_REQUEST_PATH = "/reports";
const REPORT_REQUEST_ANCHOR = "#request";

/** The form with no context: the institution report. */
export const REPORT_REQUEST_HREF = `${REPORT_REQUEST_PATH}?report=institution${REPORT_REQUEST_ANCHOR}`;

/**
 * The form link carrying the context a button already has (the bank, its name, `src`), so the form
 * opens prefilled. `report` defaults to the institution report; a link that names another report
 * type keeps it. Empty values are left out.
 */
export function reportRequestHref(context: Record<string, string | null | undefined> = {}): string {
  const params = new URLSearchParams({ report: context.report || "institution" });
  for (const [key, value] of Object.entries(context)) {
    if (key !== "report" && typeof value === "string" && value !== "") params.set(key, value);
  }
  return `${REPORT_REQUEST_PATH}?${params.toString()}${REPORT_REQUEST_ANCHOR}`;
}
