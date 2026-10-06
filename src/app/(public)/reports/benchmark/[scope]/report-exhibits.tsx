import Link from "next/link";
import { Lock } from "lucide-react";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME } from "@/lib/constants";
import { PrintButton } from "../../../research/print-button";
import { SectionHeading } from "../../../research/research-hero";
import { ExhibitSource } from "../../../research/exhibits";
import { formatDelta, type StateComparison } from "@/lib/research-report/state-findings";
import { MIN_BENCHMARK_INSTITUTIONS, MIN_CHARTER_INSTITUTIONS } from "./report-data";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/** Where the locked institution report's button goes: the paid request on For Institutions. */
export const INSTITUTION_REPORT_HREF = "/for-institutions?report=institution#report";

export interface HeroStat {
  value: string;
  label: string;
  note: string;
}

export function ReportHero({
  eyebrow,
  title,
  lede,
  stats,
  freshnessLabel,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  stats: HeroStat[];
  freshnessLabel: string;
}) {
  return (
    <section className="relative overflow-hidden bg-[#1A1815] text-[#F5EFE6]">
      <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pb-12 sm:pt-12">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#E8A48F]">
          <span aria-hidden="true" className="h-px w-8 bg-[#E8A48F]/60" />
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-[2.25rem] font-normal leading-[1.05] tracking-[-0.015em] text-white sm:text-[3.25rem]" style={SERIF}>
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[#F5EFE6]/80 sm:text-base">{lede}</p>

        <dl className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-[#1A1815] px-5 py-5">
              <dt className="sr-only">{s.label}</dt>
              <dd>
                <span className="block text-[2rem] font-semibold leading-none tabular-nums text-white sm:text-[2.5rem]" style={SERIF}>
                  {s.value}
                </span>
                <span className="mt-2 block text-[13px] font-semibold text-[#F5EFE6]">{s.label}</span>
                <span className="mt-0.5 block text-[11px] text-[#F5EFE6]/60">{s.note}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[12px]">
          <span className="inline-flex items-center gap-2 text-[#F5EFE6]/75">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7FB77E]" />
            {freshnessLabel}
          </span>
          <Link href="/methodology" className="text-[#F5EFE6]/75 hover:text-white print:hidden">
            Methodology
          </Link>
          <PrintButton className="rounded-full border border-white/25 px-3.5 py-1.5 font-semibold text-white hover:bg-white/10 print:hidden" />
        </div>
      </div>
    </section>
  );
}

function pct(value: number, scaleMax: number): number {
  return Math.max(0, Math.min(100, (value / scaleMax) * 100));
}

function RangeTrack({
  label,
  median,
  p25,
  p75,
  scaleMax,
  tone,
}: {
  label: string;
  median: number;
  p25: number | null;
  p75: number | null;
  scaleMax: number;
  tone: "area" | "national";
}) {
  const band = tone === "area" ? "bg-[#C44B2E]/25" : "bg-[#1A1815]/12";
  const tick = tone === "area" ? "bg-[#C44B2E]" : "bg-[#1A1815]/70";
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)_56px] items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8A8072]">{label}</span>
      <div className="relative h-2.5 rounded-full bg-[#F1EBE1]" aria-hidden="true">
        {p25 != null && p75 != null && (
          <div
            className={`absolute inset-y-0 rounded-full ${band}`}
            style={{ left: `${pct(p25, scaleMax)}%`, width: `${Math.max(pct(p75, scaleMax) - pct(p25, scaleMax), 1.5)}%` }}
          />
        )}
        <div className={`absolute -top-1 h-[18px] w-1 -translate-x-1/2 rounded-full ${tick}`} style={{ left: `${pct(median, scaleMax)}%` }} />
      </div>
      <span className="text-right text-[12px] font-semibold tabular-nums text-[#1A1815]">{formatAmount(median)}</span>
    </div>
  );
}

function BenchmarkCard({ row, areaLabel }: { row: StateComparison; areaLabel: string }) {
  const values = [row.median_amount, row.p75_amount ?? 0, row.national_median ?? 0, row.national_p75 ?? 0];
  const scaleMax = Math.max(...values) * 1.35 || 1;
  const delta = row.delta_pct;
  return (
    <div className="flex flex-col rounded-2xl border border-[#E8DFD1] bg-white p-5 print:break-inside-avoid">
      <p className="text-[12px] font-semibold text-[#5A5347]">{getDisplayName(row.fee_category)}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-[2.25rem] font-semibold leading-none tabular-nums text-[#1A1815]" style={SERIF}>
          {formatAmount(row.median_amount)}
        </span>
        {delta != null && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
              Math.abs(delta) < 1 ? "bg-[#F1EBE1] text-[#6B6255]" : delta < 0 ? "bg-[#4F6B3A]/10 text-[#4F6B3A]" : "bg-[#C44B2E]/10 text-[#A93D25]"
            }`}
          >
            {Math.abs(delta) < 1 ? "in line with US" : `${formatDelta(delta)} vs US`}
          </span>
        )}
      </p>
      <div className="mt-5 space-y-2.5">
        <RangeTrack label={areaLabel} median={row.median_amount} p25={row.p25_amount} p75={row.p75_amount} scaleMax={scaleMax} tone="area" />
        {row.national_median != null && (
          <RangeTrack label="US" median={row.national_median} p25={row.national_p25} p75={row.national_p75} scaleMax={scaleMax} tone="national" />
        )}
      </div>
      <p className="mt-auto pt-4 text-[11px] text-[#6B6255]">
        <span className="font-semibold tabular-nums text-[#1A1815]">{row.institution_count.toLocaleString()}</span> institutions
        <span className="text-[#8A8072]">
          {" "}
          · {row.bank_count.toLocaleString()} banks, {row.cu_count.toLocaleString()} CUs
        </span>
      </p>
    </div>
  );
}

export function BenchmarkBoard({
  rows,
  place,
  areaLabel,
  omitted,
  asOf,
}: {
  rows: StateComparison[];
  /** "the St. Louis district" or "the U.S." */
  place: string;
  /** Short label on the range bar, e.g. "D8" or "US". */
  areaLabel: string;
  omitted: number;
  asOf: string | null;
}) {
  const comparing = rows.some((r) => r.national_median != null);
  return (
    <section id="benchmarks" className="scroll-mt-28">
      <SectionHeading eyebrow="Exhibit 1 · Headline fees" title={`What institutions in ${place} charge`}>
        The tick is the median; the shaded band is where the middle half of institutions land.
        {comparing && " The top bar is the district, the bottom bar is the whole country."}
      </SectionHeading>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <BenchmarkCard key={row.fee_category} row={row} areaLabel={areaLabel} />
        ))}
      </div>
      <ExhibitSource asOf={asOf}>
        One value per institution. A fee is shown only when at least {MIN_BENCHMARK_INSTITUTIONS} institutions publish it
        {omitted > 0 ? `, so ${omitted} of the 15 headline fees are left out until more schedules are collected.` : "."}
      </ExhibitSource>
    </section>
  );
}

const LOCKED_ROWS = ["Overdraft", "NSF / returned item", "Monthly maintenance", "Outgoing domestic wire", "Stop payment"];

const INSTITUTION_REPORT_ADDS = [
  "Your own published fees on every line, next to named competitors in your market",
  "Where you sit above or below your peer band, fee by fee",
  "Peer sets by charter, asset size, state and district",
  "A source citation for every figure",
];

/** The paid next step, shown grayed out: one institution against named competitors. */
export function LockedInstitutionReport() {
  return (
    <section id="institution" className="scroll-mt-28 print:hidden">
      <div className="grid gap-8 rounded-2xl border border-[#E8DFD1] bg-[#F4EFE7] p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Institution report
          </p>
          <h2 className="mt-2 text-[1.6rem] font-normal leading-tight text-[#1A1815] sm:text-[2rem]" style={SERIF}>
            Where does your institution stand?
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-[#5A5347]">
            This report shows the market. The institution report shows you in it.
          </p>
          <ul className="mt-4 space-y-2">
            {INSTITUTION_REPORT_ADDS.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[14px] text-[#3D372F]">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C44B2E]" />
                {item}
              </li>
            ))}
          </ul>
          <Link
            href={INSTITUTION_REPORT_HREF}
            className="mt-6 inline-flex items-center rounded-full bg-[#C44B2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#A93D25]"
          >
            Request your institution report
          </Link>
          <p className="mt-2 text-[12px] text-[#6B6255]">We reply within one business day with scope and price.</p>
        </div>

        <div aria-hidden="true" className="select-none overflow-hidden rounded-xl border border-[#E0D7C9] bg-white/70">
          <div className="flex items-center justify-between border-b border-[#E0D7C9] px-4 py-3">
            <span className="text-[12px] font-semibold text-[#8A8072]">Your institution vs named local competitors</span>
            <Lock className="h-3.5 w-3.5 text-[#B5AA9B]" />
          </div>
          <table className="w-full text-[13px] text-[#9A9083]">
            <thead>
              <tr className="border-b border-[#EFE8DC] text-left text-[10px] uppercase tracking-wider">
                <th className="px-4 py-2 font-semibold">Fee</th>
                <th className="px-3 py-2 text-right font-semibold">You</th>
                <th className="px-3 py-2 text-right font-semibold">Competitors</th>
                <th className="px-4 py-2 font-semibold">Position</th>
              </tr>
            </thead>
            <tbody>
              {LOCKED_ROWS.map((fee) => (
                <tr key={fee} className="border-b border-[#EFE8DC] last:border-b-0">
                  <td className="px-4 py-2.5">{fee}</td>
                  <td className="px-3 py-2.5 text-right"><span className="inline-block h-2.5 w-10 rounded bg-[#E0D7C9]" /></td>
                  <td className="px-3 py-2.5 text-right"><span className="inline-block h-2.5 w-16 rounded bg-[#E0D7C9]" /></td>
                  <td className="px-4 py-2.5"><span className="inline-block h-2.5 w-20 rounded bg-[#E0D7C9]" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function ReportMethodology({ area, district = false }: { area: string; district?: boolean }) {
  return (
    <section id="methodology" className="scroll-mt-28 rounded-2xl border border-[#E8DFD1] bg-white p-6 sm:p-8">
      <SectionHeading eyebrow="Methodology" title="How this report is built" />
      <div className="mt-5 grid gap-5 text-[13px] leading-relaxed text-[#5A5347] md:grid-cols-3">
        <p>
          <span className="block font-semibold text-[#1A1815]">Sources.</span>
          Published fee schedules from FDIC-insured banks and NCUA-insured credit unions in {area}. Every fee is read from
          the institution&apos;s own document and verified before it is published.
          {district && " Institutions are placed in a Fed district by their headquarters state."}
        </p>
        <p>
          <span className="block font-semibold text-[#1A1815]">Statistics.</span>
          Each institution counts once per fee. A fee appears only with at least {MIN_BENCHMARK_INSTITUTIONS} institutions
          behind it, and a bank or credit union median needs at least {MIN_CHARTER_INSTITUTIONS}.
        </p>
        <p>
          <span className="block font-semibold text-[#1A1815]">Comparison.</span>
          The national figure is the same statistic over every institution in the {PRODUCT_NAME}. Differences under 1% are
          shown as in line.{" "}
          <Link href="/methodology" className="font-semibold text-[#A93D25] hover:underline print:hidden">
            Full methodology &rarr;
          </Link>
        </p>
      </div>
    </section>
  );
}
