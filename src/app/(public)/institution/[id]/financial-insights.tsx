import { formatCompactDollars } from "@/lib/format";
import type { GrowthRow, OutlierFlag, PeerRankRow } from "./financial-history";

/*
 * Gated growth, peer rank and outlier panel. Every figure is computed from the
 * call reports on file; a blank cell means the earlier quarter is missing.
 */

function growthCell(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${value > 0 ? "+" : ""}${rounded}%`;
}

function latestCell(row: GrowthRow): string {
  return row.kind === "count" ? Math.round(row.latest).toLocaleString("en-US") : formatCompactDollars(row.latest);
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function FinancialInsights({
  growth,
  ranks,
  flags,
  peerCount,
  peerQuarter,
  charterLabel,
}: {
  growth: GrowthRow[];
  ranks: PeerRankRow[];
  flags: OutlierFlag[];
  peerCount: number | null;
  peerQuarter: string | null;
  charterLabel: string;
}) {
  if (growth.length === 0 && ranks.length === 0 && flags.length === 0) return null;

  return (
    <div className="grid gap-4">
      {flags.length > 0 && (
        <div className="rounded-xl border border-[#E0D7C9] bg-white p-4">
          <p className="text-sm font-semibold text-[#1A1815]">Worth a look</p>
          <ul className="mt-2 grid gap-1.5 text-sm text-[#3D372F]">
            {flags.map((flag) => (
              <li key={flag.id} className="flex gap-2">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#A93D25]" />
                <span>{flag.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {growth.length > 0 && (
          <figure className="min-w-0 rounded-xl border border-[#E0D7C9] bg-white p-4">
            <figcaption className="text-sm font-semibold text-[#1A1815]">Growth</figcaption>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs tabular-nums">
                <thead className="text-[#6B6255]">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Line</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Latest</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Quarter</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Year</th>
                    <th className="py-1.5 pr-2 text-right font-medium">5Y / yr</th>
                    <th className="py-1.5 text-right font-medium">10Y / yr</th>
                  </tr>
                </thead>
                <tbody className="text-[#1A1815]">
                  {growth.map((row) => (
                    <tr key={row.key} className="border-t border-[#F1EBE1]">
                      <td className="py-1.5 pr-2">{row.label}</td>
                      <td className="py-1.5 pr-2 text-right">{latestCell(row)}</td>
                      <td className="py-1.5 pr-2 text-right">{growthCell(row.qoq)}</td>
                      <td className="py-1.5 pr-2 text-right">{growthCell(row.yoy)}</td>
                      <td className="py-1.5 pr-2 text-right">{growthCell(row.cagr5)}</td>
                      <td className="py-1.5 text-right">{growthCell(row.cagr10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-[#8A8174]">
              Balances compare quarter-end figures. Income lines compare four-quarter totals. 5Y and 10Y are
              compound annual rates. A dash means the earlier figure is not on file.
            </p>
          </figure>
        )}

        {ranks.length > 0 && (
          <figure className="min-w-0 rounded-xl border border-[#E0D7C9] bg-white p-4">
            <figcaption className="text-sm font-semibold text-[#1A1815]">Peer rank</figcaption>
            <ul className="mt-2 grid gap-2">
              {ranks.map((row) => (
                <li key={row.metric} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[#3D372F]">{row.label}</span>
                    <span className="font-medium tabular-nums text-[#1A1815]">{ordinal(row.percentile)} percentile</span>
                  </div>
                  <div
                    className="relative mt-1 h-1.5 rounded-full bg-[#EFE8DC]"
                    role="img"
                    aria-label={`${row.label}: ${ordinal(row.percentile)} percentile`}
                  >
                    <span
                      className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-[#2a78d6]"
                      style={{ left: `${Math.min(100, Math.max(0, row.percentile))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-[#8A8174]">
              Percentile = share of peers with a lower figure.
              {peerCount !== null &&
                ` Peers: ${peerCount.toLocaleString("en-US")} ${charterLabel.toLowerCase()} institutions in the same asset tier${peerQuarter ? `, ${peerQuarter}` : ""}.`}
            </p>
          </figure>
        )}
      </div>
    </div>
  );
}
