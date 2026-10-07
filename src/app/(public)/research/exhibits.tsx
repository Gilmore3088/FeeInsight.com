import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME } from "@/lib/constants";
import type { Finding } from "./findings";
import { SectionHeading } from "./research-hero";

/** Half-width of the shared % axis in the bank vs credit union chart. */
const AXIS_PCT = 40;

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/** Consulting-style source line under every exhibit. */
export function ExhibitSource({ children, asOf }: { children: React.ReactNode; asOf: string | null }) {
  return (
    <p className="mt-3 border-t border-[#E8DFD1] pt-2 text-[11px] leading-snug text-[#8A8072]">
      <span className="font-semibold text-[#6B6255]">Source:</span> {PRODUCT_NAME}, verified published fee schedules.{" "}
      {children}
      {asOf ? ` Data as of ${asOf}.` : ""}
    </p>
  );
}

export function KeyFindings({ findings, asOf }: { findings: Finding[]; asOf: string | null }) {
  if (findings.length === 0) return null;
  return (
    <section id="findings" className="scroll-mt-28 print:break-after-page">
      <SectionHeading eyebrow="Executive summary" title="Key findings">
        What the verified data says right now. Each finding is recomputed from live data whenever the index refreshes,
        and links to the exhibit behind it.
      </SectionHeading>
      <ol className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-[#E8DFD1] bg-[#E8DFD1] md:grid-cols-2">
        {findings.map((f, i) => (
          <li key={f.key} className="bg-white">
            <a href={`#${f.exhibit}`} className="group flex h-full gap-5 p-6 transition-colors hover:bg-[#FAF7F2]">
              <span className="text-[13px] font-bold tabular-nums text-[#C44B2E]">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="block text-[2.25rem] font-semibold leading-none tabular-nums text-[#1A1815]" style={SERIF}>
                  {f.figure}
                </span>
                <span className="mt-2 block text-[15px] font-semibold text-[#1A1815] group-hover:text-[#A93D25]">{f.headline}</span>
                <span className="mt-1 block text-[13px] leading-relaxed text-[#6B6255]">{f.detail}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
      <ExhibitSource asOf={asOf}>Findings appear only where the sample clears the minimum for a median.</ExhibitSource>
    </section>
  );
}

type CharterRow = Pick<FeeCategorySummary, "fee_category" | "bank_median_amount" | "cu_median_amount">;

/** Dumbbell chart: bank median vs credit union median for each everyday fee. */
export function CharterExhibit({
  benchmarks,
  asOf,
  eyebrow = "Exhibit 2 · Banks vs credit unions",
  place,
}: {
  benchmarks: CharterRow[];
  asOf: string | null;
  eyebrow?: string;
  /** Where the medians are measured, e.g. a state name; omitted for national. */
  place?: string;
}) {
  const rows = benchmarks.filter((b) => b.bank_median_amount != null && b.cu_median_amount != null);
  if (rows.length === 0) return null;
  const cuCheaper = rows.filter((b) => b.cu_median_amount! < b.bank_median_amount!).length;

  return (
    <section id="charters" className="scroll-mt-28 print:break-inside-avoid">
      <SectionHeading
        eyebrow={eyebrow}
        title={`${place ? `${place} credit` : "Credit"} unions are lower on ${cuCheaper} of ${rows.length} ${place ? "fees" : "everyday fees"}`}
      >
        Median price at banks and at credit unions for each fee{place ? ` in ${place}` : ""}. The gap between the dots is
        what switching charter would typically save or cost.
      </SectionHeading>

      <div className="mt-7 rounded-2xl border border-[#E8DFD1] bg-white p-5 sm:p-7">
        <div className="mb-4 flex flex-wrap gap-5 text-[11px] text-[#6B6255]">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-[#1A1815]" /> Banks</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-[#7A7F3F]" /> Credit unions</span>
        </div>
        <ul className="space-y-5">
          {rows.map((b) => {
            const bank = b.bank_median_amount!;
            const cu = b.cu_median_amount!;
            const pct = bank > 0 ? ((cu - bank) / bank) * 100 : 0;
            const rounded = Math.round(pct);
            // Shared axis: bank median at the center, credit union dot at its % difference.
            const pos = 50 + (Math.max(-AXIS_PCT, Math.min(AXIS_PCT, pct)) / AXIS_PCT) * 50;
            return (
              <li key={b.fee_category} className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[200px_minmax(0,1fr)_170px]">
                <span className="text-[13px] font-semibold text-[#1A1815]">{getDisplayName(b.fee_category)}</span>
                <div className="relative h-6" aria-hidden="true">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#E8DFD1]" />
                  <div className="absolute inset-y-0 left-1/2 w-px bg-[#D4C9BA]" />
                  <div
                    className={`absolute top-1/2 h-1 -translate-y-1/2 rounded-full ${pct < 0 ? "bg-[#7A7F3F]/40" : "bg-[#C44B2E]/30"}`}
                    style={{ left: `${Math.min(50, pos)}%`, width: `${Math.abs(pos - 50)}%` }}
                  />
                  <div className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#1A1815] shadow" />
                  <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#7A7F3F] shadow" style={{ left: `${pos}%` }} />
                </div>
                <span className="whitespace-nowrap text-[12px] tabular-nums text-[#5A5347] sm:text-right">
                  {formatAmount(bank)} vs {formatAmount(cu)}{" "}
                  <span className={`font-semibold ${rounded < 0 ? "text-[#4F6B3A]" : rounded > 0 ? "text-[#A93D25]" : "text-[#8A8072]"}`}>
                    {rounded === 0 ? (cu === bank ? "same" : "<1%") : `${rounded > 0 ? "+" : ""}${rounded}%`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 grid text-[10px] uppercase tracking-wider text-[#8A8072] sm:grid-cols-[200px_minmax(0,1fr)_170px] sm:gap-x-6">
          <span />
          <span className="flex justify-between">
            <span>&larr; CUs cheaper (&minus;{AXIS_PCT}%)</span>
            <span>bank median</span>
            <span>CUs pricier (+{AXIS_PCT}%) &rarr;</span>
          </span>
        </div>
        <p className="mt-4 text-[11px] text-[#8A8072]">Percent is the credit union median relative to the bank median. Gaps beyond {AXIS_PCT}% are pinned to the edge.</p>
      </div>
      <ExhibitSource asOf={asOf}>One value per institution; a charter is shown only where it has enough institutions for a median.</ExhibitSource>
    </section>
  );
}
