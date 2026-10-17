import Link from "next/link";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { PrintButton } from "../../print-button";
import { SectionHeading } from "../../research-hero";
import { ExhibitSource } from "../../exhibits";
import { allShapes, overlaps, stateShape, unionBox } from "../../district/[id]/district-geo";
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

const INSETS = new Set(["AK", "HI"]);

/**
 * The state drawn with the states around it: the state lit and named, the rest of its Fed
 * district a shade lighter, every other neighbor faint. Each neighbor links to its own report;
 * the map is a picture to screen readers (the breadcrumb and the research index are the way round).
 */
function StateMap({ stateCode, district }: { stateCode: string; district: number | undefined }) {
  const own = stateShape(stateCode);
  const view = unionBox([stateCode], 0.32);
  if (!own || !view) return null;
  // Alaska and Hawaii sit in insets on this projection, so neither is ever drawn as a neighbor.
  const neighbors = INSETS.has(stateCode)
    ? []
    : allShapes().filter((s) => s.code !== stateCode && !INSETS.has(s.code) && overlaps(s.box, view));
  const size = Math.max(view.w, view.h) * 0.045;
  return (
    <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="h-[200px] w-full sm:h-auto sm:max-h-[440px]" aria-hidden="true">
      {neighbors.map((s) => {
        const sibling = district != null && STATE_TO_DISTRICT[s.code] === district;
        const path = (
          <path
            d={s.d}
            className={`${sibling ? "fill-[var(--fi-viz-1)] hover:fill-[var(--fi-viz-2)]" : "fill-[var(--fi-viz-none)] hover:fill-[var(--fi-viz-1)]"} stroke-paper transition-colors`}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
        return STATE_NAMES[s.code] ? (
          <Link key={s.code} href={`/research/state/${s.code}`} tabIndex={-1} prefetch={false}>
            <title>{STATE_NAMES[s.code]}</title>
            {path}
          </Link>
        ) : (
          <g key={s.code}>{path}</g>
        );
      })}
      <path d={own.d} className="fill-[var(--fi-viz-3)] stroke-paper" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <text
        x={own.label.x}
        y={own.label.y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="pointer-events-none fill-ink font-semibold"
        style={{ fontSize: size }}
      >
        {own.box.w >= view.w * (0.024 * (STATE_NAMES[stateCode] ?? stateCode).length) ? STATE_NAMES[stateCode] : stateCode}
      </text>
    </svg>
  );
}

interface StateHeroProps {
  stateCode: string;
  stateName: string;
  district: number | undefined;
  /** At most two figures; the page picks the two that carry the story. */
  facts: { value: string; label: string; note?: string }[];
  /** One oversized line under the heading: the page's thesis. */
  statement: string | null;
  freshnessLabel: string;
}

export function StateHero({ stateCode, stateName, district, facts, statement, freshnessLabel }: StateHeroProps) {
  return (
    <section className="bg-paper">
      <div className="mx-auto grid max-w-page gap-8 px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-12">
        <div className="text-center sm:text-left">
          <nav aria-label="Breadcrumb" className="flex items-center justify-center gap-2 text-[12px] text-ink-muted sm:justify-start print:hidden">
            <Link href="/research" className="hover:text-ink">
              Research
            </Link>
            {district && (
              <>
                <span aria-hidden="true">/</span>
                <Link href={`/research/district/${district}`} className="hover:text-ink">
                  District {district}
                </Link>
              </>
            )}
            <span aria-hidden="true">/</span>
            <span className="text-ink-soft">{stateName}</span>
          </nav>
          {district && (
            <p className="mt-5 hidden text-[12px] font-semibold uppercase tracking-[0.14em] text-brick sm:mx-0 sm:block">
              {DISTRICT_NAMES[district]} Fed &middot; District {district}
            </p>
          )}
          <h1 className="mt-3 text-[36px] sm:mt-2 font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[56px]">Bank fees in {stateName}</h1>
          {statement && (
            <p className="mt-5 text-[21px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink sm:mx-0 sm:text-[28px]">{statement}</p>
          )}

          {facts.length > 0 && (
            <dl className="mt-6 grid grid-cols-2 items-start gap-6 text-left sm:mt-8 sm:max-w-xl">
              {facts.map((f) => (
                <div key={f.label} className="flex flex-col-reverse justify-end border-l-2 border-brick pl-4">
                  <dt className="mt-2 text-[13px] leading-snug text-ink-soft">
                    {f.label}
                    {f.note && <span className="mt-0.5 block text-[12px] text-ink-muted">{f.note}</span>}
                  </dt>
                  <dd className="whitespace-nowrap font-mono text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink sm:text-[44px]">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <p className="mt-6 inline-flex items-center gap-2 text-[12px] text-ink-muted sm:mx-0 sm:mt-8">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-in-range" />
            {freshnessLabel}
          </p>
          <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:gap-5 print:hidden">
            <a
              href="#free-report"
              className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
            >
              Get the free {stateName} report
            </a>
            <PrintButton className="min-h-10 text-[13px] font-semibold text-ink-soft underline decoration-border underline-offset-4 hover:text-ink" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-md lg:max-w-none">
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
