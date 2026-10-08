export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";
import { getCitiesInStateCached } from "@/lib/data-store/public-cached-reads";

interface PageProps {
  params: Promise<{ state: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state } = await params;
  const stateName = STATE_NAMES[state.toUpperCase()];
  if (!stateName) return { title: "Not Found" };

  return {
    title: `Bank Fees by City in ${stateName} - Local Fee Comparison`,
    description: `Compare bank fees by city in ${stateName}. Find banks and credit unions with lower fees in your area. Overdraft fees, monthly charges, and more.`,
    keywords: [
      `${stateName} bank fees by city`,
      `${stateName} banks with lower fees`,
      `${stateName} bank fee comparison`,
      `${stateName} credit union fees`,
    ],
  };
}

export default async function StateCityDirectory({ params }: PageProps) {
  const { state } = await params;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];

  if (!stateName) notFound();

  const cities = await getCitiesInStateCached(stateCode);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: SITE_URL },
          { name: "Fees", href: `${SITE_URL}/fees` },
          { name: stateName, href: `${SITE_URL}/fees/city/${stateCode.toLowerCase()}` },
        ]}
      />

      <div className="max-w-4xl mx-auto px-6 py-14">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-[#6B6255] mb-6">
          <Link href="/fees" className="hover:text-[#1A1815] transition-colors">Fees</Link>
          <span className="text-[#D4C9BA]">/</span>
          <span className="text-[#5A5347]">{stateName}</span>
        </nav>

        <div className="flex items-center gap-2 mb-4">
          <span className="h-px w-8 bg-[#C44B2E]/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
            City Directory
          </span>
        </div>

        <h1
          className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815] mb-2"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Bank Fees by City in {stateName}
        </h1>
        <p className="text-[14px] text-[#6B6255] mb-8">
          {cities.length} cities with fee data from {cities.reduce((s, c) => s + c.with_fees, 0)} institutions
        </p>

        {cities.length === 0 ? (
          <p className="text-[#6B6255] py-12 text-center">
            No fee data available for {stateName} yet. Check back soon.
          </p>
        ) : (
          <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">City</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Total Institutions</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">With Fee Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DFD1]/40">
                  {cities.map((c) => (
                    <tr key={`${c.city}-${c.state_code}`} className="hover:bg-[#FAF7F2]/60 transition-colors">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(c.city.toLowerCase())}`}
                          className="font-medium text-[#1A1815] hover:text-[#C44B2E] transition-colors"
                        >
                          {c.city}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                        {c.institution_count}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
                        {c.with_fees}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/research/state/${stateCode}`}
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
