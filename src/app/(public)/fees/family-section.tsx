import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { SortableFamilyTable, type FamilyTableRow } from "./sortable-family-table";
import { FeeSummaryList, stripScale, type FeeSummaryItem } from "@/components/public/fee-summary-list";


/** Thousands-separated dollars ("$5,000", "$2.50"); "-" when unavailable. */
export const money = (value: number | null | undefined) => formatFeeAmount(value) ?? "-";

export function familySectionId(familyName: string): string {
  return familyName.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and");
}

function tableRows(cats: FeeCategorySummary[]): FamilyTableRow[] {
  return cats.map((cat) => ({
    category: cat.fee_category,
    label: getDisplayName(cat.fee_category),
    median: cat.median_amount,
    p25: cat.p25_amount,
    p75: cat.p75_amount,
    min: cat.min_amount,
    max: cat.max_amount,
    institutions: cat.institution_count,
  }));
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
  // One brand mark for every family (no per-family hues: the palette is parchment, charcoal, terracotta).
  const colorBg = "bg-[#C44B2E]";
  const sectionMedians = cats.map((c) => c.median_amount).filter((a): a is number => a !== null);
  const sectionAvgMedian =
    sectionMedians.length > 0 ? sectionMedians.reduce((a, b) => a + b, 0) / sectionMedians.length : null;
  const sectionMaxMedian = sectionMedians.length > 0 ? Math.max(...sectionMedians) : null;
  const items = summaryItems(cats);
  const scaleMax = stripScale(items);
  const rows = tableRows(cats);

  return (
    <section
      id={familySectionId(familyName)}
      aria-labelledby={`${familySectionId(familyName)}-title`}
      className="scroll-mt-24"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id={`${familySectionId(familyName)}-title`}
          className="flex items-center gap-2 text-lg font-semibold tracking-tight text-[#1A1815]"
        >
          <span aria-hidden="true" className={`inline-block h-3.5 w-1.5 rounded-full ${colorBg}`} />
          {familyName}
          <span className="ml-1 text-[13px] font-medium text-[#5A5347]">
            ({cats.length} {cats.length === 1 ? "fee" : "fees"})
          </span>
        </h2>
        {sectionAvgMedian !== null && (
          <p className="flex flex-wrap items-center gap-x-4 text-[12px] text-[#5A5347]">
            <span>
              Avg median:{" "}
              <span className="font-medium text-[#1A1815] [font-variant-numeric:tabular-nums]">{money(sectionAvgMedian)}</span>
            </span>
            <span>
              Highest:{" "}
              <span className="font-medium text-[#1A1815] [font-variant-numeric:tabular-nums]">{money(sectionMaxMedian)}</span>
            </span>
          </p>
        )}
      </div>

      {/* Narrow screens: every fee's median, middle half and institution count in text. */}
      <FeeSummaryList
        items={items}
        label={`${familyName} fees`}
        className="mt-3 overflow-hidden rounded-2xl bg-white/75 ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22)] md:hidden"
      />
      <details className="group/full mt-2 md:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-[#A93D25] hover:text-[#8E2A17]">
          <span className="group-open/full:hidden">Show the full {familyName} table</span>
          <span className="hidden group-open/full:inline">Hide the full {familyName} table</span>
          <span aria-hidden="true" className="expand-icon transition-transform">&#9662;</span>
        </summary>
        <SortableFamilyTable familyName={familyName} rows={rows} scaleMax={scaleMax} className="mt-1" />
      </details>

      {/* Wider screens: the full table. */}
      <SortableFamilyTable familyName={familyName} rows={rows} scaleMax={scaleMax} className="mt-3 hidden md:block" />
    </section>
  );
}
