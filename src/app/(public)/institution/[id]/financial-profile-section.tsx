import { UpgradeGate } from "@/components/upgrade-gate";
import type { FinancialPoint, PeerMedianPoints } from "./financial-history";
import { FinancialProfileCharts } from "./financial-profile";

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

export function FinancialProfileSection({
  isPro,
  points,
  peers,
  charterLabel,
}: {
  isPro: boolean;
  points: FinancialPoint[];
  peers: PeerMedianPoints | null;
  charterLabel: string;
}) {
  if (isPro && points.length === 0) return null;
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
          <FinancialProfileCharts points={points} peers={peers} charterLabel={charterLabel} />
        ) : (
          <div className="relative">
            <LockedPreview />
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="w-full max-w-md">
                <UpgradeGate message="Assets, earnings, loan mix, credit quality, and fee income: 10+ years of call-report history with peer benchmarks" />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
