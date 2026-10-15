import type { FinancialPoint, GrowthRow, OutlierFlag, PeerMedianPoints, PeerRankRow } from "./financial-history";
import { FinancialInsights } from "./financial-insights";
import { FinancialProfileCharts } from "./financial-profile";
import { BranchFootprintCard, ComplaintsCard, EnforcementCard, HoldingCompanyCard } from "./registry-cards";
import { RegulatoryWatchSection } from "./regulatory-watch";
import type { RegulatoryWatch } from "@/lib/data-store/regulatory-watch";
import type { BranchFootprint, ComplaintTrend, EnforcementRecord, HoldingCompanyProfile } from "@/lib/data-store/registry-profile";

export interface FinancialInsightData {
  growth: GrowthRow[];
  ranks: PeerRankRow[];
  flags: OutlierFlag[];
  peerCount: number | null;
  peerQuarter: string | null;
}

export function FinancialProfileSection({
  isPro,
  points,
  peers,
  insights = null,
  charterLabel,
  footprint = null,
  complaints = null,
  holdingCompany = null,
  enforcement = null,
  regulatoryWatch = null,
  exportHref = null,
  institutionName = null,
}: {
  isPro: boolean;
  points: FinancialPoint[];
  peers: PeerMedianPoints | null;
  insights?: FinancialInsightData | null;
  charterLabel: string;
  footprint?: BranchFootprint | null;
  complaints?: ComplaintTrend | null;
  holdingCompany?: HoldingCompanyProfile | null;
  enforcement?: EnforcementRecord | null;
  regulatoryWatch?: RegulatoryWatch | null;
  /** Pro: the analyst CSV of this institution's fees against peer benchmarks. */
  exportHref?: string | null;
  /** Named in the regulatory watch, which is read about the institution, not to it. */
  institutionName?: string | null;
}) {
  const hasRegistryCards = Boolean(footprint || complaints || holdingCompany || enforcement || regulatoryWatch);
  // Pro only: free visitors get one complete Hamilton finding instead (hamilton-band.tsx).
  if (!isPro || (points.length === 0 && !hasRegistryCards)) return null;
  const years = points.length > 0 ? Math.max(1, Math.round(points.length / 4)) : null;

  return (
    <section aria-label="Financial profile" className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">Financial profile</h2>
        </div>
        {years && (
          <p className="text-sm text-ink-muted">
            {points.length} quarters{years > 1 ? ` (~${years} years)` : ""} of call reports
          </p>
        )}
      </div>

      <div className="mt-4">
        <>
          {insights && (
            <div className="mb-5">
              <FinancialInsights {...insights} charterLabel={charterLabel} />
            </div>
          )}
          {points.length > 0 && <FinancialProfileCharts points={points} peers={peers} charterLabel={charterLabel} />}
          {hasRegistryCards && (
            <div className="mt-4 grid gap-4">
              {footprint && <BranchFootprintCard footprint={footprint} />}
              <div className="grid gap-4 lg:grid-cols-2">
                {complaints && <ComplaintsCard trend={complaints} />}
                {enforcement && <EnforcementCard record={enforcement} />}
                {holdingCompany && <HoldingCompanyCard profile={holdingCompany} />}
              </div>
              {regulatoryWatch && <RegulatoryWatchSection watch={regulatoryWatch} exportHref={exportHref} institutionName={institutionName} />}
            </div>
          )}
        </>
      </div>
    </section>
  );
}
