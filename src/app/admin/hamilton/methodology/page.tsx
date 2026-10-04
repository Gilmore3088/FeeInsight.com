import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = {
  title: "Methodology",
};

const COVERAGE_STATS = {
  institutions: "1,100+",
  categories: 49,
  families: 9,
  coverageLeader: "Wyoming (91%)",
  confidenceThreshold: "0.85",
  autoStageRate: "~72%",
  humanReviewRate: "~28%",
};

function SectionHeading({ title, id }: { title: string; id: string }) {
  return (
    <h2
      id={id}
      className="text-base font-bold tracking-tight text-gray-900 dark:text-gray-100 mt-10 mb-3 border-b border-gray-100 dark:border-gray-800 pb-2"
    >
      {title}
    </h2>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-300 dark:border-amber-700 text-sm text-amber-900 dark:text-amber-200">
      {children}
    </div>
  );
}

export default async function MethodologyPage() {
  await requireAuth("view");

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            { label: "Methodology" },
          ]}
        />
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Bank Fee Index — Methodology
          </h1>
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Draft v1.0
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          How we collect, categorize, validate, and publish banking fee data
        </p>
      </div>

      <div className="admin-card p-6 text-sm leading-relaxed text-gray-700 dark:text-gray-300">

        {/* Table of Contents */}
        <nav className="mb-8">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Contents</p>
          <ol className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
            {[
              ["introduction", "Introduction"],
              ["data-sources", "Data Sources"],
              ["collection", "Collection Process"],
              ["categorization", "Fee Categorization"],
              ["confidence", "Confidence Scoring"],
              ["validation", "Validation Process"],
              ["coverage", "Coverage Metrics"],
              ["limitations", "Limitations"],
            ].map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                >
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* 1. Introduction */}
        <SectionHeading id="introduction" title="1. Introduction" />
        <p className="mb-3">
          Bank Fee Index is the national benchmark for banking fee data, tracking{" "}
          {COVERAGE_STATS.categories} fee categories across {COVERAGE_STATS.institutions}{" "}
          financial institutions. Our mission is to make fee intelligence transparent, accurate,
          and actionable — for consumers who pay these fees, for institutions that set them, and
          for analysts who study them.
        </p>
        <p className="mb-3">
          This document explains how the index works: where the data comes from, how fees are
          extracted and categorized, how we score our own confidence in each observation, and
          where the data has gaps. The goal is not to provide a replication guide, but to give
          any data user enough context to trust — or appropriately discount — the numbers they see.
        </p>
        <Callout>
          Data users should treat this index as a benchmark based on published fee schedules, not
          as a guarantee of the fees any individual customer will actually pay. Promotional rates,
          relationship pricing, and waiver programs are not captured here.
        </Callout>

        {/* 2. Data Sources */}
        <SectionHeading id="data-sources" title="2. Data Sources" />
        <p className="mb-3">
          Institution coverage begins with the regulatory registries maintained by the Federal
          Deposit Insurance Corporation (FDIC) and the National Credit Union Administration
          (NCUA). These APIs provide the authoritative list of insured depository institutions
          in the United States — approximately 4,500 banks and 4,800 credit unions — including
          asset size, charter type, Federal Reserve district assignment, and primary website URL.
        </p>
        <p className="mb-3">
          From this foundation, we identify the fee schedule for each institution: typically a
          PDF, HTML page, or downloadable document published on the institution&apos;s public website.
          Fee schedules are the primary source of record. We do not use estimated or third-party
          fee data — every observation in the index traces to a specific document at a specific URL,
          collected at a specific date.
        </p>
        <div className="my-4 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50/80 dark:bg-gray-800/50">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Source</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Coverage</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Update Cadence</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["FDIC API", "~4,500 insured commercial banks", "Quarterly re-seed"],
                ["NCUA API", "~4,800 credit unions", "Quarterly re-seed"],
                ["Institution websites", "Fee schedules (PDF, HTML)", "Continuous agent collection"],
                ["FRED (Federal Reserve)", "District economic indicators", "Monthly"],
                ["Fed Beige Book", "Regional economic commentary", "8x per year"],
              ].map(([source, coverage, cadence]) => (
                <tr key={source} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{source}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{coverage}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-500">{cadence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 3. Collection Process */}
        <SectionHeading id="collection" title="3. Collection Process" />
        <p className="mb-3">
          Fee schedule discovery is a two-stage process. First, we attempt deterministic URL
          discovery: checking known URL patterns common to banking websites (e.g.,
          <code className="mx-1 px-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">/fees</code>,
          <code className="mx-1 px-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">/rates-and-fees</code>),
          parsing sitemaps, and following links from the institution&apos;s homepage. This succeeds
          for the majority of institutions with well-structured websites.
        </p>
        <p className="mb-3">
          For institutions where deterministic discovery fails, Magellan records the attempted
          paths, retry window, and terminal reason in the agent run ledger so the next batch does
          not churn on the same failed sources.
        </p>
        <p className="mb-3">
          Once a fee schedule document is located, Magellan fetches the source and Rosetta
          normalizes readable HTML, text, and embedded PDF text into internal document artifacts.
          Image-only PDFs are marked for OCR instead of being hidden in the general review queue.
          Knox then extracts conservative fee observations against the tracked category schema.
        </p>

        {/* 4. Fee Categorization */}
        <SectionHeading id="categorization" title="4. Fee Categorization" />
        <p className="mb-3">
          The index organizes banking fees into {COVERAGE_STATS.categories} categories across{" "}
          {COVERAGE_STATS.families} families. The taxonomy was constructed by analyzing fee
          schedules from a representative sample of 200+ institutions and identifying the
          canonical fee types that appear across the industry.
        </p>
        <div className="my-4 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50/80 dark:bg-gray-800/50">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Tier</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Categories</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Examples</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Spotlight", "6", "Monthly maintenance, overdraft, NSF, ATM non-network, foreign transaction, outgoing wire"],
                ["Core", "9", "Stop payment, paper statement, cashier check, dormant account, returned deposit"],
                ["Extended", "15", "Notary, check cashing, research fee, garnishment processing"],
                ["Comprehensive", "19", "Specialty deposit products, institutional services"],
              ].map(([tier, count, examples]) => (
                <tr key={tier} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{tier}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{count}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-500">{examples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mb-3">
          The spotlight and core tiers (15 categories collectively) represent the fees most
          universally charged and most frequently compared by consumers and analysts. These are
          shown by default in the index. The extended and comprehensive tiers are available for
          deeper analysis.
        </p>

        {/* 5. Confidence Scoring */}
        <SectionHeading id="confidence" title="5. Confidence Scoring" />
        <p className="mb-3">
          Every extracted fee receives an extraction confidence score in the range [0.0, 1.0].
          This score reflects the model&apos;s certainty that the identified value correctly
          represents the fee as published — accounting for document clarity, context specificity,
          and the absence of ambiguities such as conditional pricing or range values.
        </p>
        <p className="mb-3">
          Observations with confidence at or above{" "}
          <span className="font-mono tabular-nums text-xs">{COVERAGE_STATS.confidenceThreshold}</span>{" "}
          are automatically staged for inclusion in the index. Approximately{" "}
          {COVERAGE_STATS.autoStageRate} of extracted fees meet this threshold. The remaining{" "}
          {COVERAGE_STATS.humanReviewRate} enter a human review queue where a trained analyst
          reviews the extraction against the source document before approving or rejecting.
        </p>
        <Callout>
          The confidence threshold is a precision-recall trade-off. At 0.85, we accept that some
          valid fees are held for human review (lower recall) in exchange for high certainty in
          the auto-staged population (high precision). For index computation purposes, staged
          and approved fees are treated equivalently.
        </Callout>

        {/* 6. Validation Process */}
        <SectionHeading id="validation" title="6. Validation Process" />
        <p className="mb-3">
          Beyond extraction confidence, the index applies three validation layers:
        </p>
        <ol className="list-decimal list-inside space-y-2 mb-3 ml-2">
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Outlier detection.</span>{" "}
            Extracted fees that deviate more than 3 standard deviations from the category median
            are flagged for human review regardless of confidence score. This catches parsing
            errors where a fee amount is plausible in isolation but anomalous in context (e.g.,
            a $500 monthly maintenance fee).
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Peer review for anomalies.</span>{" "}
            Institutions with fee schedules that produce an unusually high or low number of
            extractions relative to peers in the same asset tier are flagged for investigation.
            This catches cases where discovery found a promotional document rather than the
            standard fee schedule.
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Numeric cross-check.</span>{" "}
            All AI-generated analysis (Hamilton narrative sections, research reports) is
            validated against the source data by an automated validator that confirms every
            statistic in the output is present in the input data. No invented figures appear
            in published analysis.
          </li>
        </ol>

        {/* 7. Coverage Metrics */}
        <SectionHeading id="coverage" title="7. Coverage Metrics" />
        <p className="mb-3">
          Coverage is measured as the percentage of institutions in a geographic or demographic
          segment for which at least one fee observation exists in the index. National coverage
          stands at approximately 18% of tracked institutions, reflecting the challenge of
          fee schedule discovery at scale.
        </p>
        <p className="mb-3">
          Coverage varies significantly by state and institution type. Larger institutions with
          professionally structured websites are more discoverable. Credit unions, which
          frequently embed fee information in member documents rather than public fee schedules,
          present a structural discovery challenge.
        </p>
        <p className="mb-3">
          Index entries are assigned one of three maturity classifications based on observation
          depth:
        </p>
        <div className="my-4 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50/80 dark:bg-gray-800/50">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Maturity</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Threshold</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Strong", "10+ approved observations", "Median is statistically reliable; P25/P75 meaningful"],
                ["Provisional", "10+ total observations (staged + pending)", "Directionally correct; interpret with caution"],
                ["Insufficient", "Fewer than 10 observations", "Do not use for benchmarking decisions"],
              ].map(([maturity, threshold, interpretation]) => (
                <tr key={maturity} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{maturity}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{threshold}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-500">{interpretation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 8. Limitations */}
        <SectionHeading id="limitations" title="8. Limitations" />
        <p className="mb-3">
          Users should be aware of the following limitations before applying index data to
          business or research decisions:
        </p>
        <ul className="space-y-2 mb-4">
          {[
            ["Point-in-time snapshots", "Each observation reflects the fee schedule as of the collection date. Fee changes between collection cycles are not captured until the next scheduled run. For recently changed institutions, the index may lag by up to 90 days."],
            ["Published vs. actual fees", "This index tracks published fee schedules, not fees actually charged. Many institutions waive fees for qualifying customers, offer relationship pricing, or apply undocumented discretionary exceptions. Published fees represent the ceiling, not the average realized charge."],
            ["Collection failures", "A subset of institutions publish fee schedules in formats that resist automated extraction: scanned PDFs, image-based documents, or fee information embedded in account agreement PDFs without structured layout. These institutions are tracked but may have zero or incomplete observations."],
            ["Fee schedule obfuscation", "Some institutions do not publish fee schedules accessible to automated collection. This is more common among large national banks, which may direct customers to branch or call-center disclosures. The index may systematically underrepresent fees at the largest institutions."],
            ["Categorization ambiguity", "Not all fees map cleanly to the 49-category taxonomy. Fees with conditional pricing (e.g., \"$12 if balance below $500\") are captured at the stated amount but may not reflect the fee applicable to all customers."],
          ].map(([title, content]) => (
            <li key={title} className="flex gap-2">
              <span className="mt-0.5 text-gray-300 dark:text-gray-600 select-none">—</span>
              <span>
                <span className="font-medium text-gray-800 dark:text-gray-200">{title}.</span>{" "}
                <span className="text-gray-600 dark:text-gray-400">{content}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-600">
          <p>Bank Fee Index Methodology v1.0 — Draft (not yet published)</p>
          <p className="mt-1">This document will be published at a public URL in a future release. It is currently accessible only within the admin panel.</p>
        </div>

      </div>
    </div>
  );
}
