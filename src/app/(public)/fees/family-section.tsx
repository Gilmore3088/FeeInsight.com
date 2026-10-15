import Link from "next/link";
import type { FeeCategorySummary } from "@/lib/data-store";
import { getDisplayName, FAMILY_COLORS } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, hasUnstatedAudience } from "@/components/unstated-audience";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted";
// Phones get tighter cells; sm and up keep the full padding.
const CELL = "px-3 py-2.5 sm:px-4";
const TH = `${CELL} ${EYEBROW}`;
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

/** `footnote={false}` when the page shows one audience footnote for every family. */
export function FamilySection({
  familyName,
  cats,
  footnote = true,
}: {
  familyName: string;
  cats: FeeCategorySummary[];
  footnote?: boolean;
}) {
  const colors = FAMILY_COLORS[familyName];
  const colorBg = colors?.dot ?? "bg-control-border";
  const sectionMedians = cats.map((c) => c.median_amount).filter((a): a is number => a !== null);
  const sectionAvgMedian =
    sectionMedians.length > 0 ? sectionMedians.reduce((a, b) => a + b, 0) / sectionMedians.length : null;
  const sectionMaxMedian = sectionMedians.length > 0 ? Math.max(...sectionMedians) : null;
  const barScale = familyBarScale(cats);

  return (
    <section id={familySectionId(familyName)}>
      <div className="flex items-start justify-between gap-4">
        <h2 className={`flex items-center gap-2 text-sm font-bold ${colors?.text ?? "text-ink-soft"}`}>
          <span className={`inline-block h-3.5 w-1.5 rounded-full ${colorBg}`} />
          {familyName}
          <span className="ml-1 text-[11px] font-medium text-ink-muted">({cats.length})</span>
        </h2>
        {sectionAvgMedian !== null && (
          <div className="hidden sm:flex items-center gap-4 text-[11px] text-ink-muted">
            <span>
              Avg median:{" "}
              <span className="font-medium text-ink-soft tabular-nums">{money(sectionAvgMedian)}</span>
            </span>
            <span>
              Highest:{" "}
              <span className="font-medium text-ink-soft tabular-nums">{money(sectionMaxMedian)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm">
        <div className="table-scroll">
          {/* On a phone the table is two columns (fee with its institution count beneath, then the
              median), so it fits a 360px screen with no sideways scroll. The range columns, the
              distribution bar and the count column return from sm up. */}
          <table className="w-full text-left text-sm sm:min-w-[560px]">
            <thead>
              <tr className="border-b border-border/60 bg-paper/60">
                <th scope="col" className={TH}>Fee</th>
                <th scope="col" className={`${TH} text-right`}>Median</th>
                <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>P25</th>
                <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>P75</th>
                <th scope="col" className={`hidden ${TH} text-right md:table-cell`}>Min – Max</th>
                <th scope="col" className={`hidden ${TH} sm:table-cell`}>Distribution</th>
                <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>Inst.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {cats.map((cat) => (
                <CategoryRow key={cat.fee_category} cat={cat} barScale={barScale} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <UnstatedAudienceFootnote show={footnote && cats.some(hasUnstatedAudience)} className="mt-2" />
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
    <tr className="group hover:bg-paper/60 transition-colors">
      <td className={CELL}>
        <Link
          href={`/fees/${cat.fee_category}`}
          className="font-medium text-ink group-hover:text-brick transition-colors"
        >
          {getDisplayName(cat.fee_category)}
        </Link>
        <span className="mt-0.5 block text-[12px] text-ink-muted sm:hidden">
          <span className="tabular-nums">{cat.institution_count.toLocaleString()}</span> institutions
        </span>
      </td>
      <td className={`${CELL} text-right align-top tabular-nums font-semibold text-ink sm:align-middle`}>
        {money(cat.median_amount)}
        <UnstatedAudienceMark show={cat.median_amount !== null && hasUnstatedAudience(cat)} />
      </td>
      <td className={`hidden ${CELL} text-right tabular-nums text-ink-muted sm:table-cell`}>
        {money(cat.p25_amount)}
      </td>
      <td className={`hidden ${CELL} text-right tabular-nums text-ink-muted sm:table-cell`}>
        {money(cat.p75_amount)}
      </td>
      <td className={`hidden ${CELL} text-right tabular-nums text-ink-muted text-[12px] md:table-cell`}>
        {money(cat.min_amount ?? 0)} &ndash; {money(cat.max_amount ?? 0)}
      </td>
      <td className={`hidden ${CELL} sm:table-cell`}>
        <div className="relative h-3 w-full min-w-[80px] rounded-full bg-border/40">
          <div
            className="absolute top-0 h-3 rounded-full bg-border/70 group-hover:bg-brick/20 transition-colors"
            style={{ left: `${barLeftPct}%`, width: `${barWidthPct}%` }}
          />
          {cat.median_amount !== null && (
            <div
              className="absolute top-0 h-3 w-0.5 rounded-full bg-ink-muted group-hover:bg-brick-ink transition-colors"
              style={{ left: `${medianPct}%` }}
            />
          )}
        </div>
      </td>
      <td className={`hidden ${CELL} text-right tabular-nums text-ink-muted sm:table-cell`}>
        {cat.institution_count.toLocaleString()}
      </td>
    </tr>
  );
}
