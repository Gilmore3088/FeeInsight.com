import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { CONTACT_EMAIL, RESEARCH_IMPRINT, SITE_NAME, SITE_URL } from "@/lib/constants";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";
import { AmbientGlow, CheckList, EYEBROW, GLASS, GLASS_SOFT, H1, INTERACTION, LEAD } from "@/components/public/site-look";

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
    `Fee Insight collects published fee schedules from ${institutions} banks and credit unions on a rolling calendar, reads the fees, and holds anything uncertain for a person to check. Learn how our data is collected, categorized, and verified.`,
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

/** Sections in page order, for the "On this page" list. */
const SECTIONS = [
  { id: "data-sources", label: "Data sources" },
  { id: "collection", label: "Collection process" },
  { id: "reading", label: "Reading the fees" },
  { id: "categorization", label: "Categorization" },
  { id: "checks", label: "Checks before publication" },
  { id: "headline-fees", label: "Representative values" },
  { id: "coverage", label: "Coverage and limitations" },
] as const;

export default async function MethodologyPage() {
  const summary = await getPublicStatsSummary();
  const institutions = summary.institutionsLabel;
  const jsonLdData = buildJsonLd(institutions);
  return (
    <div className={`relative isolate overflow-x-clip ${INTERACTION}`}>
      <AmbientGlow height={800} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdData) }}
      />
      <div className="mx-auto max-w-page px-6 pb-24 pt-16">

        {/* Header */}
        <div className="mb-12 grid items-end gap-8 xl:grid-cols-2">
          <div className="min-w-0">
          <p className={`mb-3 ${EYEBROW}`}>
            Research Methodology
          </p>
          <h1 className={`mb-4 ${H1}`}>
            How the Bank Fee Index works
          </h1>
          <p className={LEAD}>
            A transparent account of how we collect, classify, and verify fee data across {institutions} financial institutions — and what that means for the accuracy of our benchmarks.
          </p>
          <p className="mt-4 text-xs text-[#5A5347]">
            {RESEARCH_IMPRINT} &mdash; {summary.freshnessLabel}
          </p>
          </div>
          {/* The publication rules from the sections below, in one box. */}
          <aside aria-labelledby="rules-at-a-glance" className={`p-6 sm:p-7 ${GLASS}`}>
            <h2 id="rules-at-a-glance" className="text-lg font-semibold tracking-tight text-[#1A1815]">
              Publication rules at a glance
            </h2>
            <CheckList
              className="mt-4"
              items={[
                `Strong benchmark: ${STRONG_INSTITUTION_COUNT} or more institutions publish a verified fee`,
                `Provisional: ${MIN_INSTITUTIONS_FOR_MEDIAN} to ${STRONG_INSTITUTION_COUNT - 1} institutions, benchmarked with a caution`,
                `Fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN}: shown, but not used for medians`,
                "Fees still being checked stay out of benchmarks",
                "Every fee carries the date its schedule was collected",
              ]}
            />
          </aside>
        </div>

        <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 xl:gap-12">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className={`sticky top-24 p-5 ${GLASS_SOFT}`}>
              <p className={`mb-3 ${EYEBROW}`}>On this page</p>
              <ul className="space-y-1 text-sm">
                {SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="inline-flex min-h-8 items-center text-[#3D3830] underline-offset-2 transition-colors duration-200 hover:text-[#A93D25] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A93D25]"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className="min-w-0">
        {/* Section 1: Data Sources */}
        <Section
          id="data-sources"
          label="Data Sources"
          title="We start with every regulated U.S. bank and credit union"
          body={[
            `Fee Insight draws its institution universe from two authoritative federal databases: the FDIC's BankFind Suite (which tracks every FDIC-insured bank, thrift, and savings institution) and the NCUA's Research & Data portal (which covers all federally chartered credit unions). Together, these sources provide accurate legal names, charter classifications, asset sizes, physical locations, and primary website URLs for roughly ${summary.monitoredLabel} active institutions.`,
            "We do not use purchased data lists, scraped directories, or self-reported feeds. Every institution in our index is traceable to a federal regulator record with a published institution ID. This is the foundation of our data quality commitment: our institution universe is authoritative before the first fee is collected.",
            `As of the most recent index update, ${institutions} institutions have verified fee schedules in the Bank Fee Index, across ${summary.statesLabel} states. Coverage is skewed toward institutions with assets above $100 million, where fee schedules are most consistently published online. Institutions below $50 million in assets are included where fee schedules are publicly discoverable.`,
          ]}
        />

        {/* Section 2: Collection Process */}
        <Section
          id="collection"
          label="Collection Process"
          title="Automated collection runs on a rolling calendar"
          body={[
            "Automated collection runs on a rolling calendar and stores the document, its URL and the date collected. Every fee in the index points back to that stored document, so a figure can always be checked against the schedule it came from.",
            "Finding the schedule comes first. Most institutions publish it at a predictable address (a fee schedule PDF, or a disclosures page); where they do not, we search the institution's own website. Large regional banks publish reliably; community banks and credit unions are more variable, and coverage is weakest where the schedule is not published online at all.",
            "We read HTML pages, plain-text documents and PDFs with selectable text. Scanned, image-only PDFs are set aside for separate handling rather than mixed into the general queue.",
            "Institutions whose fees change often are rechecked more often. Every schedule is rechecked at least quarterly. When a stored document has not changed since the last visit, its fees are carried forward rather than re-read.",
          ]}
        />

        {/* Section 3: Extraction */}
        <Section
          id="reading"
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
          id="categorization"
          label="Categorization"
          title="Standardized fee categories make institutions comparable"
          body={[
            "Raw fee names vary substantially across institutions. \"Monthly service charge,\" \"account maintenance fee,\" and \"checking maintenance\" typically refer to the same economic product. Comparison is only possible after normalization.",
            `Fee Insight maps every raw fee name to a standard category — ${summary.categoriesLabel} categories currently carry verified data — organized into fee families such as account maintenance, overdraft and NSF, wire transfers, ATM and card, check services, and account services. Each category has a canonical name and a maintained list of known aliases.`,
            "Categorization is automatic when a raw fee name matches a known alias. Names that do not match are held for a person to assign, and the alias list grows as new naming patterns appear.",
            "A small set of spotlight categories (monthly maintenance, overdraft, NSF, non-network ATM, foreign transaction, domestic outgoing wire) appears at high rates across all institution types and anchors the public index; the full list of categories is on the Bank Fee Index page.",
          ]}
        />

        {/* Section 5: Statistical Validation */}
        <Section
          id="checks"
          label="Checks before publication"
          title="Uncertain fees are held; outliers are looked at by a person"
          body={[
            "Before any fee enters the published index, it passes two checks.",
            "First, certainty: fees the software is not sure about are held for a person to check and are excluded from public benchmarks until confirmed.",
            "Second, outliers: fees far outside the rest of their category — an ATM fee of $300 when the category median is $3.00 — are flagged and reviewed. Flagged fees are confirmed, corrected, or excluded.",
            `Every category carries a plain status based on how many institutions publish a verified fee in it. Strong: ${STRONG_INSTITUTION_COUNT} or more institutions. Provisional: ${MIN_INSTITUTIONS_FOR_MEDIAN} to ${STRONG_INSTITUTION_COUNT - 1}, benchmarked with a caution. Too few to benchmark: fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN}, shown but not used for medians. Fees still being checked are marked Under review and stay out of benchmarks.`,
          ]}
        />

        {/* Section 6: Representative values — what the code does, function by function */}
        <RepresentativeValues />

        {/* Section 7: Coverage and Limitations */}
        <Section
          id="coverage"
          label="Coverage and Limitations"
          title="What our data covers — and what it does not"
          body={[
            "The Bank Fee Index tracks published fee schedules, not actual fee revenue or transaction-level data. A published fee of $35 does not mean a given institution collected $35 for every overdraft — waiver programs, promotional rates, and negotiated terms affect realized fees. Our data reflects disclosed rates, which are the standard of comparison for regulatory purposes and consumer research.",
            "Our coverage is strongest for retail deposit account fees (maintenance, overdraft, NSF, wire, ATM) and weakest for business account fees, loan fees, and investment-account fees. Fee schedules for these product types are less consistently published in machine-readable formats.",
            "Geographic coverage is uneven: some states and Federal Reserve districts have far more institutions with published fees than others. Each state and district page shows its own institution count, and a benchmark is marked provisional or withheld when too few institutions report it.",
            "Source freshness varies by institution and schedule. Every fee carries the date its schedule was collected, so a figure can be judged by its age. A fee stays in the index until a newer copy of its schedule replaces it.",
          ]}
        />

        {/* Footer */}
        <div className="mt-12 border-t border-[#E8DFD1] pt-6 text-xs text-[#5A5347]">
          <p>{SITE_NAME} is independently operated. Our data collection methodology is designed to comply with the terms of service of the financial institutions we monitor. We collect only publicly disclosed fee information.</p>
          <p className="mt-2">
            Questions about our methodology:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#5A5347] underline underline-offset-2">{CONTACT_EMAIL}</a>
          </p>
        </div>
          </div>
        </div>

      </div>
    </div>
  );
}

/** Each section is a glass card (the /subscribe look), headings in the page font. */
const SECTION_CARD = `mb-6 scroll-mt-24 p-6 sm:p-8 [&>p:last-child]:mb-0 ${GLASS_SOFT}`;

const SECTION_LABEL = "mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]";
const SECTION_TITLE = "mb-4 text-2xl font-semibold leading-[1.25] tracking-tight text-[#1A1815]";
const PARAGRAPH = "mb-4 text-[15px] leading-[1.75] text-[#3D3830]";

// Internal section component — page-local only
function Section({ id, label, title, body }: { id: string; label: string; title: string; body: string[] }) {
  return (
    <section id={id} className={SECTION_CARD} aria-labelledby={`${id}-title`}>
      <p className={SECTION_LABEL}>{label}</p>
      <h2 id={`${id}-title`} className={SECTION_TITLE}>
        {title}
      </h2>
      {body.map((paragraph, i) => (
        <p key={i} className={PARAGRAPH}>
          {paragraph}
        </p>
      ))}
    </section>
  );
}

/** A function name and its file, so an analyst can read the rule itself. */
function CodeRef({ fn, file }: { fn: string; file: string }) {
  return (
    <p className="mt-3 text-xs leading-relaxed text-[#5A5347]">
      In the code: <code className="font-mono text-[#1A1815]">{fn}</code> in{" "}
      <code className="font-mono [overflow-wrap:anywhere]">{file}</code>
    </p>
  );
}

function RuleCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="h-full min-w-0 rounded-xl bg-white/80 px-5 py-4 ring-1 ring-[#E8E1D6]">
      <h3 className="mb-2 text-base font-semibold text-[#1A1815]">{title}</h3>
      <div className="space-y-2 text-sm leading-relaxed text-[#3D3830]">{children}</div>
    </div>
  );
}

/**
 * How several amounts for one fee become one number, stated as the code does it. Each card
 * cites its function; change the copy when the function changes.
 */
function RepresentativeValues() {
  return (
    <section id="headline-fees" className={SECTION_CARD} aria-labelledby="headline-fees-title">
      <p className={SECTION_LABEL}>Representative values</p>
      <h2 id="headline-fees-title" className={SECTION_TITLE}>
        How several published amounts become one number
      </h2>
      <p className={PARAGRAPH}>
        Many institutions publish more than one amount for the same fee: a monthly fee for each checking account,
        or an overdraft fee that changes with the amount overdrawn. Every verified amount is listed in the
        institution&apos;s fee table. Where one number has to stand for the institution, the rule depends on where
        the number appears, and the three places use different rules.
      </p>
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <RuleCard title="Institution pages: page title, search summary and Headline fees">
          <p>
            <strong className="font-semibold text-[#1A1815]">Monthly maintenance:</strong> the lowest verified amount above
            $0 among rows that are a recurring account fee (charged monthly, or named as a maintenance or service fee;
            check, card, wire, statement, research, copy and fax charges filed there are left out). It is written
            &ldquo;from&rdquo; that amount and names its account; the other accounts and their amounts are listed beside
            it and linked to their rows in the fee table. A free ($0) account stays in the table but does not set the
            headline.
          </p>
          <p>
            <strong className="font-semibold text-[#1A1815]">Overdraft:</strong> the highest verified paid-item overdraft
            amount. Rows naming a transfer, protection, line of credit, continuous, daily, sweep, extended or sustained
            charge do not count. The page&apos;s comparison with the national median uses the same row.
          </p>
          <p>
            <strong className="font-semibold text-[#1A1815]">NSF:</strong> the highest verified NSF amount.
          </p>
          <p>
            When a record does not name the account a monthly fee belongs to, the page says so and links the page the
            fee was read from, rather than guessing a name.
          </p>
          <CodeRef fn="pickHeadlineLines" file="src/app/(public)/institution/[id]/profile-data.ts" />
        </RuleCard>

        <RuleCard title="National, state and district benchmarks">
          <p>
            Each institution counts once per fee category. Its value is the median of its own verified amounts for
            that category, so an institution with monthly fees of $5, $15, $25 and $35 enters the monthly maintenance
            benchmark at $20. Overdraft is the exception: an institution enters at its highest amount, so one charging
            $5, $20 and $35 by the amount overdrawn is compared at $35.
          </p>
          <p>
            Free ($0) amounts count. Only rows traced to a stored source document count, and amounts read from a
            business-only schedule are left out. No median is shown for a category with fewer than{" "}
            {MIN_INSTITUTIONS_FOR_MEDIAN} institutions. On an institution page, each row of the fee table is compared
            with the national median on its own.
          </p>
          <CodeRef fn="valuePerInstitution, institutionValue" file="src/lib/data-store/fee-stats.ts" />
        </RuleCard>

        <RuleCard title="Competitive Fee Position Report">
          <p>
            One amount per institution and fee line. Fee caps, business prices, rows waiting on a correction review and
            rows whose name is a cut-off sentence are left out, and the monthly maintenance line compares checking, not
            savings or money market accounts.
          </p>
          <p>
            The remaining rows are ranked: an amount above $0 first; then the standard consumer version (names with
            online, mobile, internet, electronic, business, commercial and similar words rank lower); then the shorter
            fee name; then the lowest amount for monthly maintenance and the highest for every other line. The first
            ranked row that a line of the institution&apos;s own stored schedule states as the fee is used.
          </p>
          <CodeRef fn="getCustomReportMarketData" file="src/lib/data-store/custom-report-market.ts" />
          <CodeRef fn="checkFeeAgainstSource" file="src/lib/custom-report/source-check.ts" />
        </RuleCard>

        <RuleCard title="Tiers and waivers">
          <p>
            <strong className="font-semibold text-[#1A1815]">Tiers.</strong> An institution page lists each tier as its
            own row. Benchmarks take the median of an institution&apos;s amounts, or the highest for overdraft. The report
            leaves out an amount that depends on a balance band or is itself a balance threshold, and shows further
            checked amounts for the same line as tiers without comparing them.
          </p>
          <p>
            <strong className="font-semibold text-[#1A1815]">Waivers.</strong> Every figure is the fee as published, before
            any waiver. Benchmarks are not adjusted for waivers or for how many customers pay. On an institution page a
            monthly fee shows the balance that waives it, or the waiver wording, when the record stores it or the
            fee&apos;s own schedule line states it. Where neither does, no waiver is shown; that does not mean the
            institution offers none.
          </p>
          <CodeRef fn="lineupAccountFromRow" file="src/lib/data-store/account-lineup.ts" />
        </RuleCard>
      </div>
    </section>
  );
}
