export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getCpiContext } from "@/lib/data-store";
import { getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { getDisplayName, FEE_FAMILIES, FAMILY_COLORS, getFeaturedCategories } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { CPI_BANK_SERVICES_SERIES } from "@/lib/regulatory/fed";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { NATIONAL_INDEX_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { datasetDescription, nationalFindings, subheadLead } from "./findings";

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
// Phones get tighter cells; sm and up keep the full padding.
const CELL = "px-3 py-2.5 sm:px-4";
const TH = "px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted sm:px-4";
/** Counts use tabular digits in the body face; Geist Mono (the .tabular-nums class) is for fee figures. */
const COUNT = "[font-variant-numeric:tabular-nums]";
const money = (value: number | null) => formatFeeAmount(value) ?? "-";

export default async function NationalFeeIndexPage() {
  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);
  // Same snapshot as the fee index and research hub, so the medians match to the cent.
  const [allIndex, cpi, summary] = await Promise.all([
    getPublicNationalIndex(),
    getCpiContext(),
    getPublicStatsSummary(),
  ]);

  // Pro: full index. Free: the headline categories, the same set the free report shows.
  const headlineCats = new Set(getFeaturedCategories());
  const index = isPro ? allIndex : allIndex.filter((e) => headlineCats.has(e.fee_category));
  const findings = nationalFindings(allIndex, cpi);

  const byFamily = new Map<string, typeof index>();
  for (const entry of index) {
    const family = entry.fee_family ?? "Other";
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push(entry);
  }
  const families = Object.keys(FEE_FAMILIES).filter((f) => (byFamily.get(f)?.length ?? 0) > 0);
  const columnCount = isPro ? 8 : 3;

  return (
    <div className="mx-auto max-w-page px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: NATIONAL_INDEX_NAV.label, href: NATIONAL_INDEX_NAV.href },
        ]}
      />

      <div className="max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
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
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          {subheadLead(summary.institutionsLabel)}
          {summary.refreshedOn ? (
            <>
              , updated <span className="whitespace-nowrap">{summary.refreshedOn}</span>
            </>
          ) : null}
          .
        </p>

        {findings.length > 0 && (
          <ul className="mt-6 space-y-3 border-l-2 border-brick/30 pl-4">
            {findings.map((f) => (
              <li key={f.key} className="text-[16px] leading-relaxed text-ink">
                {f.text}
                {f.key === "cpi" && (
                  <>
                    {" "}
                    <a
                      href={BLS_SERIES_URL}
                      className="whitespace-nowrap text-[13px] text-ink-muted underline underline-offset-2 hover:text-brick"
                      rel="noopener"
                    >
                      Source: BLS CPI
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={`mt-10 overflow-hidden rounded-xl border border-border/80 bg-white/70 ${isPro ? "" : "max-w-3xl"}`}>
        <div className="overflow-x-auto">
          {/* On a phone the table is two columns (fee with its institution count beneath, then
              the median), so it fits a 360px screen with no sideways scroll. */}
          <table className={`w-full text-left text-sm ${isPro ? "sm:min-w-[760px]" : ""}`}>
            <thead>
              <tr className="border-b border-border/60 bg-paper/60">
                <th scope="col" className={TH}>Fee</th>
                <th scope="col" className={`${TH} text-right`}>Median</th>
                {isPro && (
                  <>
                    <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>P25</th>
                    <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>P75</th>
                    <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>Range</th>
                    <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>Banks</th>
                    <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>CUs</th>
                  </>
                )}
                <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>Institutions</th>
              </tr>
            </thead>
            {families.map((familyName) => {
              const colors = FAMILY_COLORS[familyName];
              return (
                <tbody key={familyName} className="divide-y divide-border/50 border-b border-border/60 last:border-b-0">
                  <tr>
                    <th
                      scope="rowgroup"
                      colSpan={columnCount}
                      className={`${CELL} pb-1.5 pt-4 text-left text-[12px] font-bold ${colors?.text ?? "text-ink-soft"}`}
                    >
                      {familyName}
                    </th>
                  </tr>
                  {byFamily.get(familyName)!.map((entry) => (
                    <tr key={entry.fee_category} className="transition-colors hover:bg-paper/60">
                      <td className={CELL}>
                        <Link
                          href={`/fees/${entry.fee_category}`}
                          className="font-medium text-ink transition-colors hover:text-brick"
                        >
                          {getDisplayName(entry.fee_category)}
                        </Link>
                        <span className={`mt-0.5 block text-[12px] text-ink-muted sm:hidden ${COUNT}`}>
                          {entry.institution_count.toLocaleString()} institutions
                        </span>
                      </td>
                      <td className={`${CELL} text-right align-top font-semibold tabular-nums text-ink sm:align-middle`}>
                        {money(entry.median_amount)}
                      </td>
                      {isPro && (
                        <>
                          <td className={`hidden ${CELL} text-right tabular-nums text-ink-muted sm:table-cell`}>
                            {money(entry.p25_amount)}
                          </td>
                          <td className={`hidden ${CELL} text-right tabular-nums text-ink-muted sm:table-cell`}>
                            {money(entry.p75_amount)}
                          </td>
                          <td className={`hidden ${CELL} text-right tabular-nums text-ink-muted sm:table-cell`}>
                            {money(entry.min_amount)} &ndash; {money(entry.max_amount)}
                          </td>
                          <td className={`hidden ${CELL} text-right text-ink-muted sm:table-cell ${COUNT}`}>
                            {entry.bank_count.toLocaleString()}
                          </td>
                          <td className={`hidden ${CELL} text-right text-ink-muted sm:table-cell ${COUNT}`}>
                            {entry.cu_count.toLocaleString()}
                          </td>
                        </>
                      )}
                      <td className={`hidden ${CELL} text-right text-ink-muted sm:table-cell ${COUNT}`}>
                        {entry.institution_count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
      <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
        Each institution counts once, and the median is taken across institutions.{" "}
        <Link href="/methodology" className="text-ink-soft underline underline-offset-2 hover:text-brick">
          How the index is built
        </Link>
      </p>

      {!isPro && (
        <p className="mt-6 max-w-3xl text-[14px] leading-relaxed text-ink-soft">
          With a Pro plan this table shows every fee category, with its typical range and its bank and
          credit union counts.{" "}
          <Link href={PRO_PLANS_NAV.href} className="whitespace-nowrap font-semibold text-brick hover:underline">
            {PRO_PLANS_NAV.label} &rarr;
          </Link>
        </p>
      )}

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
