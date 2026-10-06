import Link from "next/link";
import type { CitySummary } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { formatCount } from "@/lib/public-stats";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { PRODUCT_NAME } from "@/lib/constants";
import { PrintButton } from "../../print-button";
import { SectionHeading } from "../../research-hero";
import { ExhibitSource } from "../../exhibits";
import { STATE_FINDING_MIN_INSTITUTIONS, formatDelta, type StateComparison } from "./state-findings";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/** Widest half-width of the % axis in the position chart; larger gaps are pinned to the edge. */
const POSITION_AXIS_MAX_PCT = 50;

/** Axis half-width that fits the largest gap, in steps of 10%, between 10% and the maximum. */
function positionAxis(deltas: number[]): number {
  const widest = Math.max(0, ...deltas.map((d) => Math.abs(d)));
  return Math.min(POSITION_AXIS_MAX_PCT, Math.max(10, Math.ceil(widest / 10) * 10));
}

export const STATE_SECTIONS = [
  { id: "findings", label: "Key findings" },
  { id: "benchmarks", label: "Everyday fees" },
  { id: "position", label: "vs national" },
  { id: "charters", label: "Banks vs CUs" },
  { id: "economy", label: "Economy & regulation" },
  { id: "coverage", label: "Coverage & cities" },
  { id: "table", label: "Full table" },
  { id: "methodology", label: "Methodology" },
] as const;

function SmallSample() {
  return (
    <span className="ml-1.5 rounded-full bg-[#F1EBE1] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#8A8072]">
      small sample
    </span>
  );
}

interface StateHeroProps {
  stateCode: string;
  stateName: string;
  district: number | undefined;
  monitored: number;
  verifiedInstitutions: number;
  verifiedFees: number;
  categoriesWithMedian: number;
  freshnessLabel: string;
}

export function StateHero(props: StateHeroProps) {
  const { stateName, district, monitored, verifiedInstitutions, verifiedFees, categoriesWithMedian, freshnessLabel } = props;
  const coverage = monitored > 0 ? Math.round((verifiedInstitutions / monitored) * 100) : 0;
  const stats = [
    { value: formatCount(verifiedInstitutions), label: "institutions with verified fees", note: `of ${formatCount(monitored)} we monitor in ${stateName}` },
    { value: formatCount(verifiedFees), label: "verified fees", note: "each traced to a published schedule" },
    { value: String(categoriesWithMedian), label: "fees with a state median", note: "at least 5 institutions each" },
    { value: `${coverage}%`, label: "coverage", note: "of monitored institutions, growing monthly" },
  ];

  return (
    <section className="relative overflow-hidden bg-[#1A1815] text-[#F5EFE6]">
      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-10">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-[#F5EFE6]/60 print:hidden">
          <Link href="/" className="hover:text-white">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/research" className="hover:text-white">Research</Link>
          <span aria-hidden="true">/</span>
          <span className="text-[#F5EFE6]/85">{stateName}</span>
        </nav>
        <p className="mt-6 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#E8A48F]">
          <span aria-hidden="true" className="h-px w-8 bg-[#E8A48F]/60" />
          State fee report{district ? ` · ${DISTRICT_NAMES[district]} Fed` : ""}
        </p>
        <h1 className="mt-3 max-w-3xl text-[2.25rem] font-normal leading-[1.05] tracking-[-0.015em] text-white sm:text-[3.25rem]" style={SERIF}>
          {stateName} bank &amp; credit union fees
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[#F5EFE6]/80 sm:text-base">
          What {stateName} banks and credit unions charge for everyday services, measured against the national{" "}
          {PRODUCT_NAME}. Every number comes from verified, published fee schedules.
        </p>

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
          {district && (
            <Link href={`/research/district/${district}`} className="font-semibold text-[#E8A48F] hover:text-white">
              {DISTRICT_NAMES[district]} district report &rarr;
            </Link>
          )}
          <Link href="/methodology" className="text-[#F5EFE6]/75 hover:text-white">
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

function RangeTrack({ label, median, p25, p75, scaleMax, tone }: { label: string; median: number; p25: number | null; p75: number | null; scaleMax: number; tone: "state" | "national" }) {
  const band = tone === "state" ? "bg-[#C44B2E]/25" : "bg-[#1A1815]/12";
  const tick = tone === "state" ? "bg-[#C44B2E]" : "bg-[#1A1815]/70";
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

function StateBenchmarkCard({ row, stateCode }: { row: StateComparison; stateCode: string }) {
  const values = [row.median_amount, row.p75_amount ?? 0, row.national_median ?? 0, row.national_p75 ?? 0];
  const scaleMax = Math.max(...values) * 1.35 || 1;
  const delta = row.delta_pct;
  return (
    <Link
      href={`/fees/${row.fee_category}`}
      className="group flex flex-col rounded-2xl border border-[#E8DFD1] bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-[#C44B2E]/30 hover:shadow-lg hover:shadow-[#C44B2E]/5"
    >
      <p className="text-[12px] font-semibold text-[#5A5347] group-hover:text-[#A93D25]">
        {getDisplayName(row.fee_category)}
        {row.institution_count < STATE_FINDING_MIN_INSTITUTIONS && <SmallSample />}
      </p>
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
            {formatDelta(delta)} vs US
          </span>
        )}
      </p>
      <div className="mt-5 space-y-2.5">
        <RangeTrack label={stateCode} median={row.median_amount} p25={row.p25_amount} p75={row.p75_amount} scaleMax={scaleMax} tone="state" />
        {row.national_median != null && (
          <RangeTrack label="US" median={row.national_median} p25={row.national_p25} p75={row.national_p75} scaleMax={scaleMax} tone="national" />
        )}
      </div>
      <p className="mt-auto pt-4 text-[11px] text-[#6B6255]">
        <span className="font-semibold tabular-nums text-[#1A1815]">{row.institution_count}</span> {stateCode} institutions
        <span className="text-[#8A8072]"> · {row.bank_count} banks, {row.cu_count} CUs</span>
      </p>
    </Link>
  );
}

export function StateBenchmarkBoard({ rows, stateCode, stateName, asOf }: { rows: StateComparison[]; stateCode: string; stateName: string; asOf: string | null }) {
  return (
    <section id="benchmarks" className="scroll-mt-28 print:break-inside-avoid">
      <SectionHeading eyebrow="Exhibit 1 · Everyday fees" title={`${stateName} against the national benchmark`}>
        The tick is the median; the shaded band is where the middle half of institutions land. The top bar is{" "}
        {stateName}, the bottom bar is the whole country.
      </SectionHeading>
      {rows.length > 0 ? (
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((row) => (
            <StateBenchmarkCard key={row.fee_category} row={row} stateCode={stateCode} />
          ))}
        </div>
      ) : (
        <p className="mt-7 rounded-2xl border border-dashed border-[#D4C9BA] px-5 py-8 text-center text-[13px] text-[#6B6255]">
          Not enough {stateName} institutions have verified everyday fees yet for a state median. Coverage grows with
          every monthly pass.
        </p>
      )}
      <ExhibitSource asOf={asOf}>
        One value per institution; a state median needs at least 5 institutions. &ldquo;Small sample&rdquo; marks fewer
        than {STATE_FINDING_MIN_INSTITUTIONS}.
      </ExhibitSource>
    </section>
  );
}

/** Diverging bars: how far each state median sits above or below the national median. */
export function PositionExhibit({ rows, stateName, asOf, gate }: { rows: StateComparison[]; stateName: string; asOf: string | null; gate?: React.ReactNode }) {
  const withDelta = rows.filter((r) => r.delta_pct != null).sort((a, b) => b.delta_pct! - a.delta_pct!);
  if (withDelta.length === 0) return null;
  const above = withDelta.filter((r) => r.delta_pct! >= 1).length;
  const below = withDelta.filter((r) => r.delta_pct! <= -1).length;
  const axis = positionAxis(withDelta.map((r) => r.delta_pct!));

  return (
    <section id="position" className="scroll-mt-28 print:break-inside-avoid">
      <SectionHeading eyebrow="Exhibit 2 · Position vs national" title={`${above} ${above === 1 ? "fee" : "fees"} above national, ${below} below`}>
        Each bar is the {stateName} median relative to the national median for the same fee. Right of center means{" "}
        {stateName} institutions typically charge more.
      </SectionHeading>
      <div className="mt-7 rounded-2xl border border-[#E8DFD1] bg-white p-5 sm:p-7">
        <ul className="space-y-2.5">
          {withDelta.map((r) => {
            const d = r.delta_pct!;
            const width = (Math.min(Math.abs(d), axis) / axis) * 50;
            const small = r.institution_count < STATE_FINDING_MIN_INSTITUTIONS;
            return (
              <li key={r.fee_category} className={`grid items-center gap-x-5 gap-y-1 sm:grid-cols-[210px_minmax(0,1fr)_180px] ${small ? "opacity-70" : ""}`}>
                <Link href={`/fees/${r.fee_category}`} className="truncate text-[13px] font-semibold text-[#1A1815] hover:text-[#A93D25]">
                  {getDisplayName(r.fee_category)}
                  {small && <SmallSample />}
                </Link>
                <div className="relative h-5" aria-hidden="true">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-[#D4C9BA]" />
                  {Math.abs(d) >= 1 ? (
                    <div
                      className={`absolute top-1/2 h-3 -translate-y-1/2 ${d > 0 ? "rounded-r-full bg-[#C44B2E]/70" : "rounded-l-full bg-[#7A7F3F]/70"}`}
                      style={d > 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
                    />
                  ) : (
                    <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8A8072]" />
                  )}
                </div>
                <span className="whitespace-nowrap text-[12px] tabular-nums text-[#5A5347] sm:text-right">
                  <span className={`font-semibold ${Math.abs(d) < 1 ? "text-[#8A8072]" : d > 0 ? "text-[#A93D25]" : "text-[#4F6B3A]"}`}>
                    {Math.abs(d) < 1 ? "in line" : formatDelta(d)}
                  </span>{" "}
                  · {formatAmount(r.median_amount)} vs {formatAmount(r.national_median)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 grid text-[10px] uppercase tracking-wider text-[#8A8072] sm:grid-cols-[210px_minmax(0,1fr)_180px] sm:gap-x-5">
          <span />
          <span className="flex justify-between">
            <span>&larr; cheaper (&minus;{axis}%)</span>
            <span>national</span>
            <span>pricier (+{axis}%) &rarr;</span>
          </span>
        </div>
      </div>
      {gate}
      <ExhibitSource asOf={asOf}>
        Percent difference between the {stateName} median and the national median. Gaps beyond {POSITION_AXIS_MAX_PCT}% are
        pinned to the edge.
      </ExhibitSource>
    </section>
  );
}

function CoverageBar({ label, verified, monitored }: { label: string; verified: number; monitored: number }) {
  const share = monitored > 0 ? verified / monitored : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-semibold text-[#1A1815]">{label}</span>
        <span className="whitespace-nowrap tabular-nums text-[#5A5347]">
          <span className="font-semibold text-[#1A1815]">{formatCount(verified)}</span> of {formatCount(monitored)}
        </span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#F1EBE1]" aria-hidden="true">
        <div className="h-full rounded-full bg-[#C44B2E]/70" style={{ width: `${Math.max(share * 100, verified > 0 ? 1 : 0)}%` }} />
      </div>
    </div>
  );
}

export function CoverageExhibit(props: {
  stateCode: string;
  stateName: string;
  district: number | undefined;
  districtStates: string[];
  banks: { verified: number; monitored: number };
  cus: { verified: number; monitored: number };
  cities: CitySummary[];
  asOf: string | null;
}) {
  const { stateCode, stateName, district, districtStates, banks, cus, cities, asOf } = props;
  return (
    <section id="coverage" className="scroll-mt-28 print:break-inside-avoid">
      <SectionHeading
        eyebrow="Exhibit 5 · Coverage & local markets"
        title="Who is in the data"
        action={
          <Link
            href={`/institutions?state=${stateCode}`}
            className="rounded-full border border-[#1A1815] px-4 py-2 text-[12px] font-semibold text-[#1A1815] transition-colors hover:bg-[#1A1815] hover:text-white print:hidden"
          >
            All {stateName} institutions &rarr;
          </Link>
        }
      >
        How many of the state&apos;s banks and credit unions have verified fees so far, and the cities with the most.
        Coverage grows with every monthly pass.
      </SectionHeading>

      <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rounded-2xl border border-[#E8DFD1] bg-white p-5 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Verified vs monitored</p>
          <div className="mt-4 space-y-4">
            <CoverageBar label="Banks" verified={banks.verified} monitored={banks.monitored} />
            <CoverageBar label="Credit unions" verified={cus.verified} monitored={cus.monitored} />
          </div>
          {district && districtStates.length > 0 && (
            <div className="mt-6 border-t border-[#F1EBE1] pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">
                Other {DISTRICT_NAMES[district]} district states
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {districtStates.map((code) => (
                  <Link
                    key={code}
                    href={`/research/state/${code}`}
                    className="rounded-full border border-[#E8DFD1] px-2.5 py-1 text-[12px] font-medium text-[#5A5347] hover:border-[#C44B2E]/40 hover:text-[#A93D25]"
                  >
                    {STATE_NAMES[code] ?? code}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#E8DFD1] bg-white p-5 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Cities with the most verified institutions</p>
          {cities.length > 0 ? (
            <ol className="mt-3 grid gap-x-6 sm:grid-cols-2">
              {cities.map((c, i) => (
                <li key={c.city} className="border-b border-[#F1EBE1] last:border-0 sm:[&:nth-last-child(2)]:border-0">
                  <Link
                    href={`/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(c.city.toLowerCase())}`}
                    className="group flex items-center gap-3 py-2 text-[13px]"
                  >
                    <span className="w-5 text-right text-[11px] font-bold tabular-nums text-[#C44B2E]">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-[#1A1815] group-hover:text-[#A93D25]">{c.city}</span>
                    <span className="whitespace-nowrap text-[12px] tabular-nums text-[#6B6255]">
                      {c.with_fees} of {c.institution_count}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-[13px] text-[#6B6255]">No city in {stateName} has verified fees yet.</p>
          )}
        </div>
      </div>
      <ExhibitSource asOf={asOf}>
        Monitored institutions are FDIC-insured banks and NCUA-insured credit unions headquartered in {stateName}.
      </ExhibitSource>
    </section>
  );
}

export function FullTable({ rows, stateName, gate, asOf }: { rows: StateComparison[]; stateName: string; gate?: React.ReactNode; asOf: string | null }) {
  if (rows.length === 0) return null;
  const th = "px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]";
  return (
    <section id="table" className="scroll-mt-28">
      <SectionHeading eyebrow="Appendix · Full benchmark table" title={`Every fee with a ${stateName} median`}>
        Medians, the middle half of prices, and the national comparison for each fee category.
      </SectionHeading>
      <div className="mt-7 overflow-hidden rounded-2xl border border-[#E8DFD1] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#E8DFD1] bg-[#FAF7F2]">
                <th className={th}>Fee</th>
                <th className={`${th} text-right`}>{stateName} median</th>
                <th className={`${th} text-right`}>Middle half</th>
                <th className={`${th} text-right`}>National median</th>
                <th className={`${th} text-right`}>vs national</th>
                <th className={`${th} text-right`}>Institutions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1EBE1]">
              {rows.map((r) => (
                <tr key={r.fee_category} className="hover:bg-[#FAF7F2]/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/fees/${r.fee_category}`} className="font-medium text-[#1A1815] hover:text-[#A93D25]">
                      {getDisplayName(r.fee_category)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[#1A1815]">{formatAmount(r.median_amount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
                    {r.p25_amount != null && r.p75_amount != null ? `${formatAmount(r.p25_amount)} – ${formatAmount(r.p75_amount)}` : "–"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">{formatAmount(r.national_median)}</td>
                  <td
                    className={`px-4 py-2.5 text-right text-[12px] font-semibold tabular-nums ${
                      r.delta_pct == null || Math.abs(r.delta_pct) < 1 ? "text-[#8A8072]" : r.delta_pct > 0 ? "text-[#A93D25]" : "text-[#4F6B3A]"
                    }`}
                  >
                    {r.delta_pct == null ? "–" : Math.abs(r.delta_pct) < 1 ? "in line" : formatDelta(r.delta_pct)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#5A5347]">{r.institution_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {gate}
      <ExhibitSource asOf={asOf}>Median and 25th to 75th percentile of one value per institution.</ExhibitSource>
    </section>
  );
}

export function StateMethodology({ stateName }: { stateName: string }) {
  return (
    <section id="methodology" className="scroll-mt-28 rounded-2xl border border-[#E8DFD1] bg-white p-6 sm:p-8">
      <SectionHeading eyebrow="Methodology" title="How this report is built" />
      <div className="mt-5 grid gap-5 text-[13px] leading-relaxed text-[#5A5347] md:grid-cols-3">
        <p>
          <span className="block font-semibold text-[#1A1815]">Sources.</span>
          Published fee schedules from FDIC-insured banks and NCUA-insured credit unions headquartered in {stateName}.
          Every fee is read from the institution&apos;s own document and verified before it is published.
        </p>
        <p>
          <span className="block font-semibold text-[#1A1815]">Statistics.</span>
          Each institution counts once per fee, so a bank that lists a fee several times does not outweigh one that lists
          it once. A median needs at least 5 institutions; headline findings need at least {STATE_FINDING_MIN_INSTITUTIONS}.
        </p>
        <p>
          <span className="block font-semibold text-[#1A1815]">Comparison.</span>
          The national figure is the same statistic over every institution in the {PRODUCT_NAME}. Differences under 1% are
          shown as in line. <Link href="/methodology" className="font-semibold text-[#A93D25] hover:underline print:hidden">Full methodology &rarr;</Link>
        </p>
      </div>
    </section>
  );
}
