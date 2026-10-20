/**
 * Regenerated in the background (ISR) at most every 15 minutes, like the homepage (#1168).
 * The page reads no session, cookies or search params: the header's signed-in parts and the
 * report link's query pass-through are client islands. A render with a failed read is cached
 * for one minute instead (`shortenPageLife`, #1572), so a database blip never pins a page
 * with hidden exhibits for the full 15. During `next build` each read gets 15 s and the
 * page's two reads 30 s together (`readOnRequest`) before it renders as such a render: a busy
 * database held its build-time reads past Next's 60-second page limit (#1048).
 */
export const revalidate = 900;

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { linkPreview } from "@/lib/link-preview";
import { benchmarkBasis, getPublicSnapshot, UNAVAILABLE_PUBLIC_STATS } from "@/lib/public-stats";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { PRODUCT_NAME } from "@/lib/constants";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { readOnRequest, startBuildBudget } from "@/lib/build-phase";
import { FeeRange, FeeRangeAxis } from "@/brand/components";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { TrackLink } from "@/components/track-link";
import { hasUnstatedAudience, UnstatedAudienceFootnote } from "@/components/unstated-audience";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TryAPricePanel } from "@/app/subscribe/try-a-price-panel";
import { buildScenario } from "@/app/subscribe/scenario";
import { SAMPLE_REPORT_HREF, SANS } from "@/app/landing-shared";
import { ReportOfferSection } from "./report-offer";
import { MarketLadder, readSampleLadder } from "./market-ladder";
import { buildCompetitorBoard } from "./pro-view";
import { CompetitorBoardExhibit, PriceTesterExhibit } from "./workspace-exhibits";
import { DemoVideoSection } from "./demo-video";
import { DemoRequestForm } from "./demo-request-form";
import { proPlanFacts } from "./plan-facts";
import { EYEBROW, SECTION_H2 as H2, SECTION_INNER } from "./section-styles";

/** The hero's fallback figure when there is no live sample: the national overdraft benchmark. */
const HERO_CATEGORY = "overdraft";

// Title keeps the buyer's category terms (site v3 brief 05, section 6).
const PAGE_TITLE = "Bank Fee Benchmarking and Competitive Fee Reports";
// Kept under 160 characters so search results show it whole.
const PAGE_DESCRIPTION =
  `Know where your fees stand against named local competitors, with a source for every figure. ` +
  `Hamilton, the Fee Insight workspace, is built on the ${PRODUCT_NAME}.`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ...linkPreview({ title: PAGE_TITLE, description: PAGE_DESCRIPTION, path: "/for-institutions" }),
};


/**
 * The Pro product page (site v3 brief 05 §4). Pro is the goal, the demo request the second
 * action, and the paid report a lead (James, 2026-10-15). Every exhibit is drawn from the live
 * sample report (Capital City Bank when its market passes) and the cached index reads.
 */
export default async function ForInstitutionsPage() {
  const budgetLeft = startBuildBudget();
  // The sample is read once: it is null both when none passes the bar today and on error.
  const [snapshot, sampleRead] = await readOnRequest(
    () =>
      Promise.all([
        getPublicSnapshot(),
        loadSampleReport().then(
          (report) => ({ report, failed: false }),
          (error: unknown) => {
            console.error("[for-institutions] sample report read failed; sample exhibits hidden", error);
            return { report: null, failed: true };
          },
        ),
      ]),
    [{ summary: UNAVAILABLE_PUBLIC_STATS, categories: [] }, { report: null, failed: true }],
  );
  const heroCategory = snapshot.categories.find((c) => c.fee_category === HERO_CATEGORY) ?? null;
  const liveSample = sampleRead.report;
  const sampleLive = liveSample !== null;
  const board = buildCompetitorBoard(liveSample);
  // The ladder opens on the same lead line as the board, when the index can place it.
  // During `next build` the ladder gets what is left of the page's budget (BUILD_PAGE_BUDGET_MS).
  const ladderRead = liveSample
    ? await readOnRequest(
        () => readSampleLadder(liveSample, snapshot.categories, board?.leadKey ?? null),
        { ladder: null, failed: true },
        budgetLeft(),
      )
    : { ladder: null, failed: false };
  const ladder = ladderRead.ladder;
  const failedRead =
    !snapshot.summary.complete || snapshot.categories.length === 0 || sampleRead.failed || ladderRead.failed;
  // A render with a failed read is cached for a minute, not fifteen (see the note at the top).
  if (failedRead) await shortenPageLife();
  const scenario = board ? null : buildScenario("Overdraft", heroCategory);

  return (
    <div className="min-h-screen overflow-x-clip bg-paper">
      <ConsumerNav />
      <main id="main-content">
        <Hero
          exhibit={
            board ? (
              <CompetitorBoardExhibit board={board} />
            ) : (
              <HeroFigure category={heroCategory} refreshedOn={snapshot.summary.refreshedOn} />
            )
          }
        />
        <DemoVideoSection board={board} />
        {ladder ? (
          <Feature
            id="markets"
            eyebrow="Every market"
            title="One fee, every market it competes in"
            line="Your counties, your state, your charter and the nation, on one axis."
            exhibit={<MarketLadder data={ladder} />}
          />
        ) : null}
        {board || scenario ? (
          <Feature
            id="try-a-price"
            eyebrow="Try a price"
            title="Test a price before it goes to committee"
            line={board ? "Move the fee. Count the local competitors who charge less." : "Try any amount against the national index."}
            exhibit={board ? <PriceTesterExhibit board={board} /> : scenario ? <TryAPricePanel scenario={scenario} /> : null}
            flip
          />
        ) : null}
        <PlansSection />
        <ReportOfferSection sampleLive={sampleLive} />
        <DemoClose />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}

/**
 * Hero: its own h1 on "bank fee benchmarking" (05 §6), the primary button and the Pro button
 * (03 §4), and Hamilton's My fees view beside them. `#hamilton` is the nav's "Pro workspace".
 */
function Hero({ exhibit }: { exhibit: ReactNode }) {
  const { fromMonthly } = proPlanFacts();
  return (
    <section id="hamilton" aria-labelledby="hero-heading" className="scroll-mt-16 border-b border-border">
      <div className="mx-auto grid max-w-page gap-10 px-4 pb-14 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10 lg:pb-14 lg:pt-14 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:gap-14">
        <div>
          <p className={EYEBROW}>Bank fee benchmarking</p>
          {/* The homepage hero's display face: Geist 600, one colour, no trailing period. The size
              follows the text column so no line holds a single word (measured with Geist from 320
              to 1920px): it scales with a phone's width, steps down at lg where the column
              narrows, and steps back up at xl. */}
          <h1
            id="hero-heading"
            className="mt-4 text-[length:clamp(1.5rem,7.8vw,2rem)] !font-semibold leading-[1.04] !tracking-[-0.04em] text-ink sm:text-[3rem] lg:text-[2.25rem] xl:text-[2.75rem]"
            style={SANS}
          >
            Benchmark every fee against your competitors&rsquo; own schedules
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            Hamilton, the Fee Insight workspace, names each competitor and its fee, from your counties to the nation.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {/* A pricing manager starts on the sample report, not the consumer directory (site audit #1952). */}
            <TrackLink
              event="sample_report_click"
              eventProps={{ placement: "for_institutions_hero" }}
              href={SAMPLE_REPORT_HREF}
              className="fi-btn fi-btn-primary justify-center whitespace-nowrap"
            >
              View a sample analysis
            </TrackLink>
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "for_institutions_hero" }}
              href={PRO_PLANS_NAV.href}
              className="fi-btn fi-btn-secondary justify-center whitespace-nowrap"
            >
              {PRO_PLANS_NAV.label}
            </TrackLink>
          </div>
          <p className="mt-4 text-[13px] text-ink-muted">
            Hamilton from {fromMonthly}, monthly or annual.{" "}
            <TrackLink
              event="contact_sales"
              eventProps={{ placement: "for_institutions_hero_demo" }}
              href="#demo"
              className="font-semibold text-ink underline underline-offset-2"
            >
              {DEMO_REQUEST_NAV.label}
            </TrackLink>
          </p>
        </div>
        <div className="min-w-0">{exhibit}</div>
      </div>
    </section>
  );
}

/**
 * The live national overdraft range, for the hero when there is no live sample. Hidden when the
 * benchmark has no median (below the minimum sample) or failed to read.
 */
function HeroFigure({ category, refreshedOn }: { category: FeeCategorySummary | null; refreshedOn: string | null }) {
  if (
    !category ||
    category.median_amount === null ||
    category.p25_amount === null ||
    category.p75_amount === null ||
    category.min_amount === null ||
    category.max_amount === null
  ) {
    return null;
  }
  const top = Math.max(1, Math.ceil(category.max_amount / 10) * 10);
  const domain: [number, number] = [0, top];
  const label = getDisplayName(category.fee_category);
  return (
    <figure className="rounded-lg border border-border bg-surface-0 p-5 shadow-fi-1 sm:p-6">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={EYEBROW}>The nation</span>
        <Link href={`/fees/${category.fee_category}`} className="text-[13px] font-semibold text-ink underline underline-offset-2">
          Overdraft fees nationwide
        </Link>
      </figcaption>
      <div className="mt-4">
        <FeeRange
          label={label}
          min={category.min_amount}
          q1={category.p25_amount}
          median={category.median_amount}
          q3={category.p75_amount}
          max={category.max_amount}
          domain={domain}
        />
        <FeeRangeAxis ticks={[0, top / 2, top]} domain={domain} />
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">{benchmarkBasis(category, refreshedOn)}</p>
      <UnstatedAudienceFootnote show={hasUnstatedAudience(category)} className="mt-2" />
    </figure>
  );
}

/** One workspace view: a short heading beside its live exhibit; `flip` puts the exhibit first on desktop. */
function Feature({
  id,
  eyebrow,
  title,
  line,
  exhibit,
  flip = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  line: string;
  exhibit: ReactNode;
  flip?: boolean;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-16 border-b border-border">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-14 lg:py-20">
        <div className={flip ? "lg:order-2" : undefined}>
          <p className={EYEBROW}>{eyebrow}</p>
          <h2 id={`${id}-heading`} className={`mt-3 ${H2}`} style={SANS}>
            {title}
          </h2>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-ink-soft">{line}</p>
        </div>
        <div className={`min-w-0 ${flip ? "lg:order-1" : ""}`}>{exhibit}</div>
      </div>
    </section>
  );
}

/**
 * Hamilton Pro's three plans, from PRO_TIERS, with the subscription as the section's main action.
 * Its button is navy (primary), the page's second after the hero's institution search, on
 * purpose: a Pro subscription is the site's goal, and this band is where a buyer has just read
 * the prices, so the step to them is the strongest button in view. In the hero the Pro button
 * stays secondary, beside the search.
 */
function PlansSection() {
  const { freeMonths } = proPlanFacts();
  return (
    <section id="plans" aria-labelledby="plans-heading" className="scroll-mt-16 border-b border-border bg-surface-0">
      <div className={SECTION_INNER}>
        <div className="max-w-2xl">
          <p className={EYEBROW}>Hamilton</p>
          <h2 id="plans-heading" className={`mt-3 ${H2}`} style={SANS}>
            One plan for your whole team
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
            Priced by asset size, for up to {WORKSPACE_SEAT_LIMIT} people.
            {freeMonths > 0 ? ` Pay annually and get ${freeMonths === 2 ? "two months" : freeMonths === 1 ? "one month" : `${freeMonths} months`} free.` : ""}
          </p>
        </div>
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PRO_TIERS.map((tier) => (
            <li
              key={tier.key}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-paper px-5 py-4 sm:block sm:p-6"
            >
              <p className="text-[13px] font-medium text-ink-soft">{tier.assetsLabel}</p>
              <div className="text-right sm:text-left">
                <p className="font-mono text-[22px] font-semibold tabular-nums tracking-tight text-ink sm:mt-3 sm:text-[28px]">
                  {tierPriceLabel(tier.key, "monthly")}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-muted sm:mt-1">or {tierPriceLabel(tier.key, "annual")}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "for_institutions_plans" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-primary justify-center"
          >
            {PRO_PLANS_NAV.label}
          </TrackLink>
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "for_institutions_plans_demo" }}
            href="#demo"
            className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline underline-offset-2"
          >
            {DEMO_REQUEST_NAV.label}
          </TrackLink>
        </div>
      </div>
    </section>
  );
}

/** Closing band (navy): the demo request is its one button (B2B landing pattern); the search repeats as a text link. */
function DemoClose() {
  return (
    <section id="demo" aria-labelledby="demo-heading" className="scroll-mt-16 bg-ink text-on-ink">
      <div className="mx-auto grid max-w-page gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-16 lg:py-20">
        <div>
          <h2 id="demo-heading" className="text-[1.75rem] !font-semibold leading-[1.08] !tracking-[-0.03em] sm:text-[2.25rem]" style={SANS}>
            See Hamilton on your own market
          </h2>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-on-ink/80">
            Tell us your institution. We&apos;ll walk you through its fees against its competitors.
          </p>
          <p className="mt-6 text-[14px]">
            <Link href={SAMPLE_REPORT_HREF} className="font-semibold underline underline-offset-2">
              Or view a sample analysis first
            </Link>
          </p>
        </div>
        <DemoRequestForm />
      </div>
    </section>
  );
}
