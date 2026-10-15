// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { linkPreview } from "@/lib/link-preview";
import { benchmarkBasis, COVERAGE_LABELS, getPublicSnapshot, type PublicStatsSummary } from "@/lib/public-stats";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { PRODUCT_NAME, REPORT_PRICE_INLINE, SITE_NAME } from "@/lib/constants";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { annualMonthsFree, CONSULTANT_PRICE_NOTE, PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { loadSampleReport, sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { FeeRange, FeeRangeAxis, Logo } from "@/brand/components";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { TrackLink } from "@/components/track-link";
import { hasUnstatedAudience, UnstatedAudienceFootnote } from "@/components/unstated-audience";
import { PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { reportFormHref, ReportOfferSection, SampleExcerpt } from "./report-offer";
import { HAMILTON_TABS } from "./hamilton-copy";

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

  return (
    <div className="min-h-screen bg-paper">
      <ConsumerNav />
      <main id="main-content">
        <Hero summary={summary} category={heroCategory} />
        <ProofStrip summary={summary} />
        <EveryFeeSection sample={sampleLive ? sample : null} />
        <EveryMarketSection />
        <HamiltonSection />
        <ReportOfferSection sampleLive={sampleLive} query={query} />
        <ClosingBand />
      </main>
      <CustomerFooter sampleReport={sampleLive} />
      <SearchModal />
    </div>
  );
}

/** Hero copy: site v3 brief 08 B.3 (h1 option 1, subhead), CTAs per 03 section 4. */
function Hero({ summary, category }: { summary: PublicStatsSummary; category: FeeCategorySummary | null }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-page gap-10 px-6 pb-14 pt-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:pt-20">
        <div>
          <p className={EYEBROW}>Bank fee benchmarking and competitive fee reports</p>
          <h1 className="mt-4 text-[clamp(30px,5vw,44px)] font-extrabold leading-[1.1] tracking-[-0.025em] text-ink">
            Know where your fees stand, <span className="text-brick">with a source for every figure.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            The {PRODUCT_NAME} reads the published fee schedules of U.S. banks and credit unions. See each of your
            fees against your market, your state, your Fed district, your peer group and the nation, then let
            Hamilton, the {SITE_NAME} Pro workspace, write it up.
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
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
        The median and the middle half, from each institution&apos;s own published fee schedule.
      </p>
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

function PillarHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <>
      <p className={EYEBROW}>{eyebrow}</p>
      <h2 id={id} className="mt-3 text-[28px] font-bold leading-tight text-ink">
        {title}
      </h2>
    </>
  );
}

/** Pillar 1, Every fee: site v3 brief 08 B.6; one source-linked fee row set from the live sample (03 Pillar 1). */
function EveryFeeSection({ sample }: { sample: Awaited<ReturnType<typeof loadSampleReport>> | null }) {
  return (
    <section aria-labelledby="every-fee-heading" className="border-b border-border">
      <div className="mx-auto grid max-w-page gap-10 px-6 py-14 lg:grid-cols-2 lg:items-start">
        <div>
          <PillarHeading eyebrow="Every fee" title="Your competitors' fees, from their own schedules" id="every-fee-heading" />
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            The {PRODUCT_NAME} reads each institution&apos;s published fee schedule and keeps every fee with the
            document, page and date it came from. When a board member quotes a national average from the press, you
            can answer with the schedules of the banks your customers can walk into. Fees stated as a rate, such as a
            percentage of a transaction, are kept apart from dollar fees.
          </p>
          <p className="mt-6 text-[14px]">
            <Link href="/methodology" className={TEXT_LINK}>
              How we read a fee schedule
            </Link>
          </p>
        </div>
        {sample ? <SampleExcerpt report={sample} /> : null}
      </div>
    </section>
  );
}

/** The five market layers (site v3 brief 03 Pillar 2, LAYER_KEYS). */
const MARKET_LAYERS = [
  { name: "Your market", line: "Institutions with branches in your counties, or headquartered in your city" },
  { name: "Your state", line: null },
  { name: "Your Fed district", line: null },
  { name: "Your peer group", line: "Same charter and asset size, nationwide" },
  { name: "The nation", line: null },
] as const;

/** Pillar 2, Every market: site v3 brief 08 B.7. */
function EveryMarketSection() {
  return (
    <section aria-labelledby="every-market-heading" className="border-b border-border bg-surface-0">
      <div className="mx-auto grid max-w-page gap-10 px-6 py-14 lg:grid-cols-2 lg:items-start">
        <div>
          <PillarHeading eyebrow="Every market" title="See each fee in five markets at once" id="every-market-heading" />
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            Each of your fees sits against your market (institutions with branches in your counties), your state,
            your Fed district, your peer group (same charter and asset size, nationwide) and the nation. You see the
            median, the middle half and who charges $0, and whether your fee is above, inside or below the range. A
            market with fewer than {MIN_INSTITUTIONS_FOR_MEDIAN} institutions is marked thin and gets no median.
          </p>
          <ul className="mt-6 space-y-2 text-[14px]">
            <li>
              <Link href="/reports" className={TEXT_LINK}>
                Read the free national and Fed district reports
              </Link>
            </li>
            <li>
              <Link href="/research" className={TEXT_LINK}>
                Market data
              </Link>
              <span className="text-ink-muted">: your state, your Fed district and the nation</span>
            </li>
          </ul>
        </div>
        <ol className="divide-y divide-border rounded-lg border border-border bg-paper">
          {MARKET_LAYERS.map((layer) => (
            <li key={layer.name} className="px-5 py-3.5">
              <p className="text-[15px] font-semibold text-ink">{layer.name}</p>
              {layer.line ? <p className="mt-0.5 text-[13px] text-ink-muted">{layer.line}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * Pillar 3, One workspace, and the Hamilton section the nav links to (`#hamilton`).
 * Copy: site v3 brief 08 B.8 and B.10; naming per 03 section 4. Prices from PRO_TIERS.
 */
function HamiltonSection() {
  const annualPayments = 12 - annualMonthsFree(PRO_TIERS[0].key);
  return (
    <section id="hamilton" aria-labelledby="hamilton-heading" className="scroll-mt-16 border-b border-border">
      <div className="mx-auto max-w-page px-6 py-14">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <PillarHeading eyebrow="One workspace" title="Ask, compare and take a report to committee" id="hamilton-heading" />
            <div className="mt-5">
              <Logo mark="hamilton-lockup" height={36} />
            </div>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-soft">
              Hamilton, the Fee Insight Pro workspace, puts the index and the markets in one place. Ask Hamilton a
              question and each answer cites its source. Add the findings you want to keep, and Hamilton writes a
              sourced report, such as a Peer Brief or a Competitive Positioning report. Try a price shows any amount
              side by side, including $0, before you decide. Hamilton shows the position and the options; the decision
              stays with your institution.
            </p>
          </div>
          <div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface-0">
              {HAMILTON_TABS.map((tab) => (
                <li key={tab.label} className="px-5 py-3.5">
                  <p className="text-[15px] font-semibold text-ink">{tab.label}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{tab.line}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-ink-muted">Ask Hamilton sits on every screen.</p>
          </div>
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
          <p className="mt-4 text-[14px] text-ink-soft">
            One plan for up to {WORKSPACE_SEAT_LIMIT} people. Annual is {annualPayments} monthly payments.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{CONSULTANT_PRICE_NOTE}</p>
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
          <p className="mt-6 text-[14px] text-ink-soft">
            Prefer one document? We build a{" "}
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "for_institutions_hamilton" }}
              href={reportFormHref()}
              className={TEXT_LINK}
            >
              Competitive Fee Position Report
            </TrackLink>{" "}
            for your institution, {REPORT_PRICE_INLINE}.
          </p>
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
        <p className="mt-3 text-[15px] opacity-85">
          Search your bank or credit union. Every figure comes with its source.
        </p>
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
