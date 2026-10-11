import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName, FAMILY_COLORS } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]";
const TH = `px-4 py-2.5 ${EYEBROW}`;
const BAR_HEADROOM = 1.1;
const BAR_MIN_WIDTH_PCT = 2;
const BAR_MAX_LEFT_PCT = 100 - BAR_MIN_WIDTH_PCT;

/** Thousands-separated dollars ("$5,000", "$2.50"); "-" when unavailable. */
export const money = (value: number | null | undefined) => formatFeeAmount(value) ?? "-";

export function familySectionId(familyName: string): string {
  return familyName.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and");
}

/**
 * Bars scale per family, not to the global max, so one $5,000 outlier does not
 * flatten every other row. The bar shows P25-P75, so the scale is the family's
 * largest P75 (falling back to max) with a little headroom.
 */
function familyBarScale(cats: { p75_amount: number | null; max_amount: number | null }[]) {
  const tops = cats
    .map((c) => c.p75_amount ?? c.max_amount)
    .filter((a): a is number => a !== null && a > 0);
  return tops.length > 0 ? Math.max(...tops) * BAR_HEADROOM : 100;
}

export function FamilySection({ familyName, cats }: { familyName: string; cats: FeeCategorySummary[] }) {
  const colors = FAMILY_COLORS[familyName];
  const colorBg = colors?.dot ?? "bg-[#A09788]";
  const sectionMedians = cats.map((c) => c.median_amount).filter((a): a is number => a !== null);
  const sectionAvgMedian =
    sectionMedians.length > 0 ? sectionMedians.reduce((a, b) => a + b, 0) / sectionMedians.length : null;
  const sectionMaxMedian = sectionMedians.length > 0 ? Math.max(...sectionMedians) : null;
  const barScale = familyBarScale(cats);

  return (
    <section id={familySectionId(familyName)}>
      <div className="flex items-start justify-between gap-4">
        <h2 className={`flex items-center gap-2 text-sm font-bold ${colors?.text ?? "text-[#5A5347]"}`}>
          <span className={`inline-block h-3.5 w-1.5 rounded-full ${colorBg}`} />
          {familyName}
          <span className="ml-1 text-[11px] font-medium text-[#6B6255]">({cats.length})</span>
        </h2>
        {sectionAvgMedian !== null && (
          <div className="hidden sm:flex items-center gap-4 text-[11px] text-[#6B6255]">
            <span>
              Avg median:{" "}
              <span className="font-medium text-[#5A5347] tabular-nums">{money(sectionAvgMedian)}</span>
            </span>
            <span>
              Highest:{" "}
              <span className="font-medium text-[#5A5347] tabular-nums">{money(sectionMaxMedian)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm">
        <div className="table-scroll">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
                <th scope="col" className={TH}>Fee</th>
                <th scope="col" className={`${TH} text-right`}>Median</th>
                <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>P25</th>
                <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>P75</th>
                <th scope="col" className={`hidden ${TH} text-right md:table-cell`}>Min – Max</th>
                <th scope="col" className={TH}>Distribution</th>
                <th scope="col" className={`${TH} text-right`}>Inst.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD1]/40">
              {cats.map((cat) => (
                <CategoryRow key={cat.fee_category} cat={cat} barScale={barScale} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CategoryRow({ cat, barScale }: { cat: FeeCategorySummary; barScale: number }) {
  const barP25 = cat.p25_amount ?? cat.min_amount ?? 0;
  const barP75 = cat.p75_amount ?? cat.max_amount ?? 0;
  const barLeftPct = Math.min((barP25 / barScale) * 100, BAR_MAX_LEFT_PCT);
  const barWidthPct = Math.min(
    Math.max(((barP75 - barP25) / barScale) * 100, BAR_MIN_WIDTH_PCT),
    100 - barLeftPct,
  );
  const medianPct = cat.median_amount
    ? Math.min((cat.median_amount / barScale) * 100, BAR_MAX_LEFT_PCT)
    : 0;

  return (
    <tr className="group hover:bg-[#FAF7F2]/60 transition-colors">
      <td className="px-4 py-2.5">
        <Link
          href={`/fees/${cat.fee_category}`}
          className="font-medium text-[#1A1815] group-hover:text-[#A93D25] transition-colors"
        >
          {getDisplayName(cat.fee_category)}
        </Link>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1815]">
        {money(cat.median_amount)}
      </td>
      <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
        {money(cat.p25_amount)}
      </td>
      <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] sm:table-cell">
        {money(cat.p75_amount)}
      </td>
      <td className="hidden px-4 py-2.5 text-right tabular-nums text-[#6B6255] text-[12px] md:table-cell">
        {money(cat.min_amount ?? 0)} &ndash; {money(cat.max_amount ?? 0)}
      </td>
      <td className="px-4 py-2.5">
        <div className="relative h-3 w-full min-w-[80px] rounded-full bg-[#E8DFD1]/40">
          <div
            className="absolute top-0 h-3 rounded-full bg-[#D4C9BA]/70 group-hover:bg-[#C44B2E]/20 transition-colors"
            style={{ left: `${barLeftPct}%`, width: `${barWidthPct}%` }}
          />
          {cat.median_amount !== null && (
            <div
              className="absolute top-0 h-3 w-0.5 rounded-full bg-[#7A7062] group-hover:bg-[#C44B2E] transition-colors"
              style={{ left: `${medianPct}%` }}
            />
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
        {cat.institution_count.toLocaleString()}
      </td>
    </tr>
  );
}
