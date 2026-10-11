export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getDisplayName, getFeeFamily, FEE_FAMILIES, getSpotlightCategories } from "@/lib/fee-taxonomy";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { getPublicSnapshot } from "@/lib/public-stats";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { CatalogSidebar } from "./catalog-sidebar";
import { FamilySection, money } from "./family-section";
import { AmbientGlow, GLASS, H1, INTERACTION, LEAD, NUM } from "@/components/public/site-look";

// No live number in the title: counts come from the shared public snapshot in the body.
export const metadata: Metadata = {
  title: `The ${PRODUCT_NAME} — Fee benchmarks by category`,
  description:
    "Compare bank and credit union fees by category. National medians, typical ranges, and institution counts for overdraft, NSF, ATM, wire transfer, and more.",
};

const EYEBROW = "text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]";
const SPOTLIGHT_CARD_CATEGORIES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network"];
const CANONICAL_CATEGORIES = new Set(Object.values(FEE_FAMILIES).flat());


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
      <AmbientGlow height={1000} />
      <div className="mx-auto max-w-page px-4 py-12 sm:px-6 sm:py-16">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: PRODUCT_NAME, href: "/fees" },
        ]}
      />

      {/* ── HERO ── */}
      <div className="max-w-3xl">
        <p className={EYEBROW}>National fee benchmarks</p>
        <h1 className={`mt-3 ${H1}`}>{PRODUCT_NAME}</h1>
        <p className={`mt-4 ${LEAD}`}>
          Compare published bank and credit union fees by category. Every figure comes from an institution&apos;s own fee schedule.
        </p>
      </div>

      {/* ── SPOTLIGHT STAT CARDS ── */}
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {spotlightFees.map((fee) => (
          <Link
            key={fee.fee_category}
            href={`/fees/${fee.fee_category}`}
            className={`group relative overflow-hidden px-5 py-5 no-underline sm:px-6 ${GLASS}`}
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/0 to-transparent group-hover:via-[#C44B2E]/30 transition-all duration-700" />
            <p className={`${EYEBROW} group-hover:text-[#A93D25] transition-colors`}>
              {getDisplayName(fee.fee_category)}
            </p>
            <p className={`mt-2 text-3xl font-semibold tracking-tight text-[#1A1815] ${NUM}`}>
              {money(fee.median_amount)}
            </p>
            <p className={`mt-1 text-xs text-[#5A5347] ${NUM}`}>
              Typical {money(fee.p25_amount)} &ndash; {money(fee.p75_amount)}
              <span className="mx-1.5 text-[#D4C9BA]">&middot;</span>
              {fee.institution_count.toLocaleString()} inst.
            </p>
          </Link>
        ))}
      </div>

      {/* ── MAIN + SIDEBAR ── */}
      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-[1fr_280px]">
        <div className="space-y-10">
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
  );
}
