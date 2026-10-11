export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { getCurrentUser } from "@/lib/auth";
import { SITE_URL } from "@/lib/constants";
import { getPublicSnapshot } from "@/lib/public-stats";
import { getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
import { getRevenueTrend } from "@/lib/data-store/call-reports";
import { getNationalEconomicSummary } from "@/lib/data-store/fed";
import { getNationalComplaintSummary } from "@/lib/data-store/complaints";
import { getArticles, SOURCE_LABELS } from "@/lib/data-store/news";
import { getHamiltonInstitutionContext } from "@/lib/hamilton/institution-context";
import { landingResearchHref, type ResearchScope } from "@/lib/hamilton/landing-research-handoff";
import { getDisplayName } from "@/lib/fee-taxonomy";
import {
  AmbientGlow,
  CTA_PRIMARY,
  CTA_SECONDARY,
  GLASS,
  GLASS_SOFT,
  H1,
  H2,
  INTERACTION,
  NUM,
} from "@/components/public/site-look";

export const metadata: Metadata = {
  title: "Research — Market evidence for bank fee decisions",
  description:
    "Research grounded in published fees and public records: fee schedules, financial filings, economic indicators, complaints and regulatory publications.",
};

type ScopeKey = "US" | "FL" | "institution";

interface PageProps {
  searchParams: Promise<{ scope?: string; q?: string; instId?: string }>;
}

function compactMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function pct(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}%`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function researchScope(scope: ScopeKey, instId: number | null): ResearchScope {
  if (scope === "FL") return { kind: "state", stateCode: "FL" };
  if (scope === "institution" && instId) return { kind: "local", institutionId: instId };
  return { kind: "national" };
}

function researchHref(task: "compare" | "board_report", scope: ResearchScope): string {
  return landingResearchHref({
    version: 1,
    task,
    scope,
    categories: undefined,
    charter: "all",
  });
}

function EvidenceActions({
  askHref,
  reportHref,
  sourceHref,
}: {
  askHref: string;
  reportHref: string;
  sourceHref: string;
}) {
  return (
    <div className="mt-5 flex flex-wrap gap-2 border-t border-[#E8E1D6] pt-4 text-sm">
      <Link href={askHref} className={CTA_PRIMARY}>Ask Hamilton</Link>
      <Link href={sourceHref} className={CTA_SECONDARY}>Inspect evidence</Link>
      <Link href={reportHref} className="inline-flex min-h-11 items-center font-semibold text-[#A93D25] underline underline-offset-4">
        Add to report
      </Link>
    </div>
  );
}

function ThreePartRead({
  fact,
  interpretation,
  question,
}: {
  fact: string;
  interpretation: string;
  question: string;
}) {
  return (
    <dl className="mt-5 grid gap-3 text-sm">
      <div className="rounded-xl bg-[#FAF7F2] p-4 ring-1 ring-[#E8E1D6]">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Source facts</dt>
        <dd className="mt-1 leading-relaxed text-[#1A1815]">{fact}</dd>
      </div>
      <div className="rounded-xl bg-white/75 p-4 ring-1 ring-[#E8E1D6]">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#A93D25]">Hamilton&apos;s interpretation</dt>
        <dd className="mt-1 leading-relaxed text-[#3D3830]">{interpretation}</dd>
      </div>
      <div className="rounded-xl border border-dashed border-[#D4C9BA] p-4">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Unanswered question</dt>
        <dd className="mt-1 leading-relaxed text-[#5A5347]">{question}</dd>
      </div>
    </dl>
  );
}

export default async function ResearchHubPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedScope: ScopeKey =
    params.scope === "FL" ? "FL" : params.scope === "institution" ? "institution" : "US";
  const q = (params.q ?? "").trim();
  const requestedInstId = Number(params.instId);
  const selectedContext =
    requestedScope === "institution" && Number.isSafeInteger(requestedInstId) && requestedInstId > 0
      ? await getHamiltonInstitutionContext(requestedInstId)
      : { institution: null, error: null };
  const selectedInstitution = selectedContext.institution;
  const scope: ScopeKey = requestedScope === "institution" && !selectedInstitution ? "institution" : requestedScope;
  const user = await getCurrentUser().catch(() => null);

  const [{ summary, categories: nationalFees }, revenue, economy, complaints, regulatory] = await Promise.all([
    getPublicSnapshot(),
    getRevenueTrend(8).catch(() => ({ quarters: [], latest: null })),
    getNationalEconomicSummary().catch(() => ({
      fed_funds_rate: null,
      unemployment_rate: null,
      cpi_yoy_pct: null,
      consumer_sentiment: null,
    })),
    getNationalComplaintSummary().catch(() => null),
    getArticles({ limit: 3 }).catch(() => []),
  ]);

  const selectedState = scope === "FL" ? "FL" : selectedInstitution?.stateCode ?? null;
  const scopedFees = selectedState
    ? await getPeerIndexCached({ state_code: selectedState }).catch(() => [])
    : nationalFees;
  const feeRows = ["overdraft", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing"]
    .map((category) => scopedFees.find((entry) => entry.fee_category === category))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.median_amount != null))
    .slice(0, 4);
  const maxFee = Math.max(...feeRows.map((row) => Number(row.median_amount ?? 0)), 1);

  const effectiveInstId = selectedInstitution?.id ?? null;
  const evidenceScope = researchScope(scope, effectiveInstId);
  const askHref = researchHref("compare", evidenceScope);
  const reportHref = researchHref("board_report", evidenceScope);
  const scopeLabel =
    scope === "FL"
      ? "Florida"
      : selectedInstitution
        ? selectedInstitution.name
        : "United States";

  const latestRevenue = revenue.latest;
  const latestReg = regulatory[0] ?? null;
  const briefs = [
    {
      id: "fees",
      title: "Fee landscape",
      deck: `How published fees compare across ${scopeLabel} and the broader market.`,
      keywords: "fee fees benchmark overdraft monthly maintenance atm wire institution peer pricing",
      sourceHref: scope === "FL" ? "/research/state/FL" : selectedInstitution ? `/institution/${selectedInstitution.id}` : "/fees",
      exhibit: (
        <div className="mt-5 space-y-4">
          {feeRows.length > 0 ? feeRows.map((row) => (
            <div key={row.fee_category}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="font-semibold text-[#1A1815]">{getDisplayName(row.fee_category).replace(/\s*\([^)]*\)/g, "")}</span>
                <span className={`font-semibold text-[#1A1815] ${NUM}`}>${compactMoney(Number(row.median_amount))} median</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E8E1D6]">
                <div className="h-full rounded-full bg-[#C44B2E]/70" style={{ width: `${Math.max(8, Number(row.median_amount ?? 0) / maxFee * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-[#6B6255]">{row.institution_count.toLocaleString("en-US")} institutions in this comparison.</p>
            </div>
          )) : <p className="text-sm text-[#6B6255]">No comparable published-fee medians are available for this scope yet.</p>}
        </div>
      ),
      fact: `Published schedules provide ${feeRows.length || "no"} comparable headline fee medians for ${scopeLabel}. Each benchmark uses one value per institution and excludes insufficient samples.`,
      interpretation: "Use the distribution to see where a pricing question deserves a closer peer comparison. A median is context, not a recommended price.",
      question: selectedInstitution
        ? `Which named competitors should define the relevant market for ${selectedInstitution.name}?`
        : "Which peer definition would make this benchmark useful for the decision at hand?",
      sourceLine: `Source: published institution fee schedules · refreshed ${summary.refreshedOn ?? "date unavailable"} · geography: ${scopeLabel}.`,
    },
    {
      id: "financial",
      title: "Financial performance",
      deck: "What regulatory filings show about deposit service-charge income and recent direction.",
      keywords: "financial filings fdic ncua assets income revenue trends call report",
      sourceHref: "/research/fee-revenue-analysis",
      exhibit: (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-[#FAF7F2] p-4 ring-1 ring-[#E8E1D6]">
            <p className="text-xs text-[#6B6255]">Latest quarter</p>
            <p className={`mt-1 text-2xl font-semibold text-[#1A1815] ${NUM}`}>${compactMoney(latestRevenue?.total_service_charges)}</p>
          </div>
          <div className="rounded-xl bg-[#FAF7F2] p-4 ring-1 ring-[#E8E1D6]">
            <p className="text-xs text-[#6B6255]">Year over year</p>
            <p className={`mt-1 text-2xl font-semibold text-[#1A1815] ${NUM}`}>${pct(latestRevenue?.yoy_change_pct)}</p>
          </div>
        </div>
      ),
      fact: latestRevenue
        ? `FDIC and NCUA filings report ${compactMoney(latestRevenue.total_service_charges)} in deposit service-charge income for ${latestRevenue.quarter}, across ${latestRevenue.total_institutions.toLocaleString("en-US")} filers in the loaded series.`
        : "No national filing trend is available in the current research read.",
      interpretation: "Fee-income direction can help frame the market backdrop, but it does not explain an individual institution's pricing decision by itself.",
      question: "How much of the observed change comes from pricing, customer behavior, account mix, or reporting composition?",
      sourceLine: latestRevenue
        ? `Source: FDIC Call Reports and NCUA 5300 filings · reporting period: ${latestRevenue.quarter} · national aggregation.`
        : "Source: FDIC Call Reports and NCUA 5300 filings · reporting period unavailable.",
    },
    {
      id: "economic",
      title: "Economic conditions",
      deck: "How rates, inflation and employment shape the context around deposit pricing.",
      keywords: "economic economy fed rates inflation unemployment demographics fred beige book",
      sourceHref: "/research/data-sources",
      exhibit: (
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            ["Fed funds", economy.fed_funds_rate ? pct(economy.fed_funds_rate.current, 2) : "—"],
            ["Unemployment", economy.unemployment_rate ? pct(economy.unemployment_rate.current, 1) : "—"],
            ["CPI YoY", economy.cpi_yoy_pct ? pct(economy.cpi_yoy_pct.current, 1) : "—"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-[#FAF7F2] p-4 ring-1 ring-[#E8E1D6]">
              <p className="text-xs text-[#6B6255]">{label}</p>
              <p className={`mt-1 text-xl font-semibold text-[#1A1815] ${NUM}`}>{value}</p>
            </div>
          ))}
        </div>
      ),
      fact: `FRED currently shows a federal funds rate of ${economy.fed_funds_rate ? pct(economy.fed_funds_rate.current, 2) : "unavailable"}, unemployment of ${economy.unemployment_rate ? pct(economy.unemployment_rate.current, 1) : "unavailable"}, and CPI inflation of ${economy.cpi_yoy_pct ? pct(economy.cpi_yoy_pct.current, 1) : "unavailable"}.`,
      interpretation: "These indicators describe the operating environment. They can explain pressure on deposits and households, but they should not be treated as direct evidence for a specific fee level.",
      question: scope === "FL" ? "How do Florida labor and demographic conditions differ from the national backdrop?" : "Which local or district indicators matter most for this institution's market?",
      sourceLine: `Source: Federal Reserve Economic Data (FRED) · latest loaded observations: ${economy.fed_funds_rate?.asOf ?? economy.unemployment_rate?.asOf ?? "date unavailable"} · national indicators.`,
    },
    {
      id: "complaints",
      title: "Customer experience",
      deck: "What CFPB complaint records reveal about reported issues, with coverage kept explicit.",
      keywords: "customer complaints cfpb consumer experience issues fee problem",
      sourceHref: "/research/data-sources",
      exhibit: (
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-[#FAF7F2] p-4 ring-1 ring-[#E8E1D6]">
            <p className="text-xs text-[#6B6255]">Complaints on file</p>
            <p className={`mt-1 text-xl font-semibold text-[#1A1815] ${NUM}`}>{complaints?.total_complaints?.toLocaleString("en-US") ?? "—"}</p>
          </div>
          <div className="rounded-xl bg-[#FAF7F2] p-4 ring-1 ring-[#E8E1D6]">
            <p className="text-xs text-[#6B6255]">Fee-related</p>
            <p className={`mt-1 text-xl font-semibold text-[#1A1815] ${NUM}`}>{complaints ? pct(complaints.fee_related_pct) : "—"}</p>
          </div>
          <div className="rounded-xl bg-[#FAF7F2] p-4 ring-1 ring-[#E8E1D6]">
            <p className="text-xs text-[#6B6255]">Avg. / institution</p>
            <p className={`mt-1 text-xl font-semibold text-[#1A1815] ${NUM}`}>{complaints?.average_per_institution?.toFixed(1) ?? "—"}</p>
          </div>
        </div>
      ),
      fact: complaints
        ? `The loaded CFPB complaint record contains ${complaints.total_complaints.toLocaleString("en-US")} complaints; ${pct(complaints.fee_related_pct)} meet Fee Insight's fee-related issue definition.`
        : "CFPB complaint coverage is unavailable in this read.",
      interpretation: "Complaint records are issue signals, not institution rankings. Counts depend on reporting coverage, institution matching and customer volume.",
      question: "Which complaint themes line up with the fee or product being reviewed, and what denominator is appropriate?",
      sourceLine: "Source: CFPB Consumer Complaint Database · national loaded coverage · counts are reports, not market-share-adjusted rates.",
    },
    {
      id: "regulatory",
      title: "Regulatory developments",
      deck: "What changed, when it changed, and which fee or product questions may need follow-up.",
      keywords: "regulatory regulation rule law cfpb occ fdic fed development wire",
      sourceHref: "/research/data-sources",
      exhibit: (
        <ul className="mt-5 divide-y divide-[#E8E1D6]">
          {regulatory.length > 0 ? regulatory.map((article) => (
            <li key={article.guid} className="py-3 first:pt-0">
              <p className="text-sm font-semibold leading-snug text-[#1A1815]">{article.title}</p>
              <p className="mt-1 text-xs text-[#6B6255]">
                {SOURCE_LABELS[article.source] ?? article.source} · {dateLabel(article.published_at)}
              </p>
            </li>
          )) : <li className="text-sm text-[#6B6255]">No federal regulatory releases loaded for this view.</li>}
        </ul>
      ),
      fact: latestReg
        ? `The most recent loaded federal release is “${latestReg.title}” from ${SOURCE_LABELS[latestReg.source] ?? latestReg.source}, dated ${dateLabel(latestReg.published_at)}.`
        : "No federal regulatory release is available in the current research read.",
      interpretation: "A release belongs in the decision only when its product, institution type, jurisdiction and effective timing actually apply.",
      question: "Does this development change the decision now, or only create a monitoring or legal-review question?",
      sourceLine: "Source: official Federal Reserve, FDIC, OCC and CFPB publication feeds · newest loaded federal releases.",
    },
  ];

  const query = q.toLowerCase();
  const shownBriefs = query
    ? briefs.filter((brief) => `${brief.title} ${brief.deck} ${brief.keywords}`.toLowerCase().includes(query))
    : briefs;

  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "Research", href: "/research" }]} />
      <div className={`relative isolate overflow-x-clip ${INTERACTION}`}>
        <AmbientGlow height={1000} />

        <main id="main-content" className="mx-auto max-w-page px-6 py-12 sm:py-16">
          <header className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">Research</p>
            <h1 className={`mt-3 ${H1}`}>Understand your market.</h1>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#3D3830]">
              Research grounded in published fees and public records. Explore fee schedules, financial filings,
              economic indicators, consumer complaints and regulatory publications in one workspace.
            </p>
          </header>

          <section aria-label="Research scope and search" className={`mt-8 p-5 sm:p-6 ${GLASS}`}>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Research scope">
              {[
                ["US", "United States"],
                ["FL", "Florida"],
                ["institution", selectedInstitution ? selectedInstitution.name : "Specific institution"],
              ].map(([key, label]) => {
                const active = scope === key;
                const href =
                  key === "institution"
                    ? selectedInstitution
                      ? `/research?scope=institution&instId=${selectedInstitution.id}`
                      : "/research?scope=institution"
                    : `/research?scope=${key}`;
                return (
                  <Link
                    key={key}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold no-underline ring-1 ring-[#E8E1D6] ${
                      active ? "bg-[#1A1815] text-white" : "bg-white/70 text-[#3D3830] hover:bg-white"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>

            {scope === "institution" && !selectedInstitution ? (
              <div className="mt-5">
                <p className="mb-2 text-sm font-semibold text-[#1A1815]">Choose the institution to research</p>
                <InstitutionSearchBar
                  placeholder="Search institution..."
                  ariaLabel="Choose an institution research scope"
                  selectionHrefPrefix="/research?scope=institution&instId="
                />
                {selectedContext.error ? <p className="mt-2 text-sm text-[#A93D25]">{selectedContext.error}</p> : null}
              </div>
            ) : null}

            <form action="/research" method="get" className="mt-5">
              <input type="hidden" name="scope" value={scope} />
              {selectedInstitution ? <input type="hidden" name="instId" value={selectedInstitution.id} /> : null}
              <label htmlFor="research-query" className="sr-only">Find research</label>
              <div className="relative">
                <Search aria-hidden className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6B6255]" />
                <input
                  id="research-query"
                  name="q"
                  defaultValue={q}
                  placeholder="Find a fee, institution, topic, or dataset"
                  className="min-h-12 w-full rounded-xl border border-[#D5CBBF] bg-[#FFFDF9] pl-12 pr-4 text-[15px] text-[#1A1815] placeholder:text-[#6B6255]"
                />
              </div>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#E8E1D6] pt-4 text-xs text-[#6B6255]">
              <span><strong className="font-semibold text-[#1A1815]">Research scope:</strong> {scopeLabel}</span>
              {user?.institution_name ? (
                <span><strong className="font-semibold text-[#1A1815]">Signed-in institution:</strong> {user.institution_name}</span>
              ) : null}
              <span>Scope and evidence are carried into Hamilton and report workflows.</span>
            </div>
          </section>

          <div className="mt-12 flex items-end justify-between gap-6">
            <div>
              <h2 className={H2}>Research briefs</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#5A5347]">
                One finding, one exhibit, and the evidence needed to judge it.
              </p>
            </div>
            <p className="hidden text-xs text-[#6B6255] sm:block">{shownBriefs.length} of {briefs.length} briefs</p>
          </div>

          {shownBriefs.length > 0 ? (
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              {shownBriefs.map((brief) => (
                <article key={brief.id} id={brief.id} className={`flex min-w-0 flex-col p-5 sm:p-6 ${GLASS_SOFT}`}>
                  <h3 className="text-xl font-semibold tracking-tight text-[#1A1815]">{brief.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">{brief.deck}</p>
                  {brief.exhibit}
                  <ThreePartRead fact={brief.fact} interpretation={brief.interpretation} question={brief.question} />
                  <p className="mt-4 text-xs leading-relaxed text-[#6B6255]">{brief.sourceLine}</p>
                  <EvidenceActions askHref={askHref} reportHref={reportHref} sourceHref={brief.sourceHref} />
                </article>
              ))}
            </div>
          ) : (
            <div className={`mt-6 p-6 ${GLASS_SOFT}`}>
              <p className="font-semibold text-[#1A1815]">No research brief matches “{q}”.</p>
              <p className="mt-2 text-sm text-[#5A5347]">Try a fee name, “complaints,” “financial,” “economic,” or “regulatory.”</p>
            </div>
          )}

          <section className="mt-12 border-t border-[#E8E1D6] pt-8">
            <h2 className="text-lg font-semibold text-[#1A1815]">Evidence standard</h2>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-[#5A5347]">
              Every exhibit should expose its publisher, reporting period, geography, coverage and method.
              Missing data stays missing. Complaint counts are not institution rankings. Federal Reserve
              commentary keeps its district and release context. Fee benchmarks describe observed prices;
              they do not prescribe one.
            </p>
          </section>
        </main>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Fee Insight Research",
            description: "Research grounded in published fees and public records for bank and credit union market analysis.",
            url: `${SITE_URL}/research`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
