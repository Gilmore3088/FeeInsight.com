export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getDisplayName,
  getFeeFamily,
  getFamilyColor,
  FEE_FAMILIES,
  DISPLAY_NAMES,
} from "@/lib/fee-taxonomy";
import { loadGuidesForCategory } from "@/lib/guides/source";
import { formatFeeAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DistributionChart } from "@/components/public/distribution-chart";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { Button, SearchInput } from "@/brand/components";
import { DEMO_REQUEST_NAV, PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, hasUnstatedAudience } from "@/components/unstated-audience";
import { getFeeCategoryDetailCached, getNationalRateStatsCached } from "@/lib/data-store/public-cached-reads";
import { formatRatePercent, percentFeeAllowed } from "@/lib/percent-fees";
import { benchmarkBasis, getPublicSnapshot } from "@/lib/public-stats";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { summarizeFees, summarizeFeesBy } from "@/lib/data-store/fee-stats";
import type { FeeCategorySummary, FeeInstance } from "@/lib/data-store/fees";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { SAMPLE_REPORT_HREF } from "@/app/landing-shared";
import {
  bySize,
  charterDots,
  charterFinding,
  districtHeadline,
  districtLabel,
  marketDots,
  explorerPoints,
  nationalBand,
  positionsShown,
  relatedBands,
  stateLabel,
  tierLabel,
} from "./category-view";
import { ExplorerChart, ExplorerMarkets, FeeExplorer } from "./fee-explorer";
import { DotLegend, HeroRange, LockedRows, MarketDots, RelatedRanges, VideoSlot } from "./exhibits";

interface PageProps {
  params: Promise<{ category: string }>;
}

/** States drawn for Pro, by institution count; the full list is in Hamilton. */
const STATES_SHOWN = 12;

/**
 * This page's figures, all from the one category read that also draws the chart and the
 * districts, so the hero, the chart, the districts and the bank/credit union split count the
 * same institutions. The shared snapshot is a separate cache entry that can be built at
 * another moment; it still supplies what this read lacks (the $0 count, the audience mark).
 */
function pageSummary(category: string, fees: FeeInstance[], snapshotRow: FeeCategorySummary | null): FeeCategorySummary | null {
  const rows = fees.filter((f) => f.source_document_id !== null).map((f) => ({ ...f, fee_category: category }));
  if (rows.length === 0) return snapshotRow;
  const all = summarizeFees(rows);
  const byCharter = summarizeFeesBy(rows, (r) => (r.charter_type === "bank" || r.charter_type === "credit_union" ? r.charter_type : null));
  return {
    fee_category: category,
    institution_count: all.institution_count,
    total_observations: all.observation_count,
    bank_count: all.bank_count,
    cu_count: all.cu_count,
    min_amount: all.min_amount,
    max_amount: all.max_amount,
    avg_amount: all.avg_amount,
    median_amount: all.median_amount,
    p25_amount: all.p25_amount,
    p75_amount: all.p75_amount,
    zero_count: snapshotRow?.zero_count ?? 0,
    bank_median_amount: byCharter.get("bank")?.median_amount ?? null,
    cu_median_amount: byCharter.get("credit_union")?.median_amount ?? null,
    unstated_audience_institution_count: snapshotRow?.unstated_audience_institution_count ?? 0,
  };
}

/** Thousands-separated dollars ("$5,000", "$2.50"); "-" when unavailable. */
const money = (value: number | null | undefined) => formatFeeAmount(value) ?? "-";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params;
  const name = getDisplayName(category);
  const family = getFeeFamily(category);
  // Thin pages (fewer institutions than the median floor) stay out of search; the sitemap
  // leaves them out too. When the snapshot can't be read, the page stays indexable.
  const snapshot = await getPublicSnapshot().catch(() => null);
  const national = snapshot?.categories.find((c) => c.fee_category === category) ?? null;
  const thin =
    snapshot !== null &&
    snapshot.categories.length > 0 &&
    (national?.institution_count ?? 0) < MIN_INSTITUTIONS_FOR_MEDIAN;

  return {
    title: `${name} Fee - National Benchmarks & Analysis`,
    ...(thin ? { robots: { index: false, follow: true } } : {}),
    description: `What U.S. banks and credit unions charge for ${name.toLowerCase()} fees${national?.median_amount != null ? `: a median of ${money(national.median_amount)}` : ""}. The full spread, every Fed district, and banks against credit unions, each read from the institution's own schedule.`,
    openGraph: {
      title: `${name} Fee Benchmarks`,
      description: `How much do banks charge for ${name.toLowerCase()}? National median, distribution, and peer comparisons.`,
    },
    keywords: [
      `${name.toLowerCase()} fee`,
      `average ${name.toLowerCase()} fee`,
      `bank ${name.toLowerCase()} fee`,
      family ? `${family.toLowerCase()} fees` : "bank fees",
    ],
  };
}

export default async function FeeCategoryPage({ params }: PageProps) {
  const { category } = await params;

  if (!DISPLAY_NAMES[category]) {
    notFound();
  }

  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);

  const name = getDisplayName(category);
  const plainName = name.replace(/\s*\([^)]*\)/g, "");
  const family = getFeeFamily(category);
  const familyColor = family ? getFamilyColor(family) : null;
  const [detail, snapshot, rateStats, hasSample] = await Promise.all([
    getFeeCategoryDetailCached(category),
    getPublicSnapshot(),
    // Fees this category may state as a rate ("1% of the transaction") get their own
    // statistics; a rate is never pooled with the dollar figures above it.
    percentFeeAllowed(category) ? getNationalRateStatsCached(category).catch(() => null) : Promise.resolve(null),
    sampleReportAvailable().catch(() => false),
  ]);
  const showRates = rateStats != null && rateStats.maturity_tier !== "insufficient" && rateStats.median_rate != null;

  // Close the loop the other way: a reader on a fee page can reach the guide that
  // explains it. Consumer guides are public, so this link is never a dead end.
  const consumerGuides = await loadGuidesForCategory(category, "consumer");

  // Same statistics contract as the fee index, research hub and homepage (one value per
  // institution); every figure on this page is read from the one category read (pageSummary).
  const national = pageSummary(category, detail.fees, snapshot.categories.find((c) => c.fee_category === category) ?? null);
  const band = nationalBand(national);
  const refreshedOn = snapshot.summary.refreshedOn;
  const institutionValues = detail.institution_values ?? [];
  const institutionCount = national?.institution_count ?? 0;
  const entryCount = national?.total_observations ?? 0;
  const median = national?.median_amount ?? null;

  // An asterisk when any institution in the benchmark has a row with no stated audience.
  const unstatedAudience = median !== null && hasUnstatedAudience(national);

  const districts = band ? marketDots(detail.by_fed_district, band, districtLabel) : [];
  const charters = band ? charterDots(national, band) : [];
  const charterSentence = charterFinding(charters, name);
  const tiers = band ? bySize(marketDots(detail.by_asset_tier, band, tierLabel)) : [];
  const states = band ? marketDots(detail.by_state, band, stateLabel).slice(0, STATES_SHOWN) : [];
  // Free visitors get one size group in full (the largest), and the names of the rest.
  const previewTier = isPro ? null : ([...tiers].sort((a, b) => b.institutions - a.institutions)[0] ?? null);
  const lockedTiers = previewTier ? tiers.filter((t) => t.key !== previewTier.key) : [];
  const headline = districtHeadline(districts);
  // A detail entry cached before the points existed draws the static chart until it refreshes.
  const points = explorerPoints(detail.institution_points, isPro);
  // Fewer than three institutions draw no chart at all (the static chart says so instead).
  const interactive = points.length >= 3;
  const related = relatedBands(snapshot.categories, family ? (FEE_FAMILIES[family] ?? []).filter((c) => c !== category) : []);

  return (
    <div className="mx-auto max-w-page px-4 py-8 sm:px-6 sm:py-12">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Fee Index", href: "/fees" },
          { name: name, href: `/fees/${category}` },
        ]}
      />

      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ink-muted">
        <Link href="/fees" className="hover:text-ink">
          Fee Index
        </Link>
        {family && familyColor && (
          <>
            <span className="text-border">/</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${familyColor.bg} ${familyColor.text}`}>
              {family}
            </span>
          </>
        )}
      </nav>

      <div className="mt-8 space-y-10 sm:space-y-12">
        {/* 1. Hero: the median, then the whole national spread as one range. */}
        <section aria-labelledby="fee-heading" className="space-y-4">
          <div>
            <h1 id="fee-heading" className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[40px]">
              {plainName} fee
            </h1>
            {median !== null ? (
              <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-[44px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink sm:text-[52px]">
                  {money(median)}
                  {unstatedAudience && (
                    // Raised to the figure's cap height and set close, so it reads as a note mark.
                    <span className="ml-0.5 inline-block -translate-y-[0.55em] font-sans text-[26px] font-medium leading-none text-ink-muted">
                      <UnstatedAudienceMark />
                    </span>
                  )}
                </span>
                <span className="text-[15px] text-ink-muted">
                  median across {institutionCount.toLocaleString("en-US")} banks and credit unions
                </span>
              </p>
            ) : (
              <p className="mt-2 text-[15px] text-ink-muted">Not enough published fees yet for a national benchmark.</p>
            )}
          </div>
          {band && <HeroRange band={band} label="U.S." />}
          <UnstatedAudienceFootnote show={unstatedAudience} />
          <VideoSlot title="One fee across five markets" />
        </section>

        {showRates && rateStats && (
          <section aria-labelledby="rate-heading" className="rounded-xl border border-border bg-surface-0 px-4 py-3">
            <h2 id="rate-heading" className="text-[15px] font-semibold text-ink">
              Stated as a rate at {rateStats.institution_count.toLocaleString("en-US")} institutions
            </h2>
            <p className="mt-1 text-[14px] text-ink-muted">
              Median <span className="font-mono font-semibold text-ink">{formatRatePercent(rateStats.median_rate)}</span>, middle half{" "}
              <span className="font-mono text-ink">
                {formatRatePercent(rateStats.p25_rate)}–{formatRatePercent(rateStats.p75_rate)}
              </span>
              . Rates are never mixed into the dollar figures.
            </p>
          </section>
        )}

        {/* 2-5 share one selection: a bar or a market tapped anywhere redraws the others. */}
        <FeeExplorer points={points}>
          {/* 2. Distribution: one bar per price band, one institution per value. */}
        {institutionValues.length > 0 && (
          <section aria-labelledby="distribution-heading" className="space-y-3">
            <h2 id="distribution-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
              What institutions charge
            </h2>
            {interactive ? (
              <ExplorerChart median={median} />
            ) : (
              <div className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6">
                {/* The chart's type scales with its width, so it stops growing past a readable size. */}
                <div className="mx-auto max-w-[640px]">
                  <DistributionChart values={institutionValues} median={median} />
                </div>
              </div>
            )}
            {consumerGuides[0] && (
              <p className="text-[14px] text-ink-muted">
                New to this fee?{" "}
                <Link href={`/guides/${consumerGuides[0].slug}`} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                  {consumerGuides[0].title}
                </Link>
              </p>
            )}
          </section>
        )}

        {/* 3. By Fed district, as dots on the national spread. */}
        {band && districts.length > 1 && (
          <section aria-labelledby="district-heading" className="space-y-3">
            <div>
              <h2 id="district-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
                {headline?.title}
              </h2>
              <p className="mt-1 text-[14px] text-ink-muted">
                {headline?.detail ? `${headline.detail} ` : ""}The median in each Federal Reserve district.
              </p>
            </div>
            <DotLegend positions={positionsShown(districts)} />
            <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 shadow-fi-1 sm:px-6">
              {interactive ? (
                  <ExplorerMarkets dots={districts} band={band} dim="district" ariaLabel={`${plainName} median by Fed district`} />
                ) : (
                  <MarketDots dots={districts} band={band} ariaLabel={`${plainName} median by Fed district`} />
                )}
            </div>
          </section>
        )}

        {/* 4. The reader's own institution. */}
        <section aria-labelledby="search-heading" className="rounded-2xl bg-paper px-4 py-5 ring-1 ring-border sm:px-6">
          <h2 id="search-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Where does your institution sit?
          </h2>
          <form action="/institutions" method="get" role="search" className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="fee" value={category} />
            <SearchInput name="q" label="Your bank or credit union" required autoComplete="off" className="w-full min-w-0 sm:flex-1" />
            <Button type="submit" variant="primary" className="min-h-11 justify-center whitespace-nowrap">
              {PRIMARY_CTA_NAV.label}
            </Button>
          </form>
          {hasSample && (
            <p className="mt-3 text-[13px] text-ink-muted">
              Or{" "}
              <Link href={SAMPLE_REPORT_HREF} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                see a sample report
              </Link>
              , free.
            </p>
          )}
        </section>

        {/* 5. One breakdown in full; the rest in Hamilton. */}
        {band && (charters.length === 2 || tiers.length > 0) && (
          <section aria-labelledby="breakdown-heading" className="space-y-3">
            <div>
              <h2 id="breakdown-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
                Banks against credit unions
              </h2>
              {charterSentence && <p className="mt-1 text-[15px] text-ink">{charterSentence}</p>}
            </div>
            {charters.length === 2 && (
              <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 shadow-fi-1 sm:px-6">
                {interactive ? (
                  <ExplorerMarkets dots={charters} band={band} dim="charter" ariaLabel={`${plainName} median, banks and credit unions`} />
                ) : (
                  <MarketDots dots={charters} band={band} ariaLabel={`${plainName} median, banks and credit unions`} />
                )}
              </div>
            )}
            {isPro ? (
              <>
                {tiers.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[15px] font-semibold text-ink">By asset size</h3>
                    <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 sm:px-6">
                      {interactive ? (
                  <ExplorerMarkets dots={tiers} band={band} dim="tier" ariaLabel={`${plainName} median by asset size`} />
                ) : (
                  <MarketDots dots={tiers} band={band} ariaLabel={`${plainName} median by asset size`} />
                )}
                    </div>
                  </div>
                )}
                {states.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[15px] font-semibold text-ink">By state, highest median first</h3>
                    <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 sm:px-6">
                      {interactive ? (
                  <ExplorerMarkets dots={states} band={band} dim="state" ariaLabel={`${plainName} median by state`} />
                ) : (
                  <MarketDots dots={states} band={band} ariaLabel={`${plainName} median by state`} />
                )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-border bg-surface-0 p-4 sm:p-6">
                <p className="text-[16px] font-semibold text-ink">By asset size and by state, in Hamilton</p>
                <p className="mt-1 text-[14px] text-ink-muted">
                  Hamilton, the Fee Insight Pro workspace, sets this fee against institutions your size and in your state.
                </p>
                {previewTier && (
                  <div className="mt-3">
                    <MarketDots dots={[previewTier]} band={band} ariaLabel={`${plainName} median, ${previewTier.label}`} />
                    {lockedTiers.length > 0 && <LockedRows rows={lockedTiers} />}
                    {states.length > 0 && (
                      <p className="border-t border-border pt-2 text-[12px] text-ink-muted">Plus the median in each state.</p>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <TrackLink
                    event="upgrade_click"
                    eventProps={{ placement: "fee_category_breakdown" }}
                    href={PRO_PLANS_NAV.href}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-on-ink hover:opacity-90"
                  >
                    {PRO_PLANS_NAV.label}
                  </TrackLink>
                  <TrackLink
                    event="contact_sales"
                    eventProps={{ placement: "fee_category_breakdown_demo" }}
                    href={DEMO_REQUEST_NAV.href}
                    className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                  >
                    {DEMO_REQUEST_NAV.label}
                  </TrackLink>
                </div>
              </div>
            )}
          </section>
        )}

        </FeeExplorer>

        {/* 6. Related fees, each a small range that links to its page. */}
        {related.length > 0 && (
          <section aria-labelledby="related-heading" className="space-y-3">
            <h2 id="related-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
              More {family} fees
            </h2>
            <RelatedRanges items={related} />
          </section>
        )}

        <footer className="border-t border-border pt-4 text-[12px] leading-relaxed text-ink-muted">
          {national ? `${benchmarkBasis(national, refreshedOn)}. ` : ""}Each institution counts once, read from its own
          published schedule.{" "}
          <Link href="/methodology" className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
            Methodology
          </Link>
        </footer>
      </div>

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${name} Fee - National Benchmarks`,
            description: `National ${name.toLowerCase()} fee: median ${median !== null ? money(median) : "-"}, based on ${entryCount} published fee entries from ${institutionCount} institutions.`,
            url: `${SITE_URL}/fees/${category}`,
            dateModified: refreshedOn && !Number.isNaN(Date.parse(refreshedOn)) ? new Date(refreshedOn).toISOString() : undefined,
            publisher: {
              "@type": "Organization",
              name: SITE_NAME,
              url: SITE_URL,
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
