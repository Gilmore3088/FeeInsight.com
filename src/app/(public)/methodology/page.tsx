import type { Metadata } from "next";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { CONTACT_EMAIL, RESEARCH_IMPRINT, SITE_NAME, SITE_URL } from "@/lib/constants";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";

const METHODOLOGY_URL = `${SITE_URL}/methodology`;

const buildJsonLd = (institutions: string) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "How the Bank Fee Index works",
  description:
    `A transparent account of how Fee Insight collects, classifies, and verifies fee data across ${institutions} financial institutions.`,
  url: METHODOLOGY_URL,
  datePublished: "2026-04-06T00:00:00Z",
  author: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  },
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  },
});

export async function generateMetadata(): Promise<Metadata> {
  const summary = await getPublicStatsSummary();
  const institutions = summary.institutionsLabel;
  return {
  title: "Methodology — How the Bank Fee Index works",
  description:
    `How Fee Insight collects fee schedules from ${institutions} banks and credit unions, reads each fee, and holds anything uncertain for a person to check.`,
  alternates: {
    canonical: METHODOLOGY_URL,
  },
  openGraph: {
    title: "Methodology — How the Bank Fee Index works",
    description:
      `A transparent account of how Fee Insight collects, classifies, and verifies fee data across ${institutions} financial institutions.`,
    url: METHODOLOGY_URL,
    siteName: SITE_NAME,
    type: "article",
    publishedTime: "2026-04-06T00:00:00Z",
    authors: [SITE_NAME],
  },
  twitter: {
    card: "summary_large_image",
    title: "Methodology — How the Bank Fee Index works",
    description:
      `A transparent account of how Fee Insight collects, classifies, and verifies fee data across ${institutions} financial institutions.`,
  },
  };
}

export default async function MethodologyPage() {
  const summary = await getPublicStatsSummary();
  const institutions = summary.institutionsLabel;
  const jsonLdData = buildJsonLd(institutions);
  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdData) }}
      />
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "64px 24px 96px" }}>

        {/* Header */}
        <div style={{ borderBottom: "2px solid #132338", paddingBottom: "24px", marginBottom: "48px" }}>
          <p style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em", color: "#b23a32", fontWeight: 700, marginBottom: "12px" }}>
            Research Methodology
          </p>
          <h1 style={{ fontSize: "36px", fontWeight: 600, letterSpacing: "-0.02em", color: "#132338", marginBottom: "12px", fontFamily: "var(--fi-font-sans)", lineHeight: 1.2 }}>
            How the Bank Fee Index works
          </h1>
          <p style={{ fontSize: "16px", color: "#354252", lineHeight: 1.6, maxWidth: "600px" }}>
            A transparent account of how we collect, classify, and verify fee data across {institutions} financial institutions — and what that means for the accuracy of our benchmarks.
          </p>
          <p style={{ fontSize: "12px", color: "#55606f", marginTop: "16px" }}>
            {RESEARCH_IMPRINT} &mdash; {summary.freshnessLabel}
          </p>
        </div>

        {/* Section 1: Data Sources */}
        <Section
          label="Data Sources"
          title="We start with every regulated U.S. bank and credit union"
          body={[
            `Fee Insight draws its institution universe from two authoritative federal databases: the FDIC's BankFind Suite (which tracks every FDIC-insured bank, thrift, and savings institution) and the NCUA's Research & Data portal (which covers all federally chartered credit unions). Together, these sources provide accurate legal names, charter classifications, asset sizes, physical locations, and primary website URLs for roughly ${summary.monitoredLabel} active institutions.`,
            "We do not use purchased data lists, scraped directories, or self-reported feeds. Every institution in our index is traceable to a federal regulator record with a published institution ID. This is the foundation of our data quality commitment: our institution universe is authoritative before the first fee is collected.",
            `As of the most recent index update, ${institutions} institutions have published fees in the Bank Fee Index, across ${summary.statesLabel} states.`,
          ]}
        />

        {/* Section 2: Collection Process */}
        <Section
          label="Collection Process"
          title="Automated collection runs on a rolling calendar"
          body={[
            "Automated collection runs on a rolling calendar and stores the document, its URL and the date collected. Every fee in the index points back to that stored document, so a figure can always be checked against the schedule it came from.",
            "Finding the schedule comes first. Most institutions publish it at a predictable address (a fee schedule PDF, or a disclosures page); where they do not, we search the institution's own website. Large regional banks publish reliably; community banks and credit unions are more variable, and coverage is weakest where the schedule is not published online at all.",
            "We read HTML pages, plain-text documents and PDFs with selectable text. Scanned, image-only PDFs are set aside for separate handling rather than mixed into the general queue.",
            "Schedules are rechecked on a rolling basis. When a stored document has not changed since the last visit, its fees are carried forward rather than re-read.",
          ]}
        />

        {/* Section 3: Extraction */}
        <Section
          label="Reading the fees"
          title="Only what the document says, and a person checks the rest"
          body={[
            "From the text of each schedule we record the fee name, the amount, and the conditions attached to it — waivers, tiers, whether it is charged per item or per month.",
            "Fees the software is not sure about are held for a person to check. Only fees that are clearly stated, or that a reviewer has confirmed, appear in the public index.",
            "We do not infer or estimate fees. If an amount is not written in the document, none is recorded. This is the primary safeguard against invented fee data.",
            "Each fee is stored with its source document, the date collected and its review status, so there is a full trail from the published schedule to the index entry.",
          ]}
        />

        {/* Section 4: Categorization */}
        <Section
          label="Categorization"
          title="Standardized fee categories make institutions comparable"
          body={[
            "Raw fee names vary substantially across institutions. \"Monthly service charge,\" \"account maintenance fee,\" and \"checking maintenance\" typically refer to the same economic product. Comparison is only possible after normalization.",
            `Fee Insight maps every raw fee name to a standard category. ${summary.categoriesLabel} categories currently carry published fees, organized into fee families such as account maintenance, overdraft and NSF, wire transfers, ATM and card, check services, and account services. Each category has a canonical name and a maintained list of known aliases.`,
            "Categorization is automatic when a raw fee name matches a known alias. Names that do not match are held for a person to assign, and the alias list grows as new naming patterns appear.",
            "A small set of spotlight categories (monthly maintenance, overdraft, NSF, non-network ATM, foreign transaction, domestic outgoing wire) appears at high rates across all institution types and anchors the public index; the full list of categories is on the Bank Fee Index page.",
          ]}
        />

        {/* Section 5: Statistical Validation */}
        <Section
          label="Checks before publication"
          title="Uncertain fees are held; outliers are looked at by a person"
          body={[
            "Before any fee enters the published index, it passes two checks.",
            "First, certainty: fees the software is not sure about are held for a person to check and are excluded from public benchmarks until confirmed.",
            "Second, outliers: fees far outside the rest of their category — an ATM fee of $300 when the category median is $3.00 — are flagged and reviewed. Flagged fees are confirmed, corrected, or excluded.",
            `Every category carries a plain status based on how many institutions publish a verified fee in it. Strong: ${STRONG_INSTITUTION_COUNT} or more institutions. Provisional: ${MIN_INSTITUTIONS_FOR_MEDIAN} to ${STRONG_INSTITUTION_COUNT - 1}, benchmarked with a caution. Too few to benchmark: fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN}, shown but not used for medians. Fees still being checked are marked Under review and stay out of benchmarks.`,
          ]}
        />

        {/* Section 6: Audience (#1058) */}
        <Section
          id="audience"
          label="Personal and business fees"
          title="Personal and business fees are compared separately"
          body={[
            "Banks often charge personal and business customers different prices for the same service. Our medians, ranges and comparisons describe personal accounts unless a figure says otherwise, so each fee is labeled by who it applies to.",
            "The label comes from the bank's own schedule. A fee is labeled Business when its line names business or commercial accounts, or when the whole schedule is a business one: its web address names business, commercial, corporate or treasury accounts and no personal ones. A fee is labeled Consumer when its line names personal or consumer accounts.",
            "Many schedules never say who a fee applies to. We count those fees as personal and mark every fee and figure they contribute to with an asterisk (*). The footnote beside it reads: \u201cAudience not stated on the bank\u2019s schedule; treated as personal. Fees may differ for business or commercial accounts.\u201d The link to the bank's schedule stays beside the fee, so you can check it yourself. We are labeling these fees from the schedules we already hold, and fewer figures will carry the asterisk as we do.",
            "Business fees stay on the bank's own page, labeled Business, and never enter a personal median. Business comparisons will be published once enough institutions post business fees to compare.",
          ]}
        />

        {/* Section 7: Coverage and Limitations */}
        <Section
          label="Coverage and Limitations"
          title="What our data covers — and what it does not"
          body={[
            "The Bank Fee Index tracks published fee schedules, not actual fee revenue or transaction-level data. A published fee of $35 does not mean a given institution collected $35 for every overdraft — waiver programs, promotional rates, and negotiated terms affect realized fees. Our data reflects the fees institutions disclose.",
            "Our coverage is strongest for retail deposit account fees (maintenance, overdraft, NSF, wire, ATM) and weakest for business account fees, loan fees, and investment-account fees. Fee schedules for these product types are less consistently published in machine-readable formats.",
            "Geographic coverage is uneven: some states and Federal Reserve districts have far more institutions with published fees than others. Each state and district page shows its own institution count, and a benchmark is marked provisional or withheld when too few institutions report it.",
            "Source freshness varies by institution and schedule. Every fee carries the date its schedule was collected, so a figure can be judged by its age. A fee stays in the index until a newer copy of its schedule replaces it.",
          ]}
        />

        {/* Footer */}
        <div style={{ marginTop: "64px", paddingTop: "24px", borderTop: "1px solid #ddd5c6", fontSize: "12px", color: "#55606f" }}>
          <p>{SITE_NAME} is independently operated. Our data collection methodology is designed to comply with the terms of service of the financial institutions we monitor. We collect only publicly disclosed fee information.</p>
          <p style={{ marginTop: "8px" }}>
            Questions about our methodology:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#354252" }}>{CONTACT_EMAIL}</a>
          </p>
        </div>

      </div>
    </div>
  );
}

// Internal section component — page-local only
function Section({ id, label, title, body }: { id?: string; label: string; title: string; body: string[] }) {
  return (
    <section id={id} style={{ marginBottom: "48px", scrollMarginTop: "96px" }}>
      <p style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em", color: "#b23a32", fontWeight: 700, marginBottom: "8px" }}>
        {label}
      </p>
      <h2 style={{ fontSize: "22px", fontWeight: 600, color: "#132338", marginBottom: "16px", fontFamily: "var(--fi-font-sans)", letterSpacing: "-0.01em", lineHeight: 1.3 }}>
        {title}
      </h2>
      {body.map((paragraph, i) => (
        <p key={i} style={{ fontSize: "15px", color: "#132338", lineHeight: 1.75, marginBottom: "16px" }}>
          {paragraph}
        </p>
      ))}
    </section>
  );
}
