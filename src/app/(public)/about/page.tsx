export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { CONTACT_EMAIL, REPORT_OFFER } from "@/lib/constants";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";

export const metadata: Metadata = {
  title: "About",
  description:
    "Fee Insight builds the Bank Fee Index, source-verified fee data for US banks and credit unions. Learn about our methodology, data sources, and mission.",
};

export default async function AboutPage() {
  const summary = await getPublicStatsSummary();

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          About
        </span>
      </div>

      <h1
        className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        About Fee Insight
      </h1>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-[#5A5347]">
        <p>
          Fee Insight is an independent banking fee intelligence company. Our
          flagship product, the Bank Fee Index, is a source-verified record of US
          bank and credit union fee data: we track, benchmark, and analyze fee schedules
          from financial institutions in {summary.statesLabel} states and all 12
          Federal Reserve districts.
        </p>

        <p>
          Our platform serves two audiences: consumers who want to understand
          what their bank charges and how it compares, and financial
          professionals who need competitive intelligence, peer benchmarking,
          and regulatory context to make pricing decisions.
        </p>

        <p>
          Everything is built on one ladder. The Bank Fee Index is the free lookup: any
          institution, any published fee, with its source. The{" "}
          <Link href="/for-institutions#report" className="text-[#A93D25] hover:underline">
            {REPORT_OFFER.name}
          </Link>{" "}
          is a free, one-time report placing one institution against
          its verified peer set. Fee Insight Pro is the subscription; Hamilton is its
          workspace for benchmarking, scenarios, reports and monitoring. Fee Insight Advisory
          covers custom competitor sets, board decks and multi-institution work.
        </p>

        <h2
          className="text-[18px] font-medium text-[#1A1815] pt-4"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Who&apos;s behind this
        </h2>

        {/* TODO(founder): add photo + LinkedIn */}
        <p>
          Fee Insight is built and run by James Gilmore, a banking data analyst. The Bank
          Fee Index exists because published fee schedules were never collected in one
          verifiable place — every figure here links to the document it came from.
        </p>
        <p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-[#A93D25] hover:underline"
          >
            Write to James
          </a>
        </p>

        <h2
          className="text-[18px] font-medium text-[#1A1815] pt-4"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Our Data
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { value: summary.institutionsLabel, label: "Institutions with verified fees" },
            { value: summary.observationsLabel, label: "Verified fees" },
            { value: summary.categoriesLabel, label: "Fee categories" },
            { value: summary.statesLabel, label: "States & territories" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-4 py-3 text-center"
            >
              <p className="text-[20px] font-bold tabular-nums text-[#1A1815]">
                {stat.value}
              </p>
              <p className="mt-0.5 text-[11px] text-[#6B6255]">{stat.label}</p>
            </div>
          ))}
        </div>

        <h2
          className="text-[18px] font-medium text-[#1A1815] pt-4"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Methodology
        </h2>

        <p>
          We collect fee schedule data from publicly available sources including
          institution websites, regulatory filings, and official disclosures.
          Each fee is extracted, categorized into our standard
          taxonomy, and validated through automated quality checks and manual
          review.
        </p>

        <p>
          Our national benchmarks include medians, percentile ranges (P25-P75),
          and institutional coverage counts. Data maturity is classified by how many
          institutions publish a verified fee in the category: &ldquo;strong&rdquo;
          ({STRONG_INSTITUTION_COUNT}+ institutions), &ldquo;provisional&rdquo;
          ({MIN_INSTITUTIONS_FOR_MEDIAN} to {STRONG_INSTITUTION_COUNT - 1}), or
          &ldquo;insufficient&rdquo; (fewer than {MIN_INSTITUTIONS_FOR_MEDIAN}, no median
          shown) to help users assess statistical confidence.
        </p>

        <h2
          className="text-[18px] font-medium text-[#1A1815] pt-4"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Data Sources
        </h2>

        <ul className="list-disc pl-6 space-y-1.5 text-[14px]">
          <li>Published fee schedules from bank and credit union websites</li>
          <li>FDIC Call Reports for bank financial data</li>
          <li>NCUA 5300 Reports for credit union financial data</li>
          <li>Federal Reserve Beige Book for district economic context</li>
          <li>FRED economic indicators for macro benchmarking</li>
        </ul>

        <p className="text-[13px] text-[#6B6255]">{summary.freshnessLabel}.</p>

        <h2
          className="text-[18px] font-medium text-[#1A1815] pt-4"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Contact
        </h2>

        <p>
          For questions, partnership inquiries, or data licensing, reach us
          at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-[#A93D25] hover:underline"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          or use our{" "}
          <Link href="/contact" className="text-[#A93D25] hover:underline">
            contact form
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
