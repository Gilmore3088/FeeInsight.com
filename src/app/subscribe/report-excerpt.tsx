import { ProductFrame } from "@/components/marketing/product-frame";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { REPORT_OFFER } from "@/lib/constants";
import { AtAGlance } from "@/app/market-report/[token]/at-a-glance";
import { placeLabel } from "@/app/market-report/report-body";
import { SAMPLE_REPORT_HREF } from "@/app/landing-shared";

const DISPLAY = { fontFamily: "var(--fi-font-sans)" };
/** Rows of the report's At a glance shown here; the full sample has the rest. */
export const EXCERPT_ROWS = 6;

/**
 * The one product visual on the pricing page (James, Oct 16 evening: one convincing deliverable,
 * not a tour). A readable excerpt of the live sample report, the same one the sample page renders,
 * so every figure is read from published schedules today. Without a ready sample it is left out
 * rather than shown with stand-in figures.
 */
export function ReportExcerpt({ report }: { report: MarketReport }) {
  const { data, analysis } = report;
  const market = data.market;
  if (!market) return null;
  const marketLabel = `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`;
  return (
    <section aria-labelledby="report-excerpt-heading" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">What subscribers produce</p>
        <h2
          id="report-excerpt-heading"
          className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[2.25rem]"
          style={DISPLAY}
        >
          Every fee, ranked against your local market
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[16px] leading-relaxed text-ink-soft">
          An excerpt from a live sample report. In Hamilton, you compare your own published fees with your local competitors
          and keep the source behind every figure.
        </p>
      </div>
      <div className="mx-auto mt-8 max-w-3xl">
        <ProductFrame label={`${REPORT_OFFER.name} · Sample`}>
          <div className="p-4 sm:p-6" data-report-excerpt="">
            <p className="text-[1.15rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.3rem]">
              {data.subject.institution_name} against its local market
            </p>
            <p className="mt-1 text-[13px] text-ink-muted">
              {marketLabel} · {analysis.readiness.competitorsWithData} local competitors with published fees
            </p>
            <div className="[&>section]:mt-4 [&>section]:p-4 sm:[&>section]:p-5">
              <AtAGlance lines={analysis.lines} limit={EXCERPT_ROWS} />
            </div>
          </div>
        </ProductFrame>
        <p className="mt-6 text-center">
          <a href={SAMPLE_REPORT_HREF} className="fi-btn fi-btn-secondary min-h-11">
            Open the full sample report
          </a>
        </p>
      </div>
    </section>
  );
}
