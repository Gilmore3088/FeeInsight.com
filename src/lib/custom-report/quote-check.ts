import { findInstitutionIdByName, getCustomReportMarketData, type CustomReportMarketData } from "@/lib/data-store/custom-report-market";
import {
  HEADLINE_FEE_KEYS,
  MIN_RICH_COMPETITORS,
  RICH_MIN_CATEGORIES,
  getReportRuleCheck,
  type ReportRuleCheck,
} from "@/lib/data-store/market-readiness";
import { analyzeMarket, type ReadinessResult } from "./analysis";
import { createReportToken, reportPath } from "./link";

/**
 * What James sees when an institution report is requested: whether we can build that
 * institution's report from live data today. Nothing here reaches the requester; the
 * report is paid, so James quotes first and sends the private link only after they agree.
 * "Ready" needs both the local-market check (analysis.ts) and James's report rule
 * (market-readiness.ts), the same rule the public reports grid and /admin/leads count use.
 */
export type QuoteCheck =
  | {
      status: "ready";
      readiness: ReadinessResult;
      rule?: ReportRuleCheck | null;
      path: string | null;
      /** The market data that passed, so a paid report can keep exactly these numbers. */
      data?: CustomReportMarketData;
      /** The institution checked (given, or matched by name). */
      institutionId?: number;
    }
  | { status: "thin"; readiness: ReadinessResult; rule?: ReportRuleCheck | null; institutionId?: number }
  | { status: "unmatched"; reason: string };

/** Never throws: a failed check reads as unmatched with the reason, and the request is still stored. */
export async function checkInstitutionReport(request: {
  institutionId: number | null;
  institutionName: string | null;
}): Promise<QuoteCheck> {
  let institutionId = request.institutionId;
  try {
    if (institutionId === null && request.institutionName) {
      institutionId = await findInstitutionIdByName(request.institutionName);
    }
    if (institutionId === null) {
      return { status: "unmatched", reason: "The request did not name an institution we could match." };
    }
    const data = await getCustomReportMarketData(institutionId);
    if (!data) return { status: "unmatched", reason: "The institution was not found." };
    const { readiness } = analyzeMarket(data);
    const rule = await getReportRuleCheck(institutionId);
    if (!readiness.ready || !rule?.passes) return { status: "thin", readiness, rule, institutionId };
    // The link needs CUSTOM_REPORT_LINK_SECRET; without it James still learns the report is buildable.
    const token = createReportToken(institutionId);
    return { status: "ready", readiness, rule, path: token ? reportPath(token) : null, data, institutionId };
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
  const rule = check.rule ? ` ${describeReportRule(check.rule)}` : "";
  if (check.status === "thin") {
    const reason = r.ready ? "" : ` ${r.reason ?? "Local data is too thin."}`;
    return `Report check: not ready to quote (${counts}).${reason}${rule}`;
  }
  // Never the private link itself: this line goes in an email the requester can be sent
  // in a reply. The link is issued only when they pay (/pay/report and the Stripe webhook).
  const link = check.path
    ? ` Quote a price at ${siteUrl.replace(/\/$/, "")}/admin/leads; the private report link goes to them when they pay by card.`
    : " No private link: CUSTOM_REPORT_LINK_SECRET is not set.";
  return `Report check: ready to quote (${counts}).${rule}${link}`;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * e.g. "Report rule: passes (11 of 15 headline fees; 22 other credit unions in TX with 9+)."
 * On district peers: "Report rule: passes (10 of 15 headline fees; peers: Fed 12th District
 * banks, WA had too few; 18 other banks with 9+)."
 */
export function describeReportRule(rule: ReportRuleCheck): string {
  const peers = rule.charter_type === "credit_union" ? "credit unions" : "banks";
  const own = `${rule.ownCategories} of ${HEADLINE_FEE_KEYS.length} headline fees`;
  const counts =
    rule.peerScope === "district" && rule.fed_district
      ? `${own}; peers: Fed ${ordinal(rule.fed_district)} District ${peers}, ${rule.state_code ?? "the state"} had too few; ${rule.richCompetitors} other ${peers} with ${RICH_MIN_CATEGORIES}+`
      : `${own}; ${rule.richCompetitors} other ${peers}${rule.state_code ? ` in ${rule.state_code}` : ""} with ${RICH_MIN_CATEGORIES}+` +
        (!rule.passes && rule.fed_district && rule.districtRichCompetitors !== null
          ? `, ${rule.districtRichCompetitors} in the Fed ${ordinal(rule.fed_district)} District`
          : "");
  return rule.passes
    ? `Report rule: passes (${counts}).`
    : `Report rule: not met (${counts}; needs ${RICH_MIN_CATEGORIES}+ and ${MIN_RICH_COMPETITORS}+).`;
}
