import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName, FAMILY_COLORS } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { ScrollTable } from "@/components/public/scroll-table";
import {
  FeeSummaryList,
  RangeStrip,
  stripScale,
  type FeeSummaryItem,
} from "@/components/public/fee-summary-list";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]";
const TH = `px-4 py-2.5 ${EYEBROW}`;
const TD = "whitespace-nowrap px-4 py-2.5 text-right tabular-nums";

/** Thousands-separated dollars ("$5,000", "$2.50"); "-" when unavailable. */
export const money = (value: number | null | undefined) => formatFeeAmount(value) ?? "-";

export function familySectionId(familyName: string): string {
  return familyName.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and");
}

function summaryItems(cats: FeeCategorySummary[]): FeeSummaryItem[] {
  return cats.map((cat) => ({
    key: cat.fee_category,
    label: getDisplayName(cat.fee_category),
    href: `/fees/${cat.fee_category}`,
    median: cat.median_amount,
    p25: cat.p25_amount,
    p75: cat.p75_amount,
    institutions: cat.institution_count,
  }));
}

/**
 * One fee family. Narrow screens get the homepage fee-summary pattern (name, median,
 * middle half, institution count, all in text) with the full table one tap away; wider
 * screens get the full table. No column is ever hidden: where the table is wider than
 * its box it scrolls inside the box, with a written cue and keyboard scrolling.
 * Strips scale per family, not to the global max, so one $5,000 outlier does not
 * flatten every other row.
 */
export function FamilySection({ familyName, cats }: { familyName: string; cats: FeeCategorySummary[] }) {
  const colors = FAMILY_COLORS[familyName];
  const colorBg = colors?.dot ?? "bg-[#A09788]";
  const sectionMedians = cats.map((c) => c.median_amount).filter((a): a is number => a !== null);
  const sectionAvgMedian =
    sectionMedians.length > 0 ? sectionMedians.reduce((a, b) => a + b, 0) / sectionMedians.length : null;
  const sectionMaxMedian = sectionMedians.length > 0 ? Math.max(...sectionMedians) : null;
  const items = summaryItems(cats);
  const scaleMax = stripScale(items);

  return (
    <section id={familySectionId(familyName)} aria-labelledby={`${familySectionId(familyName)}-title`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id={`${familySectionId(familyName)}-title`}
          className={`flex items-center gap-2 text-sm font-bold ${colors?.text ?? "text-[#5A5347]"}`}
        >
          <span aria-hidden="true" className={`inline-block h-3.5 w-1.5 rounded-full ${colorBg}`} />
          {familyName}
          <span className="ml-1 text-[12px] font-medium text-[#5A5347]">
            ({cats.length} {cats.length === 1 ? "fee" : "fees"})
          </span>
        </h2>
        {sectionAvgMedian !== null && (
          <p className="flex flex-wrap items-center gap-x-4 text-[12px] text-[#5A5347]">
            <span>
              Avg median:{" "}
              <span className="font-medium text-[#1A1815] tabular-nums">{money(sectionAvgMedian)}</span>
            </span>
            <span>
              Highest:{" "}
              <span className="font-medium text-[#1A1815] tabular-nums">{money(sectionMaxMedian)}</span>
            </span>
          </p>
        )}
      </div>

      {/* Narrow screens: every fee's median, middle half and institution count in text. */}
      <FeeSummaryList
        items={items}
        label={`${familyName} fees`}
        className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80 bg-white/70 md:hidden"
      />
      <details className="group/full mt-2 md:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-[#A93D25] hover:text-[#8E2A17]">
          <span className="group-open/full:hidden">Show the full {familyName} table</span>
          <span className="hidden group-open/full:inline">Hide the full {familyName} table</span>
          <span aria-hidden="true" className="expand-icon transition-transform">&#9662;</span>
        </summary>
        <FamilyTable familyName={familyName} cats={cats} scaleMax={scaleMax} className="mt-1" />
      </details>

      {/* Wider screens: the full table. */}
      <FamilyTable familyName={familyName} cats={cats} scaleMax={scaleMax} className="mt-3 hidden md:block" />
    </section>
  );
}

function FamilyTable({
  familyName,
  cats,
  scaleMax,
  className,
}: {
  familyName: string;
  cats: FeeCategorySummary[];
  scaleMax: number;
  className: string;
}) {
  return (
    <ScrollTable label={`${familyName} fee table`} minWidth="640" className={className}>
      <caption className="sr-only">
        {familyName} fees: national median, middle half (25th to 75th percentile), lowest to highest,
        and number of institutions
      </caption>
      <thead>
        <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
          <th scope="col" className={TH}>Fee</th>
          <th scope="col" className={`${TH} whitespace-nowrap text-right`}>Median</th>
          <th scope="col" className={`${TH} whitespace-nowrap text-right`}>
            Middle half <span className="sr-only">(25th to 75th percentile)</span>
          </th>
          <th scope="col" className={`${TH} whitespace-nowrap text-right`}>Lowest – highest</th>
          <th scope="col" className={`${TH} whitespace-nowrap`}>
            <span aria-hidden="true">Spread {money(0)}–{money(scaleMax)}</span>
            <span className="sr-only">Spread chart (same figures as the median and middle half columns)</span>
          </th>
          <th scope="col" className={`${TH} whitespace-nowrap text-right`}>Institutions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E8DFD1]/40">
        {cats.map((cat) => (
          <tr key={cat.fee_category} className="group hover:bg-[#FAF7F2]/60 transition-colors">
            <th scope="row" className="px-4 py-2.5 text-left font-normal">
              <Link
                href={`/fees/${cat.fee_category}`}
                className="font-medium text-[#1A1815] group-hover:text-[#A93D25] transition-colors"
              >
                {getDisplayName(cat.fee_category)}
              </Link>
            </th>
            <td className={`${TD} font-semibold text-[#1A1815]`}>{money(cat.median_amount)}</td>
            <td className={`${TD} text-[#5A5347]`}>
              {cat.p25_amount !== null && cat.p75_amount !== null
                ? `${money(cat.p25_amount)} – ${money(cat.p75_amount)}`
                : "-"}
            </td>
            <td className={`${TD} text-[#5A5347]`}>
              {cat.min_amount !== null && cat.max_amount !== null
                ? `${money(cat.min_amount)} – ${money(cat.max_amount)}`
                : "-"}
            </td>
            <td className="px-4 py-2.5">
              <RangeStrip
                median={cat.median_amount}
                p25={cat.p25_amount}
                p75={cat.p75_amount}
                scaleMax={scaleMax}
                className="min-w-[96px]"
              />
            </td>
            <td className={`${TD} text-[#5A5347]`}>{cat.institution_count.toLocaleString("en-US")}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}
