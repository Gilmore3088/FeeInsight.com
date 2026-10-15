import { Lock } from "lucide-react";
import { TrackLink } from "@/components/track-link";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { formatCompactDollars } from "@/lib/format";
import { formatReportQuarter, type NormalizedFinancial } from "./financial-units";
import type { FinancialPoint, GrowthRow, OutlierFlag, PeerMedianPoints, PeerRankRow } from "./financial-history";
import { FinancialInsights } from "./financial-insights";
import { FinancialProfileCharts } from "./financial-profile";
import { BranchFootprintCard, ComplaintsCard, EnforcementCard, HoldingCompanyCard } from "./registry-cards";
import { RegulatoryWatchSection } from "./regulatory-watch";
import type { RegulatoryWatch } from "@/lib/data-store/regulatory-watch";
import type { BranchFootprint, ComplaintTrend, EnforcementRecord, HoldingCompanyProfile } from "@/lib/data-store/registry-profile";

/**
 * The locked state: this institution's own free call-report quarters (assets and service charge
 * income), drawn and blurred, so the visitor sees the shape of what Hamilton opens.
 */
function LockedPreview({ quarters }: { quarters: NormalizedFinancial[] }) {
  const series = [...quarters].reverse();
  const top = Math.max(1, ...series.map((q) => q.serviceChargeIncome ?? 0));
  return (
    <div aria-hidden className="pointer-events-none select-none blur-[5px]">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Total assets", formatCompactDollars(quarters[0]?.totalAssets ?? null)],
          ["Deposits", formatCompactDollars(quarters[0]?.totalDeposits ?? null)],
          ["Service charges", formatCompactDollars(quarters[0]?.serviceChargeIncome ?? null)],
          ["Branches", quarters[0]?.branchCount?.toLocaleString("en-US") ?? "N/A"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">{label}</p>
            <p className="mt-1 font-mono text-lg font-semibold text-ink">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-36 items-end gap-3 rounded-xl border border-border bg-surface-0 p-4">
        {series.map((q) => (
          <div key={q.reportDate} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t bg-ink/70" style={{ height: `${((q.serviceChargeIncome ?? 0) / top) * 100}%` }} />
            <span className="text-[10px] text-ink-muted">{formatReportQuarter(q.reportDate)}</span>
          </div>
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
  regulatoryWatch = null,
  exportHref = null,
  institutionName = null,
  plansHref = null,
  freeQuarters = [],
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
  /** The locked panel's plans link, opened on this institution's tier (buildPublicInstitutionProfileLinks). */
  plansHref?: string | null;
  /** The free call-report quarters, newest first, drawn blurred behind the lock. */
  freeQuarters?: NormalizedFinancial[];
}) {
  const hasRegistryCards = Boolean(footprint || complaints || holdingCompany || enforcement || regulatoryWatch);
  if (isPro && points.length === 0 && !hasRegistryCards) return null;
  const years = points.length > 0 ? Math.max(1, Math.round(points.length / 4)) : null;

  return (
    <section aria-label="Financial profile" className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">Financial profile</h2>
        </div>
        {isPro && years && (
          <p className="text-sm text-ink-muted">
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
                {regulatoryWatch && <RegulatoryWatchSection watch={regulatoryWatch} exportHref={exportHref} institutionName={institutionName} />}
              </div>
            )}
          </>
        ) : (
          <div className="grid">
            {/* Both layers share one grid cell, so the section is as tall as the taller of the two
                and the gate never spills onto the card below on a phone. */}
            <div className="[grid-area:1/1]">
              <LockedPreview quarters={freeQuarters} />
            </div>
            <div className="relative z-10 flex items-center justify-center p-4 [grid-area:1/1]">
              <div className="w-full max-w-md">
                <div className="rounded-xl border border-border bg-surface-0/95 p-5 text-center shadow-fi-2">
                  <Lock className="mx-auto h-5 w-5 text-ink" aria-hidden="true" />
                  <p className="mt-2 text-[15px] font-semibold text-ink">Call-report history with peer rank, branch footprint, complaints and enforcement actions</p>
                  <TrackLink
                    event="upgrade_click"
                    eventProps={{ placement: "institution_financial_lock" }}
                    href={plansHref ?? "/subscribe#pro"}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-on-ink hover:opacity-90"
                  >
                    {PRO_PLANS_NAV.label}
                  </TrackLink>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
