import { CheckCircle2 } from "lucide-react";

/**
 * Code-rendered example of Hamilton Benchmark mode, no image. Rows are real
 * figures from the sample report (Reports/studio/sample/, data pulled Oct 3, 2026):
 * only the client bank is anonymized; peers and peer medians are published data.
 */
const PEER_ROWS = [
  { institution: "Sample Community Bank (you)", nsf: "$33.00", monthly: "$10.00", wire: "$25.00", you: true },
  { institution: "Redwood Capital Bank, Eureka, CA", nsf: "$35.00", monthly: "$5.00", wire: "$15.00" },
  { institution: "Gateway Bank, Mendota Heights, MN", nsf: "$30.00", monthly: "$17.00", wire: "$25.00" },
  { institution: "First Community Bank of Central Alabama", nsf: "$33.00", monthly: "—", wire: "$20.00" },
  { institution: "Peer median (60 banks)", nsf: "$33.50", monthly: "$7.50", wire: "$20.00", median: true },
] as const;

const COLUMNS = ["NSF / returned item", "Monthly maintenance", "Domestic wire, out"] as const;

const CELL = "px-3 py-2 text-right tabular-nums";

export function HamiltonBenchmarkPreview({ className = "" }: { className?: string }) {
  return (
    <figure
      className={`overflow-hidden rounded-lg border border-warm-300 bg-white ${className}`}
      aria-label="Example of Hamilton Benchmark mode"
    >
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-warm-200 bg-warm-50 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600">
          Hamilton · Benchmark mode
        </span>
        <span className="text-[11px] text-warm-600">From the sample report · banks $300M–$1B</span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-b border-warm-200 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600">
              <th className="px-4 py-2 font-bold">Institution</th>
              {COLUMNS.map((column) => (
                <th key={column} className={`${CELL} font-bold`}>
                  {column}
                </th>
              ))}
              <th className="px-3 py-2 font-bold">Status</th>
            </tr>
          </thead>
          <tbody>
            {PEER_ROWS.map((row) => {
              const isYou = "you" in row && row.you;
              const isMedian = "median" in row && row.median;
              const rowClass = isYou
                ? "bg-terra-soft/60 font-semibold text-warm-900"
                : isMedian
                  ? "border-t-2 border-warm-300 bg-warm-50 font-semibold text-warm-800"
                  : "text-warm-700";
              return (
                <tr key={row.institution} className={`border-b border-warm-200 last:border-b-0 ${rowClass}`}>
                  <td className="px-4 py-2">{row.institution}</td>
                  <td className={CELL}>{row.nsf}</td>
                  <td className={CELL}>{row.monthly}</td>
                  <td className={CELL}>{row.wire}</td>
                  <td className="px-3 py-2">{isMedian ? "" : <VerifiedBadge />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-warm-200 px-4 py-3">
        <p className="text-[13px] leading-relaxed text-warm-800">
          Your NSF fee sits at the peer median; monthly maintenance is above the $7.50 median but
          inside the middle half of the market, and your outgoing domestic wire is at the 78th percentile.
        </p>
        <p className="mt-1.5 font-mono text-[11px] text-warm-600">
          Source: each bank&apos;s published fee schedule · Bank Fee Index, data pulled Oct 3, 2026
        </p>
      </div>
    </figure>
  );
}

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warm-300 bg-warm-50 px-2 py-0.5 text-[11px] font-semibold text-warm-700">
      <CheckCircle2 className="h-3 w-3 text-terra" aria-hidden="true" />
      Verified
    </span>
  );
}
