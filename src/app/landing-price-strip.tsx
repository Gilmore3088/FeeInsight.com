import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { formatCount } from "@/lib/public-stats";
import { GLASS } from "@/components/public/site-look";

/** Everyday fees a consumer recognizes, with short labels that fit one phone line. */
const STRIP_FEES: { category: string; label: string }[] = [
  { category: "overdraft", label: "Overdraft" },
  { category: "nsf", label: "Returned item (NSF)" },
  { category: "atm_non_network", label: "Out-of-network ATM" },
  { category: "monthly_maintenance", label: "Monthly fee" },
  { category: "wire_domestic_outgoing", label: "Outgoing wire" },
];

interface PriceRow {
  category: string;
  label: string;
  median: number;
  p25: number;
  p75: number;
  institutions: number;
}

function formatUsd(value: number): string {
  const n = Math.round(value * 100) / 100;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function buildRows(categories: FeeCategorySummary[]): PriceRow[] {
  const byCategory = new Map(categories.map((e) => [e.fee_category, e]));
  return STRIP_FEES.flatMap(({ category, label }) => {
    const e = byCategory.get(category);
    // The median is null below the minimum sample, so a thin category drops out here.
    if (
      !e ||
      e.median_amount == null ||
      e.p25_amount == null ||
      e.p75_amount == null
    ) {
      return [];
    }
    return [
      {
        category,
        label,
        median: e.median_amount,
        p25: e.p25_amount,
        p75: e.p75_amount,
        institutions: e.institution_count,
      },
    ];
  });
}

/**
 * "What banks charge": the national median price for a handful of everyday fees, each with
 * a bar showing where most institutions fall (25th–75th percentile), in a glass box the
 * same size as the search box beside it (the /subscribe layout). Every figure is also in
 * text, and each row's link names all of them, so the bars are never the only carrier.
 * Renders nothing without data.
 */
export function LandingPriceStrip({
  categories,
  refreshedOn,
}: {
  /** National benchmarks from the shared public snapshot (same figures as /fees). */
  categories: FeeCategorySummary[];
  refreshedOn: string | null;
}) {
  const rows = buildRows(categories);
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="what-banks-charge" className={`flex min-w-0 flex-col p-5 sm:p-7 ${GLASS}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="what-banks-charge" className="text-xl font-semibold tracking-tight text-[#1A1815] sm:text-2xl">
          What banks charge
        </h2>
        <Link
          href="/fees"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[#A93D25] underline underline-offset-2 hover:text-[#8E2A17]"
        >
          All fees <span aria-hidden="true">&nbsp;→</span>
        </Link>
      </div>
      <p className="mt-1 text-pretty text-sm leading-relaxed text-[#5A5347]">
        The big number is the median: half of institutions charge more, half charge less.
      </p>

      <ul className="mt-3 flex-1 divide-y divide-[#E8E1D6]">
        {rows.map((row) => (
          <li key={row.category}>
            <PriceRowLink row={row} />
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#E8E1D6] pt-4 text-xs text-[#5A5347]">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-[#C44B2E]" />
          Median price
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1.5 w-5 rounded-full bg-[#C44B2E]/25" />
          Middle half of institutions
        </span>
        <span>
          One value per institution{refreshedOn ? ` · updated ${refreshedOn}` : ""}
        </span>
        <Link href="/methodology" className="font-semibold text-[#A93D25] underline underline-offset-2 hover:text-[#8E2A17]">
          How we calculate this
        </Link>
      </div>
    </section>
  );
}

function PriceRowLink({ row }: { row: PriceRow }) {
  // Each row gets its own scale from $0, with headroom past the 75th percentile
  // so the dot and band never sit on the edge.
  const scaleMax = Math.max(row.p75 * 1.3, row.median * 1.5, 1);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scaleMax) * 100))}%`;

  return (
    <Link
      href={`/fees/${row.category}`}
      className="group flex min-h-11 items-center gap-4 rounded-lg py-3"
      aria-label={`${row.label}: median ${formatUsd(row.median)} across ${formatCount(row.institutions)} institutions, most between ${formatUsd(row.p25)} and ${formatUsd(row.p75)}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-[#1A1815] group-hover:text-[#A93D25]">{row.label}</p>
        <div aria-hidden="true" className="relative mt-2 h-2.5">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#E0D7C9]" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#C44B2E]/25"
            style={{ left: pct(row.p25), width: `calc(${pct(row.p75)} - ${pct(row.p25)})` }}
          />
          <div
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C44B2E] ring-2 ring-white"
            style={{ left: pct(row.median) }}
          />
        </div>
        <p aria-hidden="true" className="mt-1 text-xs [font-variant-numeric:tabular-nums] text-[#5A5347]">
          {formatUsd(row.p25)}–{formatUsd(row.p75)} · {formatCount(row.institutions)} institutions
        </p>
      </div>
      <p aria-hidden="true" className="w-24 shrink-0 text-right text-2xl font-semibold [font-variant-numeric:tabular-nums] tracking-tight text-[#1A1815] sm:text-3xl">
        {formatUsd(row.median)}
      </p>
    </Link>
  );
}
