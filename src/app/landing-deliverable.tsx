import { ArrowUpRight } from "lucide-react";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { SITE_NAME } from "@/lib/constants";
import type { LinePosition } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { incomeLabel, quarterLabel, type RevenueContext } from "@/lib/custom-report/revenue-context";
import { placeLabel } from "./market-report/report-body";
import { cardMoney } from "./landing-index-view";
import { HOME_WRAP, SAMPLE_REPORT_HREF, SERIF, buildSampleView, type SampleRow } from "./landing-shared";

/** Fee lines the cover shows. */
const COVER_ROWS = 3;

/** The prepared date, in the full sample's form, dated in U.S. Eastern so a U.S. evening render is never dated tomorrow. */
const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

const POSITION: Record<LinePosition, { label: string; className: string }> = {
  above_market: { label: "Above", className: "bg-[#FBE9E4] text-brick" },
  in_market: { label: "Inside", className: "bg-surface-200 text-ink" },
  below_market: { label: "Below", className: "bg-[#EAF0EC] text-below-market" },
  free: { label: "Free", className: "bg-[#EAF0EC] text-below-market" },
};

export interface OutlineItem {
  key: "findings" | "pricing" | "financial" | "peers" | "method";
  name: string;
  detail: string;
}

/**
 * What the sample report holds, in the order its page shows it (MarketReportBody): only the
 * sections it renders today. The fee lines, findings and method are always there for a ready
 * report; fee income needs the Call Report read and named competitors need at least one. With no
 * report (a failed read, or no sample today) the outline keeps the parts every report has.
 * The report carries no risk or regulatory section, so the outline names none.
 */
export function deliverableOutline(report: MarketReport | null, revenue: RevenueContext | null): OutlineItem[] {
  const items: OutlineItem[] = [];
  if (!report || report.analysis.findings.length > 0)
    items.push({ key: "findings", name: "Research conclusions", detail: "The fees that stand out from the local market." });
  items.push({ key: "pricing", name: "Pricing evidence", detail: "Every fee against local competitors, each linked to its schedule." });
  if (report && revenue)
    items.push({ key: "financial", name: "Current financial state", detail: "Fee income from the latest Call Report, beside institutions of its size." });
  if (report && report.analysis.named.length > 0)
    items.push({ key: "peers", name: "Comparable institutions", detail: "Named competitors in its market, fee by fee." });
  items.push({ key: "method", name: "Sources and method", detail: "How the market, the competitors and each figure were chosen." });
  return items;
}

export interface DeliverableCover {
  institutionName: string;
  market: string;
  competitors: { withData: number; inMarket: number };
  rows: SampleRow[];
  income: { quarter: string; amount: string } | null;
}

/** The cover's real figures, from the live sample report and its Call Report read; null without a report. */
export function deliverableCover(report: MarketReport | null, revenue: RevenueContext | null): DeliverableCover | null {
  const view = buildSampleView(report);
  if (!report || !view || !report.data.market) return null;
  const market = report.data.market;
  const latest = revenue?.quarters[0];
  return {
    institutionName: view.institutionName,
    market: `${placeLabel(market.places[0])} area`,
    competitors: { withData: report.analysis.readiness.competitorsWithData, inMarket: report.analysis.readiness.competitorsInMarket },
    rows: view.rows.slice(0, COVER_ROWS),
    income: latest ? { quarter: quarterLabel(latest.quarter), amount: incomeLabel(latest.thousands) } : null,
  };
}

/** A page of the report, drawn from its real data: the title, the date, the fee lines and fee income. */
function CoverPage({ cover, preparedOn }: { cover: DeliverableCover; preparedOn: Date }) {
  return (
    <div className="relative mx-auto w-full max-w-[30rem] py-3 lg:mx-0" data-deliverable-cover="">
      <span aria-hidden="true" className="absolute inset-x-8 inset-y-0 -rotate-[2.5deg] rounded-[8px] bg-brick-tint" />
      <span aria-hidden="true" className="absolute inset-x-5 inset-y-1 rotate-[1.5deg] rounded-[8px] border border-border bg-surface-200" />
      <figure className="relative rounded-[8px] border border-border bg-surface-0 p-5 shadow-[0_22px_44px_-28px_rgb(9_39_71/0.55)] sm:p-6">
        <figcaption>
          <p className="text-[11px] text-ink-muted">
            {SITE_NAME} · {DATE.format(preparedOn)}
          </p>
          <p className="mt-2 text-[21px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[24px]">
            {cover.institutionName} against its local market
          </p>
          <p className="mt-1.5 text-[12px] text-ink-soft">
            {cover.market} · verified fees for {cover.competitors.withData} of {cover.competitors.inMarket} local competitors
          </p>
        </figcaption>
        {cover.rows.length > 0 && (
          <table className="mt-4 w-full text-left text-[12px]">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Fee</th>
                <th className="py-1.5 pr-2 text-right font-medium">Theirs</th>
                <th className="py-1.5 pr-2 text-right font-medium">Local median</th>
                <th className="py-1.5 text-right font-medium">
                  <span className="sr-only">Position</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cover.rows.map((row) => (
                <tr key={row.key} className="border-b border-surface-200 last:border-0" data-deliverable-row={row.key}>
                  <td className="py-2 pr-2 text-ink">{row.label}</td>
                  <td className="py-2 pr-2 text-right text-[14px] font-semibold tabular-nums text-ink">{cardMoney(row.amount)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-ink-soft">{cardMoney(row.median)}</td>
                  <td className="py-2 text-right">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${POSITION[row.position].className}`}>
                      {POSITION[row.position].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cover.income && (
          <p className="mt-4 flex items-baseline justify-between gap-3 rounded-[5px] bg-paper px-3 py-2.5 text-[12px] text-ink-soft" data-deliverable-income="">
            <span>Deposit service charges, {cover.income.quarter}</span>
            <strong className="shrink-0 whitespace-nowrap text-[15px] font-semibold tabular-nums text-ink">{cover.income.amount}</strong>
          </p>
        )}
      </figure>
    </div>
  );
}

/**
 * The deliverable before the plans (James's critique §6 and §8, step 05): today's live sample
 * report for the demo bank (loadSampleReport), its cover drawn from its own figures, and what
 * it holds. No price and no buy button: the sample shows what Hamilton produces. A failed read
 * hides the cover and keeps the outline.
 */
export function LandingDeliverable({
  report,
  revenue,
  preparedOn,
}: {
  report: MarketReport | null;
  revenue: RevenueContext | null;
  preparedOn: Date;
}) {
  const cover = deliverableCover(report, revenue);
  const outline = deliverableOutline(cover ? report : null, cover ? revenue : null);
  return (
    <section id="sample" aria-labelledby="deliverable-title" className="bg-paper py-10 sm:py-14" data-deliverable="">
      <div className={`${HOME_WRAP} grid items-center gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-14 lg:gap-y-6`}>
        {/* A phone reads the heading, then the page itself, then what it holds; from lg up the page sits beside both. */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:self-end">
          <h2 id="deliverable-title" className="text-[34px] !font-medium leading-[1.06] tracking-[-0.025em] text-ink sm:text-[48px]" style={SERIF}>
            Read the report before you choose a plan.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:text-[16px]">
            {cover
              ? `Today’s sample for ${cover.institutionName}, built live, every amount linked to its fee schedule.`
              : "Each report is built live, every amount linked to its fee schedule."}
          </p>
        </div>
        {cover && (
          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <CoverPage cover={cover} preparedOn={preparedOn} />
          </div>
        )}
        <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:self-start">
          <ol className="border-t border-border" aria-label="What the report contains">
            {outline.map((item, i) => (
              <li key={item.key} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 border-b border-border py-3" data-outline={item.key}>
                <span aria-hidden="true" className="pt-0.5 text-[12px] font-semibold tabular-nums text-brick">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold leading-tight text-ink">{item.name}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{item.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-col items-center gap-3.5 sm:flex-row sm:gap-6">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "home_deliverable" }}
              href={PRO_PLANS_NAV.href}
              className="fi-btn fi-btn-brick min-h-12 w-full justify-center px-6 text-[15px] sm:w-auto"
            >
              Get Hamilton for your institution
            </TrackLink>
            {/* The full sample only when it exists today, so the link never lands on its "on its way" note. */}
            {cover && (
              <TrackLink
                event="sample_report_click"
                eventProps={{ placement: "home_deliverable" }}
                href={SAMPLE_REPORT_HREF}
                className="inline-flex items-center gap-1.5 text-[14px] font-medium text-brick underline decoration-brick/40 underline-offset-4 hover:decoration-brick"
              >
                Open the full sample
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </TrackLink>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
