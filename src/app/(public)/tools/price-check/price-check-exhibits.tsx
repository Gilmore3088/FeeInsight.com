import Link from "next/link";
import { FeeRange, FeeRangeAxis } from "@/brand/components";
import { DOT } from "@/app/(public)/fees/[category]/exhibits";
import type { GroupCheck, PricedInstitution } from "@/lib/price-check";
import { axisTicks, clipped, COPY, money, rowLabel, sharedDomain, VERDICT, type Placement } from "./price-check-view";

const CARD = "rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6";

/** The verdict as a small coloured tag, using the site's below / within / above market colours. */
export function VerdictTag({ placement }: { placement: Placement }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-0 px-3 py-1 text-[13px] font-semibold text-ink">
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${DOT[placement.position]}`} />
      {VERDICT[placement.position]}
    </span>
  );
}

/** One bar split into charge less, the same and more, so the count reads at a glance on a phone. */
export function ShareBar({ placement }: { placement: Placement }) {
  const { lower, same, higher, count } = placement;
  const pct = (n: number) => `${(n / count) * 100}%`;
  return (
    <div>
      <div
        className="flex h-3 overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={`${lower} charge less, ${same} the same, ${higher} more`}
      >
        <span style={{ width: pct(lower) }} className="bg-ink/55" />
        <span style={{ width: pct(same) }} className="bg-ink" />
        <span style={{ width: pct(higher) }} className="bg-ink/15" />
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-ink-muted" aria-hidden="true">
        <span>Less {lower.toLocaleString("en-US")}</span>
        <span>Same {same.toLocaleString("en-US")}</span>
        <span>More {higher.toLocaleString("en-US")}</span>
      </div>
    </div>
  );
}

/** Every group as a range on one shared axis, the visitor's fee as the dot on each. */
export function RangeStack({ rows, price }: { rows: Placement[]; price: number }) {
  if (rows.length === 0) return null;
  const domain = sharedDomain(rows, price);
  return (
    <figure className={`${CARD} m-0`}>
      <div className="fi-range-stack space-y-1">
        {rows.map((row) => {
          const band = clipped(row.band, domain);
          return (
            <FeeRange
              key={row.label}
              label={rowLabel(row)}
              min={band.min}
              q1={band.p25}
              median={band.median}
              q3={band.p75}
              max={band.max}
              value={Math.min(price, domain[1])}
              domain={domain}
              format={money}
              figure="median"
              subjectLabel="your fee"
              spread={{ min: row.band.min, max: row.band.max }}
            />
          );
        })}
        <FeeRangeAxis ticks={axisTicks(domain)} domain={domain} format={money} />
      </div>
      <figcaption className="mt-3 text-[12px] text-ink-muted">{COPY.rangeKey}</figcaption>
    </figure>
  );
}

/** Local markets in the state, each with how many there charge less than the price. */
export function MarketList({ rows, price }: { rows: GroupCheck[]; price: number }) {
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface-0">
      {rows.map((row) => (
        <li key={row.label} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-[14px]">
          <span className="min-w-0 leading-tight text-ink">
            {row.label}
            <span className="block text-[12px] text-ink-muted">
              {row.lower} of {row.count} charge less than {money(price)}
            </span>
          </span>
          <span className="shrink-0 text-right leading-tight">
            <span className="block font-mono text-[14px] font-semibold tabular-nums text-ink">{money(row.median)}</span>
            <span className="block text-[11px] text-ink-muted">median</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The state's checked institutions, lowest first, each linking to its page and its own schedule. */
export function InstitutionList({ institutions, shown }: { institutions: PricedInstitution[]; shown: number }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface-0">
      {institutions.slice(0, shown).map((institution) => (
        <li key={institution.id} className="flex items-center justify-between gap-3 px-4 text-[14px]">
          <span className="flex min-w-0 flex-wrap items-center gap-x-3">
            <Link href={`/institution/${institution.id}`} className="inline-flex min-h-11 items-center text-ink hover:underline">
              {institution.name}
            </Link>
            {institution.documentUrl && (
              <a
                href={institution.documentUrl}
                rel="nofollow noopener"
                target="_blank"
                className="inline-flex min-h-11 items-center text-[12px] text-brick hover:underline"
              >
                Schedule
                <span className="sr-only"> {COPY.opensNewTab}</span>
              </a>
            )}
          </span>
          <span className="shrink-0 font-mono tabular-nums text-ink">{money(institution.value)}</span>
        </li>
      ))}
    </ul>
  );
}
