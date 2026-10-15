export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getDisplayName, getFeeFamily, FEE_FAMILIES, getSpotlightCategories } from "@/lib/fee-taxonomy";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PRODUCT_NAME, REPORT_OFFER, REPORT_PRICE_INLINE, SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { COVERAGE_LABELS, getPublicSnapshot } from "@/lib/public-stats";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { CatalogSidebar } from "../catalog-sidebar";
import { FamilySection } from "../family-section";
import { UnstatedAudienceFootnote, hasUnstatedAudience } from "@/components/unstated-audience";
import { getFeeCategoryDetailCached } from "@/lib/data-store/public-cached-reads";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { DistributionChart, buildHistogram } from "@/components/public/distribution-chart";
import { StateVideo } from "../../research/state/[code]/state-exhibits";
import { FeeIndexExplorer, type ExplorerFee } from "./fee-index-explorer";

// No live number in the title: counts come from the shared public snapshot in the body.
export const metadata: Metadata = {
  title: `The ${PRODUCT_NAME}: fee benchmarks by category`,
  description:
    "Compare bank and credit union fees by category. National medians, typical ranges, and institution counts for overdraft, NSF, ATM, wire transfer, and more.",
};

const SPOTLIGHT_CARD_CATEGORIES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network"];
/** Short tab names for the hero explorer, so all four fit on a phone. */
const EXPLORER_LABELS: Record<string, string> = {
  overdraft: "Overdraft",
  nsf: "NSF",
  monthly_maintenance: "Monthly fee",
  atm_non_network: "Out-of-network ATM",
};
const CANONICAL_CATEGORIES = new Set(Object.values(FEE_FAMILIES).flat());

const ACTION_LINKS = [
  { label: "National benchmarks", href: "/research/national-fee-index" },
  { label: "State & district reports", href: "/research" },
  { label: "Consumer guides", href: "/guides" },
  { label: "API", href: "/api-docs" },
];

export default async function FeeCatalogPage() {
  const user = await getCurrentUser();
  const showAll = canAccessAllCategories(user);
  const spotlightCats = new Set(getSpotlightCategories());

  // Counts and benchmarks from one snapshot: the same figures as the homepage and research hub.
  const { summary, categories: allSummaries } = await getPublicSnapshot();
  const summaries = showAll
    ? allSummaries
    : allSummaries.filter((s) => spotlightCats.has(s.fee_category));

  // Gated count uses the same canonical-category basis as the public headline number.
  const shownCanonical = summaries.filter((s) => CANONICAL_CATEGORIES.has(s.fee_category)).length;
  const gatedCount = Math.max(summary.categories - shownCanonical, 0);

  const byFamily = new Map<string, typeof summaries>();
  for (const s of summaries) {
    const family = getFeeFamily(s.fee_category) ?? "Other";
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push(s);
  }
  const familyOrder = Object.keys(FEE_FAMILIES);

  const spotlightFees = SPOTLIGHT_CARD_CATEGORIES
    .map((c) => summaries.find((s) => s.fee_category === c))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  // One value per institution for each headline fee: the same population as its median.
  // The charts are drawn here, on the server, so the browser gets bars, not every institution's value.
  const withMedian = spotlightFees.filter((f): f is typeof f & { median_amount: number } => f.median_amount !== null);
  const [details, sampleLive] = await Promise.all([
    Promise.all(withMedian.map((f) => getFeeCategoryDetailCached(f.fee_category).catch(() => null))),
    sampleReportAvailable().catch(() => false),
  ]);
  const explorerFees: ExplorerFee[] = withMedian.map((f, i) => ({
    key: f.fee_category,
    label: EXPLORER_LABELS[f.fee_category] ?? getDisplayName(f.fee_category),
    median: f.median_amount,
    p25: f.p25_amount,
    p75: f.p75_amount,
    institutions: f.institution_count,
    zeroCount: f.zero_count ?? 0,
    chart: <DistributionChart values={details[i]?.institution_values ?? []} median={f.median_amount} bucketCount={16} />,
    unstated: hasUnstatedAudience(f),
  }));
  const videoFee = withMedian[0];
  const videoBars = buildHistogram(details[0]?.institution_values ?? []).map((b) => b.count);
  const reportLink = sampleLive
    ? { href: "/reports/sample-competitive-fee-position", label: `See the sample ${REPORT_OFFER.name}` }
    : { href: "/reports?report=institution&src=fee-index#request", label: REPORT_OFFER.institutionCtaLabel };

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: PRODUCT_NAME, href: "/fees" },
        ]}
      />

      {/* 1. The answer first: the national spread of the fees people ask about most. */}
      <section className="border-b border-border bg-paper">
        <div className="mx-auto grid max-w-page gap-8 px-4 pb-10 pt-6 sm:px-6 sm:pb-14 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-12 lg:gap-y-6">
          <div className="lg:pt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brick">{PRODUCT_NAME}</p>
            <h1 className="mt-3 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">
              What U.S. banks charge, fee by fee
            </h1>
            <p className="mt-3 max-w-[34rem] text-[16px] text-ink-soft">
              {summary.categoriesLabel} fee categories from {summary.institutionsLabel} banks and credit unions&rsquo; own published
              schedules.
            </p>
            <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
              <span>
                <span className="font-medium tabular-nums text-ink-soft">{summary.observationsLabel}</span>{" "}
                {COVERAGE_LABELS.observations.toLowerCase()}
              </span>
              <span>
                <span className="font-medium tabular-nums text-ink-soft">{summary.monitoredLabel}</span>{" "}
                {COVERAGE_LABELS.monitored.toLowerCase()}
              </span>
              <span>{summary.freshnessLabel}</span>
              <Link href="/methodology" className="underline decoration-border underline-offset-2 hover:text-ink">
                How we build it
              </Link>
            </p>
          </div>
          <div className="lg:row-span-2">
            <FeeIndexExplorer fees={explorerFees} />
          </div>
          <div className="lg:col-start-1 lg:row-start-2">
            <nav aria-label="More fee data" className="flex flex-wrap gap-2">
              {ACTION_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface-0 px-4 text-[13px] font-medium text-ink-soft hover:border-ink/30 hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-page px-4 pt-10 sm:px-6 sm:pt-12">
      {!showAll && gatedCount > 0 && (
        <p className="rounded-lg border border-border bg-paper px-4 py-2.5 text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">Free:</span> national benchmarks for the{" "}
          {shownCanonical} categories below.{" "}
          <span className="font-semibold text-ink">Pro:</span> the other {gatedCount} categories, peer
          and state breakdowns, and API access on request.{" "}
          <Link href="/subscribe" className="font-medium text-brick hover:underline">
            Compare plans
          </Link>
        </p>
      )}

      {/* ── MAIN + SIDEBAR ── */}
      <div className="mt-10 grid grid-cols-1 gap-8 xl:grid-cols-[1fr_280px]">
        <div className="space-y-10">
          {familyOrder.map((familyName) => {
            const cats = byFamily.get(familyName);
            if (!cats || cats.length === 0) return null;
            return <FamilySection key={familyName} familyName={familyName} cats={cats} footnote={false} />;
          })}
          <div>
            <p className="text-[12px] text-ink-muted">
              Each institution counts once, and the median and typical range (25th to 75th
              percentile) are taken across institutions.
              {summary.refreshedOn ? ` Updated ${summary.refreshedOn}.` : ""}
            </p>
            <UnstatedAudienceFootnote
              show={[...byFamily.values()].flat().some((fee) => fee.median_amount !== null && hasUnstatedAudience(fee))}
              className="mt-1"
            />
          </div>
        </div>
        <CatalogSidebar
          familyOrder={familyOrder}
          byFamily={byFamily}
          spotlightFees={spotlightFees}
          statesLabel={summary.statesLabel}
        />
      </div>

      {!showAll && gatedCount > 0 && (
        <div className="mt-8">
          <UpgradeGate count={gatedCount} />
        </div>
      )}
      </div>

      {videoFee && <StateVideo stateName={`${getDisplayName(videoFee.fee_category).replace(/\s*\(.*\)$/, "").toLowerCase()} fees`} bars={videoBars} />}

      {/* Staff of a bank or credit union: Hamilton puts their own fees on every one of these lines. */}
      <section aria-labelledby="hamilton-heading" className="mx-auto max-w-page px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-0 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            <h2 id="hamilton-heading" className="text-[18px] font-semibold tracking-[-0.02em] text-ink">
              Work at a bank or credit union?
            </h2>
            <p className="mt-1 max-w-[36rem] text-[14px] text-ink-muted">
              See your own fees on these lines, beside your local competitors: the {REPORT_OFFER.name}, {REPORT_PRICE_INLINE}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "fee_index_staff_band" }}
              href={reportLink.href}
              className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
            >
              {reportLink.label}
            </TrackLink>
            <Link href={DEMO_REQUEST_NAV.href} className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
              {DEMO_REQUEST_NAV.label}
            </Link>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `${PRODUCT_NAME} - Complete Fee Catalog`,
            description: "National benchmarking data across bank and credit union fee categories.",
            url: `${SITE_URL}/fees`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
