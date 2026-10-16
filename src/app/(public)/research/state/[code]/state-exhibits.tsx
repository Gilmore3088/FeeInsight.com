import Link from "next/link";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";
import { PrintButton } from "../../print-button";
import { SectionHeading } from "../../research-hero";
import { ExhibitSource } from "../../exhibits";
import {
  POSITION_AXIS_MAX_PCT,
  STATE_FINDING_MIN_INSTITUTIONS,
  formatDelta,
  positionAxis,
  type StateComparison,
} from "@/lib/research-report/state-findings";

function SmallSample() {
  return (
    <span className="ml-1.5 rounded-full bg-surface-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-muted">
      small sample
    </span>
  );
}

interface StateHeroProps {
  stateCode: string;
  stateName: string;
  district: number | undefined;
  /** The live figures under the heading, already formatted. */
  figures: { value: string; label: string }[];
  freshnessLabel: string;
  /** The line under the heading: what the state's fees are read against. */
  subhead: string;
}

/**
 * The country with this state lit and its Fed district's states a shade lighter. Every other
 * state links to its own report; the map is a picture to screen readers (the breadcrumb and the
 * research index are the way round for them).
 */
function StateMap({ stateCode, district }: { stateCode: string; district: number | undefined }) {
  return (
    <svg viewBox="0 0 960 600" className="h-auto w-full" aria-hidden="true">
      {US_STATES.map((s) => {
        const fill =
          s.id === stateCode
            ? "fill-[#e0716a]"
            : district && STATE_TO_DISTRICT[s.id] === district
              ? "fill-white/30 hover:fill-white/45"
              : "fill-white/[0.12] hover:fill-white/30";
        const path = <path d={s.d} className={`${fill} stroke-ink transition-colors`} strokeWidth={1.2} />;
        return s.id === stateCode || !STATE_NAMES[s.id] ? (
          <g key={s.id}>{path}</g>
        ) : (
          <Link key={s.id} href={`/research/state/${s.id}`} tabIndex={-1} prefetch={false}>
            {path}
          </Link>
        );
      })}
    </svg>
  );
}

export function StateHero({ stateCode, stateName, district, figures, freshnessLabel, subhead }: StateHeroProps) {
  return (
    <section className="bg-ink text-paper">
      <div className="mx-auto grid max-w-page gap-6 px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-paper/60 print:hidden">
            <Link href="/research" className="hover:text-white">Research</Link>
            <span aria-hidden="true">/</span>
            <span className="text-paper/85">{stateName}</span>
          </nav>
          <h1 className="mt-4 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[44px]">
            {stateName} bank &amp; credit union fees
          </h1>
          <p className="mt-2 text-[15px] text-paper/75">{subhead}</p>

          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10">
            {figures.map((f) => (
              <div key={f.label} className="bg-ink px-4 py-3">
                <dt className="text-[12px] text-paper/65">{f.label}</dt>
                <dd className="font-mono text-[26px] font-semibold leading-tight tabular-nums text-white">{f.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-paper/70">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7fb59b]" />
              {freshnessLabel}
            </span>
            {district && (
              <Link href={`/research/district/${district}`} className="font-semibold text-[#e0716a] hover:text-white">
                {DISTRICT_NAMES[district]} Fed district &rarr;
              </Link>
            )}
            <PrintButton className="font-semibold text-paper/80 underline decoration-white/30 underline-offset-4 hover:text-white print:hidden" />
          </p>
        </div>
        <div className="-mx-1 lg:mx-0">
          <StateMap stateCode={stateCode} district={district} />
        </div>
      </div>
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
      <div className="mt-7 rounded-2xl border border-border bg-white p-5 sm:p-7">
        <ul className="space-y-2.5">
          {withDelta.map((r) => {
            const d = r.delta_pct!;
            const width = (Math.min(Math.abs(d), axis) / axis) * 50;
            const small = r.institution_count < STATE_FINDING_MIN_INSTITUTIONS;
            return (
              <li key={r.fee_category} className={`grid items-center gap-x-5 gap-y-1 sm:grid-cols-[210px_minmax(0,1fr)_180px] ${small ? "opacity-70" : ""}`}>
                <Link href={`/fees/${r.fee_category}`} className="truncate text-[13px] font-semibold text-ink hover:text-brick">
                  {getDisplayName(r.fee_category)}
                  {small && <SmallSample />}
                </Link>
                <div className="relative h-5" aria-hidden="true">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  {Math.abs(d) >= 1 ? (
                    <div
                      className={`absolute top-1/2 h-3 -translate-y-1/2 ${d > 0 ? "rounded-r-full bg-brick/70" : "rounded-l-full bg-below-market/70"}`}
                      style={d > 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
                    />
                  ) : (
                    <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-muted" />
                  )}
                </div>
                <span className="whitespace-nowrap text-[12px] tabular-nums text-ink-soft sm:text-right">
                  <span className={`font-semibold ${Math.abs(d) < 1 ? "text-ink-muted" : d > 0 ? "text-brick" : "text-below-market"}`}>
                    {Math.abs(d) < 1 ? "in line" : formatDelta(d)}
                  </span>{" "}
                  · {formatAmount(r.median_amount)} vs {formatAmount(r.national_median)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 grid text-[10px] uppercase tracking-wider text-ink-muted sm:grid-cols-[210px_minmax(0,1fr)_180px] sm:gap-x-5">
          <span />
          <span className="flex justify-between">
            <span>&larr; lower (&minus;{axis}%)</span>
            <span>national</span>
            <span>higher (+{axis}%) &rarr;</span>
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

export function FullTable({ rows, stateName, gate, asOf }: { rows: StateComparison[]; stateName: string; gate?: React.ReactNode; asOf: string | null }) {
  if (rows.length === 0) return null;
  const th = "px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted";
  return (
    <section id="table" className="scroll-mt-28">
      <SectionHeading eyebrow="Appendix · Full benchmark table" title={`Every fee with a ${stateName} median`}>
        Medians, the middle half of prices, and the national comparison for each fee category.
      </SectionHeading>
      <div className="mt-7 overflow-hidden rounded-2xl border border-border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-paper">
                <th className={th}>Fee</th>
                <th className={`${th} text-right`}>{stateName} median</th>
                <th className={`${th} text-right`}>Middle half</th>
                <th className={`${th} text-right`}>National median</th>
                <th className={`${th} text-right`}>vs national</th>
                <th className={`${th} text-right`}>Institutions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200">
              {rows.map((r) => (
                <tr key={r.fee_category} className="hover:bg-paper/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/fees/${r.fee_category}`} className="font-medium text-ink hover:text-brick">
                      {getDisplayName(r.fee_category)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{formatAmount(r.median_amount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                    {r.p25_amount != null && r.p75_amount != null ? `${formatAmount(r.p25_amount)} – ${formatAmount(r.p75_amount)}` : "–"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">{formatAmount(r.national_median)}</td>
                  <td
                    className={`px-4 py-2.5 text-right text-[12px] font-semibold tabular-nums ${
                      r.delta_pct == null || Math.abs(r.delta_pct) < 1 ? "text-ink-muted" : r.delta_pct > 0 ? "text-brick" : "text-below-market"
                    }`}
                  >
                    {r.delta_pct == null ? "–" : Math.abs(r.delta_pct) < 1 ? "in line" : formatDelta(r.delta_pct)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">{r.institution_count}</td>
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
