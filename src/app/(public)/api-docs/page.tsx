export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "@/lib/constants";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { MONTHLY_PRICE_LABEL } from "@/app/subscribe/pricing";

const PRO_LABEL = `${SITE_NAME} Pro`;
const API_ACCESS_HREF = `mailto:${CONTACT_EMAIL}?subject=API%20access`;
const API_ACCESS_CTA = "Contact us about API access";

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    `REST API for accessing bank and credit union fee benchmarking data. JSON endpoints are available with optional manual API keys; CSV exports require a signed-in ${PRO_LABEL} seat.`,
};

/* ---------- small reusable pieces ---------- */

function Badge({ children, variant }: { children: React.ReactNode; variant: "get" | "tier" | "new" }) {
  const styles = {
    get: "bg-emerald-100 text-emerald-700",
    tier: "bg-[#E8DFD1]/60 text-[#6B6255]",
    new: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${styles[variant]}`}>
      {children}
    </span>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-12 mb-6 text-lg font-bold tracking-tight text-[#1A1815] scroll-mt-20"
      style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
    >
      {children}
    </h2>
  );
}

function ParamRow({
  name,
  type,
  required,
  description,
}: {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}) {
  return (
    <tr className="border-t border-[#E8DFD1]/60">
      <td className="py-2 pr-3 align-top">
        <code className="rounded bg-[#E8DFD1]/40 px-1.5 py-0.5 text-[12px] text-[#5A5347]">
          {name}
        </code>
        {required && (
          <span className="ml-1.5 text-[10px] font-semibold uppercase text-red-500">
            required
          </span>
        )}
      </td>
      <td className="py-2 pr-3 align-top text-[12px] text-[#6B6255]">{type}</td>
      <td className="py-2 align-top text-[13px] text-[#6B6255]">{description}</td>
    </tr>
  );
}

function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="mt-3">
      {title && (
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">
          {title}
        </p>
      )}
      <pre className="overflow-x-auto rounded-lg bg-[#1A1815] px-5 py-4 text-[12px] leading-relaxed text-[#D4C9BA]">
        {children}
      </pre>
    </div>
  );
}

function ResponseField({ name, type, note }: { name: string; type: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[13px]">
      <code className="text-[12px] text-[#5A5347]">{name}</code>
      <span className="text-[11px] text-[#6B6255]">{type}</span>
      {note && <span className="text-[#6B6255]">-- {note}</span>}
    </div>
  );
}

/* ---------- endpoint card ---------- */

function Endpoint({
  method,
  path,
  summary,
  description,
  params,
  curlExample,
  responseExample,
  responseFields,
  tierNote,
}: {
  method: string;
  path: string;
  summary: string;
  description: string;
  params: { name: string; type: string; required?: boolean; description: string }[];
  curlExample: string;
  responseExample: string;
  responseFields?: { name: string; type: string; note?: string }[];
  tierNote?: string;
}) {
  return (
    <div className="rounded-xl border border-[#E8DFD1]/80 bg-white px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="get">{method}</Badge>
        <code className="text-sm font-medium text-[#1A1815]">{path}</code>
        {tierNote && <Badge variant="tier">{tierNote}</Badge>}
      </div>
      <p className="mt-1 text-[14px] font-medium text-[#1A1815]">{summary}</p>
      <p className="mt-1 text-[13px] text-[#6B6255]">{description}</p>

      {/* Parameters */}
      {params.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">
            Parameters
          </p>
          <table className="mt-2 w-full text-left">
            <tbody>
              {params.map((p) => (
                <ParamRow key={p.name} {...p} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Try it */}
      <CodeBlock title="Try it">{curlExample}</CodeBlock>

      {/* Response */}
      {responseFields && responseFields.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">
            Response fields
          </p>
          <div className="mt-2 space-y-1">{responseFields.map((f) => <ResponseField key={f.name} {...f} />)}</div>
        </div>
      )}

      <CodeBlock title="Example response">{responseExample}</CodeBlock>
    </div>
  );
}

/* ---------- pricing tier card ---------- */

function TierCard({
  name,
  price,
  features,
  highlighted,
  cta,
  ctaHref,
}: {
  name: string;
  price: string;
  features: string[];
  highlighted?: boolean;
  cta: string;
  ctaHref?: string;
}) {
  return (
    <div
      className={`rounded-xl border px-5 py-5 ${
        highlighted
          ? "border-[#C44B2E] bg-[#C44B2E]/5"
          : "border-[#E8DFD1]/80 bg-white"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">
        {name}
      </p>
      <p className="mt-1 text-2xl font-bold text-[#1A1815]">{price}</p>
      <ul className="mt-3 space-y-1.5 text-[13px] text-[#6B6255]">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-600">&#10003;</span>
            {f}
          </li>
        ))}
      </ul>
      {ctaHref ? (
        <a href={ctaHref} className="mt-4 inline-block text-[13px] font-medium text-[#A93D25] underline underline-offset-2">
          {cta}
        </a>
      ) : (
        <p className="mt-4 text-[13px] font-medium text-[#A93D25]">{cta}</p>
      )}
    </div>
  );
}

/* ---------- page ---------- */

const BASE = `${SITE_URL}/api/v1`;

export default async function ApiDocsPage() {
  const summary = await getPublicStatsSummary();
  const categoriesLabel = summary.categoriesLabel;
  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "API Docs", href: "/api-docs" },
        ]}
      />

      {/* Hero */}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A93D25]">
        Developer
      </p>
      <h1
        className="mt-1 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-bold text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Bank Fee Index API
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#5A5347]">
        Programmatic access to fee benchmarking data for U.S. banks and credit
        unions. {categoriesLabel} fee categories, national and peer medians, percentile ranges,
        and institution-level detail — all via a simple REST API.
      </p>

      {/* Quick links */}
      <div className="mt-5 flex flex-wrap gap-3 text-[13px]">
        <a href="#authentication" className="rounded-md border border-[#E8DFD1] px-3 py-1.5 text-[#5A5347] hover:bg-[#FAF7F2] transition-colors">
          Authentication
        </a>
        <a href="#fees" className="rounded-md border border-[#E8DFD1] px-3 py-1.5 text-[#5A5347] hover:bg-[#FAF7F2] transition-colors">
          Fees
        </a>
        <a href="#index" className="rounded-md border border-[#E8DFD1] px-3 py-1.5 text-[#5A5347] hover:bg-[#FAF7F2] transition-colors">
          Index
        </a>
        <a href="#institutions" className="rounded-md border border-[#E8DFD1] px-3 py-1.5 text-[#5A5347] hover:bg-[#FAF7F2] transition-colors">
          Institutions
        </a>
        <a href="#pricing" className="rounded-md border border-[#E8DFD1] px-3 py-1.5 text-[#5A5347] hover:bg-[#FAF7F2] transition-colors">
          Pricing
        </a>
        <a
          href={`${BASE}/openapi.json`}
          className="rounded-md border border-[#C44B2E]/30 bg-[#C44B2E]/5 px-3 py-1.5 text-[#A93D25] hover:bg-[#C44B2E]/10 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAPI Spec
        </a>
      </div>

      {/* Base URL */}
      <div className="mt-6 rounded-lg border border-[#E8DFD1] bg-[#FAF7F2]/50 px-5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">
          Base URL
        </p>
        <code className="mt-1 block text-[14px] font-medium text-[#1A1815]">
          {BASE}
        </code>
      </div>

      {/* Authentication */}
      <SectionHeading id="authentication">Authentication</SectionHeading>
      <div className="rounded-xl border border-[#E8DFD1]/80 bg-white px-6 py-5">
        <p className="text-[13px] text-[#6B6255]">
          JSON endpoints can be called without credentials and are rate-limited on the free tier. If Fee Insight manually issues an API key for your workspace, pass it in the{" "}
          <code className="rounded bg-[#E8DFD1]/40 px-1 text-[12px]">Authorization</code>{" "}
          header as a Bearer token, or as an{" "}
          <code className="rounded bg-[#E8DFD1]/40 px-1 text-[12px]">api_key</code>{" "}
          query parameter.
        </p>

        <CodeBlock title="Header authentication">{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BASE}/fees`}</CodeBlock>

        <CodeBlock title="Query parameter authentication">{`curl "${BASE}/fees?api_key=YOUR_API_KEY"`}</CodeBlock>

        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50/50 px-4 py-2.5 text-[13px] text-amber-800">
          Self-serve API key creation is not exposed yet. {PRO_LABEL} users should use signed-in CSV exports from Account; managed API keys are set up by hand.{" "}
          <a href={API_ACCESS_HREF} className="font-medium underline underline-offset-2">{API_ACCESS_CTA}</a>.
        </div>
      </div>

      {/* Rate Limits */}
      <SectionHeading id="rate-limits">Rate Limits</SectionHeading>
      <div className="rounded-xl border border-[#E8DFD1]/80 bg-white px-6 py-5">
        <p className="text-[13px] text-[#6B6255]">
          Rate limits are enforced per API key when present and by anonymous request source otherwise. Current window information is returned in response headers.
        </p>
        <div className="mt-3 space-y-1.5 text-[13px]">
          <ResponseField name="X-RateLimit-Limit" type="header" note="Maximum requests in the current window" />
          <ResponseField name="X-RateLimit-Remaining" type="header" note="Requests remaining" />
          <ResponseField name="X-RateLimit-Reset" type="header" note="UTC epoch timestamp when the window resets" />
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-[#E8DFD1]/60">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-[#FAF7F2]">
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">Tier</th>
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">Monthly limit</th>
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">Burst rate</th>
              </tr>
            </thead>
            <tbody className="text-[#5A5347]">
              <tr className="border-t border-[#E8DFD1]/60">
                <td className="px-4 py-2">Free</td>
                <td className="px-4 py-2">100 requests</td>
                <td className="px-4 py-2">10/min</td>
              </tr>
              <tr className="border-t border-[#E8DFD1]/60">
                <td className="px-4 py-2 font-medium">{PRO_LABEL} key</td>
                <td className="px-4 py-2">10,000 requests</td>
                <td className="px-4 py-2">Manual setup</td>
              </tr>
              <tr className="border-t border-[#E8DFD1]/60">
                <td className="px-4 py-2">{SITE_NAME} Advisory</td>
                <td className="px-4 py-2">Custom</td>
                <td className="px-4 py-2">Custom</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- FEES ---- */}
      <SectionHeading id="fees">Fee Categories</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/fees"
          summary="List all fee categories"
          description={`Returns all ${categoriesLabel} fee categories with national median, P25/P75 percentiles, min/max, and institution counts. Free tier returns 6 spotlight categories.`}
          params={[
            {
              name: "format",
              type: "string",
              description: `"csv" for CSV download from a signed-in ${PRO_LABEL} session`,
            },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BASE}/fees`}
          responseFields={[
            { name: "total", type: "integer", note: "Number of categories returned" },
            { name: "data[]", type: "array", note: "Array of fee summary objects" },
            { name: "data[].category", type: "string", note: "Slug identifier (e.g., overdraft)" },
            { name: "data[].median", type: "number", note: "National median in USD" },
            { name: "data[].p25", type: "number", note: "25th percentile" },
            { name: "data[].p75", type: "number", note: "75th percentile" },
            { name: "data[].tier", type: "string", note: "spotlight | core | extended | comprehensive" },
          ]}
          responseExample={`{
  "total": ${summary.categories},
  "data": [
    {
      "category": "overdraft",
      "display_name": "Overdraft Fee",
      "family": "Overdraft & NSF",
      "tier": "spotlight",
      "median": 35.00,
      "p25": 30.00,
      "p75": 36.00,
      "min": 5.00,
      "max": 40.00,
      "institution_count": 842
    },
    ...
  ]
}`}
        />

        <Endpoint
          method="GET"
          path="/fees?category={slug}"
          summary="Get fee category detail"
          description="Detailed breakdown for a single fee category with segmentation by charter type, asset tier, Federal Reserve district, and state."
          tierNote="Pro"
          params={[
            {
              name: "category",
              type: "string",
              required: true,
              description: "Fee category slug (e.g., overdraft, nsf, monthly_maintenance)",
            },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/fees?category=overdraft"`}
          responseFields={[
            { name: "by_charter_type", type: "object", note: "Bank vs credit union medians" },
            { name: "by_asset_tier", type: "object", note: "Breakdowns by asset size tier" },
            { name: "by_fed_district", type: "object", note: "Medians for each Fed district (1-12)" },
            { name: "by_state", type: "object", note: "Medians by state code" },
          ]}
          responseExample={`{
  "category": "overdraft",
  "display_name": "Overdraft Fee",
  "family": "Overdraft & NSF",
  "tier": "spotlight",
  "summary": {
    "institution_count": 842,
    "observation_count": 1156
  },
  "by_charter_type": {
    "bank": { "median": 36.00, "p25": 33.00, "p75": 36.00, "count": 510 },
    "credit_union": { "median": 30.00, "p25": 25.00, "p75": 35.00, "count": 332 }
  },
  "by_asset_tier": { ... },
  "by_fed_district": { ... },
  "by_state": { ... }
}`}
        />
      </div>

      {/* ---- INDEX ---- */}
      <SectionHeading id="index">Fee Index</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/index"
          summary="National and peer fee index"
          description="Returns the fee index for all categories. Apply filters for peer group benchmarking by state, charter type, or Federal Reserve district. Includes maturity indicators and bank/credit union counts."
          params={[
            {
              name: "state",
              type: "string",
              description: "Two-letter state code (e.g., CA, TX)",
            },
            {
              name: "charter",
              type: "string",
              description: '"bank" or "credit_union"',
            },
            {
              name: "district",
              type: "string",
              description: "Fed district number(s), comma-separated (e.g., 7 or 2,7,12)",
            },
            {
              name: "format",
              type: "string",
              description: `"csv" for CSV download from a signed-in ${PRO_LABEL} session`,
            },
          ]}
          curlExample={`# National index
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BASE}/index

# California credit unions
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/index?state=CA&charter=credit_union"

# Fed District 7, JSON response
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/index?district=7"`}
          responseFields={[
            { name: "scope", type: "string", note: '"national" or "filtered"' },
            { name: "filters", type: "object", note: "Applied filter values (null if unused)" },
            { name: "data[].maturity", type: "string", note: "strong | provisional | insufficient" },
            { name: "data[].bank_count", type: "integer", note: "Number of banks in sample" },
            { name: "data[].cu_count", type: "integer", note: "Number of credit unions in sample" },
          ]}
          responseExample={`{
  "scope": "filtered",
  "filters": {
    "state": "CA",
    "charter": "credit_union",
    "district": null
  },
  "total": 42,
  "data": [
    {
      "category": "monthly_maintenance",
      "display_name": "Monthly Maintenance Fee",
      "family": "Account Maintenance",
      "tier": "spotlight",
      "median": 10.00,
      "p25": 5.00,
      "p75": 12.00,
      "min": 0.00,
      "max": 25.00,
      "institution_count": 189,
      "bank_count": 0,
      "cu_count": 189,
      "maturity": "strong"
    },
    ...
  ]
}`}
        />
      </div>

      {/* ---- INSTITUTIONS ---- */}
      <SectionHeading id="institutions">Institutions</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/institutions"
          summary="List institutions"
          description="Paginated list of financial institutions with fee data. Filter by state and charter type. Returns summary data including fee count, asset size, and Fed district."
          params={[
            { name: "state", type: "string", description: "Two-letter state code" },
            { name: "charter", type: "string", description: '"bank" or "credit_union"' },
            { name: "page", type: "integer", description: "Page number (default: 1)" },
            { name: "limit", type: "integer", description: "Results per page (default: 50, max: 200)" },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/institutions?state=NY&limit=10"`}
          responseFields={[
            { name: "total", type: "integer", note: "Total matching institutions" },
            { name: "page", type: "integer", note: "Current page" },
            { name: "pages", type: "integer", note: "Total pages" },
            { name: "data[].asset_tier", type: "string", note: "e.g., 1B-10B, 100M-1B" },
          ]}
          responseExample={`{
  "total": 312,
  "page": 1,
  "page_size": 10,
  "pages": 32,
  "data": [
    {
      "id": 4521,
      "name": "First National Bank of New York",
      "state": "NY",
      "city": "New York",
      "charter_type": "bank",
      "asset_size": 2400000000,
      "asset_tier": "1B-10B",
      "fed_district": 2,
      "fee_count": 22
    },
    ...
  ]
}`}
        />

        <Endpoint
          method="GET"
          path="/institutions?id={id}"
          summary="Get institution detail"
          description="Returns a single institution profile with all extracted fees, including amounts, frequency, conditions, and review status."
          tierNote="Pro"
          params={[
            { name: "id", type: "integer", required: true, description: "Institution ID" },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/institutions?id=4521"`}
          responseFields={[
            { name: "fees[]", type: "array", note: "All non-rejected fees for this institution" },
            { name: "fees[].amount", type: "number", note: "Fee amount in USD" },
            { name: "fees[].frequency", type: "string", note: 'e.g., "per item", "monthly"' },
            { name: "fees[].conditions", type: "string", note: "Waiver conditions, if any" },
          ]}
          responseExample={`{
  "id": 4521,
  "name": "First National Bank of New York",
  "state": "NY",
  "city": "New York",
  "charter_type": "bank",
  "asset_size": 2400000000,
  "asset_tier": "1B-10B",
  "fed_district": 2,
  "fee_count": 22,
  "fees": [
    {
      "fee_name": "Overdraft Fee",
      "amount": 35.00,
      "frequency": "per item",
      "conditions": "Max 4 per day. Waived for balances over $5,000.",
      "review_status": "approved"
    },
    {
      "fee_name": "Monthly Maintenance Fee",
      "amount": 12.00,
      "frequency": "monthly",
      "conditions": "Waived with $1,500 minimum balance.",
      "review_status": "approved"
    },
    ...
  ]
}`}
        />
      </div>

      {/* ---- PRICING ---- */}
      <SectionHeading id="pricing">API Pricing</SectionHeading>

      <div className="grid gap-4 sm:grid-cols-3">
        <TierCard
          name="Free"
          price="$0"
          features={[
            "100 requests/month",
            "6 spotlight categories",
            "National medians only",
            "JSON responses",
          ]}
          cta="Get started -- no card required"
        />
        <TierCard
          name={PRO_LABEL}
          price={`${MONTHLY_PRICE_LABEL}/mo per seat`}
          highlighted
          features={[
            `Signed-in ${PRO_LABEL} exports`,
            `All ${categoriesLabel} fee categories`,
            "Peer group filtering",
            "Category detail breakdowns",
            "Institution-level data",
            "Managed API key setup by request",
          ]}
          cta={API_ACCESS_CTA}
          ctaHref={API_ACCESS_HREF}
        />
        <TierCard
          name={`${SITE_NAME} Advisory`}
          price="Custom"
          features={[
            "Unlimited requests",
            "Full dataset access",
            "Bulk data export",
            "Historical data",
            "Dedicated support",
            "Custom SLA",
          ]}
          cta="Talk to us"
          ctaHref={`mailto:${CONTACT_EMAIL}?subject=Fee%20Insight%20Advisory`}
        />
      </div>

      {/* ---- DATA NOTES ---- */}
      <SectionHeading id="data-notes">Data Notes</SectionHeading>
      <div className="rounded-xl border border-[#E8DFD1] bg-[#FAF7F2]/50 px-6 py-5">
        <ul className="space-y-2 text-[13px] text-[#6B6255]">
          <li>
            <span className="font-medium text-[#5A5347]">Currency.</span>{" "}
            All monetary amounts are in USD.
          </li>
          <li>
            <span className="font-medium text-[#5A5347]">Methodology.</span>{" "}
            Medians, percentiles, and ranges are computed from non-rejected fee observations only.
          </li>
          <li>
            <span className="font-medium text-[#5A5347]">Sources.</span>{" "}
            Institution data is sourced from FDIC (banks) and NCUA (credit unions) registries.
            Fee data is read from published fee schedules; fees the software is not sure about
            are held for a person to check.
          </li>
          <li>
            <span className="font-medium text-[#5A5347]">Status.</span>{" "}
            Each category carries a status: Verified (10+ checked fees), Under review, or Too few to benchmark.
          </li>
          <li>
            <span className="font-medium text-[#5A5347]">Tier system.</span>{" "}
            Categories are organized into 4 tiers: spotlight, core, extended, and comprehensive.
            The Free API tier returns only spotlight categories.
          </li>
          <li>
            <span className="font-medium text-[#5A5347]">Coverage.</span>{" "}
            The dataset covers {summary.institutionsLabel} institutions with verified fees and is
            refreshed on a rolling calendar. {summary.freshnessLabel}.
          </li>
        </ul>
      </div>

      {/* OpenAPI link */}
      <div className="mt-8 rounded-xl border border-[#E8DFD1] bg-white px-6 py-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">
          Machine-readable specification
        </p>
        <p className="mt-2 text-[14px] text-[#5A5347]">
          Import our OpenAPI 3.0 spec into Postman, Swagger UI, or your code generator of choice.
        </p>
        <a
          href={`${BASE}/openapi.json`}
          className="mt-3 inline-block rounded-lg border border-[#C44B2E]/30 bg-[#C44B2E]/5 px-5 py-2 text-[13px] font-medium text-[#A93D25] hover:bg-[#C44B2E]/10 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          Download OpenAPI Spec (JSON)
        </a>
      </div>
    </div>
  );
}
