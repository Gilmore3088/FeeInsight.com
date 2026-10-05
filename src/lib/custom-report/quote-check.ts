import { findInstitutionIdByExactName, getCustomReportMarketData } from "@/lib/data-store/custom-report-market";
import { analyzeMarket, type ReadinessResult } from "./analysis";
import { createReportToken, reportPath } from "./link";

/**
 * What James sees when an institution report is requested: whether we can build that
 * institution's report from live data today. Nothing here reaches the requester; the
 * report is paid, so James quotes first and sends the private link only after they agree.
 */
export type QuoteCheck =
  | { status: "ready"; readiness: ReadinessResult; path: string | null }
  | { status: "thin"; readiness: ReadinessResult }
  | { status: "unmatched"; reason: string };

/** Never throws: a failed check reads as unmatched with the reason, and the request is still stored. */
export async function checkInstitutionReport(request: {
  institutionId: number | null;
  institutionName: string | null;
}): Promise<QuoteCheck> {
  let institutionId = request.institutionId;
  try {
    if (institutionId === null && request.institutionName) {
      institutionId = await findInstitutionIdByExactName(request.institutionName);
    }
    if (institutionId === null) {
      return { status: "unmatched", reason: "The request did not name an institution we could match." };
    }
    const data = await getCustomReportMarketData(institutionId);
    if (!data) return { status: "unmatched", reason: "The institution was not found." };
    const { readiness } = analyzeMarket(data);
    if (!readiness.ready) return { status: "thin", readiness };
    // The link needs CUSTOM_REPORT_LINK_SECRET; without it James still learns the report is buildable.
    const token = createReportToken(institutionId);
    return { status: "ready", readiness, path: token ? reportPath(token) : null };
  } catch (error) {
    console.error("[custom-report] quote check failed", {
      institutionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "unmatched", reason: "The data check failed; look the institution up by hand." };
  }
}

/** One line for James's email and the lead row, e.g. "Report check: ready to quote (9 fee lines, 22 local competitors)". */
export function describeQuoteCheck(check: QuoteCheck, siteUrl: string): string {
  if (check.status === "unmatched") return `Report check: ${check.reason}`;
  const r = check.readiness;
  const counts = `${r.comparableLines} comparable fee lines, ${r.competitorsWithData} of ${r.competitorsInMarket} local competitors with data`;
  if (check.status === "thin") {
    return `Report check: not ready to quote (${counts}). ${r.reason ?? "Local data is too thin."}`.trim();
  }
  const link = check.path ? ` Private report link to send after they agree: ${siteUrl.replace(/\/$/, "")}${check.path}` : "";
  return `Report check: ready to quote (${counts}).${link}`;
}
