export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  getCityInstitutions,
  getCityFeeAverages,
  getNationalIndexCached,
} from "@/lib/data-store";
import { getDisplayName, isFeaturedFee } from "@/lib/fee-taxonomy";
import { formatAmount, formatAssets } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";

interface PageProps {
  params: Promise<{ state: string; city: string }>;
}

/** Cities with fewer verified institutions than this are thin pages: rendered, not indexed. */
const MIN_INDEXABLE_INSTITUTIONS = 3;

// Shared between generateMetadata and the page so the query runs once per request.
const loadCityInstitutions = cache(getCityInstitutions);

function titleCase(s: string): string {
  return decodeURIComponent(s)
    .split(/[-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state, city } = await params;
  const stateName = STATE_NAMES[state.toUpperCase()];
  const cityName = titleCase(city);
  if (!stateName) return { title: "Not Found" };

  const institutions = await loadCityInstitutions(cityName, state.toUpperCase());
  const indexable = institutions.length >= MIN_INDEXABLE_INSTITUTIONS;

  return {
    robots: { index: indexable, follow: true },
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

  const cityAverages = await getCityFeeAverages(cityName, stateCode);
  const nationalIndex = await getNationalIndexCached();

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

      <div className="max-w-5xl mx-auto px-6 py-14">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-[12px] text-[#6B6255] mb-6">
          <Link href="/fees" className="hover:text-[#1A1815] transition-colors">Fees</Link>
          <span className="text-[#D4C9BA]">/</span>
          <Link href={`/fees/city/${stateCode.toLowerCase()}`} className="hover:text-[#1A1815] transition-colors">{stateName}</Link>
          <span className="text-[#D4C9BA]">/</span>
          <span className="text-[#5A5347]">{cityName}</span>
        </nav>

        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="h-px w-8 bg-[#C44B2E]/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
            Local Fee Comparison
          </span>
        </div>

        <h1
          className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815] mb-2"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Bank Fees in {cityName}, {stateCode}
        </h1>
        <p className="text-[14px] text-[#6B6255] mb-8">
          {institutions.length} institution{institutions.length !== 1 ? "s" : ""} with fee data
          ({bankCount} bank{bankCount !== 1 ? "s" : ""}, {cuCount} credit union{cuCount !== 1 ? "s" : ""})
        </p>

        {/* Spotlight fee cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {spotlightAverages.map((s) => (
            <div key={s.category} className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mb-1.5">{s.displayName}</p>
              <p
                className="text-[22px] font-light tabular-nums text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                {s.cityAvg !== null ? formatAmount(s.cityAvg) : "N/A"}
              </p>
              {s.delta !== null && (
                <p className={`text-[11px] tabular-nums mt-0.5 ${s.delta > 0 ? "text-red-500" : "text-emerald-600"}`}>
                  {s.delta > 0 ? "+" : ""}{s.delta.toFixed(1)}% vs national
                </p>
              )}
              <p className="text-[10px] text-[#6B6255] mt-0.5">
                {s.institutionCount} institution{s.institutionCount !== 1 ? "s" : ""} reporting
              </p>
            </div>
          ))}
        </div>

        {/* Institution table */}
        <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-3 bg-[#FAF7F2]/60 border-b border-[#E8DFD1]/60">
            <h2
              className="text-[14px] font-medium text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              Institutions in {cityName}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[#E8DFD1]/40 bg-[#FAF7F2]/30">
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Institution</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Type</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Assets</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Overdraft</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Monthly Fee</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">NSF</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">ATM</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Fees</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD1]/40">
                {institutions.map((inst) => (
                  <tr key={inst.id} className="hover:bg-[#FAF7F2]/60 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/institution/${inst.id}`}
                        className="block min-w-0 max-w-[260px] break-words font-medium text-[#1A1815] transition-colors hover:text-[#C44B2E]"
                      >
                        {inst.institution_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#6B6255]">
                      {inst.charter_type === "bank" ? "Bank" : "CU"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                      {inst.asset_size ? formatAssets(inst.asset_size) : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#1A1815]">
                      {formatAmount(inst.overdraft)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#1A1815]">
                      {formatAmount(inst.monthly_maintenance)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#1A1815]">
                      {formatAmount(inst.nsf)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#1A1815]">
                      {formatAmount(inst.atm_non_network)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
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
          <div className="mt-10 rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-3 bg-[#FAF7F2]/60 border-b border-[#E8DFD1]/60">
              <h2
                className="text-[14px] font-medium text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                Average Fees in {cityName} vs National
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-[#E8DFD1]/40 bg-[#FAF7F2]/30">
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Fee Category</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">{cityName} Avg</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">National</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Difference</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Reporting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DFD1]/40">
                  {cityAverages.filter((a) => isFeaturedFee(a.fee_category)).map((avg) => {
                    const natMedian = nationalMedians[avg.fee_category];
                    const delta = natMedian ? ((avg.median - natMedian) / natMedian) * 100 : null;
                    return (
                      <tr key={avg.fee_category} className="hover:bg-[#FAF7F2]/60 transition-colors">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/fees/${avg.fee_category}`}
                            className="font-medium text-[#1A1815] transition-colors hover:text-[#C44B2E]"
                          >
                            {getDisplayName(avg.fee_category)}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1815]">
                          {formatAmount(avg.median)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                          {natMedian !== undefined ? formatAmount(natMedian) : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {delta !== null ? (
                            <span className={delta > 0 ? "text-red-500" : "text-emerald-600"}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                            </span>
                          ) : "-"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
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

        {/* Links */}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/fees/city/${stateCode.toLowerCase()}`}
            className="rounded-full border border-[#E8DFD1] px-4 py-1.5 text-[12px] font-medium text-[#5A5347] hover:border-[#C44B2E]/30 hover:text-[#A93D25] transition-colors no-underline"
          >
            More cities in {stateName}
          </Link>
          <Link
            href={`/research/state/${stateCode.toLowerCase()}`}
            className="rounded-full border border-[#E8DFD1] px-4 py-1.5 text-[12px] font-medium text-[#5A5347] hover:border-[#C44B2E]/30 hover:text-[#A93D25] transition-colors no-underline"
          >
            {stateName} Fee Report
          </Link>
          <Link
            href="/fees"
            className="rounded-full border border-[#E8DFD1] px-4 py-1.5 text-[12px] font-medium text-[#5A5347] hover:border-[#C44B2E]/30 hover:text-[#A93D25] transition-colors no-underline"
          >
            Bank Fee Index
          </Link>
        </div>
      </div>
    </>
  );
}
