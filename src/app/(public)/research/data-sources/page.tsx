export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getDataCoverageSummaryCached } from "@/lib/data-store/public-cached-reads";

export const metadata: Metadata = {
  title: "Data Sources & Coverage — Methodology",
  description:
    "Federal data sources powering the Bank Fee Index: FDIC Call Reports, NCUA 5300, CFPB Complaints, FRED, BLS, NY Fed, OFR, Summary of Deposits, Census ACS, and FFIEC Census Tracts.",
  keywords: [
    "bank fee data sources",
    "FDIC call reports",
    "NCUA 5300",
    "CFPB complaints",
    "bank fee methodology",
  ],
};

const DATA_SOURCES = [
  {
    name: "Fee Schedule Extractions",
    description: "Bank and credit union fee observations extracted from published PDFs and web pages with source lineage and review gates.",
    agency: SITE_NAME,
    cadence: "Weekly",
    key: null as string | null,
  },
  {
    name: "FDIC Call Reports",
    description: "Quarterly financial data for all FDIC-insured banks. Includes service charge income (RIAD4080), total assets, deposits, and revenue metrics.",
    agency: "Federal Deposit Insurance Corporation",
    cadence: "Quarterly",
    key: "fdic_financials",
  },
  {
    name: "NCUA 5300 Reports",
    description: "Quarterly financial data for federally insured credit unions. Includes fee income (ACCT_131), assets, deposits, and member counts.",
    agency: "National Credit Union Administration",
    cadence: "Quarterly",
    key: "ncua_financials",
  },
  {
    name: "CFPB Consumer Complaints",
    description: "Consumer complaints about checking accounts, savings accounts, and fee-related issues. Filtered to overdraft, NSF, and account management complaints.",
    agency: "Consumer Financial Protection Bureau",
    cadence: "Weekly",
    key: "cfpb_complaints",
  },
  {
    name: "FRED Economic Indicators",
    description: "Federal Reserve Economic Data including federal funds rate, CPI, unemployment, and bank-specific Quarterly Banking Profile metrics (net interest income, service charges).",
    agency: "Federal Reserve Bank of St. Louis",
    cadence: "Weekly",
    key: "fred_indicators",
  },
  {
    name: "BLS Consumer Price Index",
    description: "Bureau of Labor Statistics CPI data including the bank-specific series CUUR0000SEMC01 (Checking Account and Other Bank Services) and regional professional services CPI.",
    agency: "Bureau of Labor Statistics",
    cadence: "Weekly",
    key: "bls_observations",
  },
  {
    name: "NY Fed Reference Rates",
    description: "Daily reference rates including SOFR (Secured Overnight Financing Rate), EFFR (Effective Federal Funds Rate), and OBFR (Overnight Bank Funding Rate).",
    agency: "Federal Reserve Bank of New York",
    cadence: "Daily",
    key: "nyfed_rates",
  },
  {
    name: "OFR Financial Stress Index",
    description: "Daily composite financial stress index from 33 market variables. Tracks credit, equity, funding, and volatility stress indicators.",
    agency: "Office of Financial Research",
    cadence: "Daily",
    key: "ofr_stress",
  },
  {
    name: "FDIC Summary of Deposits",
    description: "Annual branch-level deposit data for all domestic banking offices. Used to compute Herfindahl-Hirschman Index (HHI) market concentration by MSA.",
    agency: "Federal Deposit Insurance Corporation",
    cadence: "Annual",
    key: "sod_branches",
  },
  {
    name: "Market Concentration (HHI)",
    description: "Derived market concentration metrics per Metropolitan Statistical Area. Computed from Summary of Deposits branch-level data.",
    agency: "Derived",
    cadence: "Annual",
    key: "market_concentrations",
  },
  {
    name: "Census ACS Demographics",
    description: "American Community Survey 5-year estimates: median household income, poverty rates, and population by state and county.",
    agency: "U.S. Census Bureau",
    cadence: "Annual",
    key: "demographics",
  },
  {
    name: "FFIEC Census Tract Classifications",
    description: "Income classifications (low/moderate/middle/upper) and demographics for census tracts. Enables CRA-type equity analysis of fee distributions.",
    agency: "Federal Financial Institutions Examination Council",
    cadence: "Annual",
    key: "census_tracts",
  },
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default async function DataSourcesPage() {
  const coverage = await getDataCoverageSummaryCached();

  const coverageMap: Record<string, number> = {
    fdic_financials: coverage.fdic_financials,
    ncua_financials: coverage.ncua_financials,
    cfpb_complaints: coverage.cfpb_complaints,
    fred_indicators: coverage.fred_indicators,
    bls_observations: coverage.bls_observations,
    nyfed_rates: coverage.nyfed_rates,
    ofr_stress: coverage.ofr_stress,
    sod_branches: coverage.sod_branches,
    market_concentrations: coverage.market_concentrations,
    demographics: coverage.demographics,
    census_tracts: coverage.census_tracts,
  };

  const totalRecords = Object.values(coverageMap).reduce((a, b) => a + b, 0);
  const populatedSources = Object.values(coverageMap).filter((v) => v > 0).length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: "Data Sources", href: "/research/data-sources" },
        ]}
      />

      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          Methodology
        </span>
      </div>
      <h1
        className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-bold text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Data Sources & Coverage
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] text-[#6B6255]">
        The Bank Fee Index integrates data from {DATA_SOURCES.length} federal and
        derived sources. All data is publicly available, sourced from official
        government APIs, and refreshed on automated schedules.
      </p>

      {/* Summary strip */}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[#6B6255]">
        <span>
          <span className="font-semibold tabular-nums text-[#5A5347]">
            {DATA_SOURCES.length}
          </span>{" "}
          data sources
        </span>
        <span className="hidden sm:inline text-[#D4C9BA]">|</span>
        <span>
          <span className="font-semibold tabular-nums text-[#5A5347]">
            {populatedSources}
          </span>{" "}
          populated
        </span>
        <span className="hidden sm:inline text-[#D4C9BA]">|</span>
        <span>
          <span className="font-semibold tabular-nums text-[#5A5347]">
            {formatCount(totalRecords)}
          </span>{" "}
          total records
        </span>
      </div>

      {/* Data source cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DATA_SOURCES.map((source) => {
          const count = source.key ? coverageMap[source.key] ?? 0 : null;
          const hasData = count === null || count > 0;

          return (
            <div
              key={source.name}
              className={`rounded-xl border px-5 py-4 transition-colors ${
                hasData
                  ? "border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm"
                  : "border-[#E8DFD1]/40 bg-[#FAF7F2]/30 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#1A1815]">
                  {source.name}
                </h3>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    source.cadence === "Daily"
                      ? "bg-blue-50 text-blue-600"
                      : source.cadence === "Weekly"
                        ? "bg-emerald-50 text-emerald-600"
                        : source.cadence === "Quarterly"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-50 text-slate-500"
                  }`}
                >
                  {source.cadence}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[#6B6255]">
                {source.description}
              </p>
              <div className="mt-3 flex items-center justify-between text-[11px]">
                <span className="text-[#6B6255]">{source.agency}</span>
                {count !== null && (
                  <span
                    className={`font-semibold tabular-nums ${
                      count > 0 ? "text-emerald-600" : "text-[#6B6255]"
                    }`}
                  >
                    {count > 0 ? formatCount(count) : "Not populated"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Refresh schedule */}
      <section className="mt-10 rounded-xl border border-[#E8DFD1] bg-[#FAF7F2]/50 px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6255]">
          Automated Refresh Schedule
        </h2>
        <div className="mt-3 grid gap-2 text-[13px] text-[#6B6255]">
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-center text-[10px] font-semibold text-blue-600">
              Daily
            </span>
            <span>OFR Financial Stress Index, NY Fed reference rates</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-center text-[10px] font-semibold text-emerald-600">
              Weekly
            </span>
            <span>FRED macroeconomic indicators, BLS CPI, CFPB complaints, Fed speeches &amp; research, fee schedule crawls</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-center text-[10px] font-semibold text-amber-700">
              Quarterly
            </span>
            <span>FDIC Call Reports, NCUA 5300 Reports</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 rounded-full bg-slate-50 px-2 py-0.5 text-center text-[10px] font-semibold text-slate-500">
              Annual
            </span>
            <span>FDIC Summary of Deposits, Census ACS demographics, FFIEC census tracts</span>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Data Sources & Coverage",
            description: "Federal data sources powering the Bank Fee Index.",
            url: `${SITE_URL}/research/data-sources`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
