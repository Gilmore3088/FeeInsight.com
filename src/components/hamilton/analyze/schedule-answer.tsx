/**
 * Engine answers that are not a storyline: every fee against its peer median (a whole-schedule
 * question, engine 1.10.0) and a list of sourced findings (for example why fee income sits
 * where it does, engine 1.11.0). Descriptive only: higher, lower or at the median, never ranked
 * by what to do.
 */
import Link from "next/link";
import type { Fact, SchedulePosition } from "@/lib/hamilton/workspace/types";
import { fmtMoney } from "@/components/hamilton/memo/memo";

const DIRECTION: Record<SchedulePosition["direction"], { text: string; cls: string }> = {
  higher: { text: "Higher", cls: "border-terra/40 bg-terra-soft text-terra-text" },
  at: { text: "At median", cls: "border-warm-300 bg-white text-warm-800" },
  lower: { text: "Lower", cls: "border-warm-300 bg-warm-100 text-warm-800" },
};

export function SchedulePositionsTable({
  rows,
  hrefFor,
}: {
  rows: SchedulePosition[];
  /** My fees for one fee, when the page can link there. */
  hrefFor?: (feeCategory: string) => string;
}) {
  if (rows.length === 0) return null;
  const count = (d: SchedulePosition["direction"]) => rows.filter((r) => r.direction === d).length;
  const labels = [...new Set(rows.map((r) => r.peerLabel))];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg text-warm-900">Every fee against its peer median</h3>
        <p className="text-sm text-warm-700 [font-variant-numeric:tabular-nums]">
          {count("lower")} lower · {count("at")} at median · {count("higher")} higher
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-warm-300 bg-white">
        <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className="border-b border-warm-200 text-left text-xs uppercase tracking-[0.08em] text-warm-600">
              <th scope="col" className="px-4 py-2.5 font-medium">Fee</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">You</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Peer median</th>
              <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Peers</th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                <span className="sr-only">Against the median</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.feeCategory} className="border-b border-warm-100 last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-normal text-warm-900">
                  {hrefFor ? (
                    <Link href={hrefFor(r.feeCategory)} className="hover:text-terra-text hover:underline">
                      {r.displayName}
                    </Link>
                  ) : (
                    r.displayName
                  )}
                </th>
                <td className="px-4 py-2.5 text-right font-medium text-warm-900">{fmtMoney(r.current)}</td>
                <td className="px-4 py-2.5 text-right text-warm-800">{fmtMoney(r.peerMedian)}</td>
                <td className="hidden px-4 py-2.5 text-right text-warm-700 sm:table-cell">{r.peerCount}</td>
                <td className="px-4 py-2.5">
                  <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${DIRECTION[r.direction].cls}`}>
                    {DIRECTION[r.direction].text}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-warm-600">
        Furthest from the median first. Peers: {labels.join("; ")}. Published fees verified against each institution&apos;s own schedule.
      </p>
    </section>
  );
}

/** Sourced findings, one per line, with where each figure comes from. */
export function FactList({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <ul className="flex max-w-[68ch] flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-white">
      {facts.map((f, i) => (
        <li key={i} className="flex flex-col gap-1 px-4 py-3">
          <span className="text-[15px] leading-relaxed text-warm-900 [font-variant-numeric:tabular-nums]">{f.text}</span>
          <span className="text-xs text-warm-600">
            {f.source.label}
            {f.source.asOf ? `, ${f.source.asOf}` : ""}
            {f.sampleSize != null ? ` · ${f.sampleSize} institutions` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
