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
  if (!stateName) notFound();

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

      <div className="max-w-page mx-auto px-6 py-14">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ink-muted mb-6">
          <Link href="/fees" className="hover:text-ink transition-colors">Fees</Link>
          <span className="text-border">/</span>
          <span className="text-ink-soft">{stateName}</span>
        </nav>

        <div className="flex items-center gap-2 mb-4">
          <span className="h-px w-8 bg-brick/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brick/60">
            City Directory
          </span>
        </div>

        <h1
          className="font-extrabold text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-ink mb-2"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          Bank Fees by City in {stateName}
        </h1>
        <p className="text-[14px] text-ink-muted mb-8">
          {cities.length} cities with fee data from {cities.reduce((s, c) => s + c.with_fees, 0)} institutions
        </p>

        {cities.length === 0 ? (
          <p className="text-ink-muted py-12 text-center">
            No fee data available for {stateName} yet. Check back soon.
          </p>
        ) : (
          <div className="rounded-xl border border-border/80 bg-white/70 backdrop-blur-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm sm:min-w-[520px]">
                <thead>
                  <tr className="border-b border-border/60 bg-paper/60">
                    <th className="px-3 py-2.5 sm:px-4 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">City</th>
                    <th className="px-3 py-2.5 sm:px-4 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">Institutions</th>
                    <th className="px-3 py-2.5 sm:px-4 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">With fees</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {cities.map((c) => (
                    <tr key={`${c.city}-${c.state_code}`} className="hover:bg-paper/60 transition-colors">
                      <td className="px-3 py-2.5 sm:px-4">
                        <Link
                          href={`/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(c.city.toLowerCase())}`}
                          className="font-medium text-ink hover:text-brick transition-colors"
                        >
                          {c.city}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 sm:px-4 text-right tabular-nums text-ink-muted">
                        {c.institution_count}
                      </td>
                      <td className="px-3 py-2.5 sm:px-4 text-right tabular-nums font-medium text-ink">
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
