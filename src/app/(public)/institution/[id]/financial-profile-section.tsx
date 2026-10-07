import { UpgradeGate } from "@/components/upgrade-gate";
import type { FinancialPoint, GrowthRow, OutlierFlag, PeerMedianPoints, PeerRankRow } from "./financial-history";
import { FinancialInsights } from "./financial-insights";
import { FinancialProfileCharts } from "./financial-profile";
import { BranchFootprintCard, ComplaintsCard, EnforcementCard, HoldingCompanyCard } from "./registry-cards";
import type { BranchFootprint, ComplaintTrend, EnforcementRecord, HoldingCompanyProfile } from "@/lib/data-store/registry-profile";

/** Decorative silhouette for the locked state; contains no institution data. */
function LockedPreview() {
  const bars = [38, 44, 41, 52, 49, 58, 61, 57, 66, 70, 68, 76];
  return (
    <div aria-hidden className="pointer-events-none select-none blur-[3px]">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {["Total assets", "Net income", "Return on assets", "Net charge-off rate"].map((label) => (
          <div key={label} className="rounded-lg border border-[#E0D7C9] bg-white px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">{label}</p>
            <p className="mt-1 text-lg font-semibold text-[#1A1815]">— —</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex h-40 items-end gap-1.5 rounded-xl border border-[#E0D7C9] bg-white p-4">
        {bars.map((height, i) => (
          <div key={i} className="flex-1 rounded-t bg-[#2a78d6]/40" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}

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
}) {
  const hasRegistryCards = Boolean(footprint || complaints || holdingCompany || enforcement);
  if (isPro && points.length === 0 && !hasRegistryCards) return null;
  const years = points.length > 0 ? Math.max(1, Math.round(points.length / 4)) : null;

  return (
    <section className="border border-[#E0D7C9] bg-[#FFFDF9] p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
            Financial profile{!isPro && " · Pro"}
          </p>
          <h2 className="text-lg font-semibold text-[#1A1815]">Performance from regulator filings</h2>
        </div>
        {isPro && years && (
          <p className="text-sm text-[#6B6255]">
            {points.length} quarters{years > 1 ? ` (~${years} years)` : ""} of call reports
          </p>
        )}
      </div>

      <div className="mt-4">
        {isPro ? (
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
              </div>
            )}
          </>
        ) : (
          <div className="relative">
            <LockedPreview />
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="w-full max-w-md">
                <UpgradeGate message="Up to 16 years of call-report history with growth, peer rank and outliers, deposit mix and capital, branch footprint, consumer complaints, enforcement actions, and SEC filings" />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
