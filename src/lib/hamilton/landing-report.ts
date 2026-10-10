import { getDisplayName } from "@/lib/fee-taxonomy";
import type { LandingResearchHandoff } from "./landing-research-handoff";
import type { LocalMarketAnswer } from "./local-market-answer";
import type { GeographicResearchResult } from "./landing-geographic-research";
import type { ReportSummaryResponse } from "./types";

const dollars = (v: number | null | undefined) => v == null ? "Not observed / insufficient evidence" : `$${v.toFixed(2)}`;
/** Data-only board draft using the existing saved report and PDF schema. No invented advice. */
export function buildLandingReport(selection: LandingResearchHandoff, result: LocalMarketAnswer | GeographicResearchResult, asOf: string): ReportSummaryResponse {
  const local = "competitors" in result ? result : null;
  const geographic = "comparisons" in result ? result : null;
  const scope = local ? `${local.institutionName}: ${local.market.label}` : selection.scope.kind === "state" ? selection.scope.stateCode : "United States";
  const charter = selection.charter === "all" ? "Banks and credit unions" : selection.charter === "bank" ? "Banks" : "Credit unions";
  const columns = local ? ["Institution", "Selected fee", "Published amount"] : ["Fee", "Selected median", "Institutions", "National median", "As of"];
  const rows = local ? [
    ...selection.categories.map(c => [local.institutionName + " (research subject)", getDisplayName(c), dollars(local.you.fees[c])]),
    ...local.competitors.flatMap(peer => selection.categories.map(c => [peer.name, getDisplayName(c), dollars(peer.fees[c])])),
  ] : geographic!.comparisons.map(row => [getDisplayName(row.category), dollars(row.selected.median), String(row.selected.institutions), row.national ? dollars(row.national.median) : "Not applicable", row.selected.lastUpdated ?? "Date unavailable"]);
  return {
    title: `${scope} — board research draft`,
    executiveSummary: [`${charter}. Selected fees: ${selection.categories.map(getDisplayName).join(", ")}.`, `Published fee research captured ${asOf}. This draft supports review; it is not a fee-change recommendation.`],
    snapshot: [], strategicRationale: "Compare the selected published fees and verify current schedules, product eligibility, waivers and charging frequency before making a pricing decision.",
    tradeoffs: [{ label: "Evidence limit", value: "Published records are not a fresh independent verification of each schedule. Missing fees are not $0. Thin geographic cohorts are withheld." }],
    recommendation: "Review the evidence and identify any missing schedules before presenting a pricing proposal.",
    implementationNotes: [`Research scope: ${JSON.stringify(selection)}`, "No revenue impact, regulatory conclusion or proposed price has been inferred."],
    exhibits: [{ id: local ? "local_market" : "statistical_appendix", title: "Selected published fee comparison", subtitle: `${scope} · ${charter}`, columns, rows, note: local ? "Local peers are ranked by branches in the market. Branch/deposit filings and published fees have different dates." : "State reference medians use the same charter nationally. Counts represent institutions, not fee rows." }],
    sources: local ? [
      { label: local.institutionName, detail: "Research subject: inspect fee schedule evidence on the institution page", url: `https://feeinsight.com/institution/${local.institutionId}` },
      ...local.competitors.map(p => ({ label: p.name, detail: p.evidenceDate ?? "Schedule date unavailable", url: p.evidenceUrl && /^https?:\/\//i.test(p.evidenceUrl) ? p.evidenceUrl : `https://feeinsight.com/institution/${p.institutionId}` })),
      ...local.sources.map(s => ({ label: s.label, detail: s.asOf ?? "Date unavailable", url: null })),
    ] : [{ label: "Bank Fee Index", detail: `Published consumer fee index; ${scope}; ${charter}; observation dates are shown in the table.`, url: "https://feeinsight.com/research/national-fee-index" }],
    exportControls: { pdfEnabled: true, shareEnabled: false },
  };
}
