// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { linkPreview } from "@/lib/link-preview";
import { benchmarkBasis, getPublicSnapshot, type PublicStatsSummary } from "@/lib/public-stats";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { getFeeCategoryDetailCached } from "@/lib/data-store/public-cached-reads";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { loadSampleReport, sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { FeeRange, FeeRangeAxis, Logo } from "@/brand/components";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { TrackLink } from "@/components/track-link";
import { hasUnstatedAudience, UnstatedAudienceFootnote } from "@/components/unstated-audience";
import { PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { ReportOfferSection, SampleExcerpt } from "./report-offer";
import { loadSampleLadder, MarketLadder, type MarketLadderData } from "./market-ladder";
import { TryAPricePanel } from "@/app/subscribe/try-a-price-panel";
import { buildScenario, type AnalyzeScenario } from "@/app/subscribe/scenario";
import { LandingSizzle } from "@/app/landing-sizzle";
import { buildHomeData, buildSampleView } from "@/app/landing-shared";

const DEMO_HREF = "/contact?source=demo";
/** The hero's live figure: the national overdraft benchmark (site v3 brief 03, Q9). */
const HERO_CATEGORY = "overdraft";

// Title keeps the buyer's category terms (site v3 brief 05, section 6).
const PAGE_TITLE = "Bank Fee Benchmarking and Competitive Fee Reports";
const PAGE_DESCRIPTION =
  `Know where your fees stand in your market, with a source for every figure. The ${PRODUCT_NAME} reads ` +
  `the published fee schedules of U.S. banks and credit unions, and Hamilton, the Pro workspace, takes you ` +
  `from that figure to a decision and a board document.`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ...linkPreview({ title: PAGE_TITLE, description: PAGE_DESCRIPTION, path: "/for-institutions" }),
};

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted";

export default async function ForInstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const [snapshot, sampleLive, sample, overdraftDetail] = await Promise.all([
    getPublicSnapshot(),
    sampleReportAvailable(),
    loadSampleReport().catch(() => null),
    getFeeCategoryDetailCached("overdraft").catch((error: unknown) => {
      console.error("[for-institutions] overdraft district read failed; district rows hidden", error);
      return null;
    }),
  ]);
  const { summary } = snapshot;
  const heroCategory = snapshot.categories.find((c) => c.fee_category === HERO_CATEGORY) ?? null;
  const liveSample = sampleLive ? sample : null;
  const ladder = liveSample ? await loadSampleLadder(liveSample, snapshot.categories) : null;
  const scenario = buildScenario("Overdraft", heroCategory);
  // The sizzle here leaves out what this page already shows (the ladder, Try a price): its
  // workspace chapter is Hamilton answering a question, and its end frame the sample report.
  const sizzleData = buildHomeData(summary, snapshot.categories, overdraftDetail?.by_fed_district, {
    sample: buildSampleView(liveSample),
  });

  return (
    <div className="min-h-screen bg-paper">
      <ConsumerNav />
      <main id="main-content">
        <Hero summary={summary} category={heroCategory} ladder={ladder} />
        <HamiltonSection scenario={scenario} />
        <LandingSizzle data={sizzleData} workspace="ask" topPadding />
        <ReportOfferSection
          sampleLive={sampleLive}
          query={query}
          excerpt={liveSample ? <SampleExcerpt report={liveSample} /> : null}
        />
        <ClosingBand />
      </main>
      <CustomerFooter sampleReport={sampleLive} />
      <SearchModal />
    </div>
  );
}

/** Hero: its own h1 on "bank fee benchmarking" (05 §6, growth OS review S5); CTAs per 03 section 4. */
function Hero({
  summary,
  category,
  ladder,
}: {
  summary: PublicStatsSummary;
  category: FeeCategorySummary | null;
  ladder: MarketLadderData | null;
}) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-page gap-8 px-4 pb-12 pt-8 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-12 lg:pb-16 lg:pt-14">
        <div>
          <p className={EYEBROW}>Bank fee benchmarking</p>
          <h1 className="mt-4 text-[clamp(30px,5vw,44px)] font-extrabold leading-[1.1] tracking-[-0.025em] text-ink">
            Benchmark every fee <span className="text-brick">against your competitors&apos; own schedules.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            Hamilton, the {SITE_NAME} Pro workspace, places each of your fees in your market, your state and the
            nation.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:mt-8">
            <Link
              href={PRIMARY_CTA_NAV.href}
              className="fi-btn fi-btn-primary justify-center"
            >
              {PRIMARY_CTA_NAV.label}
            </Link>
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "for_institutions_hero" }}
              href={PRO_PLANS_NAV.href}
              className="fi-btn fi-btn-secondary justify-center"
            >
              {PRO_PLANS_NAV.label}
            </TrackLink>
          </div>
          <p className="mt-4 text-[13px] text-ink-muted">Free. Search any institution in the index.</p>
        </div>
        {ladder ? <MarketLadder data={ladder} /> : <HeroFigure category={category} refreshedOn={summary.refreshedOn} />}
      </div>
    </section>
  );
}

/**
 * The live national overdraft range: the house box plot, with what it measures beside it.
 * Hidden when the benchmark has no median (below the minimum sample) or failed to read.
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

function PillarHeading({ eyebrow, title, id, line }: { eyebrow: string; title: string; id: string; line: string }) {
  return (
    <>
      <p className={EYEBROW}>{eyebrow}</p>
      <h2 id={id} className="mt-3 text-[28px] font-bold leading-tight text-ink">
        {title}
      </h2>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">{line}</p>
    </>
  );
}

/**
 * Pillar 3, One workspace, and the Hamilton section the nav links to (`#hamilton`).
 * Naming per 03 section 4; the example is Try a price on the live national index. Prices from PRO_TIERS.
 */
function HamiltonSection({ scenario }: { scenario: AnalyzeScenario | null }) {
  return (
    <section id="hamilton" aria-labelledby="hamilton-heading" className="scroll-mt-16 border-b border-border">
      <div className="mx-auto max-w-page px-6 py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
          <div>
            <div className="mb-5">
              <Logo mark="hamilton-lockup" height={36} />
            </div>
            <PillarHeading
              eyebrow="One workspace"
              title="Test a price, then take it to committee"
              id="hamilton-heading"
              line="Try any amount against the market, ask questions with sources, and send the board a cited brief."
            />
          </div>
          {scenario ? <TryAPricePanel scenario={scenario} /> : null}
        </div>

        <div className="mt-12">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {PRO_TIERS.map((tier) => (
              <li key={tier.key} className="rounded-lg border border-border bg-surface-0 p-5">
                <p className="text-[13px] text-ink-muted">{tier.assetsLabel}</p>
                <p className="mt-2 font-mono text-[24px] font-semibold tabular-nums text-ink">
                  {tierPriceLabel(tier.key, "monthly")}
                </p>
                <p className="mt-1 text-[13px] text-ink-muted">or {tierPriceLabel(tier.key, "annual")}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[14px] text-ink-soft">One plan for up to {WORKSPACE_SEAT_LIMIT} people.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "for_institutions_hamilton" }}
              href={PRO_PLANS_NAV.href}
              className="fi-btn fi-btn-primary justify-center"
            >
              {PRO_PLANS_NAV.label}
            </TrackLink>
            <TrackLink
              event="contact_sales"
              eventProps={{ placement: "for_institutions_hamilton_demo" }}
              href={DEMO_HREF}
              className="inline-flex min-h-11 items-center text-[14px] font-medium text-ink underline underline-offset-2"
            >
              Or ask for a demo
            </TrackLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Closing band (navy): site v3 brief 08 B.12. */
function ClosingBand() {
  return (
    <section className="bg-ink text-on-ink">
      <div className="mx-auto max-w-page px-6 py-14 text-center">
        <h2 className="text-[28px] font-bold leading-tight">See where your fees stand in your market</h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
          <Link
            href={PRIMARY_CTA_NAV.href}
            className="fi-btn justify-center bg-paper text-ink hover:opacity-90"
          >
            {PRIMARY_CTA_NAV.label}
          </Link>
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "for_institutions_closing" }}
            href={PRO_PLANS_NAV.href}
            className="text-[14px] font-semibold underline underline-offset-2"
          >
            {PRO_PLANS_NAV.label}
          </TrackLink>
        </div>
      </div>
    </section>
  );
}
