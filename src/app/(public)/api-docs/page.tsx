export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { API_ATTRIBUTION, CONTACT_EMAIL, SITE_URL } from "@/lib/constants";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { DEMO } from "./api-docs-example";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";
import { API_MONTHLY_CALLS_LABEL, API_PLANS_LABEL, BURST_CALLS_PER_MINUTE } from "@/lib/api-subscriber-access";
import { PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { NON_INSTITUTION_TIER, tierAmountLabel, tierPriceLabel } from "@/lib/pro-tiers";
import { PAGE_HEADER } from "@/components/public/page-header";
import { MAX_CHOSEN_PEERS, PEER_GROUP_PARAMS } from "@/lib/peer-set-dimensions";
import { API_ERROR_CODES, type ApiErrorCode } from "@/lib/api-v1";
import { MCP_TOOLS } from "@/lib/api-v1-mcp";
import { CodeBlock } from "./code-block";

const PRO_LABEL = "Hamilton";
const API_ACCESS_LABEL = `${PRO_LABEL} · ${API_PLANS_LABEL}`;

const ERROR_GUIDANCE: Record<ApiErrorCode, { status: number; action: string }> = {
  account_context_required: { status: 403, action: "Use your own Hamilton subscriber key for saved account context. Generic partner keys have no personal mapping; pass explicit institution and peer parameters instead." },
  api_key_required: { status: 401, action: "Send your API key in the Authorization header, or make a key on your account page." },
  invalid_api_key: { status: 401, action: "Check that you copied the whole key. A subscriber key also requires active payer and holder accounts; contact us if account access is unavailable." },
  key_revoked: { status: 401, action: "Make a replacement key on your account page, or contact us about a partner key." },
  subscription_inactive: { status: 401, action: "Restart the Hamilton subscription that covers this key from your account page." },
  seat_removed: { status: 401, action: "Ask the plan owner to add you back to their workspace." },
  plan_required: { status: 403, action: `Use a key covered by the ${API_PLANS_LABEL}, or an eligible partner key. The response includes upgrade_url.` },
  invalid_parameter: { status: 400, action: "Read the error message, correct the named query parameter and retry." },
  not_found: { status: 404, action: "Check the category or institution ID. A local market may not be on file for that institution." },
  rate_limited: { status: 429, action: "Your team used its monthly allowance. Wait until the reset time in reset or X-RateLimit-Reset (the 1st of next month, UTC)." },
  burst_limited: { status: 429, action: "Wait the number of seconds in Retry-After before retrying; spread requests out across the minute." },
  rate_limit_unavailable: { status: 503, action: "Usage tracking is temporarily unavailable. Wait the Retry-After seconds (60) and retry." },
  data_unavailable: { status: 503, action: "Revenue data is temporarily unavailable. Retry later; contact us if it persists." },
  context_unavailable: { status: 503, action: "Saved Hamilton context could not be read. Retry later; no partial account context is returned." },
};

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    `REST API and Claude connector for bank and credit union fees, call report fee revenue, fee changes and branch markets. Included with the ${API_PLANS_LABEL} of Hamilton: make your key on your account page.`,
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
      <th scope="row" className="py-2 pr-3 align-top font-normal">
        <code className="rounded bg-border/40 px-1.5 py-0.5 text-[12px] text-ink-soft">
          {name}
        </code>
        {required && (
          <span className="ml-1.5 text-[10px] font-semibold uppercase text-red-500">
            required
          </span>
        )}
      </th>
      <td className="py-2 pr-3 align-top text-[12px] text-ink-muted">{type}</td>
      <td className="py-2 align-top text-[13px] text-ink-muted">{description}</td>
    </tr>
  );
}

function ResponseField({ name, type, note }: { name: string; type: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
      <code className="min-w-0 break-all text-[12px] text-ink-soft">{name}</code>
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
  const id = `endpoint-${method.toLowerCase()}-${path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <article aria-labelledby={id} className="min-w-0 rounded-xl border border-border/80 bg-white px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="get">{method}</Badge>
        <code className="break-all text-sm font-medium text-ink">{path}</code>
        {tierNote && <Badge variant="tier">{tierNote}</Badge>}
      </div>
      <h3 id={id} className="mt-1 scroll-mt-20 text-[14px] font-medium text-ink">
        <a href={`#${id}`} className="hover:underline underline-offset-2">{summary}</a>
      </h3>
      <p className="mt-1 text-[13px] text-ink-muted">{description}</p>

      {/* Parameters */}
      {params.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Parameters
          </p>
          <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={`${summary} parameters`}>
          <table className="w-full text-left">
            <caption className="sr-only">{method} {path} parameters</caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3">Name</th>
                <th scope="col" className="py-2 pr-3">Type</th>
                <th scope="col" className="py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <ParamRow key={p.name} {...p} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {params.length === 0 && <p className="mt-4 text-[13px] text-ink-muted">No query parameters.</p>}

      {/* Try it */}
      <CodeBlock title="Try it" copyLabel={`${method} ${path} request`}>{curlExample}</CodeBlock>

      {/* Response */}
      {responseFields && responseFields.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Response fields
          </p>
          <div className="mt-2 space-y-1">{responseFields.map((f) => <ResponseField key={f.name} {...f} />)}</div>
        </div>
      )}

      <CodeBlock title="Example response · illustrative values, not live data" copyLabel={`${method} ${path} example response`}>{responseExample}</CodeBlock>
    </article>
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

/** Pinned bridge release with credential-file support; no key is passed in process arguments. */
const DESKTOP_SERVER_NAME = "bank-fee-index";
const DESKTOP_BRIDGE = "mcp-remote@0.15.1";
const MAC_HEADERS_PATH = "/Users/YOUR_USERNAME/.feeinsight/headers.txt";
const WINDOWS_HEADERS_PATH = "C:\\Users\\YOUR_USERNAME\\.feeinsight\\headers.txt";
function desktopConfig(command: string, args: string[], env?: Record<string, string>): string {
  return JSON.stringify(
    { mcpServers: { [DESKTOP_SERVER_NAME]: { command, args, ...(env ? { env } : {}) } } },
    null,
    2,
  );
}
const DESKTOP_CONFIG_MAC = desktopConfig("npx", ["-y", DESKTOP_BRIDGE, `${BASE}/mcp`, "--header-file", MAC_HEADERS_PATH]);
// The bridge expands this reference after launch; no spaces or credential value enter cmd/npx arguments.
const DESKTOP_CONFIG_WINDOWS = desktopConfig("cmd", ["/c", "npx", "-y", DESKTOP_BRIDGE, `${BASE}/mcp`, "--header", "Authorization:${FEEINSIGHT_AUTH_HEADER}"], {
  FEEINSIGHT_AUTH_HEADER: "Bearer YOUR_API_KEY",
});
const CLAUDE_CODE_CONFIG = JSON.stringify({
  mcpServers: {
    [DESKTOP_SERVER_NAME]: {
      type: "http",
      url: `${BASE}/mcp`,
      headers: { Authorization: "Bearer ${FEEINSIGHT_API_KEY}" },
    },
  },
}, null, 2);

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
            <Link href="/account" className="font-semibold text-brick underline underline-offset-2">Make your key on your account page.</Link>{" "}
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
      <nav aria-label="API documentation" className="mt-5 flex flex-wrap gap-3 text-[13px]">
        <a href="#authentication" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Authentication
        </a>
        <a href="#claude" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Claude connector
        </a>
        <a href="#rate-limits" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Rate limits
        </a>
        <a href="#errors" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Errors
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
        <a href="#revenue" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Revenue
        </a>
        <a href="#fee-changes" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Fee changes
        </a>
        <a href="#branches" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Branches
        </a>
        <a href="#peers" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Peers
        </a>
        <a href="#hamilton-context" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Hamilton context
        </a>
        <a href="#rate-fees" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Rate fees
        </a>
        <a href="#pricing" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Pricing
        </a>
        <a href="#data-notes" className="rounded-md border border-border px-3 py-1.5 text-ink-soft hover:bg-paper transition-colors">
          Data notes
        </a>
        <a
          href={`${BASE}/openapi.json`}
          className="rounded-md border border-brick/30 bg-brick/5 px-3 py-1.5 text-brick hover:bg-brick/10 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAPI Spec
        </a>
      </nav>

      {/* Base URL */}
      <div className="mt-6 rounded-lg border border-border bg-paper/50 px-5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Base URL
        </p>
        <code className="mt-1 block break-all text-[14px] font-medium text-ink">
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

        <p className="mt-3 text-[13px] text-ink-muted">
          The Bash header example reads your key from the private credential file described in the{" "}
          <a href="#claude" className="font-medium text-brick underline underline-offset-2">local connection steps below</a>.
          Replace the example path with its absolute path. <code>--include</code> shows the HTTP status
          and response headers alongside the JSON body.
        </p>
        <CodeBlock title="Header authentication">{`curl --include --header "@/absolute/path/headers.txt" \\
  ${BASE}/fees`}</CodeBlock>

        <CodeBlock title="Query parameter authentication">{`curl "${BASE}/fees?api_key=YOUR_API_KEY"`}</CodeBlock>

        <p className="mt-3 text-[13px] text-ink-muted">
          In Windows PowerShell 5.1, <code>curl</code> is an alias for a different command;
          PowerShell 7 has no built-in curl alias. This single-line example uses native <code>curl.exe</code>{" "}
          and works in either version. Create the credential file described below, then replace the
          example path with its absolute path. The key stays in that file.
        </p>

        <CodeBlock title="PowerShell authentication" copyLabel="PowerShell API test">{`curl.exe --include --header "@${WINDOWS_HEADERS_PATH}" "${BASE}/fees"`}</CodeBlock>

        <p className="mt-4 text-[13px] text-ink-muted">
          A key keeps working while your subscription is active, and for {PAST_DUE_GRACE_DAYS} days after a failed payment
          while the card is retried. It stops when the subscription ends. Keep it private.
          Anyone who has it can use your monthly calls and read the saved Hamilton institution and peer
          groups available to that key. Use your own personal key for saved context; keep it out of shared files and logs.
        </p>
      </div>

      {/* Claude connector */}
      <SectionHeading id="claude">Claude connector</SectionHeading>
      <div className="rounded-xl border border-border/80 bg-white px-6 py-5">
        <p className="text-[13px] text-ink-muted">
          Add the connector once and ask Claude in plain English, for example which banks in Ohio have
          the highest overdraft fee, or how banks and credit unions in Texas compare. To add it, open
          Settings in Claude, then Connectors, add a custom connector and use this link with your key
          only for a private, per-user connection. Treat the full link as a credential; keep it out of
          terminals, shared configuration and logs. For a company connection, ask your administrator how
          each user supplies their own key. A shared URL key gives everyone that key&apos;s Hamilton context.
        </p>
        <CodeBlock title="Connector link">{`${BASE}/mcp?api_key=YOUR_API_KEY`}</CodeBlock>
        <p className="mt-3 text-[13px] text-ink-muted">
          Each question Claude answers uses a few calls from your team&apos;s {API_MONTHLY_CALLS_LABEL}-a-month allowance.
        </p>

        <p className="mt-4 text-[13px] font-semibold text-ink">Claude Desktop local connection</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          If your organization permits local MCP servers, Claude Desktop can connect through
          mcp-remote, an open-source bridge. Managed accounts may disable both custom connectors and
          local MCP; ask your owner or administrator for an approved connection method. This setup needs
          Node.js 22.12 or newer (check <code>node -v</code> and <code>npx -v</code> in a terminal).
          For Mac/Linux Desktop and the curl tests, create a plain-text <code>headers.txt</code> in a private folder on your computer, outside
          any repository or shared/synced folder. Put the following line in it, replacing the placeholder
          in your text editor. On Mac or Linux restrict access with <code>chmod 600 /absolute/path/headers.txt</code>;
          on Windows restrict the file to your user in Properties, then Security.
        </p>
        <CodeBlock title="Credential file contents" copyLabel="FeeInsight credential file">{"Authorization: Bearer YOUR_API_KEY"}</CodeBlock>
        <p className="mt-2 text-[13px] text-ink-muted">
          Replace the example username and path below with the absolute path to your credential file.
          On Linux use your home path, such as <code>/home/YOUR_USERNAME/.feeinsight/headers.txt</code>.
          In Claude Desktop, open Settings, then Developer, then Edit Config, and add this entry to{" "}
          <code className="rounded bg-border/40 px-1 text-[12px]">claude_desktop_config.json</code>. If the file
          already has <code className="rounded bg-border/40 px-1 text-[12px]">mcpServers</code>, add only the{" "}
          <code className="rounded bg-border/40 px-1 text-[12px]">{DESKTOP_SERVER_NAME}</code> entry inside it.
          Save, quit Claude Desktop fully and reopen it.
        </p>
        <CodeBlock title="Claude Desktop on Mac or Linux" copyLabel="Claude Desktop config for Mac or Linux">{DESKTOP_CONFIG_MAC}</CodeBlock>
        <p className="mt-3 text-[13px] text-ink-muted">
          Windows Desktop uses the bridge&apos;s environment-reference form to avoid cmd/npx quoting
          problems with paths or header values containing spaces. In the private config below, replace{" "}
          <code>YOUR_API_KEY</code> only inside <code>env</code>; leave the argument reference unchanged.
          Restrict this config to your user, keep it out of shared files and repositories, and never post
          its contents. After saving, quit Claude Desktop from the system tray and reopen it.
        </p>
        <CodeBlock title="Claude Desktop on Windows" copyLabel="Claude Desktop config for Windows">{DESKTOP_CONFIG_WINDOWS}</CodeBlock>
        <p className="mt-3 text-[13px] text-ink-muted">
          For Claude Code, make <code>FEEINSIGHT_API_KEY</code> available through your environment or
          secret manager before starting Claude Code. Keep the variable reference below as written;
          do not replace it with the key. Add the entry to your project&apos;s <code>.mcp.json</code>
          (or merge it into an existing <code>mcpServers</code> object), approve the project connection,
          then use <code>/mcp</code> in a session to check it. This config contains no key value.
        </p>
        <CodeBlock title="Claude Code project configuration" copyLabel="Claude Code project config">{CLAUDE_CODE_CONFIG}</CodeBlock>

        <p className="mt-4 text-[13px] font-semibold text-ink">If the connector stops working</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-ink-muted">
          <li>
            Replacing or turning off a key stops the old one at once. Update the local credential file,
            Claude Code environment, or remote connector connection you configured, then restart the connection.
          </li>
          <li>
            Claude Desktop ignores a config file that is not valid JSON. Check that every brace and comma is in
            place, especially between two entries in{" "}
            <code className="rounded bg-border/40 px-1 text-[12px]">mcpServers</code>.
          </li>
          <li>
            &ldquo;Unexpected token &lsquo;&lt;&rsquo;&rdquo; means the client received non-JSON content.
            Check the endpoint URL, HTTP status and Content-Type for an HTML error, redirect or deployment
            protection page. API key refusals return JSON; this parse error alone does not identify a bad key.
          </li>
          <li>
            To test the key on its own, use the Bash header example or the single-line PowerShell example
            above. Read the HTTP status and JSON <code>code</code> and <code>error</code> message.{" "}
            <code>api_key_required</code> means no accepted key was supplied; <code>invalid_api_key</code>
            can mean an unknown key or an unavailable account. For <code>key_revoked</code>, replace the key;
            for <code>subscription_inactive</code> or <code>seat_removed</code>, restore the plan or seat access.
            The error table below lists the recovery steps.
          </li>
        </ul>

        <p className="mt-3 text-[13px] text-ink-muted">
          Your own subscriber key can use the institution and peer sets you saved in Hamilton.
          Ask Claude to call <code>get_hamilton_context</code> first, or call{" "}
          <a href="#hamilton-context" className="font-medium text-brick underline underline-offset-2">/hamilton-context</a>{" "}
          from your code. Peer comparison uses those defaults when you omit explicit values.
          A generic partner key has no personal account mapping.
        </p>
        <p className="mt-4 text-[13px] font-semibold text-ink">What Claude can look up</p>
        <ul className="mt-2 space-y-1.5 text-[13px] text-ink-muted">
          {MCP_TOOLS.map((tool) => (
            <li key={tool.name}>
              <code className="rounded bg-border/40 px-1 text-[12px] text-ink">{tool.name}</code>{" "}
              <span className="text-ink-soft">{tool.title}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Rate Limits */}
      <SectionHeading id="rate-limits">Rate Limits</SectionHeading>
      <div className="rounded-xl border border-border/80 bg-white px-6 py-5">
        <p className="text-[13px] text-ink-muted">
          Each plan gets one monthly allowance, shared by every key on it and across all endpoints. When it runs out, calls return 429 rate_limited until the allowance resets on the 1st of the next month (UTC). Each plan can also make up to {BURST_CALLS_PER_MINUTE} calls a minute, and calls past that return 429 burst_limited with a Retry-After header giving the seconds to wait. Unlimited keys get no X-RateLimit-Limit or X-RateLimit-Remaining headers.
        </p>
        <p className="mt-3 text-[13px] text-ink-muted">
          Data responses carry an ETag; send it back in If-None-Match to get 304 Not Modified when nothing changed (a 304 still counts as a call). /hamilton-context and personalized /peers responses are private, use no-store and do not return an ETag or 304.
        </p>
        <div className="mt-3 space-y-1.5 text-[13px]">
          <ResponseField name="X-RateLimit-Limit" type="header" note="Maximum requests in the current window" />
          <ResponseField name="X-RateLimit-Remaining" type="header" note="Requests remaining" />
          <ResponseField name="X-RateLimit-Reset" type="header" note="ISO 8601 UTC time when the monthly window resets" />
          <ResponseField name="Retry-After" type="header" note="On 429 burst_limited, seconds to wait" />
        </div>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border/60" tabIndex={0} role="region" aria-label="API monthly allowance">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">API monthly request allowance</caption>
            <thead>
              <tr className="bg-paper">
                <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Tier</th>
                <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Monthly limit</th>
                <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">How to get it</th>
              </tr>
            </thead>
            <tbody className="text-ink-soft">
              <tr className="border-t border-border/60">
                <td className="px-4 py-2 font-medium">{PRO_LABEL} key</td>
                <td className="px-4 py-2">{API_MONTHLY_CALLS_LABEL} requests</td>
                <td className="px-4 py-2">Account page, {API_PLANS_LABEL}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <SectionHeading id="errors">Errors and recovery</SectionHeading>
      <div className="rounded-xl border border-border/80 bg-white px-6 py-5">
        <p className="text-[13px] text-ink-muted">
          Errors return JSON with a readable <code>error</code> message and a stable <code>code</code>.
          Check the HTTP status and code before retrying. Error responses are never cached.
        </p>
        <CodeBlock title="Example error · HTTP 400" copyLabel="invalid parameter error example">{JSON.stringify({
          error: "state must be a two-letter code such as TX",
          code: "invalid_parameter",
        }, null, 2)}</CodeBlock>
        <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="API errors and recovery">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">API error statuses, codes and recovery actions</caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 pr-3">HTTP status</th>
                <th scope="col" className="py-2 pr-3">Code</th>
                <th scope="col" className="py-2">What to do</th>
              </tr>
            </thead>
            <tbody>
              {API_ERROR_CODES.map((code) => (
                <tr key={code} className="border-t border-border/60 align-top">
                  <td className="py-3 pr-3 text-ink-soft">{ERROR_GUIDANCE[code].status}</td>
                  <th scope="row" className="py-3 pr-3 font-normal text-ink-soft"><code>{code}</code></th>
                  <td className="min-w-48 py-3 text-ink-muted">{ERROR_GUIDANCE[code].action}</td>
                </tr>
              ))}
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
              description: `"csv" for a CSV download, with a ${PRO_LABEL} key or a signed-in ${PRO_LABEL} session`,
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
  "total": 1,
  "data": [
    {
      "category": "overdraft",
      "display_name": "Overdraft (OD)",
      "family": "Overdraft & NSF",
      "tier": "spotlight",
      "median": 35.00,
      "p25": 30.00,
      "p75": 36.00,
      "min": 5.00,
      "max": 40.00,
      "institution_count": 842
    }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />

        <Endpoint
          method="GET"
          path="/fees?category={slug}"
          summary="Get fee category detail"
          description="Detailed breakdown for a single fee category with segmentation by charter type, asset tier, Federal Reserve district, and state."
          tierNote={API_ACCESS_LABEL}
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
            { name: "by_charter_type[]", type: "array", note: "Bank and Credit Union breakdowns, labeled by dimension_value" },
            { name: "by_asset_tier[]", type: "array", note: "Breakdowns by asset size tier, labeled by dimension_value" },
            { name: "by_fed_district[]", type: "array", note: "District breakdowns, labeled District 1 through District 12" },
            { name: "by_state[]", type: "array", note: "Up to 15 state breakdowns, labeled by two-letter state code" },
            { name: "by_charter_type[].median_amount", type: "number | null", note: "Median in USD; each breakdown also includes count, min_amount, max_amount, avg_amount, p25_amount and p75_amount" },
          ]}
          responseExample={`{
  "category": "overdraft",
  "display_name": "Overdraft (OD)",
  "family": "Overdraft & NSF",
  "tier": "spotlight",
  "summary": {
    "institution_count": 842,
    "observation_count": 1156
  },
  "by_charter_type": [
    { "dimension_value": "Bank", "count": 510, "min_amount": 5, "max_amount": 40, "avg_amount": 34, "median_amount": 36, "p25_amount": 33, "p75_amount": 36 },
    { "dimension_value": "Credit Union", "count": 332, "min_amount": 5, "max_amount": 38, "avg_amount": 29, "median_amount": 30, "p25_amount": 25, "p75_amount": 35 }
  ],
  "by_asset_tier": [
    { "dimension_value": "community_large", "count": 200, "min_amount": 5, "max_amount": 40, "avg_amount": 30, "median_amount": 30, "p25_amount": 25, "p75_amount": 35 }
  ],
  "by_fed_district": [
    { "dimension_value": "District 6", "count": 75, "min_amount": 5, "max_amount": 38, "avg_amount": 29, "median_amount": 30, "p25_amount": 25, "p75_amount": 35 }
  ],
  "by_state": [
    { "dimension_value": "FL", "count": 44, "min_amount": 5, "max_amount": 38, "avg_amount": 29, "median_amount": 30, "p25_amount": 25, "p75_amount": 35 }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
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
          description="Returns the fee index for every category. Filter by state, charter type, Federal Reserve district or asset size to benchmark a peer group. Includes maturity indicators and bank and credit union counts."
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
              name: "asset_tier",
              type: "string",
              description: "Asset-size tier(s), comma-separated: community_small, community_mid, community_large, regional, large_regional, super_regional",
            },
            {
              name: "format",
              type: "string",
              description: `"csv" for a CSV download, with a ${PRO_LABEL} key or a signed-in ${PRO_LABEL} session`,
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
    "district": null,
    "asset_tier": null
  },
  "total": 1,
  "data": [
    {
      "category": "monthly_maintenance",
      "display_name": "Monthly Maintenance",
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
    }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
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
          description="Paginated list of banks and credit unions. Filter by state, charter, size or city, search by name, or rank by one fee. Each row has fee count, total assets (in thousands of dollars) and Fed district."
          params={[
            { name: "state", type: "string", description: "Two-letter state code" },
            { name: "charter", type: "string", description: '"bank" or "credit_union"' },
            { name: "has_fees", type: "boolean", description: '"true" to return only institutions with published fees' },
            { name: "q", type: "string", description: "Search by name, e.g. JPMorgan Chase" },
            { name: "asset_tier", type: "string", description: "Asset-size tier(s), comma-separated, e.g. community_small, community_mid" },
            { name: "city", type: "string", description: "Exact city name, e.g. Austin (not with q or fee_category)" },
            { name: "fee_category", type: "string", description: `Rank by one fee, e.g. overdraft (${PRO_LABEL} keys). Each row gains fee_amount, the institution's lowest published amount for that fee.` },
            { name: "sort", type: "string", description: '"highest" (default) or "lowest", with fee_category' },
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
  "total": 1,
  "page": 1,
  "page_size": 10,
  "pages": 1,
  "has_more": false,
  "data": [
    {
      "id": ${DEMO.id},
      "name": "${DEMO.name}",
      "state": "${DEMO.state}",
      "city": "${DEMO.city}",
      "charter_type": "bank",
      "asset_size": ${DEMO.assetThousands},
      "asset_tier": "${DEMO.assetTier}",
      "fed_district": ${DEMO.fedDistrict},
      "fee_count": ${DEMO.feeCount}
    }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />

        <Endpoint
          method="GET"
          path="/institutions?id={id}"
          summary="Get institution detail"
          description="One institution's profile with its published fees and source links, call report figures and complaint counts. Add view=benchmark for its fees beside peer medians (format=csv for a spreadsheet) or view=regulatory_watch for local competitor enforcement records, fee comparisons and tracked rule changes. Where it charges several different fees in one category, amount is null and each fee is listed by name (in view=regulatory_watch, with the lowest and highest amounts)."
          tierNote={API_ACCESS_LABEL}
          params={[
            { name: "id", type: "integer", required: true, description: "Institution ID" },
            { name: "view", type: "string", description: '"detail" (default), "benchmark" or "regulatory_watch"' },
            { name: "quarters", type: "integer", description: "Call report quarters, newest first (default: 8, max: 66)" },
            { name: "format", type: "string", description: '"csv" with view=benchmark' },
            {
              name: "updated_since",
              type: "string",
              description: "An ISO 8601 date or time, such as 2026-10-01 or 2026-10-01T00:00:00Z. Only fees published on or after it are returned.",
            },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/institutions?id=${DEMO.id}"`}
          responseFields={[
            { name: "fees[]", type: "array", note: "Every published fee for this institution" },
            { name: "fees[].source_url", type: "string", note: "The fee schedule the fee was read from" },
            { name: "call_reports[]", type: "array", note: "FDIC or NCUA call report figures by quarter, in whole dollars" },
            { name: "complaints[]", type: "array", note: "CFPB complaint counts by product, when any are on file" },
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
  "id": ${DEMO.id},
  "name": "${DEMO.name}",
  "state": "${DEMO.state}",
  "city": "${DEMO.city}",
  "charter_type": "bank",
  "asset_size": ${DEMO.assetThousands},
  "asset_tier": "${DEMO.assetTier}",
  "fed_district": ${DEMO.fedDistrict},
  "fee_count": 2,
  "fees": [
    {
      "fee_name": "Overdraft Item Fee",
      "name_is_category_fallback": false,
      "category": "overdraft",
      "amount": 35.00,
      "frequency": "per_item",
      "conditions": null,
      "review_status": "approved",
      "confidence": 0.99,
      "source_url": "https://example.com/fee-schedule.pdf",
      "published_at": "2026-10-02T14:05:00.000Z"
    },
    {
      "fee_name": "Paper statements",
      "name_is_category_fallback": false,
      "category": "paper_statement",
      "amount": 2.00,
      "frequency": "monthly",
      "conditions": null,
      "review_status": "approved",
      "confidence": 0.98,
      "source_url": "https://example.com/fee-schedule.pdf",
      "published_at": "2026-10-02T14:05:00.000Z"
    }
  ],
  "rate_fees": [],
  "call_reports": [],
  "complaints": [],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />
      </div>

      <div className="mt-6 space-y-6">
        <Endpoint
          method="GET"
          path="/institutions?view=fees"
          summary="Published fee rows, filtered by publish date"
          description="Every published dollar fee as its own row, oldest first by publish date, then by fee_id. To keep your own copy current, save the newest published_at you hold and ask again with updated_since set to it. Rows published at exactly that time come back again, so match them on fee_id. A fee that is taken down drops out of the list and is not reported as a change, so pull the full list without updated_since from time to time to catch removals."
          tierNote={API_ACCESS_LABEL}
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
  "total": 1,
  "page": 1,
  "page_size": 200,
  "pages": 1,
  "has_more": false,
  "data": [
    {
      "fee_id": 501,
      "institution_id": ${DEMO.id},
      "institution_name": "${DEMO.name}",
      "state": "${DEMO.state}",
      "charter_type": "bank",
      "fee_name": "Overdraft Item Fee",
      "name_is_category_fallback": false,
      "category": "overdraft",
      "amount": 35.00,
      "frequency": "per_item",
      "conditions": null,
      "source_url": "https://example.com/fee-schedule.pdf",
      "published_at": "2026-10-02T14:05:00.000Z"
    }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />
      </div>

      {/* ---- HAMILTON CONTEXT ---- */}
      <SectionHeading id="hamilton-context">Hamilton Context</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/hamilton-context"
          summary="Read your saved institution and peer sets"
          description="Returns the subscriber key holder's saved Hamilton institution and authorized personal or workspace peer sets. If no saved institution is available, the current account institution may supply it. Requires your own subscriber key or a paid signed-in session; generic partner keys return 403 account_context_required. Responses are private and never cached. It returns institution and peer context without account identifiers, contact details or billing information."
          tierNote={API_ACCESS_LABEL}
          params={[]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/hamilton-context"`}
          responseFields={[
            { name: "institution", type: "object | null", note: "Selected institution's id and name, or null when none is available" },
            { name: "institution_source", type: "string", note: "The saved source label, account for the current account fallback, or none" },
            { name: "peer_sets[]", type: "array", note: "Only your authorized personal or workspace peer sets, with their saved filters" },
            { name: "active_peer_set_id", type: "integer | null", note: "The saved active peer set; null when none is active" },
          ]}
          responseExample={`{
  "institution": { "id": ${DEMO.id}, "name": "${DEMO.name}" },
  "institution_source": "manual",
  "peer_sets": [
    {
      "id": 31,
      "name": "Regional bank peers",
      "scope": "personal",
      "workspace_institution_id": null,
      "is_default": true,
      "filters": {
        "charter_type": "bank",
        "asset_tiers": ["community_mid", "community_large"],
        "fed_districts": [${DEMO.fedDistrict}],
        "states": ["FL", "GA"]
      }
    }
  ],
  "active_peer_set_id": 31,
  "note": "Only saved context available to this key holder is returned.",
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />
      </div>

      {/* ---- PEERS ---- */}
      <SectionHeading id="peers">Peer Comparison</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/peers"
          summary="Compare one institution's fees with its peers"
          description={`For each fee the institution publishes in dollars, shows its amount next to the peer median and the 25th and 75th percentiles. Your own subscriber key can supply omitted institution and peer defaults from Hamilton. Explicit peer_ids or peer-group parameters bypass saved peer defaults. Choose one authorized saved_peer_set_id, explicit peer_ids, or peer-group parameters; do not combine a saved set with explicit peers or filters. use_saved_context=false disables automatic defaults while still allowing an explicit authorized saved set. Without saved peers, the default group uses the institution's charter type, asset size and Fed district. Only the peer-group parameters you set apply, and "same" means the institution's own value. The percentile counts peers with lower amounts plus half of ties. When fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN} peers publish a fee, the median and percentiles are left out. Fees stated as a percentage are listed separately and not compared.`}
          tierNote={API_ACCESS_LABEL}
          params={[
            { name: "institution_id", type: "integer", description: "Institution ID; optional when saved Hamilton or current account context supplies it. If neither is available, the request returns 400 invalid_parameter" },
            { name: "saved_peer_set_id", type: "integer", description: "One authorized saved personal or workspace peer set. Cannot combine with peer_ids or peer-group parameters. Missing or unauthorized sets return 404 not_found; generic partner keys return 403 account_context_required" },
            { name: "use_saved_context", type: "boolean", description: "Default true. false disables automatic institution and peer defaults; an explicitly requested authorized saved_peer_set_id still works. Saved-context comparisons are private and never cached" },
            { name: "peer_ids", type: "string", description: `Up to ${MAX_CHOSEN_PEERS} institution IDs, comma-separated, to use as the peer group. Not combined with the parameters below` },
            ...PEER_GROUP_PARAMS.map((p) => ({ name: p.name, type: "string", description: `${p.description}, e.g. ${p.example}` })),
          ]}
          curlExample={`# Use your saved Hamilton institution and active peer set
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/peers"

# Choose an authorized saved peer set for one institution
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/peers?institution_id=${DEMO.id}&saved_peer_set_id=31"

# Use only the explicit institution and the default charter/size/district group
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/peers?institution_id=${DEMO.id}&use_saved_context=false"

# Banks with branches in the same metro, $1B to $10B in assets
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/peers?institution_id=${DEMO.id}&charter=bank&market=same&asset_min=1000000000&asset_max=10000000000"`}
          responseFields={[
            { name: "context", type: "object", note: "institution_source, peer_source, saved_peer_set_id and saved_peer_set_name explain the applied defaults" },
            { name: "peer_group.label", type: "string", note: "Which institutions were compared" },
            { name: "categories[].amount", type: "number", note: "The institution's amount in USD; null when it charges several different fees in the category" },
            { name: "categories[].fees", type: "array", note: "Each of the institution's fees as name and amount, lowest first; amount_low and amount_high on the category give the range" },
            { name: "categories[].peer_median", type: "number", note: "Median among peers that publish the fee" },
            { name: "categories[].peer_count", type: "integer", note: "Peers that publish the fee" },
            { name: "categories[].percentile", type: "integer", note: "0 to 100, the share of peers with a lower amount" },
            { name: "rate_fees[]", type: "array", note: "Fees stated as a percentage, listed apart" },
          ]}
          responseExample={`{
  "institution": { "id": ${DEMO.id}, "name": "${DEMO.name}", "state": "${DEMO.state}", "charter_type": "bank", "asset_tier": "${DEMO.assetTier}", "fed_district": ${DEMO.fedDistrict} },
  "peer_group": {
    "basis": "default",
    "label": "Banks with $1B to $10B in assets in the Atlanta Fed district",
    "peers_with_fees": 38
  },
  "min_peers": ${MIN_INSTITUTIONS_FOR_MEDIAN},
  "categories": [
    {
      "category": "overdraft",
      "display_name": "Overdraft (OD)",
      "amount": 35.00,
      "amount_low": 35.00,
      "amount_high": 35.00,
      "fees": [{ "name": "Overdraft Item Fee", "amount": 35.00 }],
      "peer_count": 38,
      "peer_median": 30.00,
      "peer_p25": 27.00,
      "peer_p75": 32.00,
      "peers_lower": 30,
      "peers_same": 3,
      "peers_higher": 5,
      "percentile": 83,
      "maturity_tier": "strong"
    }
  ],
  "rate_fees": [],
  "context": {
    "institution_source": "explicit",
    "peer_source": "default",
    "saved_peer_set_id": null,
    "saved_peer_set_name": null
  },
  "note": "Each row compares the institution's published dollar amount with the same fee at its peers.",
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
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
          tierNote={API_ACCESS_LABEL}
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
      "institution_id": 1,
      "institution_name": "Example Bank",
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
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />
      </div>

      {/* ---- REVENUE ---- */}
      <SectionHeading id="revenue">Fee Revenue</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/revenue"
          summary="Market-wide fee revenue by quarter"
          description="Call-report fee income in thousands of dollars per quarter, newest first, with one set of rows per regulator. FDIC rows are bank service charges on deposit accounts. NCUA rows are credit unions' broader fee income. The two measure different things, so we never add them together. Each regulator is dated by its own newest filing. The districts view gives one row per Fed district per regulator."
          tierNote={API_ACCESS_LABEL}
          params={[
            { name: "view", type: "string", description: '"national" (default) or "districts"' },
            { name: "quarters", type: "integer", description: "Quarters to return per regulator, back to 2010 (default: 8, max: 66)" },
            { name: "source", type: "string", description: '"fdic" (banks) or "ncua" (credit unions). Default: both, as separate rows' },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/revenue?quarters=4"`}
          responseFields={[
            { name: "financial_groups[]", type: "object", note: "One per regulator: what it measures, its newest quarter, and whether it reported" },
            { name: "data[].source", type: "string", note: '"fdic" or "ncua"; compare rows only within one source' },
            { name: "data[].measure", type: "string", note: '"deposit_service_charge_income" or "broad_credit_union_fee_income"' },
            { name: "data[].quarter", type: "string", note: 'e.g. "2026-Q1"; quarter_end gives the date' },
            { name: "data[].service_charges", type: "number", note: "Thousands of dollars, for that source's measure only" },
            { name: "data[].yoy_change_pct", type: "null", note: "Always null. The set of filers changes from quarter to quarter, so we don't report year-over-year growth" },
          ]}
          responseExample={`{
  "view": "national",
  "units": "Amounts are in thousands of US dollars per standalone quarter. ...",
  "financial_groups": [
    {
      "source": "fdic",
      "charter_type": "bank",
      "measure": "deposit_service_charge_income",
      "unit": "thousands of dollars",
      "period_basis": "standalone_quarter",
      "status": "reported",
      "latest_quarter": "2026-Q1",
      "latest_quarter_end": "2026-03-31",
      "quarters_returned": 4
    }
  ],
  "data": [
    {
      "source": "fdic",
      "charter_type": "bank",
      "measure": "deposit_service_charge_income",
      "quarter": "2026-Q1",
      "quarter_end": "2026-03-31",
      "service_charges": 1000000,
      "institutions": 4100,
      "yoy_change_pct": null
    }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />
      </div>

      {/* ---- FEE CHANGES ---- */}
      <SectionHeading id="fee-changes">Fee Changes</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/fee-changes"
          summary="Detected fee changes"
          description="Fee changes found when an institution's published schedule changed between reads, newest first, at most 200. Coverage is still small and growing."
          tierNote={API_ACCESS_LABEL}
          params={[
            { name: "days", type: "integer", description: "How far back to look (default: 90, max: 365)" },
            { name: "category", type: "string", description: "Fee category key, e.g. overdraft" },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/fee-changes?days=30&category=overdraft"`}
          responseFields={[
            { name: "data[].previous_amount", type: "number", note: "Amount before the change, in USD" },
            { name: "data[].new_amount", type: "number", note: "Amount after the change, in USD" },
            { name: "data[].detected_at", type: "string", note: "When the change was found" },
          ]}
          responseExample={`{
  "days": 30,
  "category": "overdraft",
  "count": 1,
  "data": [
    {
      "institution_id": 1001,
      "institution_name": "Example Bank",
      "category": "overdraft",
      "display_name": "Overdraft (OD)",
      "previous_amount": 32.00,
      "new_amount": 30.00,
      "change": "decrease",
      "detected_at": "2026-10-05T09:00:00.000Z"
    }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />
      </div>

      {/* ---- BRANCHES ---- */}
      <SectionHeading id="branches">Branches and Local Markets</SectionHeading>

      <div className="space-y-6">
        <Endpoint
          method="GET"
          path="/branches"
          summary="Branch locations"
          description="Bank branches come from the FDIC Summary of Deposits, with deposits. Credit union branches come from NCUA, without deposits. Each has an address and, where known, latitude and longitude. Pass institution_id for one institution, or state (optionally with city or zip) for an area."
          tierNote={API_ACCESS_LABEL}
          params={[
            { name: "institution_id", type: "integer", description: "One institution's branches" },
            { name: "state", type: "string", description: "Two-letter state code" },
            { name: "city", type: "string", description: "Exact city name, with state" },
            { name: "zip", type: "string", description: "Five-digit ZIP code, with state" },
            { name: "page", type: "integer", description: "Page number (default: 1)" },
            { name: "limit", type: "integer", description: "Results per page (default: 100, max: 500)" },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/branches?state=MN&city=Springfield"`}
          responseFields={[
            { name: "data[].source", type: "string", note: '"fdic_sod" or "ncua"' },
            { name: "data[].latitude", type: "number", note: "Null when not yet located" },
            { name: "data[].deposits", type: "number", note: "Whole dollars; null for credit unions" },
          ]}
          responseExample={`{
  "sod_year": 2026,
  "total": 1,
  "page": 1,
  "page_size": 100,
  "pages": 1,
  "has_more": false,
  "data": [
    {
      "source": "fdic_sod",
      "institution_id": 1001,
      "institution_name": "Example Bank",
      "branch_name": "Main Office",
      "is_main_office": true,
      "address": "1 Example Ave",
      "city": "Springfield",
      "state": "MN",
      "zip": "55000",
      "latitude": 44.9,
      "longitude": -93.2,
      "deposits": 250000000
    }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
}`}
        />

        <Endpoint
          method="GET"
          path="/market?institution_id={id}"
          summary="Local market competitors"
          description="Who competes in an institution's local market: the counties holding most of its deposits (for credit unions, its headquarters city's counties), with each competitor's deposits there and its deposit share. Credit unions have no deposit figure, so their share is null."
          tierNote={API_ACCESS_LABEL}
          params={[
            { name: "institution_id", type: "integer", required: true, description: "Institution ID" },
          ]}
          curlExample={`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BASE}/market?institution_id=1001"`}
          responseFields={[
            { name: "places[]", type: "array", note: "Counties or city that define the market" },
            { name: "data[].deposit_share_pct", type: "number", note: "Share of the market's deposits, in percent" },
            { name: "data[].is_subject", type: "boolean", note: "True for the requested institution" },
          ]}
          responseExample={`{
  "institution_id": 1001,
  "basis": "branch_counties",
  "places": ["Example County, MN"],
  "sod_year": 2026,
  "competitor_count": 0,
  "total_market_deposits": 250000000,
  "data": [
    {
      "institution_id": 1001,
      "name": "Example Bank",
      "charter_type": "bank",
      "is_subject": true,
      "market_deposits": 250000000,
      "deposit_share_pct": 100
    }
  ],
  "attribution": ${JSON.stringify(API_ATTRIBUTION)}
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
