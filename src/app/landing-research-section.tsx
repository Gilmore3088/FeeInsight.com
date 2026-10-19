import { ArrowUpRight } from "lucide-react";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import type { ReportPeerContext, ReportPeerFinancial } from "@/lib/custom-report/peer-context";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { RevenueContext } from "@/lib/custom-report/revenue-context";
import type { MarketBranchFootprint } from "@/lib/data-store/branches";
import { buildOneQuestionView, type OneQuestionView } from "./landing-one-question";
import { OneQuestionFlow } from "./landing-research";
import { HOME_WRAP, SAMPLE_REPORT_HREF, SERIF } from "./landing-shared";

/** Where a visitor inspects how each source is collected and checked. */
export const DATA_SOURCES_HREF = "/research/data-sources";

/**
 * The providers behind the figures this section actually shows, so the strip never credits a
 * source the example does not use (James's brief, Oct 19, §8).
 */
export function sourcesShown(view: OneQuestionView | null): string[] {
  const out = ["Published fee schedules"];
  if (!view) return out;
  if (view.income) out.push(view.income.filing.startsWith("NCUA") ? "NCUA Call Reports" : "FDIC Call Reports");
  if (view.market) out.push("FDIC Summary of Deposits");
  return out;
}

/**
 * "One question. Every angle considered." (James's brief and mockup, Oct 19): one question about
 * the demo bank's outgoing wire fee, the four kinds of evidence Hamilton reads, and four outputs
 * drawn from the live sample report. The page passes the reads it already makes; this section
 * adds none of its own.
 */
export function LandingResearch({
  report = null,
  revenue = null,
  financial = null,
  peers = null,
  branches = null,
}: {
  report?: MarketReport | null;
  revenue?: RevenueContext | null;
  financial?: ReportPeerFinancial | null;
  peers?: ReportPeerContext | null;
  branches?: MarketBranchFootprint | null;
} = {}) {
  const view = buildOneQuestionView({ report, revenue, financial, peers, branches });
  const sources = sourcesShown(view);
  return (
    <section id="research" aria-labelledby="research-title" className="border-y border-border bg-surface-0 py-12 sm:py-16">
      <div className={HOME_WRAP}>
        <header className="mx-auto max-w-[52rem] text-center">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Hamilton Intelligence</p>
          <h2 id="research-title" className="mt-3 text-[34px] !font-medium leading-[1.06] tracking-[-0.025em] text-ink sm:text-[48px]" style={SERIF}>
            {/* Each sentence starts its own line, so a break never strands a word. */}
            <span className="block">One question.</span> <span className="block">Every angle considered.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-[46rem] text-[16px] leading-relaxed text-ink-soft sm:text-[18px]">
            Hamilton brings together your institution&rsquo;s financial performance, competitors, market conditions, and regulatory
            context to help you make decisions grounded in evidence.
          </p>
        </header>

        <div className="mt-9 sm:mt-11">
          <OneQuestionFlow view={view} sampleHref={view ? SAMPLE_REPORT_HREF : null} />
        </div>

        <div className="mt-10 flex flex-col items-center gap-5 text-center">
          <h3 className="max-w-[36rem] text-[24px] !font-medium leading-tight tracking-[-0.02em] text-ink sm:text-[30px]" style={SERIF}>
            See what Hamilton could uncover for your institution.
          </h3>
          <div className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "home_research" }}
              href={PRO_PLANS_NAV.href}
              className="fi-btn fi-btn-brick min-h-12 w-full justify-center px-6 text-[15px] sm:w-auto"
            >
              Explore Hamilton
            </TrackLink>
            {view ? (
              <TrackLink
                event="sample_report_click"
                eventProps={{ placement: "home_research" }}
                href={SAMPLE_REPORT_HREF}
                className="fi-btn fi-btn-secondary min-h-12 w-full justify-center px-6 text-[15px] sm:w-auto"
              >
                View sample report
              </TrackLink>
            ) : null}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-5 text-[12px] text-ink-muted sm:flex-row sm:items-center sm:justify-between" data-source-strip="">
          <p>
            <span className="mr-2 font-semibold uppercase tracking-[0.1em]">Sources</span>
            {sources.join(" · ")}
          </p>
          <a
            href={DATA_SOURCES_HREF}
            className="inline-flex items-center gap-1 font-medium text-ink-soft underline decoration-ink-muted/40 underline-offset-4 hover:text-ink"
          >
            Data sources and methodology
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
