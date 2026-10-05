import Link from "next/link";
import type { IndexEntry } from "@/lib/data-store";

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

function buildRows(entries: IndexEntry[]): PriceRow[] {
  const byCategory = new Map(entries.map((e) => [e.fee_category, e]));
  return STRIP_FEES.flatMap(({ category, label }) => {
    const e = byCategory.get(category);
    if (
      !e ||
      e.maturity_tier === "insufficient" ||
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
 * "What banks charge": the national median price for a handful of everyday fees,
 * each with a bar showing where most institutions fall (25th–75th percentile).
 * Numbers carry the message; words stay small. Renders nothing without data.
 */
export function LandingPriceStrip({
  entries,
  institutionsLabel,
}: {
  entries: IndexEntry[];
  /** Live count of institutions with verified fees, same figure as the hero and stats band. */
  institutionsLabel: string;
}) {
  const rows = buildRows(entries);
  if (rows.length === 0) return null;

  return (
    <section className="border-b border-[#E0D7C9] bg-[#FDFBF8]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h2
              className="text-2xl font-normal text-[#1A1815] sm:text-3xl"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              What banks charge
            </h2>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#5A5347]">
              The big number is the median: half of institutions charge more, half charge less. The
              shaded bar shows where the middle half of institutions fall.
            </p>
          </div>
          <Link href="/fees" className="shrink-0 text-xs font-semibold text-[#A93D25] hover:text-[#8E2A17]">
            All fees →
          </Link>
        </div>

        <ul className="mt-5 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <li key={row.category} className="border-t border-[#EDE6DA]">
              <PriceRowLink row={row} />
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[#6B6255]">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-[#C44B2E]" />
            Median price
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-1.5 w-5 rounded-full bg-[#C44B2E]/25" />
            Middle half of institutions
          </span>
          <span>
            From the published schedules of{" "}
            {/\d/.test(institutionsLabel) ? `${institutionsLabel} ` : ""}verified institutions
          </span>
          <Link href="/methodology" className="font-semibold text-[#A93D25] hover:text-[#8E2A17]">
            How we calculate this →
          </Link>
        </div>
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
      className="group flex items-center gap-4 py-3.5"
      aria-label={`${row.label}: median ${formatUsd(row.median)}, most between ${formatUsd(row.p25)} and ${formatUsd(row.p75)}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[#5A5347] group-hover:text-[#1A1815]">{row.label}</p>
        <div aria-hidden="true" className="relative mt-2 h-2.5">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#E0D7C9]" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#C44B2E]/25"
            style={{ left: pct(row.p25), width: `calc(${pct(row.p75)} - ${pct(row.p25)})` }}
          />
          <div
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C44B2E] ring-2 ring-[#FDFBF8]"
            style={{ left: pct(row.median) }}
          />
        </div>
        <p aria-hidden="true" className="mt-1 text-[11px] tabular-nums text-[#8A8072]">
          {formatUsd(row.p25)}–{formatUsd(row.p75)}
        </p>
      </div>
      <p aria-hidden="true" className="w-20 shrink-0 text-right text-2xl font-semibold tabular-nums text-[#1A1815]">
        {formatUsd(row.median)}
      </p>
    </Link>
  );
}
