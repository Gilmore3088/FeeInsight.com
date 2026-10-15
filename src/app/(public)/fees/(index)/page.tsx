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
import { CatalogSidebar } from "../catalog-sidebar";
import { FamilySection, money } from "../family-section";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, hasUnstatedAudience } from "@/components/unstated-audience";

// No live number in the title: counts come from the shared public snapshot in the body.
export const metadata: Metadata = {
  title: `The ${PRODUCT_NAME} — Fee benchmarks by category`,
  description:
    "Compare bank and credit union fees by category. National medians, typical ranges, and institution counts for overdraft, NSF, ATM, wire transfer, and more.",
};

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted";
const SERIF = { fontFamily: "var(--fi-font-sans)" };
const MONO_FIGURE = { fontFamily: "var(--fi-font-mono)" } as const;
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
    <div className="mx-auto max-w-page px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: PRODUCT_NAME, href: "/fees" },
        ]}
      />

      {/* ── HERO ── */}
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 mb-4">
          <span className="h-px w-8 bg-brick/40" />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brick">
            Published fees · every figure sourced
          </span>
        </div>

        <h1
          className="font-extrabold text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-ink"
          style={SERIF}
        >
          {PRODUCT_NAME} — benchmarks by category
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          Bank and credit union fee benchmarks across {summary.categoriesLabel} fee categories, from{" "}
          {summary.institutionsLabel} institutions with published fees.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
          <span>
            <span className="font-medium text-ink-soft tabular-nums">{summary.observationsLabel}</span>{" "}
            {COVERAGE_LABELS.observations.toLowerCase()}
          </span>
          <span className="h-3 w-px bg-border" />
          <span>
            <span className="font-medium text-ink-soft tabular-nums">{summary.monitoredLabel}</span>{" "}
            {COVERAGE_LABELS.monitored.toLowerCase()}
          </span>
          <span className="h-3 w-px bg-border" />
          <span>{summary.freshnessLabel}</span>
        </div>

        <div className="mt-1.5 text-[11px] text-ink-muted">
          Sources: published fee schedules, FDIC Call Reports, NCUA 5300 Reports, institution websites
        </div>
      </div>

      {/* ── SPOTLIGHT STAT CARDS ── */}
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {spotlightFees.map((fee) => (
          <Link
            key={fee.fee_category}
            href={`/fees/${fee.fee_category}`}
            className="group relative rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-5 py-4 transition-all duration-400 hover:border-brick/20 hover:shadow-md hover:shadow-[#b23a32]/5 no-underline overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-brick/0 to-transparent group-hover:via-brick/30 transition-all duration-700" />
            <p className={`${EYEBROW} group-hover:text-brick transition-colors`}>
              {getDisplayName(fee.fee_category)}
            </p>
            <p className="mt-2 text-[28px] font-semibold tracking-tight text-ink tabular-nums" style={MONO_FIGURE}>
              {money(fee.median_amount)}
              <UnstatedAudienceMark show={fee.median_amount !== null && hasUnstatedAudience(fee)} />
            </p>
            <p className="mt-1 text-[11px] tabular-nums text-ink-muted">
              Typical {money(fee.p25_amount)} &ndash; {money(fee.p75_amount)}
              <span className="mx-1.5 text-border">&middot;</span>
              {fee.institution_count.toLocaleString()} inst.
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-ink-muted">
              {fee.total_observations.toLocaleString()} published fee entries
            </p>
          </Link>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        Each institution counts once, and the median and typical range (25th to 75th
        percentile) are taken across institutions.{" "}
        {summary.refreshedOn ? `Updated ${summary.refreshedOn}. ` : ""}
        Full min–max by category is in the tables below.
      </p>
      <UnstatedAudienceFootnote show={spotlightFees.some((fee) => fee.median_amount !== null && hasUnstatedAudience(fee))} className="mt-1" />
      {!showAll && gatedCount > 0 && (
        <p className="mt-3 rounded-lg border border-border bg-paper px-4 py-2.5 text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">Free:</span> national benchmarks for the{" "}
          {shownCanonical} spotlight categories below.{" "}
          <span className="font-semibold text-ink">Pro:</span> the other {gatedCount} categories, peer
          and state breakdowns, and API access on request.{" "}
          <Link href="/subscribe" className="font-medium text-brick hover:underline">
            Compare plans
          </Link>
        </p>
      )}

      {/* ── ACTION BAR ── */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {ACTION_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-full border border-border bg-white/80 px-4 py-1.5 text-[12px] font-medium text-ink-soft transition-all hover:border-brick/30 hover:text-brick no-underline"
          >
            {item.label}
          </Link>
        ))}
      </div>

      {/* ── MAIN + SIDEBAR ── */}
      <div className="mt-10 grid grid-cols-1 gap-8 xl:grid-cols-[1fr_280px]">
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
