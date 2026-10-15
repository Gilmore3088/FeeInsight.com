// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { linkPreview } from "@/lib/link-preview";
import { benchmarkBasis, COVERAGE_LABELS, getPublicSnapshot, type PublicStatsSummary } from "@/lib/public-stats";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { MarketReport } from "@/lib/custom-report/report-data";
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
import { buildMarketLadder, MarketLadder, type MarketLadderData } from "./market-ladder";
import { TryAPricePanel } from "@/app/subscribe/try-a-price-panel";
import { buildScenario, type AnalyzeScenario } from "@/app/subscribe/scenario";

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
const TEXT_LINK = "font-semibold text-ink underline underline-offset-2 hover:text-ink-soft";

export default async function ForInstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const [snapshot, sampleLive, sample] = await Promise.all([
    getPublicSnapshot(),
    sampleReportAvailable(),
    loadSampleReport().catch(() => null),
  ]);
  const { summary } = snapshot;
  const heroCategory = snapshot.categories.find((c) => c.fee_category === HERO_CATEGORY) ?? null;
  const liveSample = sampleLive ? sample : null;
  const ladder = liveSample ? await sampleLadder(liveSample, snapshot.categories) : null;
  const scenario = buildScenario("Overdraft", heroCategory);

  return (
    <div className="min-h-screen bg-paper">
      <ConsumerNav />
      <main id="main-content">
        <Hero summary={summary} category={heroCategory} />
        <ProofStrip summary={summary} />
        <SizzleSlot frame={SIZZLE_FRAME} />
        <EveryFeeSection sample={liveSample} />
        <EveryMarketSection ladder={ladder} />
        <HamiltonSection scenario={scenario} />
        <ReportOfferSection sampleLive={sampleLive} query={query} />
        <ClosingBand />
      </main>
      <CustomerFooter sampleReport={sampleLive} />
      <SearchModal />
    </div>
  );
}

/** The sample's state and charter benchmarks for the market ladder; a failed read drops its row. */
async function sampleLadder(sample: MarketReport, national: FeeCategorySummary[]): Promise<MarketLadderData | null> {
  const { state_code, charter_type } = sample.data.subject;
  const none: IndexEntry[] = [];
  const [stateIndex, charterIndex] = await Promise.all([
    state_code ? getPeerIndexCached({ state_code }).catch(() => none) : none,
    charter_type ? getPeerIndexCached({ charter_type }).catch(() => none) : none,
  ]);
  return buildMarketLadder({ sample, stateIndex, charterIndex, national });
}

/** Hero: its own h1 on "bank fee benchmarking" (05 §6, growth OS review S5); CTAs per 03 section 4. */
function Hero({ summary, category }: { summary: PublicStatsSummary; category: FeeCategorySummary | null }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-page gap-10 px-6 pb-14 pt-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:pt-20">
        <div>
          <p className={EYEBROW}>Bank fee benchmarking</p>
          <h1 className="mt-4 text-[clamp(30px,5vw,44px)] font-extrabold leading-[1.1] tracking-[-0.025em] text-ink">
            Benchmark every fee <span className="text-brick">against your competitors&apos; own schedules.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            Hamilton, the {SITE_NAME} Pro workspace, places each of your fees in your market, your state and the
            nation.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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
        <HeroFigure category={category} refreshedOn={summary.refreshedOn} />
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

/** Proof strip: live counts under COVERAGE_LABELS (site v3 brief 08 B.6, 03 Pillar 1). */
function ProofStrip({ summary }: { summary: PublicStatsSummary }) {
  const items = [
    { value: summary.institutionsLabel, label: COVERAGE_LABELS.institutions },
    { value: summary.observationsLabel, label: COVERAGE_LABELS.observations },
    { value: summary.categoriesLabel, label: COVERAGE_LABELS.categories },
    { value: summary.statesLabel, label: "States" },
  ];
  return (
    <section aria-label="Coverage" className="border-b border-border bg-surface-0">
      <div className="mx-auto max-w-page px-6 py-8">
        <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.label}>
              <dd className="font-mono text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{item.value}</dd>
              <dt className="mt-1 text-[13px] text-ink-muted">{item.label}</dt>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[12px] text-ink-muted">{summary.freshnessLabel}</p>
      </div>
    </section>
  );
}

/**
 * Where the homepage's coded sizzle frame (site v3 brief 06 §4.1-4.2) also renders on this page,
 * right under the hero. The homepage builder owns the frame; until it is passed in here, the
 * section renders nothing. WIRE: replace `null` in `SIZZLE_FRAME` with the frame element.
 */
const SIZZLE_FRAME: ReactNode = null;

function SizzleSlot({ frame }: { frame: ReactNode }) {
  if (!frame) return null;
  return (
    <section id="tour" aria-label="Product tour" className="border-b border-border">
      <div className="mx-auto max-w-page px-6 py-12">{frame}</div>
    </section>
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

/** Pillar 1, Every fee: live rows from the sample report, each with the line it was read from. */
function EveryFeeSection({ sample }: { sample: MarketReport | null }) {
  if (!sample) return null;
  return (
    <section aria-labelledby="every-fee-heading" className="border-b border-border">
      <div className="mx-auto grid max-w-page gap-10 px-6 py-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <PillarHeading
            eyebrow="Every fee"
            title="Read from each bank's own fee schedule"
            id="every-fee-heading"
            line="Every figure keeps the document, page and date it came from."
          />
          <p className="mt-6 text-[14px]">
            <Link href="/methodology" className={TEXT_LINK}>
              How we read a fee schedule
            </Link>
          </p>
        </div>
        <SampleExcerpt report={sample} />
      </div>
    </section>
  );
}

/** Pillar 2, Every market: one live fee in each market layer, in the Hamilton frame (03 Pillar 2). */
function EveryMarketSection({ ladder }: { ladder: MarketLadderData | null }) {
  if (!ladder) return null;
  return (
    <section aria-labelledby="every-market-heading" className="border-b border-border bg-surface-0">
      <div className="mx-auto grid max-w-page gap-10 px-6 py-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <PillarHeading
            eyebrow="Every market"
            title="One fee, every market around you"
            id="every-market-heading"
            line="See the same fee against local competitors, your state, your peers and the nation."
          />
          <p className="mt-6 text-[14px]">
            <Link href="/research" className={TEXT_LINK}>
              Market data by state and Fed district
            </Link>
          </p>
        </div>
        <MarketLadder data={ladder} />
      </div>
    </section>
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
