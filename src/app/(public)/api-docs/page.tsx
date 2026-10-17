export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/constants";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";
import { API_MONTHLY_CALLS_LABEL, API_PLANS_LABEL, BURST_CALLS_PER_MINUTE } from "@/lib/api-subscriber-access";
import { PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { NON_INSTITUTION_TIER, tierAmountLabel, tierPriceLabel } from "@/lib/pro-tiers";
import { PAGE_HEADER } from "@/components/public/page-header";
import { MAX_CHOSEN_PEERS, PEER_GROUP_PARAMS } from "@/lib/peer-set-dimensions";

const PRO_LABEL = "Hamilton";

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    `REST API and Claude connector for bank and credit union fee data. Included with the ${API_PLANS_LABEL} of Hamilton: make your key on your account page.`,
};

/* ---------- small reusable pieces ---------- */

function Badge({ children, variant }: { children: React.ReactNode; variant: "get" | "tier" | "new" }) {
  const styles = {
    get: "bg-emerald-100 text-emerald-700",
    tier: "bg-border/60 text-ink-muted",
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
      className="mt-12 mb-6 text-lg font-bold tracking-tight text-ink scroll-mt-20"
      style={{ fontFamily: "var(--fi-font-sans)" }}
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
    <tr className="border-t border-border/60">
      <td className="py-2 pr-3 align-top">
        <code className="rounded bg-border/40 px-1.5 py-0.5 text-[12px] text-ink-soft">
          {name}
        </code>
        {required && (
          <span className="ml-1.5 text-[10px] font-semibold uppercase text-red-500">
            required
          </span>
        )}
      </td>
      <td className="py-2 pr-3 align-top text-[12px] text-ink-muted">{type}</td>
      <td className="py-2 align-top text-[13px] text-ink-muted">{description}</td>
    </tr>
  );
}

function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="mt-3">
      {title && (
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          {title}
        </p>
      )}
      <pre className="overflow-x-auto rounded-lg bg-ink px-5 py-4 text-[12px] leading-relaxed text-border">
        {children}
      </pre>
    </div>
  );
}

function ResponseField({ name, type, note }: { name: string; type: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[13px]">
      <code className="text-[12px] text-ink-soft">{name}</code>
      <span className="text-[11px] text-ink-muted">{type}</span>
      {note && <span className="text-ink-muted">-- {note}</span>}
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
    <div className="rounded-xl border border-border/80 bg-white px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="get">{method}</Badge>
        <code className="text-sm font-medium text-ink">{path}</code>
        {tierNote && <Badge variant="tier">{tierNote}</Badge>}
      </div>
      <p className="mt-1 text-[14px] font-medium text-ink">{summary}</p>
      <p className="mt-1 text-[13px] text-ink-muted">{description}</p>

      {/* Parameters */}
      {params.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Response fields
          </p>
          <div className="mt-2 space-y-1">{responseFields.map((f) => <ResponseField key={f.name} {...f} />)}</div>
        </div>
      )}

      <CodeBlock title="Example response · illustrative values, not live data">{responseExample}</CodeBlock>
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
          ? "border-brick bg-brick/5"
          : "border-border/80 bg-white"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {name}
      </p>
      <p className="mt-1 text-2xl font-bold text-ink">{price}</p>
      <ul className="mt-3 space-y-1.5 text-[13px] text-ink-muted">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-600">&#10003;</span>
            {f}
          </li>
        ))}
      </ul>
      {ctaHref ? (
        <a href={ctaHref} className="mt-4 inline-block text-[13px] font-medium text-brick underline underline-offset-2">
          {cta}
        </a>
      ) : (
        <p className="mt-4 text-[13px] font-medium text-brick">{cta}</p>
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
      <header className={PAGE_HEADER}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-brick">
        Developer
      </p>
      <h1
        className="mt-1 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] font-extrabold text-ink"
        style={{ fontFamily: "var(--fi-font-sans)" }}
      >
        Bank Fee Index API
      </h1>
      <p className="mx-auto mt-3 max-w-[34rem] text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:max-w-2xl">
        Published fees for U.S. banks and credit unions, from national and district medians down to
        one institution, with call-report fee revenue and branch locations. Use it in your own code,
        in Excel, or by asking Claude. {categoriesLabel} fee categories.
      </p>
      </header>

      {/* Access first: which plans include a key, and where to make it. */}
      <section aria-labelledby="getting-access" className="mt-6 rounded-xl border border-border bg-white px-6 py-5">
        <h2
          id="getting-access"
          className="text-[15px] font-bold text-ink"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          Getting access
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-ink-soft">
          <li>
            <span className="font-semibold text-ink">Subscribe to {PRO_LABEL} on the {API_PLANS_LABEL}.</span>{" "}
            Consultants pay the {tierAmountLabel(NON_INSTITUTION_TIER, "monthly")} price, so their plan includes it too.{" "}
            <Link href="/subscribe" className="font-medium text-brick underline underline-offset-2">
              {PRO_PLANS_NAV.label}
            </Link>
          </li>
          <li>
            <span className="font-semibold text-ink">Make your key on your account page.</span>{" "}
            Everyone on the plan, up to {WORKSPACE_SEAT_LIMIT} people, makes their own key. It shows once,
            with a Claude connector link, and you can replace it or turn it off there.
          </li>
          <li>
            <span className="font-semibold text-ink">Call any endpoint below,</span> or add the
            connector to Claude and ask in plain English. Your team shares {API_MONTHLY_CALLS_LABEL} calls a month.
          </li>
        </ol>
        <p className="mt-3 text-[12px] text-ink-muted">
          Example responses on this page show the real field names and shapes with illustrative
          numbers. For today&apos;s figures, see the{" "}
          <Link href="/fees" className="font-medium text-brick underline underline-offset-2">
            Fee Index
          </Link>
          . {summary.freshnessLabel}.
        </p>
      </section>

      {/* Quick links */}
      <div className="mt-5 flex flex-wrap gap-3 text-[13px]">
        <a href="#authentication" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Authentication
        </a>
        <a href="#claude" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Claude connector
        </a>
        <a href="#fees" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Fees
        </a>
        <a href="#index" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Index
        </a>
        <a href="#institutions" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Institutions
        </a>
        <a href="#peers" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Peers
        </a>
        <a href="#rate-fees" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Rate fees
        </a>
        <a href="#pricing" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Pricing
        </a>
        <a
          href={`${BASE}/openapi.json`}
          className="rounded-md border border-brick/30 bg-brick/5 px-3 py-1.5 text-brick hover:bg-brick/10 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAPI Spec
        </a>
      </div>

      {/* Base URL */}
      <div className="mt-6 rounded-lg border border-border bg-paper/50 px-5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Base URL
        </p>
        <code className="mt-1 block text-[14px] font-medium text-ink">
          {BASE}
        </code>
      </div>

      {/* Authentication */}
      <SectionHeading id="authentication">Authentication</SectionHeading>
      <div className="rounded-xl border border-border/80 bg-white px-6 py-5">
        <p className="text-[13px] text-ink-muted">
          Every request needs an API key. Everyone on the {API_PLANS_LABEL} makes their own on the{" "}
          <Link href="/account" className="font-medium text-brick underline underline-offset-2">account page</Link>. Pass yours in the{" "}
          <code className="rounded bg-border/40 px-1 text-[12px]">Authorization</code>{" "}
          header as a Bearer token, or as an{" "}
          <code className="rounded bg-border/40 px-1 text-[12px]">api_key</code>{" "}
          query parameter.
        </p>

        <CodeBlock title="Header authentication">{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BASE}/fees`}</CodeBlock>

        <CodeBlock title="Query parameter authentication">{`curl "${BASE}/fees?api_key=YOUR_API_KEY"`}</CodeBlock>

        <p className="mt-4 text-[13px] text-ink-muted">
          A key keeps working while your subscription is active, and for {PAST_DUE_GRACE_DAYS} days after a failed payment
          while the card is retried. It stops when the subscription ends. Keep it private.
          Anyone who has it can use your monthly calls.
        </p>
      </div>

      {/* Claude connector */}
      <SectionHeading id="claude">Claude connector</SectionHeading>
      <div className="rounded-xl border border-border/80 bg-white px-6 py-5">
        <p className="text-[13px] text-ink-muted">
          Add the connector once and ask Claude in plain English, for example which banks in Ohio have
          the highest overdraft fee, or how banks and credit unions in Texas compare. To add it, open
          Settings in Claude, then Connectors, add a custom connector and paste this link with your key.
        </p>
        <CodeBlock title="Connector link">{`${BASE}/mcp?api_key=YOUR_API_KEY`}</CodeBlock>
        <p className="mt-3 text-[13px] text-ink-muted">
          Each question Claude answers uses a few calls from your team&apos;s {API_MONTHLY_CALLS_LABEL}-a-month allowance.
        </p>
      </div>

      {/* Rate Limits */}
      <SectionHeading id="rate-limits">Rate Limits</SectionHeading>
      <div className="rounded-xl border border-border/80 bg-white px-6 py-5">
        <p className="text-[13px] text-ink-muted">
          Each plan gets one monthly allowance, shared by every key on it and across all endpoints. When it runs out, calls return 429 rate_limited until the allowance resets on the 1st of the next month (UTC). Each plan can also make up to {BURST_CALLS_PER_MINUTE} calls a minute, and calls past that return 429 burst_limited with a Retry-After header giving the seconds to wait. Unlimited keys get no X-RateLimit-Limit or X-RateLimit-Remaining headers. Errors return JSON with an error message and a stable code such as invalid_parameter, plan_required or rate_limited.
        </p>
        <div className="mt-3 space-y-1.5 text-[13px]">
          <ResponseField name="X-RateLimit-Limit" type="header" note="Maximum requests in the current window" />
          <ResponseField name="X-RateLimit-Remaining" type="header" note="Requests remaining" />
          <ResponseField name="X-RateLimit-Reset" type="header" note="ISO 8601 UTC time when the monthly window resets" />
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-border/60">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-paper">
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Tier</th>
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Monthly limit</th>
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">How to get it</th>
              </tr>
            </thead>
            <tbody className="text-ink-soft">
              <tr className="border-t border-border/60">
                <td className="px-4 py-2 font-medium">{PRO_LABEL} key</td>
                <td className="px-4 py-2">{API_MONTHLY_CALLS_LABEL} requests</td>
                <td className="px-4 py-2">Account page, {API_PLANS_LABEL}</td>
              </tr>
              <tr className="border-t border-border/60">
                <td className="px-4 py-2">Data licensing</td>
                <td className="px-4 py-2">Custom</td>
                <td className="px-4 py-2">Talk to us</td>
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
          description={`Returns all ${categoriesLabel} fee categories with national median, P25/P75 percentiles, min/max, and institution counts.`}
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
            {
              name: "data[].unstated_audience_institution_count",
              type: "integer",
              note: "Institutions in the sample with at least one fee whose schedule doesn't say whether it's personal or business; those fees count as personal. It counts every institution, while institution_count counts institutions that share one fee schedule once, so the two are not a ratio.",
            },
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
      "maturity": "strong",
      "unstated_audience_institution_count": 184
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
            { name: "has_fees", type: "boolean", description: '"true" to return only institutions with published fees' },
            { name: "page", type: "integer", description: "Page number (default: 1)" },
            { name: "limit", type: "integer", description: "Results per page (default: 50, max: 200)" },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/institutions?state=MN&has_fees=true&limit=10"`}
          responseFields={[
            { name: "total", type: "integer", note: "Total matching institutions" },
            { name: "page", type: "integer", note: "Current page" },
            { name: "pages", type: "integer", note: "Total pages" },
            { name: "data[].asset_tier", type: "string", note: "e.g., community_mid" },
          ]}
          responseExample={`{
  "total": 44,
  "page": 1,
  "page_size": 10,
  "pages": 5,
  "data": [
    {
      "id": 2466,
      "name": "Gateway Bank",
      "state": "MN",
      "city": "Mendota Heights",
      "charter_type": "bank",
      "asset_size": 319549,
      "asset_tier": "community_mid",
      "fed_district": 9,
      "fee_count": 33
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
            {
              name: "updated_since",
              type: "string",
              description: "An ISO 8601 date or time, such as 2026-10-01 or 2026-10-01T00:00:00Z. Only fees published on or after it are returned.",
            },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/institutions?id=2466"`}
          responseFields={[
            { name: "fees[]", type: "array", note: "All non-rejected fees for this institution" },
            {
              name: "fees[].fee_name",
              type: "string",
              note: 'The fee\'s name as the bank\'s schedule words it, made complete where the row leaves its heading out ("3 X 10" shows as "Safe Deposit Box 3 X 10"). When that name was cut off mid-line, the fee category\'s name stands in.',
            },
            {
              name: "fees[].name_is_category_fallback",
              type: "boolean",
              note: "true when fee_name is the category's name standing in for a cut-off name; false when it is the schedule's own name, or that name made complete",
            },
            { name: "fees[].amount", type: "number", note: "Fee amount in USD" },
            { name: "fees[].frequency", type: "string", note: 'e.g., "per item", "monthly"' },
            { name: "fees[].conditions", type: "string", note: "Waiver conditions, if any" },
            {
              name: "rate_fees[]",
              type: "array",
              note: "Fees stated as a rate of the transaction or balance. Listed apart from fees[] and never included in dollar figures",
            },
            { name: "rate_fees[].fee_name", type: "string", note: "Named the same way as fees[].fee_name" },
            { name: "rate_fees[].name_is_category_fallback", type: "boolean", note: "Same meaning as on fees[]" },
            { name: "rate_fees[].rate_percent", type: "number", note: "The rate in percent, e.g. 3 for 3%" },
            { name: "rate_fees[].rate_min_amount", type: "number", note: "Dollar floor, when the schedule states one" },
            { name: "rate_fees[].rate_max_amount", type: "number", note: "Dollar cap, when the schedule states one" },
            { name: "rate_fees[].rate_basis", type: "string", note: 'What the rate applies to, e.g. "transaction"' },
            { name: "rate_fees[].rate_terms", type: "string", note: 'The rate in words, e.g. "3% of the transaction"' },
          ]}
          responseExample={`{
  "id": 2466,
  "name": "Gateway Bank",
  "state": "MN",
  "city": "Mendota Heights",
  "charter_type": "bank",
  "asset_size": 319549,
  "asset_tier": "community_mid",
  "fed_district": 9,
  "fee_count": 33,
  "fees": [
    {
      "fee_name": "Overdraft Fee",
      "name_is_category_fallback": false,
      "amount": 30.00,
      "frequency": "per_occurrence",
      "conditions": "Per item; created by check, in-person withdrawal, or other electronic means",
      "review_status": "approved"
    },
    {
      "fee_name": "Account Maintenance",
      "name_is_category_fallback": false,
      "amount": 17.00,
      "frequency": "monthly",
      "conditions": null,
      "review_status": "approved"
    },
    ...
  ]
}`}
        />
      </div>

      <div className="mt-6 space-y-6">
        <Endpoint
          method="GET"
          path="/institutions?view=fees"
          summary="Published fee rows, filtered by publish date"
          description="Every published dollar fee as its own row, oldest first by publish date, then by fee_id. To keep your own copy current, save the newest published_at you hold and ask again with updated_since set to it. Rows published at exactly that time come back again, so match them on fee_id. A fee that is taken down drops out of the list and is not reported as a change, so pull the full list without updated_since from time to time to catch removals."
          tierNote="Pro"
          params={[
            { name: "view", type: "string", required: true, description: '"fees"' },
            { name: "updated_since", type: "string", description: "An ISO 8601 date or time, such as 2026-10-01 or 2026-10-01T00:00:00Z. Only fees published on or after it are returned." },
            { name: "id", type: "integer", description: "One institution's fees" },
            { name: "state", type: "string", description: "Two-letter state code" },
            { name: "charter", type: "string", description: '"bank" or "credit_union"' },
            { name: "page", type: "integer", description: "Page number (default: 1)" },
            { name: "limit", type: "integer", description: "Results per page (default: 50, max: 200)" },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/institutions?view=fees&updated_since=2026-10-01&limit=200"`}
          responseFields={[
            { name: "data[].fee_id", type: "integer", note: "Stable id of the published fee" },
            { name: "data[].amount", type: "number", note: "Fee amount in USD" },
            { name: "data[].published_at", type: "string", note: "When the fee was published" },
          ]}
          responseExample={`{
  "view": "fees",
  "updated_since": "2026-10-01T00:00:00.000Z",
  "total": 2,
  "page": 1,
  "page_size": 200,
  "pages": 1,
  "has_more": false,
  "data": [
    {
      "fee_id": 501,
      "institution_id": 2466,
      "institution_name": "Gateway Bank",
      "state": "MN",
      "charter_type": "bank",
      "fee_name": "Overdraft Fee",
      "name_is_category_fallback": false,
      "category": "overdraft",
      "amount": 30.00,
      "frequency": "per_occurrence",
      "conditions": null,
      "source_url": "https://example.com/fee-schedule.pdf",
      "published_at": "2026-10-02T14:05:00.000Z"
    },
    ...
  ]
}`}
        />
      </div>

      {/* ---- PEERS ---- */}
      <SectionHeading id="peers">Peer Comparison</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/peers?institution_id={id}"
          summary="Compare one institution's fees with its peers"
          description={`For each fee the institution publishes in dollars, shows its amount next to the peer median and the 25th and 75th percentiles. The percentile field is the share of peers with a lower amount, counting half of those with the same amount. By default, peers are banks or credit unions of the same charter type, asset size and Fed district. To choose them yourself, either set the peer-group parameters below or list institutions in peer_ids, not both. When you set any peer-group parameter, only the ones you set apply, and "same" means the institution's own value. When fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN} peers publish a fee, the median and percentiles are left out. Fees stated as a percentage are listed separately and not compared.`}
          tierNote="Pro"
          params={[
            { name: "institution_id", type: "integer", required: true, description: "Institution ID" },
            { name: "peer_ids", type: "string", description: `Up to ${MAX_CHOSEN_PEERS} institution IDs, comma-separated, to use as the peer group. Not combined with the parameters below` },
            ...PEER_GROUP_PARAMS.map((p) => ({ name: p.name, type: "string", description: `${p.description}, e.g. ${p.example}` })),
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/peers?institution_id=2466"

# Banks with branches in the same metro, $500M to $2B in assets
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/peers?institution_id=2466&charter=bank&market=same&asset_min=500000000&asset_max=2000000000"`}
          responseFields={[
            { name: "peer_group.label", type: "string", note: "Which institutions were compared" },
            { name: "categories[].amount", type: "number", note: "The institution's amount in USD" },
            { name: "categories[].peer_median", type: "number", note: "Median among peers that publish the fee" },
            { name: "categories[].peer_count", type: "integer", note: "Peers that publish the fee" },
            { name: "categories[].percentile", type: "integer", note: "0 to 100, the share of peers with a lower amount" },
            { name: "rate_fees[]", type: "array", note: "Fees stated as a percentage, listed apart" },
          ]}
          responseExample={`{
  "institution": { "id": 2466, "name": "Gateway Bank", "state": "MN", "charter_type": "bank", "asset_tier": "community_mid", "fed_district": 9 },
  "peer_group": {
    "basis": "default",
    "label": "Banks with $300M to $1B in assets in the Minneapolis Fed district",
    "peers_with_fees": 41
  },
  "min_peers": ${MIN_INSTITUTIONS_FOR_MEDIAN},
  "categories": [
    {
      "category": "overdraft",
      "display_name": "Overdraft (OD)",
      "amount": 30.00,
      "peer_count": 38,
      "peer_median": 30.00,
      "peer_p25": 27.00,
      "peer_p75": 32.00,
      "peers_lower": 12,
      "peers_same": 9,
      "peers_higher": 17,
      "percentile": 43,
      "maturity_tier": "strong"
    },
    ...
  ],
  "rate_fees": []
}`}
        />
      </div>

      {/* ---- RATE FEES ---- */}
      <SectionHeading id="rate-fees">Rate Fees</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/rate-fees"
          summary="Fees stated as a percentage"
          description="Some fees are a percentage rather than a flat amount, such as a foreign transaction fee charged as a share of the purchase. This endpoint lists them with the rate, any dollar minimum or maximum the schedule states, and the link to the schedule. They are kept apart from dollar fees and never included in dollar medians."
          tierNote="Pro"
          params={[
            { name: "institution_id", type: "integer", description: "One institution's rate fees" },
            { name: "state", type: "string", description: "Two-letter state code" },
            { name: "category", type: "string", description: "Fee category key, such as card_foreign_txn" },
            { name: "charter", type: "string", description: '"bank" or "credit_union"' },
            { name: "updated_since", type: "string", description: "An ISO 8601 date or time, such as 2026-10-01 or 2026-10-01T00:00:00Z. Only fees published on or after it are returned." },
            { name: "page", type: "integer", description: "Page number (default: 1)" },
            { name: "limit", type: "integer", description: "Results per page (default: 100, max: 500)" },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/rate-fees?state=MN&category=card_foreign_txn"`}
          responseFields={[
            { name: "data[].rate_percent", type: "number", note: "The rate in percent, e.g. 3 for 3%" },
            { name: "data[].rate_min_amount", type: "number", note: "Dollar minimum, when the schedule states one" },
            { name: "data[].rate_max_amount", type: "number", note: "Dollar maximum, when the schedule states one" },
            { name: "data[].rate_terms", type: "string", note: 'The rate in words, e.g. "3% of the transaction"' },
          ]}
          responseExample={`{
  "total": 1,
  "page": 1,
  "page_size": 100,
  "pages": 1,
  "has_more": false,
  "data": [
    {
      "id": 9001,
      "institution_id": 2466,
      "institution_name": "Gateway Bank",
      "state": "MN",
      "charter_type": "bank",
      "fee_name": "Foreign Transaction Fee",
      "category": "card_foreign_txn",
      "rate_percent": 3,
      "rate_min_amount": null,
      "rate_max_amount": null,
      "rate_basis": "transaction",
      "rate_terms": "3% of the transaction",
      "source_url": "https://example.com/fee-schedule.pdf",
      "published_at": "2026-10-02T14:05:00.000Z"
    }
  ]
}`}
        />
      </div>

      {/* ---- PRICING ---- */}
      <SectionHeading id="pricing">API Pricing</SectionHeading>

      <div className="grid gap-4 sm:grid-cols-2">
        <TierCard
          name={PRO_LABEL}
          price={`${tierPriceLabel("mid", "monthly")} and up`}
          highlighted
          features={[
            "Your own API key, made on your account page",
            "Claude connector",
            `${API_MONTHLY_CALLS_LABEL} calls a month`,
            `All ${categoriesLabel} fee categories`,
            "Institution-level fees, peer comparison, fee revenue and branches",
            "CSV output for Excel",
          ]}
          cta={PRO_PLANS_NAV.label}
          ctaHref={PRO_PLANS_NAV.href}
        />
        <TierCard
          name="Data licensing"
          price="Custom"
          features={[
            "The full dataset as files",
            "Rights to load it into your own systems",
          ]}
          cta="Talk to us"
          ctaHref={`mailto:${CONTACT_EMAIL}?subject=Data%20licensing`}
        />
      </div>

      {/* ---- DATA NOTES ---- */}
      <SectionHeading id="data-notes">Data Notes</SectionHeading>
      <div className="rounded-xl border border-border bg-paper/50 px-6 py-5">
        <ul className="space-y-2 text-[13px] text-ink-muted">
          <li>
            <span className="font-medium text-ink-soft">Currency.</span>{" "}
            All monetary amounts are in USD.
          </li>
          <li>
            <span className="font-medium text-ink-soft">Methodology.</span>{" "}
            Medians, percentiles, and ranges are computed from non-rejected fee observations only.
          </li>
          <li>
            <span className="font-medium text-ink-soft">Sources.</span>{" "}
            Institution data is sourced from FDIC (banks) and NCUA (credit unions) registries.
            Fee data is read from published fee schedules; fees the software is not sure about
            are held for a person to check.
          </li>
          <li>
            <span className="font-medium text-ink-soft">Status.</span>{" "}
            Each category carries a status: Strong ({STRONG_INSTITUTION_COUNT}+ institutions with published fees), Provisional ({MIN_INSTITUTIONS_FOR_MEDIAN} to {STRONG_INSTITUTION_COUNT - 1}), or Too few to benchmark (under {MIN_INSTITUTIONS_FOR_MEDIAN}, no median shown).
          </li>
          <li>
            <span className="font-medium text-ink-soft">Tier system.</span>{" "}
            Categories are organized into 4 tiers: spotlight, core, extended, and comprehensive.
          </li>
          <li>
            <span className="font-medium text-ink-soft">Coverage.</span>{" "}
            The dataset covers {summary.institutionsLabel} institutions with published fees (of{" "}
            {summary.monitoredLabel} monitored) and is
            refreshed on a rolling calendar. {summary.freshnessLabel}.
          </li>
        </ul>
      </div>

      {/* OpenAPI link */}
      <div className="mt-8 rounded-xl border border-border bg-white px-6 py-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Machine-readable specification
        </p>
        <p className="mt-2 text-[14px] text-ink-soft">
          Import our OpenAPI 3.0 spec into Postman, Swagger UI, or your code generator of choice.
        </p>
        <a
          href={`${BASE}/openapi.json`}
          className="mt-3 inline-block rounded-lg border border-brick/30 bg-brick/5 px-5 py-2 text-[13px] font-medium text-brick hover:bg-brick/10 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          Download OpenAPI Spec (JSON)
        </a>
      </div>
    </div>
  );
}
