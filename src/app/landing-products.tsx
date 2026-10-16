import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/brand/components";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { DistrictMap } from "./landing-charts";
import { DISPLAY_H2, SANS, SECTION_INNER, TEXT_LINK, hasFigure, money, type HomeData, type SampleView } from "./landing-shared";

/** Fees the Hamilton snapshot lists, furthest from the local median first. */
const SNAPSHOT_ROWS = 6;

/** The report's own position colors (its At a glance), so the sample reads the same on every visual. */
const POSITION_FILL: Record<SampleView["rows"][number]["position"], string> = {
  above_market: "var(--fi-brick)",
  in_market: "var(--color-ink-soft)",
  below_market: "#2F5585",
  free: "#2F5585",
};

/**
 * Section 2, the problem and the answer (James's homepage reset, Oct 16): one compact
 * statement of the work a fee review takes, and that Fee Insight brings it together.
 */
export function LandingProblem() {
  return (
    <section aria-labelledby="problem-heading" className="border-t border-border bg-surface-0">
      <div className={`${SECTION_INNER} py-12 text-center sm:py-16`}>
        <h2 id="problem-heading" className={`mx-auto max-w-3xl ${DISPLAY_H2}`} style={SANS}>
          A fee review means weeks of gathering
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-soft">
          {SITE_NAME} collects the schedules, matches competitors to your fees and keeps the evidence for every figure.
        </p>
      </div>
    </section>
  );
}

/** The sample bank's fees, each on its own local range: what Hamilton's My fees screen shows. */
export function HamiltonSnapshot({ sample }: { sample: SampleView }) {
  const rows = [...sample.rows]
    .sort((a, b) => Math.abs(b.amount - b.median) / (b.median || 1) - Math.abs(a.amount - a.median) / (a.median || 1))
    .slice(0, SNAPSHOT_ROWS);
  return (
    <div className="p-5 sm:p-6" data-hamilton-snapshot="">
      <p className="text-[13px] text-ink-soft">
        <span className="font-semibold text-ink">{sample.institutionName}</span> against {sample.competitors} local competitors
      </p>
      <ul className="mt-5 space-y-4" aria-label={`${sample.institutionName}'s fees against the local middle half`}>
        {rows.map((row) => {
          const hi = Math.max(row.p75, row.amount, row.median) * 1.15 || 1;
          const at = (v: number) => `${Math.max(0, Math.min(100, (v / hi) * 100))}%`;
          return (
            <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem]">
              <span className="text-[14px] leading-snug text-ink">{row.label}</span>
              <span className="relative col-span-2 row-start-2 block h-5 sm:col-span-1 sm:row-start-auto" aria-hidden="true">
                <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                <span className="absolute inset-y-0.5 rounded-[3px] bg-ink/12" style={{ left: at(row.p25), width: `calc(${at(row.p75)} - ${at(row.p25)})` }} />
                <span className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-ink" style={{ left: at(row.median) }} />
                <span
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0"
                  style={{ left: at(row.amount), background: POSITION_FILL[row.position] }}
                />
              </span>
              <span className="col-start-2 row-start-1 text-right font-mono text-[14px] font-semibold tabular-nums text-ink sm:col-start-auto sm:row-start-auto">
                {money(row.amount)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 text-[12px] leading-relaxed text-ink-muted">
        Dot: its fee · Band: the middle half of local competitors · Line: their median
      </p>
    </div>
  );
}

function Product({
  mark,
  benefit,
  action,
  frameLabel,
  children,
}: {
  mark: ReactNode;
  benefit: string;
  action: ReactNode;
  frameLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="max-sm:text-center">
        <h3 className="flex h-8 items-center max-sm:justify-center">{mark}</h3>
        <p className="mt-3 max-w-md text-[17px] leading-relaxed text-ink-soft max-sm:mx-auto">{benefit}</p>
        <p className="mt-3 text-[14px]">{action}</p>
      </div>
      {children ? (
        <ProductFrame label={frameLabel} className="fi-window-lift mt-6">
          {children}
        </ProductFrame>
      ) : null}
    </div>
  );
}

/**
 * Section 3, the two products and how they relate (James's homepage reset, Oct 16): the
 * Bank Fee Index is the fee database, Hamilton the workspace built on it. Each gets its own
 * mark, one benefit and one visual from live data: the district map from the index, and the
 * sample bank's fees as Hamilton lays them out.
 */
export function LandingProducts({ data, summary }: { data: HomeData; summary: Pick<PublicStatsSummary, "observationsLabel" | "institutionsLabel"> }) {
  const map = data.overdraft && data.districts.length > 0;
  const counted = hasFigure(summary.observationsLabel) && hasFigure(summary.institutionsLabel);
  return (
    <section aria-labelledby="products-heading" className="bg-paper">
      <div className={`${SECTION_INNER} py-16 sm:py-20`}>
        <h2 id="products-heading" className={`mx-auto max-w-3xl text-center ${DISPLAY_H2}`} style={SANS}>
          The fee data, and the workspace built on it
        </h2>
        <div className="mt-10 grid gap-12 lg:mt-12 lg:grid-cols-2 lg:gap-10">
          <Product
            mark={<Logo mark="bank-fee-index-wordmark" height={24} />}
            benefit="See what banks and credit unions charge, with the spread and the benchmark for each fee, from the nation down to your market."
            action={
              <Link href="/fees" className={TEXT_LINK}>
                Explore the {PRODUCT_NAME}
              </Link>
            }
            frameLabel="Live data"
          >
            {map ? <DistrictMap data={data} compact /> : null}
          </Product>
          <Product
            mark={<Logo mark="hamilton-wordmark" height={24} />}
            benefit="See each of your fees against your own market, then turn the comparison into analysis and a report for your board."
            action={
              <TrackLink event="upgrade_click" eventProps={{ placement: "home_products" }} href={PRO_PLANS_NAV.href} className={TEXT_LINK}>
                {PRO_PLANS_NAV.label}
              </TrackLink>
            }
            frameLabel={data.sample ? `${data.sample.institutionName} · sample` : "Your institution"}
          >
            {data.sample && data.sample.rows.length > 0 ? <HamiltonSnapshot sample={data.sample} /> : null}
          </Product>
        </div>
        <p className="mx-auto mt-12 max-w-3xl text-center text-[15px] leading-relaxed text-ink-soft" data-trust-line="">
          Hamilton reads the {PRODUCT_NAME}, so every figure in your analysis traces to an institution&apos;s own published
          fee schedule and the date it was read
          {counted ? ` (${summary.observationsLabel} fee entries from ${summary.institutionsLabel} institutions)` : ""}.{" "}
          <Link href="/methodology" className={TEXT_LINK}>
            How each fee is checked
          </Link>
        </p>
      </div>
    </section>
  );
}
