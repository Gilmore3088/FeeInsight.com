export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { AudiencePaths } from "@/components/public/audience-paths";
import {
  getStatesWithFeeData,
  getDistrictMetrics,
  getFeeCategorySummaries,
} from "@/lib/data-store";
import { STATE_NAMES, US_STATES_ONLY, US_TERRITORIES } from "@/lib/us-states";
import { UsStateMap } from "@/components/public/us-state-map";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { ResearchSidebar } from "./research-sidebar";
import { OriginalResearchSection } from "./original-research";
import { DataSourcesSection } from "./data-sources";
import { IndexModule } from "./index-module";
import { DistrictReportsSection } from "./district-cards";

export const metadata: Metadata = {
  title: "Research - Bank & Credit Union Fee Analysis",
  description:
    "Geographic analysis of bank and credit union fees. State-level reports and Federal Reserve district analysis with economic context — every figure traced to a published schedule.",
};

export default async function ResearchHubPage() {
  const statesData = await getStatesWithFeeData();
  const districtMetrics = await getDistrictMetrics();
  const summary = await getPublicStatsSummary();
  const summaries = await getFeeCategorySummaries();

  // Separate states from territories for accurate display
  const stateCount = statesData.filter((s) => US_STATES_ONLY.has(s.state_code)).length;
  const territoryCount = statesData.filter((s) => US_TERRITORIES.has(s.state_code)).length;
  const stateLabel = territoryCount > 0
    ? `${stateCount} states + DC & territories`
    : `${stateCount} states`;

  // Spotlight fees for quick stats sidebar
  const spotlightKeys = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing", "card_foreign_txn"];
  const spotlightFees = spotlightKeys
    .map((k) => summaries.find((s) => s.fee_category === k))
    .filter(Boolean) as typeof summaries;

  // Top states by institution count for "chart preview" section
  const topStates = statesData.slice(0, 5);
  const maxStateInst = topStates.length > 0 ? topStates[0].institution_count : 1;

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
        ]}
      />

      {/* -- Hero -- */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="h-px w-8 bg-[#C44B2E]/40" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#6B6255]">
            Research
          </p>
        </div>
        <h1
          className="mt-1.5 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-extrabold text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Fee Research & Analysis
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[#6B6255]">
          State-level reports, Federal Reserve district analysis, and national
          benchmarks across every fee category — every figure traced to a
          published schedule.
        </p>

        {/* Authority strip */}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[#6B6255]">
          <span>
            <span className="font-semibold tabular-nums text-[#5A5347]">
              {summary.observationsLabel}
            </span>{" "}
            verified fees
          </span>
          <span className="hidden sm:inline text-[#D4C9BA]">|</span>
          <span>
            <span className="font-semibold tabular-nums text-[#5A5347]">
              {summary.institutionsLabel}
            </span>{" "}
            institutions with verified fees
          </span>
          <span className="hidden sm:inline text-[#D4C9BA]">|</span>
          <span>
            <span className="font-semibold tabular-nums text-[#5A5347]">{summary.categoriesLabel}</span>{" "}
            fee categories
          </span>
          <span className="hidden sm:inline text-[#D4C9BA]">|</span>
          <span>
            <span className="font-semibold tabular-nums text-[#5A5347]">
              {stateCount}
            </span>{" "}
            states{territoryCount > 0 ? ` + ${territoryCount} territories` : ""}
          </span>
          <span className="hidden sm:inline text-[#D4C9BA]">|</span>
          <span>12 Fed districts</span>
        </div>

        <AudiencePaths className="mt-6" />
      </div>

      {/* -- Two-column layout -- */}
      <div className="mt-10 grid grid-cols-1 gap-10 xl:grid-cols-[1fr_300px]">
        {/* -- Main column -- */}
        <div className="min-w-0">
          <IndexModule summary={summary} />

          {/* Analysis Previews -- mini bar charts */}
          <section className="mt-8" id="analysis">
            <h2
              className="text-sm font-bold text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              Analysis Previews
            </h2>
            <p className="mt-1 text-[13px] text-[#6B6255]">
              Top states by institution coverage and key fee benchmarks.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {/* Top states bar chart */}
              <div className="rounded-xl border border-[#E8DFD1]/80 px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255]">
                  Institutions by State (Top 5)
                </p>
                <div className="mt-3 space-y-2">
                  {topStates.map((s) => {
                    const pct = (s.institution_count / maxStateInst) * 100;
                    return (
                      <div key={s.state_code} className="flex items-center gap-2">
                        <span className="w-6 text-[11px] font-semibold text-[#6B6255]">
                          {s.state_code}
                        </span>
                        <div className="flex-1 h-4 rounded-sm bg-[#E8DFD1]/40 overflow-hidden">
                          <div
                            className="h-full rounded-sm bg-[#D4C9BA]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-[11px] tabular-nums font-medium text-[#6B6255]">
                          {s.institution_count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Spotlight fee comparison */}
              <div className="rounded-xl border border-[#E8DFD1]/80 px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255]">
                  National Fee Medians
                </p>
                <div className="mt-3 space-y-2">
                  {spotlightFees.slice(0, 5).map((fee) => {
                    const maxMedian = Math.max(...spotlightFees.map((f) => f.median_amount ?? 0));
                    const pct = maxMedian > 0 ? ((fee.median_amount ?? 0) / maxMedian) * 100 : 0;
                    return (
                      <div key={fee.fee_category} className="flex items-center gap-2">
                        <span className="w-20 truncate text-[11px] text-[#6B6255]">
                          {getDisplayName(fee.fee_category).split(" ").slice(0, 2).join(" ")}
                        </span>
                        <div className="flex-1 h-4 rounded-sm bg-[#E8DFD1]/40 overflow-hidden">
                          <div
                            className="h-full rounded-sm bg-[#C44B2E]/40"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-[11px] tabular-nums font-semibold text-[#5A5347]">
                          {formatAmount(fee.median_amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* State Reports */}
          <section className="mt-10" id="states">
            <div className="flex items-baseline justify-between">
              <div>
                <h2
                  className="text-sm font-bold text-[#1A1815]"
                  style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                >
                  State Fee Reports
                </h2>
                <p className="mt-1 text-[13px] text-[#6B6255]">
                  {stateLabel} &middot; {summary.observationsLabel} verified fees
                </p>
              </div>
            </div>

            {/* Interactive map */}
            <div className="mt-4 rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm p-4">
              <UsStateMap statesData={statesData} />
              <p className="mt-2 text-center text-[11px] text-[#6B6255]">
                Click a state to view its fee report
              </p>
            </div>

            {/* Compact state list below map */}
            <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-1 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {statesData.map((s) => (
                <Link
                  key={s.state_code}
                  href={`/research/state/${s.state_code}`}
                  className="flex items-baseline justify-between rounded px-2 py-1 text-[11px] transition-colors hover:bg-[#FAF7F2]"
                >
                  <span className="font-medium text-[#5A5347] hover:text-[#A93D25] truncate">
                    {STATE_NAMES[s.state_code] ?? s.state_code}
                  </span>
                  <span className="ml-1 tabular-nums text-[#6B6255] shrink-0">
                    {s.institution_count}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <DistrictReportsSection districtMetrics={districtMetrics} />

          <OriginalResearchSection />

          <DataSourcesSection stateLabel={stateLabel} />
        </div>

        <ResearchSidebar spotlightFees={spotlightFees} categoriesLabel={summary.categoriesLabel} />
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Bank Fee Research Reports",
            description:
              "Geographic analysis of bank and credit union fees by state and Federal Reserve district.",
            url: `${SITE_URL}/research`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
