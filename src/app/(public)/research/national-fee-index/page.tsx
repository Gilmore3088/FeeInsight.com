export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getCpiContext } from "@/lib/data-store";
import { getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { getDisplayName, FEE_FAMILIES, getFeaturedCategories } from "@/lib/fee-taxonomy";
import { getFeeCategoryDetailCached } from "@/lib/data-store/public-cached-reads";
import { CPI_BANK_SERVICES_SERIES } from "@/lib/regulatory/fed";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { NATIONAL_INDEX_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { datasetDescription, districtMedians, nationalFindings, subheadLead } from "./findings";
import { NationalExplorer } from "./national-explorer";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME}, national: median bank and credit union fees`,
  description:
    "Median bank and credit union fees by category, with institution counts, from the published fee schedules of thousands of U.S. banks and credit unions.",
  keywords: [
    "bank fee index",
    "national fee index",
    "bank fee benchmarks",
    "average bank fees",
    "overdraft fee average",
    "NSF fee average",
    "credit union fees",
  ],
};

const BLS_SERIES_URL = `https://data.bls.gov/timeseries/${CPI_BANK_SERVICES_SERIES}`;

export default async function NationalFeeIndexPage() {
  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);
  // Same snapshot as the fee index and research hub, so the medians match to the cent. The
  // overdraft district medians are the cached read /fees/overdraft and the homepage already
  // make; the panel compares them with the snapshot's national median, the one figure it
  // shows. A failed read only hides the map.
  const [allIndex, cpi, summary, overdraftDetail] = await Promise.all([
    getPublicNationalIndex(),
    getCpiContext(),
    getPublicStatsSummary(),
    getFeeCategoryDetailCached("overdraft").catch((error: unknown) => {
      console.error("[national-index] overdraft district read failed; district map hidden", error);
      return null;
    }),
  ]);

  // Pro: full index. Free: the headline categories, the same set the free report shows.
  const headlineCats = new Set(getFeaturedCategories());
  const index = isPro ? allIndex : allIndex.filter((e) => headlineCats.has(e.fee_category));
  const byFamily = new Map<string, typeof index>();
  for (const entry of index) {
    const family = entry.fee_family ?? "Other";
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push(entry);
  }
  const groups = Object.keys(FEE_FAMILIES)
    .filter((f) => (byFamily.get(f)?.length ?? 0) > 0)
    .map((family) => ({
      family,
      // Only the fields the table and panel draw; bank and credit union counts go to Pro only.
      entries: byFamily.get(family)!.map((e) => ({
        fee_category: e.fee_category,
        fee_family: e.fee_family,
        median_amount: e.median_amount,
        p25_amount: e.p25_amount,
        p75_amount: e.p75_amount,
        min_amount: e.min_amount,
        max_amount: e.max_amount,
        institution_count: e.institution_count,
        ...(isPro ? { bank_count: e.bank_count, cu_count: e.cu_count } : {}),
      })),
    }));
  // The "most published" bars draw only fees this reader's table holds, so every bar selects one.
  const tableCategories = new Set(groups.flatMap((g) => g.entries.map((e) => e.fee_category)));
  const findings = nationalFindings(allIndex, cpi, tableCategories);

  const header = (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="h-px w-8 bg-brick/40" />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brick">
          The {PRODUCT_NAME} &middot; National
        </span>
      </div>
      <h1
        className="text-[1.75rem] font-extrabold leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.25rem]"
        style={{ fontFamily: "var(--fi-font-sans)" }}
      >
        What U.S. banks and credit unions charge
      </h1>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-soft">
        {subheadLead(summary.institutionsLabel)}
        {summary.refreshedOn ? (
          <>
            , updated <span className="whitespace-nowrap">{summary.refreshedOn}</span>
          </>
        ) : null}
        .
      </p>
    </div>
  );

  const footer = (
    <div className="space-y-3 text-[13px] leading-relaxed text-ink-muted">
      <p>
        Each institution counts once, and the median is taken across institutions.{" "}
        <Link href="/methodology" className="text-ink-soft underline underline-offset-2 hover:text-brick">
          How the index is built
        </Link>
      </p>
      {!isPro && (
        <p className="text-[14px] text-ink-soft">
          With a Pro plan this table shows every fee category, with its bank and credit union counts.{" "}
          <Link href={PRO_PLANS_NAV.href} className="whitespace-nowrap font-semibold text-brick hover:underline">
            {PRO_PLANS_NAV.label} &rarr;
          </Link>
        </p>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-page px-4 py-8 sm:px-6 sm:py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: NATIONAL_INDEX_NAV.label, href: NATIONAL_INDEX_NAV.href },
        ]}
      />

      <NationalExplorer
        header={header}
        footer={footer}
        findings={findings}
        groups={groups}
        isPro={isPro}
        overdraftDistricts={districtMedians(overdraftDetail?.by_fed_district)}
        cpiSourceUrl={BLS_SERIES_URL}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `${PRODUCT_NAME}, national: U.S. bank and credit union fees`,
            description: datasetDescription(summary.categoriesLabel),
            url: `${SITE_URL}${NATIONAL_INDEX_NAV.href}`,
            creator: { "@type": "Organization", name: SITE_NAME },
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
            // #1166 T11: the terms page states how the data may be used; there is no open license.
            license: `${SITE_URL}/terms`,
            dateModified:
              summary.refreshedOn && !Number.isNaN(Date.parse(summary.refreshedOn))
                ? new Date(summary.refreshedOn).toISOString()
                : undefined,
            variableMeasured: allIndex.map((entry) => getDisplayName(entry.fee_category)),
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
