export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import {
  getDistrictMetrics,
  getBeigeBookHeadlines,
  getPublicStats,
} from "@/lib/data-store";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { ProReferenceWorkflowBanner } from "@/components/pro/reference-workflow-banner";

export const metadata: Metadata = {
  title: "District Intelligence",
};

export default async function ProDistrictsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/pro/districts");
  if (!canAccessPremium(user)) redirect("/subscribe?from=/pro/districts");

  const metrics = await getDistrictMetrics();
  const headlines = await getBeigeBookHeadlines();
  const stats = await getPublicStats();

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Terracotta label */}
      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-terra/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-terra/60">
          District Intelligence
        </span>
      </div>

      <h1
        className="text-[2rem] leading-[1.1] tracking-[-0.02em] text-warm-900"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Federal Reserve Districts
      </h1>
      <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-warm-600">
        Fee benchmarks, institutional coverage, and economic commentary across
        all 12 Federal Reserve districts. Data spans{" "}
        {stats.total_institutions.toLocaleString()} institutions and{" "}
        {stats.total_observations.toLocaleString()} fee observations.
      </p>

      <ProReferenceWorkflowBanner userId={user.id} surface="districts" />

      {/* District grid */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((m) => {
          const name = DISTRICT_NAMES[m.district] ?? `District ${m.district}`;
          const headline = headlines.get(m.district);
          const coveragePct =
            m.institution_count > 0
              ? Math.round((m.with_fee_url / m.institution_count) * 100)
              : 0;

          return (
            <Link
              key={m.district}
              href={`/research/district/${m.district}`}
              className="group rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm p-5 hover:shadow-md hover:border-warm-300 transition-all duration-200 no-underline"
            >
              {/* District header */}
              <div className="flex items-center gap-3 mb-4">
                <span className="flex items-center justify-center h-8 w-8 rounded-lg bg-warm-100 text-[12px] font-bold text-warm-600 tabular-nums">
                  {m.district}
                </span>
                <h2
                  className="text-[15px] font-semibold text-warm-900 group-hover:text-terra transition-colors"
                  style={{
                    fontFamily: "var(--font-newsreader), Georgia, serif",
                  }}
                >
                  {name}
                </h2>
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                    Institutions
                  </p>
                  <p
                    className="mt-0.5 text-lg font-light text-warm-900 tabular-nums"
                    style={{
                      fontFamily: "var(--font-newsreader), Georgia, serif",
                    }}
                  >
                    {m.institution_count.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                    Fees
                  </p>
                  <p
                    className="mt-0.5 text-lg font-light text-warm-900 tabular-nums"
                    style={{
                      fontFamily: "var(--font-newsreader), Georgia, serif",
                    }}
                  >
                    {m.total_fees.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                    Coverage
                  </p>
                  <p
                    className="mt-0.5 text-lg font-light text-warm-900 tabular-nums"
                    style={{
                      fontFamily: "var(--font-newsreader), Georgia, serif",
                    }}
                  >
                    {coveragePct}%
                  </p>
                </div>
              </div>

              {/* Beige Book headline */}
              {headline ? (
                <div className="pt-3 border-t border-warm-200/40">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500 mb-1">
                    Beige Book
                  </p>
                  <p className="text-[11px] leading-relaxed text-warm-600 line-clamp-2">
                    {headline.text}
                  </p>
                </div>
              ) : (
                <div className="pt-3 border-t border-warm-200/40">
                  <p className="text-[11px] text-warm-500 italic">
                    No Beige Book data available
                  </p>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
