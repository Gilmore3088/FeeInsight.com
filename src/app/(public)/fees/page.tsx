export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getDisplayName, getFeeFamily, FEE_FAMILIES, getSpotlightCategories } from "@/lib/fee-taxonomy";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { COVERAGE_LABELS, getPublicSnapshot } from "@/lib/public-stats";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { CatalogSidebar } from "./catalog-sidebar";
import { FamilySection, money } from "./family-section";
import { RangeLegend } from "@/components/public/fee-summary-list";
import {
  AmbientGlow,
  EYEBROW as EYEBROW_BRAND,
  GLASS,
  GLASS_SOFT,
  H1,
  INTERACTION,
  LEAD,
  NUM,
  TEXT_LINK,
} from "@/components/public/site-look";

// No live number in the title: counts come from the shared public snapshot in the body.
export const metadata: Metadata = {
  title: `The ${PRODUCT_NAME} — Fee benchmarks by category`,
  description:
    "Compare bank and credit union fees by category. National medians, typical ranges, and institution counts for overdraft, NSF, ATM, wire transfer, and more.",
};

const EYEBROW = "text-xs font-semibold uppercase tracking-[0.14em] text-[#5A5347]";
const SPOTLIGHT_CARD_CATEGORIES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network"];
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

  return (
    <div className={`relative isolate overflow-x-clip ${INTERACTION}`}>
    <AmbientGlow height={900} />
    <div className="mx-auto max-w-page px-6 py-12 sm:py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: PRODUCT_NAME, href: "/fees" },
        ]}
      />

      {/* ── HERO: spans the page (the /subscribe header) ── */}
      <div className="max-w-4xl">
        <p className={EYEBROW_BRAND}>Published fees · every figure sourced</p>
        <h1 className={`mt-3 ${H1}`}>{PRODUCT_NAME} — benchmarks by category</h1>
        <p className={`mt-4 ${LEAD}`}>
          Bank and credit union fee benchmarks across {summary.categoriesLabel} fee categories, from{" "}
          {summary.institutionsLabel} institutions with published fees.
        </p>
        <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-[#5A5347]" aria-label="Coverage">
          <li>
            <span className={`font-semibold text-[#1A1815] ${NUM}`}>{summary.observationsLabel}</span>{" "}
            {COVERAGE_LABELS.observations.toLowerCase()}
          </li>
          <li>
            <span className={`font-semibold text-[#1A1815] ${NUM}`}>{summary.monitoredLabel}</span>{" "}
            {COVERAGE_LABELS.monitored.toLowerCase()}
          </li>
          <li>{summary.freshnessLabel}</li>
        </ul>
        <p className="mt-1.5 text-xs text-[#5A5347]">
          Sources: published fee schedules, FDIC Call Reports, NCUA 5300 Reports, institution websites
        </p>
      </div>

      {/* ── SPOTLIGHT: four boxes of one size ── */}
      <ul className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
        {spotlightFees.map((fee) => (
          <li key={fee.fee_category}>
            <Link
              href={`/fees/${fee.fee_category}`}
              className={`group flex h-full flex-col p-5 no-underline transition-shadow duration-200 hover:shadow-[0_16px_44px_-14px_rgba(26,24,21,0.32)] sm:p-6 ${GLASS}`}
            >
              <span className={`${EYEBROW} group-hover:text-[#A93D25]`}>{getDisplayName(fee.fee_category)}</span>
              <span className={`mt-2 text-3xl font-semibold tracking-tight text-[#1A1815] sm:text-4xl ${NUM}`}>
                {money(fee.median_amount)}
              </span>
              <span className="mt-0.5 text-xs font-medium text-[#5A5347]">national median</span>
              <span className={`mt-3 border-t border-[#E8E1D6] pt-3 text-[13px] leading-snug text-[#3D3830] ${NUM}`}>
                Middle half {money(fee.p25_amount)}&ndash;{money(fee.p75_amount)}
              </span>
              <span className={`mt-0.5 text-[13px] leading-snug text-[#3D3830] ${NUM}`}>
                {fee.institution_count.toLocaleString("en-US")} institutions
              </span>
              <span className={`mt-0.5 text-[13px] leading-snug text-[#5A5347] ${NUM}`}>
                {fee.total_observations.toLocaleString("en-US")} published fee entries
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-[#5A5347]">
        Each institution counts once. The median is the middle institution&apos;s fee; the middle
        half is the range from the 25th to the 75th percentile.{" "}
        {summary.refreshedOn ? `Updated ${summary.refreshedOn}. ` : ""}
        Lowest and highest fees by category are in the tables below.
      </p>

      {/* ── FREE vs PRO, and where to go next ── */}
      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {!showAll && gatedCount > 0 ? (
          <p className={`px-5 py-3.5 text-sm text-[#3D3830] ${GLASS_SOFT}`}>
            <span className="font-semibold text-[#1A1815]">Free:</span> national benchmarks for the{" "}
            {shownCanonical} spotlight categories below.{" "}
            <span className="font-semibold text-[#1A1815]">Pro:</span> the other {gatedCount} categories, peer
            and state breakdowns, and API access on request.{" "}
            <Link href="/subscribe" className={TEXT_LINK}>
              Compare plans
            </Link>
          </p>
        ) : (
          <span />
        )}
        <nav aria-label="Related pages" className="flex flex-wrap items-center gap-2">
          {ACTION_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center rounded-full bg-white/70 px-4 text-sm font-medium text-[#3D3830] ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:text-[#A93D25] hover:ring-[#C44B2E]/40 no-underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* ── MAIN + SIDEBAR ── */}
      <div className="mt-12 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-10">
        <div className="min-w-0 space-y-12">
          {/* Wide screens: one key for every table's strip. Narrow lists carry their own. */}
          <div className="hidden md:block">
            <RangeLegend />
          </div>
          {familyOrder.map((familyName) => {
            const cats = byFamily.get(familyName);
            if (!cats || cats.length === 0) return null;
            return <FamilySection key={familyName} familyName={familyName} cats={cats} />;
          })}
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
    </div>
    </div>
  );
}
