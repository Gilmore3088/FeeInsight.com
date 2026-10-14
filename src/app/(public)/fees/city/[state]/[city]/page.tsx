export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicNationalIndex } from "@/lib/public-stats";
import { getDisplayName, isFeaturedFee } from "@/lib/fee-taxonomy";
import { formatAmount, formatAssets } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";
import { ProNextStep } from "@/components/public/pro-next-step";
import { getCityFeeAveragesCached } from "@/lib/data-store/public-cached-reads";
import { loadCityInstitutions, titleCase } from "./city-lookup";

interface PageProps {
  params: Promise<{ state: string; city: string }>;
}

/** Cities with fewer verified institutions than this are thin pages: rendered, not indexed. */
const MIN_INDEXABLE_INSTITUTIONS = 3;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state, city } = await params;
  const stateName = STATE_NAMES[state.toUpperCase()];
  const cityName = titleCase(city);
  if (!stateName) notFound();

  const institutions = await loadCityInstitutions(cityName, state.toUpperCase());
  if (institutions.length === 0) notFound();
  const indexable = institutions.length >= MIN_INDEXABLE_INSTITUTIONS;

  return {
    robots: { index: indexable, follow: true },
    // One address per city: "little-rock" and "little%20rock" render the same page, and the
    // sitemap and breadcrumbs use the encoded lowercase name.
    alternates: { canonical: `/fees/city/${state.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}` },
    title: `Bank Fees in ${cityName}, ${state.toUpperCase()} - Compare Local Fees`,
    description: `Compare bank and credit union fees in ${cityName}, ${stateName}. See overdraft fees, monthly maintenance charges, NSF fees, and more from local institutions.`,
    keywords: [
      `${cityName} bank fees`,
      `${cityName} ${stateName} overdraft fees`,
      `banks in ${cityName}`,
      `credit unions in ${cityName}`,
      `${cityName} checking account fees`,
    ],
  };
}

export default async function CityFeePage({ params }: PageProps) {
  const { state, city } = await params;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  const cityName = titleCase(city);

  if (!stateName) notFound();

  const institutions = await loadCityInstitutions(cityName, stateCode);
  if (institutions.length === 0) notFound();

  const cityAverages = await getCityFeeAveragesCached(cityName, stateCode);
  const nationalIndex = await getPublicNationalIndex();

  const nationalMedians: Record<string, number> = {};
  for (const entry of nationalIndex) {
    nationalMedians[entry.fee_category] = entry.median_amount ?? 0;
  }

  const spotlightCategories = ["overdraft", "monthly_maintenance", "nsf", "atm_non_network"];
  const spotlightAverages = spotlightCategories.map((cat) => {
    const cityAvg = cityAverages.find((a) => a.fee_category === cat);
    const natMedian = nationalMedians[cat];
    return {
      category: cat,
      displayName: getDisplayName(cat),
      cityAvg: cityAvg?.median ?? null,
      nationalMedian: natMedian ?? null,
      institutionCount: cityAvg?.institution_count ?? 0,
      delta: cityAvg && natMedian ? ((cityAvg.median - natMedian) / natMedian) * 100 : null,
    };
  });

  const bankCount = institutions.filter((i) => i.charter_type === "bank").length;
  const cuCount = institutions.filter((i) => i.charter_type === "credit_union").length;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: SITE_URL },
          { name: "Fees", href: `${SITE_URL}/fees` },
          { name: stateName, href: `${SITE_URL}/fees/city/${stateCode.toLowerCase()}` },
          { name: cityName, href: `${SITE_URL}/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}` },
        ]}
      />

      <div className="max-w-page mx-auto px-6 py-14">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ink-muted mb-6">
          <Link href="/fees" className="hover:text-ink transition-colors">Fees</Link>
          <span className="text-border">/</span>
          <Link href={`/fees/city/${stateCode.toLowerCase()}`} className="hover:text-ink transition-colors">{stateName}</Link>
          <span className="text-border">/</span>
          <span className="text-ink-soft">{cityName}</span>
        </nav>

        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="h-px w-8 bg-brick/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brick/60">
            Local Fee Comparison
          </span>
        </div>

        <h1
          className="font-extrabold text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-ink mb-2"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          Bank Fees in {cityName}, {stateCode}
        </h1>
        <p className="text-[14px] text-ink-muted mb-8">
          {institutions.length} institution{institutions.length !== 1 ? "s" : ""} with fee data
          ({bankCount} bank{bankCount !== 1 ? "s" : ""}, {cuCount} credit union{cuCount !== 1 ? "s" : ""})
        </p>

        {/* Spotlight fee cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {spotlightAverages.map((s) => (
            <div key={s.category} className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm px-4 py-3.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted mb-1.5">{s.displayName}</p>
              <p
                className="text-[22px] font-semibold tabular-nums text-ink"
                style={{ fontFamily: "var(--fi-font-mono)" }}
              >
                {s.cityAvg !== null ? formatAmount(s.cityAvg) : "N/A"}
              </p>
              {s.delta !== null && (
                <p className={`text-[11px] tabular-nums mt-0.5 ${s.delta > 0 ? "text-red-500" : "text-emerald-600"}`}>
                  {s.delta > 0 ? "+" : ""}{s.delta.toFixed(1)}% vs national
                </p>
              )}
              <p className="text-[10px] text-ink-muted mt-0.5">
                {s.institutionCount} institution{s.institutionCount !== 1 ? "s" : ""} reporting
              </p>
            </div>
          ))}
        </div>

        {/* Institution table */}
        <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-3 bg-paper/60 border-b border-border/60">
            <h2
              className="text-[14px] font-bold text-ink"
              style={{ fontFamily: "var(--fi-font-sans)" }}
            >
              Institutions in {cityName}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-paper/30">
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Institution</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Type</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Assets</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Overdraft</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Monthly Fee</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">NSF</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">ATM</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Fees</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {institutions.map((inst) => (
                  <tr key={inst.id} className="hover:bg-paper/60 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/institution/${inst.id}`}
                        className="block min-w-0 max-w-[260px] break-words font-medium text-ink transition-colors hover:text-brick"
                      >
                        {inst.institution_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {inst.charter_type === "bank" ? "Bank" : "CU"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                      {inst.asset_size ? formatAssets(inst.asset_size) : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {formatAmount(inst.overdraft)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {formatAmount(inst.monthly_maintenance)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {formatAmount(inst.nsf)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {formatAmount(inst.atm_non_network)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                      {inst.fee_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* City averages vs national */}
        {cityAverages.length > 0 && (
          <div className="mt-10 rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-3 bg-paper/60 border-b border-border/60">
              <h2
                className="text-[14px] font-bold text-ink"
                style={{ fontFamily: "var(--fi-font-sans)" }}
              >
                Average Fees in {cityName} vs National
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-paper/30">
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Fee Category</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">{cityName} Avg</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">National</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Difference</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Reporting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {cityAverages.filter((a) => isFeaturedFee(a.fee_category)).map((avg) => {
                    const natMedian = nationalMedians[avg.fee_category];
                    const delta = natMedian ? ((avg.median - natMedian) / natMedian) * 100 : null;
                    return (
                      <tr key={avg.fee_category} className="hover:bg-paper/60 transition-colors">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/fees/${avg.fee_category}`}
                            className="font-medium text-ink transition-colors hover:text-brick"
                          >
                            {getDisplayName(avg.fee_category)}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-ink">
                          {formatAmount(avg.median)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                          {natMedian !== undefined ? formatAmount(natMedian) : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {delta !== null ? (
                            <span className={delta > 0 ? "text-red-500" : "text-emerald-600"}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                            </span>
                          ) : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                          {avg.institution_count}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <ProNextStep className="mt-8" />

        {/* Links */}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/fees/city/${stateCode.toLowerCase()}`}
            className="rounded-full border border-border px-4 py-1.5 text-[12px] font-medium text-ink-soft hover:border-brick/30 hover:text-brick transition-colors no-underline"
          >
            More cities in {stateName}
          </Link>
          <Link
            href={`/research/state/${stateCode}`}
            className="rounded-full border border-border px-4 py-1.5 text-[12px] font-medium text-ink-soft hover:border-brick/30 hover:text-brick transition-colors no-underline"
          >
            {stateName} Fee Report
          </Link>
          <Link
            href="/fees"
            className="rounded-full border border-border px-4 py-1.5 text-[12px] font-medium text-ink-soft hover:border-brick/30 hover:text-brick transition-colors no-underline"
          >
            Bank Fee Index
          </Link>
        </div>
      </div>
    </>
  );
}
