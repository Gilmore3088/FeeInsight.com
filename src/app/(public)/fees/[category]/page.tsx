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
import { FDIC_TIER_LABELS } from "@/lib/fed-districts";
import { formatFeeAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DistributionChart } from "@/components/public/distribution-chart";
import { STATE_NAMES } from "@/lib/us-states";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { getFeeCategoryDetailCached, getNationalRateStatsCached } from "@/lib/data-store/public-cached-reads";
import { formatRatePercent, percentFeeAllowed } from "@/lib/percent-fees";
import { benchmarkBasis, getPublicSnapshot } from "@/lib/public-stats";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { BreakdownRow, BREAKDOWN_HEADERS, DistrictSection, WarmTable, range } from "./breakdown-tables";
import { AmbientGlow, GLASS, GLASS_SOFT, H1, INTERACTION, LEAD, NUM, TEXT_LINK } from "@/components/public/site-look";

interface PageProps {
  params: Promise<{ category: string }>;
}

const EYEBROW = "text-xs font-semibold uppercase tracking-[0.14em] text-[#5A5347]";
/** Headings and figures in the page font (Plus Jakarta Sans), semibold, as on /subscribe. */
const SERIF = { fontWeight: 600, letterSpacing: "-0.015em" };

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
    description: `National benchmarking data for ${name.toLowerCase()} fees. See median, P25/P75, distribution, and breakdowns by bank vs. credit union, asset tier, Fed district, and state.`,
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
  const family = getFeeFamily(category);
  const familyColor = family ? getFamilyColor(family) : null;
  const [detail, snapshot, rateStats] = await Promise.all([
    getFeeCategoryDetailCached(category),
    getPublicSnapshot(),
    // Fees this category may state as a rate ("1% of the transaction") get their own
    // statistics; a rate is never pooled with the dollar figures above it.
    percentFeeAllowed(category) ? getNationalRateStatsCached(category).catch(() => null) : Promise.resolve(null),
  ]);
  const showRates = rateStats != null && rateStats.maturity_tier !== "insufficient" && rateStats.median_rate != null;

  // Close the loop the other way: a reader on a fee page can reach the guide that
  // explains it. Consumer guides are public, so this link is never a dead end.
  const consumerGuides = await loadGuidesForCategory(category, "consumer");

  // Headline figures come from the shared public snapshot, so this page states the same
  // median, institution count and entry count as the fee index, research hub and homepage.
  // The chart uses the same population: one value per institution.
  const national = snapshot.categories.find((c) => c.fee_category === category) ?? null;
  const refreshedOn = snapshot.summary.refreshedOn;
  const institutionValues = detail.institution_values ?? [];
  const institutionCount = national?.institution_count ?? 0;
  const entryCount = national?.total_observations ?? 0;
  const stats = {
    median: national?.median_amount ?? null,
    p25: national?.p25_amount ?? null,
    p75: national?.p75_amount ?? null,
    min: national?.min_amount ?? null,
    max: national?.max_amount ?? null,
  };

  const hasDistricts = detail.by_fed_district.length > 0;

  const familyMembers = family
    ? (FEE_FAMILIES[family] ?? []).filter((c) => c !== category)
    : [];

  return (
    <div className={`relative isolate overflow-x-clip ${INTERACTION}`}>
    <AmbientGlow height={800} />
    <div className="mx-auto max-w-page px-6 py-12 sm:py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Fee Index", href: "/fees" },
          { name: name, href: `/fees/${category}` },
        ]}
      />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-[13px] text-[#5A5347]">
        <Link href="/" className="hover:text-[#1A1815] transition-colors">
          Home
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <Link href="/fees" className="hover:text-[#1A1815] transition-colors">
          Fee Index
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <span className="text-[#5A5347]">{name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-2">
        {family && familyColor && (
          <span
            className="rounded-full bg-[#C44B2E]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]"
          >
            {family}
          </span>
        )}
      </div>

      <h1
        className={`mt-3 ${H1}`}
      >
        {name} Fee
      </h1>
      <p className={`mt-4 ${LEAD}`}>
        {national ? benchmarkBasis(national, refreshedOn) : "Not enough published fees yet for a national benchmark."}
      </p>
      <p className="mt-2 text-sm text-[#5A5347]">
        Each institution counts once. The median and percentiles are taken across institutions, from
        published fee schedules.{" "}
        <Link href="/methodology" className={TEXT_LINK}>
          Methodology
        </Link>
      </p>

      {/* Stat cards: four boxes of one size, the /subscribe glass */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-5">
        {[
          { label: "Median", value: money(stats.median) },
          { label: "25th percentile", value: money(stats.p25) },
          { label: "75th percentile", value: money(stats.p75) },
          { label: "Lowest \u2013 highest", value: range(stats.min, stats.max) },
        ].map((s) => (
          <div
            key={s.label}
            className={`px-5 py-4 sm:px-6 sm:py-5 ${GLASS}`}
          >
            <p className={EYEBROW}>
              {s.label}
            </p>
            <p
              className={`mt-1.5 text-2xl font-semibold tracking-tight text-[#1A1815] sm:text-3xl ${NUM}`}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {showRates && rateStats && (
        <section className={`mt-6 px-5 py-5 sm:px-6 ${GLASS_SOFT}`}>
          <h2 className="text-[16px] font-medium text-[#1A1815]" style={SERIF}>
            When stated as a rate
          </h2>
          <p className="mt-1 text-[13px] text-[#5A5347]">
            {rateStats.institution_count.toLocaleString("en-US")} institutions state this fee as a percentage
            rather than a dollar amount. Those rates are summarized here on their own, never mixed into the
            dollar figures above.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: "Median rate", value: formatRatePercent(rateStats.median_rate) },
              {
                label: "Middle half",
                value: `${formatRatePercent(rateStats.p25_rate)} \u2013 ${formatRatePercent(rateStats.p75_rate)}`,
              },
              {
                label: "Range",
                value: `${formatRatePercent(rateStats.min_rate)} \u2013 ${formatRatePercent(rateStats.max_rate)}`,
              },
            ].map((s) => (
              <div key={s.label}>
                <p className={EYEBROW}>{s.label}</p>
                <p className={`mt-1 text-xl font-semibold tracking-tight text-[#1A1815] ${NUM}`}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Distribution, the guide and the reader's own bank sit in the left column on wide
          screens with the district table beside them; narrow screens keep this order. */}
      <div
        className={`mt-10 grid grid-cols-1 gap-x-8 gap-y-6 ${
          hasDistricts ? "xl:grid-cols-2 xl:grid-rows-[auto_auto_1fr]" : ""
        }`}
      >
        {/* Distribution */}
        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815]" style={SERIF}>
            Fee Distribution
          </h2>
          <div className="mt-3 rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm p-5">
            <DistributionChart values={institutionValues} median={stats.median} />
          </div>
        </section>

        {/* Fed district */}
        {hasDistricts && (
          <DistrictSection
            name={name}
            rows={detail.by_fed_district}
            className="xl:col-start-2 xl:row-span-3 xl:row-start-1"
          />
        )}

        {/* Guide to this fee — free for everyone */}
        {consumerGuides.length > 0 && (
          <section className="rounded-xl border border-[#E8DFD1] bg-white/70 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#A93D25]">
              New to this fee?
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="text-[14px] text-[#5A5347]">
                Read the plain-language guide to {name.toLowerCase()} — what it is, who
                charges the most, and how to avoid it. Free to read.
              </p>
              {consumerGuides.slice(0, 2).map((guide) => (
                <Link
                  key={guide.slug}
                  href={`/guides/${guide.slug}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#E8DFD1] bg-[#FAF7F2] px-4 py-1.5 text-[12px] font-medium text-[#5A5347] no-underline transition-colors hover:border-[#C44B2E]/30 hover:text-[#A93D25]"
                >
                  {guide.title}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* The reader's own bank — the question every fee page is really being asked */}
        <section className="flex flex-wrap items-center justify-between gap-3 self-start rounded-xl border border-[#C44B2E]/15 bg-gradient-to-r from-[#FFFDF9] to-[#FAF7F2] px-5 py-4">
          <p className="text-[14px] text-[#5A5347]">
            See what <span className="font-medium text-[#1A1815]">your</span> bank charges for{" "}
            {name.replace(/\s*\([^)]*\)/g, "").toLowerCase()}, next to the national median.
          </p>
          <Link
            href={`/institutions?fee=${category}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#C44B2E] px-4 py-2 text-[12px] font-semibold text-white no-underline transition-colors hover:bg-[#A83D25]"
          >
            Find your institution
          </Link>
        </section>
      </div>

      {/* Related fees */}
      {familyMembers.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-[#1A1815]">
              Related fees in {family}
            </h2>
            <span className="h-px flex-1 bg-[#E8E1D6]" />
          </div>
          <div className="flex flex-wrap gap-2">
            {familyMembers.map((cat) => (
              <Link
                key={cat}
                href={`/fees/${cat}`}
                className="inline-flex min-h-11 items-center rounded-full bg-white/70 px-4 text-sm font-medium text-[#3D3830] ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:text-[#A93D25] hover:ring-[#C44B2E]/40 no-underline"
              >
                {getDisplayName(cat)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Methodology */}
      <section className={`mt-12 p-6 sm:p-7 ${GLASS_SOFT}`}>
        <h2 className={EYEBROW}>
          Methodology
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-[#3D3830]">
          Based on {entryCount.toLocaleString()} published fee entries from{" "}
          {institutionCount.toLocaleString()} US banks and credit unions, read from their published
          fee schedules. Fees the software is not sure about are held for a person to check and are
          not counted here. Institutions are identified via FDIC and NCUA regulatory databases.
        </p>
      </section>

      {/* Professional breakdowns: below everything that is free, so nothing free sits behind
          the gate. */}
      {/* Bank vs. Credit Union */}
      {isPro && detail.by_charter_type.length > 0 && (
        <section className="mt-10">
          <h2
            className="text-[16px] font-medium text-[#1A1815]"
            style={SERIF}
          >
            Bank vs. Credit Union
          </h2>
          <WarmTable label={`${name} fee, banks and credit unions`} headers={["Type", ...BREAKDOWN_HEADERS]}>
            {detail.by_charter_type.map((row) => (
              <BreakdownRow key={row.dimension_value} name={row.dimension_value} row={row} />
            ))}
          </WarmTable>
        </section>
      )}

      {/* Asset tier */}
      {isPro && detail.by_asset_tier.length > 0 && (
        <section className="mt-10">
          <h2
            className="text-[16px] font-medium text-[#1A1815]"
            style={SERIF}
          >
            By Asset Tier
          </h2>
          <WarmTable label={`${name} fee by asset tier`} headers={["Tier", ...BREAKDOWN_HEADERS]}>
            {detail.by_asset_tier.map((row) => (
              <BreakdownRow
                key={row.dimension_value}
                name={FDIC_TIER_LABELS[row.dimension_value] ?? row.dimension_value}
                row={row}
              />
            ))}
          </WarmTable>
        </section>
      )}

      {/* State breakdown */}
      {isPro && detail.by_state.length > 0 && (
        <section className="mt-10">
          <h2
            className="text-[16px] font-medium text-[#1A1815]"
            style={SERIF}
          >
            By State
            <span className="ml-2 text-[12px] font-normal text-[#6B6255]">
              The {detail.by_state.length} states with the most institutions
            </span>
          </h2>
          <WarmTable label={`${name} fee by state`} headers={["State", ...BREAKDOWN_HEADERS]}>
            {detail.by_state.map((row) => (
              <BreakdownRow
                key={row.dimension_value}
                name={STATE_NAMES[row.dimension_value] ?? row.dimension_value}
                sub={row.dimension_value}
                row={row}
              />
            ))}
          </WarmTable>
        </section>
      )}

      {!isPro && (
        <div className="mt-10">
          <UpgradeGate
            audience="consumer"
            message={`${name} by charter, asset size and state`}
          />
        </div>
      )}

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${name} Fee - National Benchmarks`,
            description: `National ${name.toLowerCase()} fee: median ${money(stats.median)}, based on ${entryCount} published fee entries from ${institutionCount} institutions.`,
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
    </div>
  );
}
