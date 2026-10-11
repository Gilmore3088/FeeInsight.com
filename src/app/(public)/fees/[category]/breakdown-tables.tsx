import type { ReactNode } from "react";
import type { DimensionBreakdown } from "@/lib/data-store/fees";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatFeeAmount } from "@/lib/format";
import { ScrollTable } from "@/components/public/scroll-table";
import { FeeSummaryList, type FeeSummaryItem } from "@/components/public/fee-summary-list";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]";
const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/** Thousands-separated dollars ("$5,000", "$2.50"); "-" when unavailable. */
const money = (value: number | null | undefined) => formatFeeAmount(value) ?? "-";

/** "$25 \u2013 $35", or "-" when either end is unavailable (below the minimum sample). */
export const range = (low: number | null | undefined, high: number | null | undefined) =>
  low == null || high == null ? "-" : `${money(low)} \u2013 ${money(high)}`;

/**
 * A breakdown table (district, charter, asset tier, state). Wider than a phone, so it
 * scrolls inside its own box with a written cue and keyboard scrolling (ScrollTable).
 */
export function WarmTable({
  label,
  headers,
  children,
  className = "mt-3",
}: {
  /** Names the table and its scroll region, e.g. "Overdraft fee by Federal Reserve district". */
  label: string;
  headers: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <ScrollTable label={label} minWidth="560" className={className}>
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
          {headers.map((h, i) => (
            <th key={h} scope="col" className={`px-4 py-2.5 ${EYEBROW} ${i > 0 ? "whitespace-nowrap text-right" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E8DFD1]/40">{children}</tbody>
    </ScrollTable>
  );
}

export const BREAKDOWN_HEADERS = ["Median", "Middle half", "Lowest \u2013 highest", "Institutions"];

/** One breakdown row: name, median, middle half, lowest to highest, institutions. */
export function BreakdownRow({ name, sub, row }: { name: string; sub?: string; row: DimensionBreakdown }) {
  return (
    <tr className="hover:bg-[#FAF7F2]/60 transition-colors">
      <th scope="row" className="px-4 py-2.5 text-left font-medium text-[#1A1815]">
        {name}
        {sub && <span className="ml-1 font-normal text-[#5A5347]">({sub})</span>}
      </th>
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
        {money(row.median_amount)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
        {range(row.p25_amount, row.p75_amount)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
        {range(row.min_amount, row.max_amount)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-[#5A5347]">
        {row.count.toLocaleString("en-US")}
      </td>
    </tr>
  );
}

/** "Boston" and "District 1" from a breakdown row keyed "District 1". */
function districtLabel(row: DimensionBreakdown): { name: string; label: string } {
  const number = parseInt(row.dimension_value.replace("District ", ""), 10);
  return { name: DISTRICT_NAMES[number] ?? row.dimension_value, label: row.dimension_value };
}

function DistrictTable({ name, rows, className }: { name: string; rows: DimensionBreakdown[]; className: string }) {
  return (
    <WarmTable
      label={`${name} fee by Federal Reserve district`}
      headers={["District", ...BREAKDOWN_HEADERS]}
      className={className}
    >
      {rows.map((row) => {
        const { name: districtName, label } = districtLabel(row);
        return <BreakdownRow key={row.dimension_value} name={districtName} sub={label} row={row} />;
      })}
    </WarmTable>
  );
}


/**
 * "By Federal Reserve District". Narrow screens get each district's median, middle half and
 * institution count as text (the homepage fee-summary pattern) with the full table one tap
 * away; wider screens get the table. The table never hides a column: where it is wider than
 * its box it scrolls inside the box, with a written cue and keyboard scrolling.
 */
export function DistrictSection({
  name,
  rows,
  className = "",
}: {
  /** The fee's display name ("Overdraft (OD)"). */
  name: string;
  rows: DimensionBreakdown[];
  className?: string;
}) {
  const items: FeeSummaryItem[] = rows.map((row) => {
    const { name: districtName, label } = districtLabel(row);
    return {
      key: row.dimension_value,
      label: districtName,
      sublabel: label,
      median: row.median_amount,
      p25: row.p25_amount,
      p75: row.p75_amount,
      low: row.min_amount,
      high: row.max_amount,
      institutions: row.count,
    };
  });

  return (
    <section className={className}>
      <h2 className="text-[16px] font-medium text-[#1A1815]" style={SERIF}>
        By Federal Reserve District
      </h2>
      <p className="mt-1 text-[12px] text-[#5A5347]">
        Each institution counts once, in its own district. A dash means too few institutions in that
        district for a median.
      </p>
      <FeeSummaryList
        items={items}
        label={`${name} fee by Federal Reserve district`}
        className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80 bg-white/70 md:hidden"
      />
      <details className="group/full mt-2 md:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-[#A93D25] hover:text-[#8E2A17]">
          <span className="group-open/full:hidden">Show the full district table</span>
          <span className="hidden group-open/full:inline">Hide the full district table</span>
          <span aria-hidden="true" className="expand-icon transition-transform">&#9662;</span>
        </summary>
        <DistrictTable name={name} rows={rows} className="mt-1" />
      </details>
      <DistrictTable name={name} rows={rows} className="mt-3 hidden md:block" />
    </section>
  );
}
