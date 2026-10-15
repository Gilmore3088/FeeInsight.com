import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAssets } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { encodeLandingResearch, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import { INTELLIGENCE_LENSES, type Lens } from "@/lib/hamilton/market-question";
import type { AssetSize } from "@/lib/hamilton/asset-size";
import type { MarketBriefInput } from "@/lib/hamilton/board-brief";
import type { ReportExhibit } from "@/lib/hamilton/types";
import { readFindings, type Loaded } from "./IntelligenceWorkspace";

const CHARTER_LABEL: Record<LandingResearchHandoff["charter"], string> = { all: "Banks & credit unions", bank: "Banks", credit_union: "Credit unions" };
const dollars = (v: number | null | undefined) => v == null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

/**
 * The board brief for a market view, built from the same loaded readers as the screen: Hamilton's
 * findings, the fee landscape, the largest institutions and the income trend, each with its source.
 */
export function marketBoardBriefInput(selection: LandingResearchHandoff, data: Loaded, lenses: readonly Lens[], size: AssetSize | null): MarketBriefInput {
  const state = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const place = state ? STATE_NAMES[state] ?? state : "the United States";
  const primary = selection.categories[0];
  const sized = size && size.id !== "all" ? size : null;
  const scopeLabel = `${CHARTER_LABEL[selection.charter]}${sized ? `, ${sized.label}` : ""}, ${state ? `headquartered in ${place}` : "nationwide"}`;
  const topics = INTELLIGENCE_LENSES.filter(l => lenses.includes(l.id)).map(l => l.label.toLowerCase());
  const exhibits: ReportExhibit[] = [];
  const sources: MarketBriefInput["sources"] = [];

  if (lenses.includes("fees") && data.fees?.comparisons.length) {
    exhibits.push({
      id: "peer_range", title: `Published fees in ${place}`, subtitle: `${CHARTER_LABEL[selection.charter]}${sized ? `, ${sized.label}` : ""} · one value per institution`,
      columns: ["Fee", "Median", "Middle half", "Institutions", ...(state ? ["U.S. median"] : [])],
      rows: data.fees.comparisons.map(c => [
        getDisplayName(c.category),
        c.selected.status === "available" ? dollars(c.selected.median) : c.selected.status === "insufficient" ? "Too few to compare" : "Not observed",
        c.selected.p25 !== null && c.selected.p75 !== null ? `${dollars(c.selected.p25)} to ${dollars(c.selected.p75)}` : "Unavailable",
        c.selected.institutions.toLocaleString(),
        ...(state ? [dollars(c.national?.median ?? null)] : []),
      ]),
      note: "Missing values are not $0 fees. Cohorts under the minimum are withheld.",
    });
    sources.push({ label: "Bank Fee Index · published fee catalog", detail: "Published consumer fees, one value per institution", url: null });
  }
  if (lenses.includes("fees") && data.peers?.rows.length && primary) {
    exhibits.push({
      id: "local_market", title: `Largest institutions in ${place}: ${getDisplayName(primary)}`, subtitle: `${Math.min(10, data.peers.rows.length)} of ${data.peers.institutionsInScope.toLocaleString()} in scope, largest by assets`,
      columns: ["Institution", "Assets", getDisplayName(primary), "Fee schedule"],
      rows: data.peers.rows.slice(0, 10).map(r => [r.name, formatAssets(r.totalAssets), dollars(r.amount), r.documentUrl ?? "No link"]),
      note: "Assets from FDIC and NCUA filings. Each amount links to the schedule it was read from.",
    });
  }
  if (lenses.includes("financials") && data.revenue?.quarters.length) {
    exhibits.push({
      id: "fee_income_trend", title: "Deposit service-charge income, United States", subtitle: "Latest four quarters, USD billions",
      columns: ["Quarter", "All filers", "Banks", "Credit unions", "Year over year"],
      rows: data.revenue.quarters.slice(0, 4).map(q => [q.quarter, `$${(q.total_service_charges / 1_000_000).toFixed(2)}B`, `$${(q.bank_service_charges / 1_000_000).toFixed(2)}B`, `$${(q.cu_service_charges / 1_000_000).toFixed(2)}B`, q.yoy_change_pct == null ? "Unavailable" : `${q.yoy_change_pct > 0 ? "+" : ""}${q.yoy_change_pct.toFixed(1)}%`]),
      note: state ? "A state total is not available yet; this is the national figure." : null,
    });
    sources.push({ label: "FDIC Call Reports (RIAD 4080) and NCUA 5300 filings", detail: `Reporting period: ${data.revenue.latest?.quarter ?? "not recorded"}`, url: null });
  }

  const findings = readFindings(data, state ? place : "the United States", state, primary).filter(f => lenses.includes(f.lens));
  const known = (label: string) => sources.some(s => s.label === label || (label.startsWith("Bank Fee Index") && s.label.startsWith("Bank Fee Index")));
  for (const f of findings) if (!known(f.source)) sources.push({ label: f.source, detail: "As cited in the findings", url: null });

  return {
    place,
    scopeLabel,
    topics: topics.length === INTELLIGENCE_LENSES.length ? "fees, finances and market" : topics.length > 1 ? `${topics.slice(0, -1).join(", ")} and ${topics[topics.length - 1]}` : topics[0] ?? "market",
    findings: findings.map(({ title, body, source }) => ({ title, body, source })),
    exhibits,
    sources,
    limits: [
      ...(sized ? [`Fee figures cover ${sized.label} institutions only.`] : []),
      ...(state && lenses.includes("financials") ? ["Service-charge income is reported nationally; a state total is not available yet."] : []),
      "Hamilton reports what the data shows. It does not recommend a price.",
    ],
    researchHref: `/pro/intelligence?${new URLSearchParams({ research: encodeLandingResearch(selection), lens: lenses[0] ?? "fees", ...(sized ? { size: sized.id } : {}) })}`,
  };
}
