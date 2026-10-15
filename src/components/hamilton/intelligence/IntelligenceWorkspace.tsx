import Link from "next/link";
import type { ReactNode } from "react";
import { decodeLandingResearch, encodeLandingResearch, landingResearchHref, RESEARCH_STATE_CODES, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import { loadLandingGeographicResearch, type GeographicResearchResult } from "@/lib/hamilton/landing-geographic-research";
import { getStateEconomicContext, type IndicatorSeries, type StateEconomicContext } from "@/lib/data-store/economic-context";
import { getRevenueByTier, getRevenueTrend, type RevenueTrend, type TierRevenue } from "@/lib/data-store/call-reports";
import { getArticles, SOURCE_LABELS, TOPIC_LABELS, type RegArticle } from "@/lib/data-store/news";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { STATE_NAMES } from "@/lib/us-states";
import { STATE_TO_DISTRICT, DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatAssets } from "@/lib/format";
import {
  joinSeries, loadComplaintTrend, loadFeeMap, loadPeerTable, loadStatePosts, percentChange, yearOverYear,
  type ComplaintTrend, type FeeMap, type PeerTable, type StatePost,
} from "@/lib/hamilton/intelligence-data";
import { ScopeControls } from "./ScopeControls";
import { EvidenceDetails } from "./EvidenceDetails";
import { FeeLandscapeChart, HorizontalBars, MultiTrend, StateFeeMap } from "./IntelligenceCharts";
import { LandingResearchResults } from "@/components/hamilton/landing/LandingResearchResults";

const LENSES = [
  { id: "fees", label: "Fee landscape" },
  { id: "financials", label: "Financials" },
  { id: "economy", label: "Economy" },
  { id: "complaints", label: "Complaints" },
  { id: "regulation", label: "Regulation" },
] as const;
export type Lens = (typeof LENSES)[number]["id"];

const DEFAULT: LandingResearchHandoff = { version: 1, task: "compare", scope: { kind: "national" }, charter: "all", categories: ["monthly_maintenance", "wire_domestic_outgoing", "atm_non_network"] };
const dollars = (v: number | null | undefined) => v == null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const pct = (v: number | null | undefined, digits = 1) => v == null ? "Unavailable" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
const CHARTER_LABEL: Record<LandingResearchHandoff["charter"], string> = { all: "Banks & credit unions", bank: "Banks", credit_union: "Credit unions" };
const TIER_LABEL: Record<string, string> = { micro: "Under $100M", community: "$100M–$1B", midsize: "$1B–$10B", regional: "$10B–$250B", mega: "$250B and up" };

export interface Loaded {
  fees: GeographicResearchResult | null;
  feeMap: FeeMap | null;
  peers: PeerTable | null;
  revenue: RevenueTrend | null;
  tiers: TierRevenue[] | null;
  economy: StateEconomicContext | null;
  complaints: ComplaintTrend | null;
  articles: RegArticle[] | null;
  statePosts: StatePost[] | null;
}

/**
 * Overview and Research: national or state intelligence across five lenses (James's design brief;
 * #1011 docs/design/hamilton-rebuild/). Every exhibit names its source, period, geography, coverage
 * and method; observed facts are kept apart from interpretation, and missing data is never $0.
 */
export async function IntelligenceWorkspace({ params, overview = false }: { params: { research?: string; lens?: string; instId?: string }; overview?: boolean }) {
  let selection: LandingResearchHandoff;
  try { selection = decodeLandingResearch(params.research) ?? DEFAULT; }
  catch { return <p role="alert">This research selection is invalid. <Link href={overview ? "/pro/hamilton" : "/pro/intelligence"}>Reset selection</Link></p>; }
  if (selection.scope.kind === "local") return <LandingResearchResults selection={{ ...selection, task: "compare" }} />;
  selection = { ...selection, task: "compare" };
  const state = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const district = state ? STATE_TO_DISTRICT[state] ?? null : null;
  const lens: Lens = LENSES.find(l => l.id === params.lens)?.id ?? "fees";
  const primary = selection.categories[0];
  const want = (id: Lens) => overview || lens === id;

  const data: Loaded = Object.fromEntries(await Promise.all(([
    ["fees", want("fees") ? loadLandingGeographicResearch(selection).catch(() => null) : null],
    ["feeMap", want("fees") && primary ? loadFeeMap(primary, selection.charter) : null],
    ["peers", want("fees") && primary && (state || !overview) ? loadPeerTable(state, selection.charter, primary, overview ? 10 : 25) : null],
    ["revenue", want("financials") ? getRevenueTrend(12).catch(() => null) : null],
    ["tiers", !overview && lens === "financials" ? getRevenueByTier().catch(() => null) : null],
    ["economy", want("economy") ? getStateEconomicContext(state ?? "US", district).catch(() => null) : null],
    ["complaints", want("complaints") ? loadComplaintTrend(state) : null],
    ["articles", want("regulation") ? getArticles({ limit: overview ? 5 : 12 }).catch(() => null) : null],
    ["statePosts", want("regulation") && state ? loadStatePosts(state) : null],
  ] as const).map(async ([key, value]) => [key, await value]))) as unknown as Loaded;

  return <IntelligenceView selection={selection} data={data} lens={lens} overview={overview} instId={params.instId} />;
}

/** The rendered workspace for already-loaded data; kept apart from loading so it can be checked with sample data. */
export function IntelligenceView({ selection, data, lens, overview, instId }: { selection: LandingResearchHandoff; data: Loaded; lens: Lens; overview: boolean; instId?: string }) {
  const state = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const place = state ? STATE_NAMES[state] ?? state : "United States";
  const district = state ? STATE_TO_DISTRICT[state] ?? null : null;
  const pathname = overview ? "/pro/hamilton" : "/pro/intelligence";
  const primary = selection.categories[0];
  const hrefFor = (next: LandingResearchHandoff, path = pathname, lensId: string = lens) =>
    `${path}?${new URLSearchParams({ research: encodeLandingResearch(next), ...(path === "/pro/intelligence" ? { lens: lensId } : {}) })}`;
  const lensHref = (id: Lens) => hrefFor(selection, "/pro/intelligence", id);
  const stateHrefs = Object.fromEntries(RESEARCH_STATE_CODES.map(code => [code, hrefFor({ ...selection, scope: { kind: "state", stateCode: code } })]));

  const askHref = `/pro/analyze?${new URLSearchParams({ research: encodeLandingResearch(selection), ...(instId ? { instId: instId } : {}) })}`;
  const panels = {
    fees: <FeePanels data={data} selection={selection} place={place} state={state} stateHrefs={stateHrefs} compact={overview} exploreHref={overview ? lensHref("fees") : null} />,
    financials: <FinancialPanel revenue={data.revenue} tiers={data.tiers} state={state} compact={overview} exploreHref={overview ? lensHref("financials") : null} />,
    economy: <EconomyPanel economy={data.economy} place={place} state={state} district={district} compact={overview} exploreHref={overview ? lensHref("economy") : null} />,
    complaints: <ComplaintPanel complaints={data.complaints} place={place} compact={overview} exploreHref={overview ? lensHref("complaints") : null} />,
    regulation: <RegulationPanel articles={data.articles} statePosts={data.statePosts} place={place} compact={overview} exploreHref={overview ? lensHref("regulation") : null} />,
  } satisfies Record<Lens, ReactNode>;

  return <div className="mx-auto flex max-w-7xl flex-col gap-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="fi-text-label text-[var(--fi-muted)]">{overview ? "Intelligence overview" : "Research"}</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{overview ? (state ? `${place}: fees, finances and market` : "The U.S. fee landscape") : `Research · ${place}`}</h1>
        <p className="mt-2 text-[var(--fi-muted)]">{CHARTER_LABEL[selection.charter]} · {overview ? "What is happening, how it compares, and where to look next." : "Explore the evidence behind your next decision."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={askHref} className="fi-btn fi-btn-secondary no-underline">Ask Hamilton about {state ? place : "this market"}</Link>
        <Link href={landingResearchHref({ ...selection, task: "board_report" })} className="fi-btn fi-btn-primary no-underline">Build board brief</Link>
      </div>
    </header>
    <ScopeControls selection={selection} pathname={pathname} lens={lens} />
    {overview ? <HamiltonRead data={data} place={place} state={state} primary={primary} /> : null}
    {overview ? <>
      {panels.fees}
      <div className="grid gap-6 lg:grid-cols-2">{panels.financials}{panels.economy}</div>
      <div className="grid gap-6 lg:grid-cols-2">{panels.complaints}{panels.regulation}</div>
      <Link className="text-sm font-medium text-[var(--fi-ink)] underline" href={`/pro/intelligence?${new URLSearchParams({ view: "institution", ...(instId ? { instId: instId } : {}) })}`}>Open your institution&apos;s monthly briefing</Link>
    </> : <>
      <nav aria-label="Research lenses" className="intelligence-tabs">{LENSES.map(l => <Link key={l.id} href={lensHref(l.id)} aria-current={lens === l.id ? "page" : undefined}>{l.label}</Link>)}</nav>
      {panels[lens]}
    </>}
  </div>;
}

/** Three observed facts, each tied to its exhibit's source; no interpretation, no pricing advice. */
function HamiltonRead({ data, place, state, primary }: { data: Loaded; place: string; state: string | null; primary: string | undefined }) {
  const findings: Array<{ title: string; body: string; source: string }> = [];
  const row = data.fees?.comparisons.find(c => c.category === primary) ?? data.fees?.comparisons.find(c => c.selected.status === "available");
  if (row && row.selected.status === "available") {
    const fee = getDisplayName(row.category).toLowerCase();
    findings.push({
      title: `${place}'s median ${fee} is ${dollars(row.selected.median)}.`,
      body: `Across ${row.selected.institutions.toLocaleString()} institutions with a published amount${state && row.national?.median != null ? `, against ${dollars(row.national.median)} nationally (${row.difference != null ? `${row.difference >= 0 ? "+" : "-"}${dollars(Math.abs(row.difference))}` : "difference unavailable"})` : ""}. The middle half runs ${dollars(row.selected.p25)} to ${dollars(row.selected.p75)}.`,
      source: "Bank Fee Index published catalog",
    });
  }
  const latest = data.revenue?.latest;
  if (latest) {
    findings.push({
      title: `Deposit service-charge income was $${(latest.total_service_charges / 1_000_000).toFixed(2)}B in ${latest.quarter}.`,
      body: `${latest.yoy_change_pct != null ? `${pct(latest.yoy_change_pct)} on the same quarter a year earlier` : "No same-quarter comparison a year earlier"}, across ${latest.total_institutions.toLocaleString()} filers nationally${state ? "; a state aggregate is not available" : ""}.`,
      source: "FDIC Call Reports and NCUA 5300",
    });
  }
  const e = data.economy;
  const bank = e?.cpi_bank_services, all = e?.cpi_all_items;
  const bankYoY = bank ? percentChange(bank.latest.value, bank.year_ago?.value) : null;
  const allYoY = all ? percentChange(all.latest.value, all.year_ago?.value) : null;
  if (state && e?.state_unemployment) {
    findings.push({
      title: `${place} unemployment is ${e.state_unemployment.latest.value.toFixed(1)}%.`,
      body: `${e.national_unemployment ? `The U.S. rate is ${e.national_unemployment.latest.value.toFixed(1)}% (${e.national_unemployment.latest.date.slice(0, 7)})` : "The U.S. comparison is unavailable"}; state figure as of ${e.state_unemployment.latest.date.slice(0, 7)}.`,
      source: "BLS via FRED",
    });
  } else if (bankYoY !== null) {
    findings.push({
      title: `Prices for bank services rose ${pct(bankYoY)} over twelve months.`,
      body: `${allYoY !== null ? `All consumer prices rose ${pct(allYoY)} over the same period` : "The all-items comparison is unavailable"}, to ${bank!.latest.date.slice(0, 7)}.`,
      source: "BLS consumer price index via FRED",
    });
  }
  if (findings.length === 0) return null;
  return <section className="intelligence-read" aria-labelledby="hamilton-read">
    <h2 id="hamilton-read" className="font-semibold">Hamilton&apos;s read <span className="font-normal text-[var(--fi-muted)]">· Observed in the data below</span></h2>
    <ol>{findings.map(f => <li key={f.title}><strong>{f.title}</strong>{f.body} <span className="mt-1 block text-xs text-[var(--fi-muted)]">Source: {f.source}</span></li>)}</ol>
  </section>;
}

function Panel({ title, subtitle, explore, children, className = "" }: { title: string; subtitle?: string; explore?: string | null; children: ReactNode; className?: string }) {
  return <section className={`intelligence-panel ${className}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2>{title}</h2>
      {explore ? <Link href={explore} className="text-sm font-medium text-[var(--fi-brick)] no-underline hover:underline">Open in Research →</Link> : null}
    </div>
    {subtitle ? <p className="mt-1 text-sm text-[var(--fi-muted)]">{subtitle}</p> : null}
    {children}
  </section>;
}

function Unavailable({ children }: { children: ReactNode }) {
  return <p role="status" className="mt-4 rounded-md bg-[var(--fi-surface-200)] p-4 text-sm text-[var(--fi-muted)]">{children}</p>;
}

function FeePanels({ data, selection, place, state, stateHrefs, compact, exploreHref }: {
  data: Loaded; selection: LandingResearchHandoff; place: string; state: string | null; stateHrefs: Record<string, string>; compact: boolean; exploreHref: string | null;
}) {
  const result = data.fees;
  const primary = selection.categories[0];
  const primaryName = primary ? getDisplayName(primary) : "Selected fee";
  const comparisons = result?.comparisons ?? [];
  const available = comparisons.filter(row => row.selected.status === "available");
  return <>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Panel title="Published fee landscape" subtitle={`${place} · ${CHARTER_LABEL[selection.charter]} · medians of one value per institution`} explore={exploreHref}>
        {!result ? <Unavailable>Published comparisons could not load. Refresh to retry; no substitute figures are shown.</Unavailable>
          : available.length ? <div className="mt-5"><FeeLandscapeChart state={state ? place : null} rows={comparisons.map(row => ({ fee: getDisplayName(row.category), selected: row.selected.median, national: row.national?.median ?? null }))} /></div>
          : <Unavailable>Too few institutions publish the selected fees here for a median. Missing observations are not $0 fees.</Unavailable>}
        {result ? <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Fee comparisons; scroll horizontally if needed">
          <table className="w-full text-left text-sm"><caption className="sr-only">Exact fee amounts, coverage and observation dates</caption>
            <thead><tr className="border-b border-[var(--fi-border)] text-xs uppercase tracking-wide text-[var(--fi-muted)]">{["Fee", "Median", "Middle half", "Institutions", ...(state ? ["U.S. median"] : []), "Latest record"].map(s => <th scope="col" key={s} className="p-2.5 font-semibold">{s}</th>)}</tr></thead>
            <tbody>{comparisons.map(row => <tr key={row.category} className="border-b border-[var(--fi-border)]">
              <th scope="row" className="p-2.5 font-medium">{getDisplayName(row.category)}</th>
              <td className="p-2.5 tabular-nums">{row.selected.status === "available" ? dollars(row.selected.median) : row.selected.status === "insufficient" ? "Too few to compare" : "Not observed"}</td>
              <td className="p-2.5 tabular-nums">{row.selected.p25 !== null && row.selected.p75 !== null ? `${dollars(row.selected.p25)}–${dollars(row.selected.p75)}` : "Unavailable"}</td>
              <td className="p-2.5 tabular-nums">{row.selected.institutions.toLocaleString()}</td>
              {state ? <td className="p-2.5 tabular-nums">{dollars(row.national?.median ?? null)}</td> : null}
              <td className="p-2.5">{row.selected.lastUpdated?.slice(0, 10) ?? "Not recorded"}</td>
            </tr>)}</tbody>
          </table>
        </div> : null}
        <EvidenceDetails source="Bank Fee Index · published fee catalog" period="Per-category record dates in the table" geography={place} coverage="Published consumer fees from the selected institution type; cohorts under the minimum are withheld" method="One value per institution; median and 25th–75th percentiles. State figures use the same institution type as the national reference. Missing is not zero; record dates are not a fresh schedule recheck." />
      </Panel>
      <Panel title={`${primaryName} by state`} subtitle={`Published median by state · ${CHARTER_LABEL[selection.charter]}${data.feeMap?.nationalMedian != null ? ` · U.S. ${dollars(data.feeMap.nationalMedian)}` : ""}`}>
        {data.feeMap && data.feeMap.states.length ? <div className="mt-4"><StateFeeMap states={data.feeMap.states} selected={state} hrefs={stateHrefs} feeLabel={primaryName} /></div>
          : <Unavailable>The state map could not load for {primaryName.toLowerCase()}.</Unavailable>}
        <EvidenceDetails source="Bank Fee Index · published fee catalog" period="Live catalog at page load" geography="States by institution headquarters" coverage={data.feeMap ? `${data.feeMap.nationalInstitutions.toLocaleString()} institutions publish this fee; states with too few are hatched` : "Unavailable"} method="One value per institution, median per state. A state shaded lighter has a lower published median; branches outside the headquarters state are not counted." />
      </Panel>
    </div>
    {data.peers ? <PeerTablePanel peers={data.peers} place={place} primaryName={primaryName} charter={selection.charter} compact={compact} exploreHref={exploreHref} /> : null}
  </>;
}

function PeerTablePanel({ peers, place, primaryName, charter, compact, exploreHref }: { peers: PeerTable; place: string; primaryName: string; charter: LandingResearchHandoff["charter"]; compact: boolean; exploreHref: string | null }) {
  const amounts = peers.rows.map(r => r.amount).sort((a, b) => a - b);
  return <Panel title={`Largest institutions in ${place}: ${primaryName.toLowerCase()}`} subtitle={`${peers.rows.length} shown of ${peers.institutionsInScope.toLocaleString()} ${CHARTER_LABEL[charter].toLowerCase()} in scope, largest by assets first`} explore={exploreHref}>
    {peers.rows.length ? <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Institutions and their published fee">
      <table className="w-full text-left text-sm"><caption className="sr-only">Published {primaryName} by institution with source documents</caption>
        <thead><tr className="border-b border-[var(--fi-border)] text-xs uppercase tracking-wide text-[var(--fi-muted)]">{["Institution", "Type", "Assets", primaryName, "Published", "Evidence"].map(h => <th key={h} scope="col" className="p-2.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{peers.rows.map(r => <tr key={r.institutionId} className="border-b border-[var(--fi-border)]">
          <th scope="row" className="p-2.5 font-medium"><Link href={`/pro/intelligence?view=institution&instId=${r.institutionId}`} className="text-[var(--fi-ink)] no-underline hover:underline">{r.name}</Link></th>
          <td className="p-2.5 text-[var(--fi-muted)]">{r.charter === "credit_union" ? "Credit union" : r.charter === "bank" ? "Bank" : "—"}</td>
          <td className="p-2.5 tabular-nums">{formatAssets(r.totalAssets)}</td>
          <td className="p-2.5 font-semibold tabular-nums">{dollars(r.amount)}</td>
          <td className="p-2.5 text-[var(--fi-muted)]">{r.publishedAt?.slice(0, 10) ?? "Not recorded"}</td>
          <td className="p-2.5">{r.documentUrl ? <a href={r.documentUrl} target="_blank" rel="noreferrer" className="text-[var(--fi-brick)]">Fee schedule ↗</a> : <span className="text-[var(--fi-muted)]">No link</span>}</td>
        </tr>)}</tbody>
      </table>
    </div> : <Unavailable>No institution in this scope publishes {primaryName.toLowerCase()} yet.</Unavailable>}
    {!compact && amounts.length ? <p className="mt-3 text-sm text-[var(--fi-muted)]">Among these {amounts.length}: lowest {dollars(amounts[0])}, highest {dollars(amounts[amounts.length - 1])}.</p> : null}
    <EvidenceDetails source="Bank Fee Index · published fee catalog; assets from FDIC and NCUA filings" period="Each row's published date" geography={place} coverage="Institutions in scope with a published value; others are not shown, not $0" method="One value per institution under the statistics contract; each links to the fee schedule it was read from." />
  </Panel>;
}

function FinancialPanel({ revenue, tiers, state, compact, exploreHref }: { revenue: RevenueTrend | null; tiers: TierRevenue[] | null; state: string | null; compact: boolean; exploreHref: string | null }) {
  const quarters = [...(revenue?.quarters ?? [])].reverse();
  const rows = quarters.map(q => ({ period: q.quarter, total: q.total_service_charges / 1_000_000, bank: q.bank_service_charges / 1_000_000, cu: q.cu_service_charges / 1_000_000 }));
  return <Panel title="Deposit service-charge income" subtitle={`United States · quarterly, USD billions${state ? " · a state aggregate is not available" : ""}`} explore={exploreHref}>
    {rows.length ? <div className="mt-4"><MultiTrend rows={rows} series={[{ key: "total", name: "All filers" }, { key: "bank", name: "Banks" }, { key: "cu", name: "Credit unions" }]} label="Deposit service-charge income" unit="USD billions" format="billions" height={compact ? 220 : 280} /></div>
      : <Unavailable>The national filing trend could not load.</Unavailable>}
    {!compact && revenue?.quarters.length ? <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Quarterly filings">
      <table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--fi-border)] text-xs uppercase tracking-wide text-[var(--fi-muted)]">{["Quarter", "All filers", "Banks", "Credit unions", "Year over year", "Filers"].map(h => <th key={h} scope="col" className="p-2.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{revenue.quarters.map(q => <tr key={q.quarter} className="border-b border-[var(--fi-border)] tabular-nums">
          <th scope="row" className="p-2.5 font-medium">{q.quarter}</th><td className="p-2.5">${(q.total_service_charges / 1_000_000).toFixed(2)}B</td><td className="p-2.5">${(q.bank_service_charges / 1_000_000).toFixed(2)}B</td><td className="p-2.5">${(q.cu_service_charges / 1_000_000).toFixed(2)}B</td><td className="p-2.5">{pct(q.yoy_change_pct)}</td><td className="p-2.5">{q.total_institutions.toLocaleString()}</td>
        </tr>)}</tbody></table>
    </div> : null}
    {!compact && tiers?.length ? <div className="mt-6"><h3 className="text-base font-semibold">By asset size, latest quarter</h3>
      <HorizontalBars label="Deposit service-charge income by asset size" valueLabel="USD billions" format="billions" rows={tiers.map(t => ({ name: `${TIER_LABEL[t.tier] ?? t.tier} (${t.institution_count.toLocaleString()})`, value: t.total_sc_income / 1_000_000 }))} />
    </div> : null}
    <EvidenceDetails source="FDIC Call Reports (RIAD 4080) and NCUA 5300 filings" period={revenue?.latest?.quarter ?? "Unavailable"} geography="United States" coverage="Banks and credit unions that filed a positive service-charge figure; coverage varies by quarter" method="Credit union year-to-date lines converted to quarters. Deposit service charges are not wire- or overdraft-specific income." />
  </Panel>;
}

function seriesPoints(s: IndicatorSeries | null | undefined) { return s?.history ?? null; }

function EconomyPanel({ economy, place, state, district, compact, exploreHref }: { economy: StateEconomicContext | null; place: string; state: string | null; district: number | null; compact: boolean; exploreHref: string | null }) {
  if (!economy) return <Panel title="Economic conditions" explore={exploreHref}><Unavailable>Economic series could not load.</Unavailable></Panel>;
  const since = `${new Date().getUTCFullYear() - 5}-01-01`;
  const jobs = joinSeries({ state: seriesPoints(economy.state_unemployment), us: seriesPoints(economy.national_unemployment) }, since);
  const prices = joinSeries({ bank: economy.cpi_bank_services ? yearOverYear(economy.cpi_bank_services.history) : null, all: economy.cpi_all_items ? yearOverYear(economy.cpi_all_items.history) : null }, since);
  const payrolls = economy.state_payrolls ? joinSeries({ payrolls: yearOverYear(economy.state_payrolls.history) }, since) : [];
  const rates = joinSeries({ funds: seriesPoints(economy.fed_funds) }, since);
  return <Panel title="Economic conditions" subtitle={state ? `${place} against the United States` : "United States"} explore={exploreHref}>
    <h3 className="mt-4 text-sm font-semibold">Unemployment rate</h3>
    {jobs.length ? <MultiTrend rows={jobs} series={[...(state ? [{ key: "state", name: place }] : []), { key: "us", name: "United States" }]} label="Unemployment rate" unit="percent" format="percent" height={compact ? 200 : 240} /> : <Unavailable>No unemployment series for this scope.</Unavailable>}
    <h3 className="mt-5 text-sm font-semibold">Prices: bank services against all items, twelve-month change</h3>
    {prices.length ? <MultiTrend rows={prices} series={[{ key: "bank", name: "Bank services" }, { key: "all", name: "All items" }]} label="Consumer price change" unit="percent over twelve months" format="percent" height={compact ? 200 : 240} /> : <Unavailable>Price series are unavailable.</Unavailable>}
    {!compact ? <>
      {payrolls.length ? <><h3 className="mt-5 text-sm font-semibold">{place} payroll jobs, twelve-month change</h3><MultiTrend rows={payrolls} series={[{ key: "payrolls", name: "Payroll jobs" }]} label="Payroll job growth" unit="percent" format="percent" /></> : null}
      {rates.length ? <><h3 className="mt-5 text-sm font-semibold">Federal funds rate</h3><MultiTrend rows={rates} series={[{ key: "funds", name: "Effective rate" }]} label="Federal funds rate" unit="percent" format="percent" />{economy.fomc ? <p className="mt-2 text-sm text-[var(--fi-muted)]">FOMC, {economy.fomc.meeting_date}: “{economy.fomc.policy_action}” <a href={economy.fomc.source_url} target="_blank" rel="noreferrer" className="text-[var(--fi-brick)]">Minutes ↗</a></p> : null}</> : null}
      {economy.beige_book && district ? <div className="mt-6 rounded-md bg-[var(--fi-surface-200)] p-4">
        <h3 className="text-sm font-semibold">Beige Book · {DISTRICT_NAMES[district] ?? `District ${district}`} district, {economy.beige_book.release_date}</h3>
        <p className="mt-2 text-sm leading-relaxed">{economy.beige_book.banking?.text ?? economy.beige_book.summary}</p>
        {economy.beige_book.themes.length ? <ul className="mt-3 flex flex-wrap gap-2">{economy.beige_book.themes.slice(0, 6).map(t => <li key={t.category} className="fi-tag">{t.category} · {t.sentiment}</li>)}</ul> : null}
        <p className="mt-2 text-xs text-[var(--fi-muted)]">District commentary covers the whole {DISTRICT_NAMES[district] ?? ""} Federal Reserve district, not {place} alone.{economy.beige_book.source_url ? <> <a href={economy.beige_book.source_url} target="_blank" rel="noreferrer" className="text-[var(--fi-brick)]">Source ↗</a></> : null}</p>
      </div> : null}
    </> : null}
    <EvidenceDetails source="BLS (LAUS, CES, CPI) and Federal Reserve, via FRED; Beige Book" period={[economy.state_unemployment?.latest.date, economy.national_unemployment?.latest.date, economy.cpi_bank_services?.latest.date].filter(Boolean).map(d => d!.slice(0, 7)).join(" · ") || "Unavailable"} geography={state ? `${place} and United States` : "United States"} coverage="Monthly observations as published; months BLS did not publish stay gaps" method="Rates as reported; price and payroll lines are twelve-month percent changes. State and national dates are shown separately." />
  </Panel>;
}

function ComplaintPanel({ complaints, place, compact, exploreHref }: { complaints: ComplaintTrend | null; place: string; compact: boolean; exploreHref: string | null }) {
  const years = complaints?.years ?? [];
  const latest = years[years.length - 1];
  return <Panel title="Consumer complaints" subtitle={`${place} · CFPB complaints matched to institutions headquartered here`} explore={exploreHref}>
    {!complaints ? <Unavailable>Complaint records could not load.</Unavailable> : years.length === 0 ? <Unavailable>No complaint records are matched to institutions in this scope.</Unavailable> : <>
      {latest ? <p className="mt-3 text-sm"><span className="text-2xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{latest.total.toLocaleString()}</span> complaints in {latest.year}, {latest.total ? `${((latest.feeRelated / latest.total) * 100).toFixed(1)}%` : "0%"} about fees, across {latest.institutions.toLocaleString()} institutions.</p> : null}
      <div className="mt-3"><MultiTrend rows={years.map(y => ({ period: y.year, total: y.total, fees: y.feeRelated }))} series={[{ key: "total", name: "All complaints" }, { key: "fees", name: "Fee-related" }]} label="Complaints per year" unit="complaints" height={compact ? 200 : 240} /></div>
      {!compact && complaints.products.length ? <div className="mt-5"><h3 className="text-sm font-semibold">Products complained about, {latest?.year}</h3><HorizontalBars label="Complaints by product" valueLabel="Complaints" rows={complaints.products.map(p => ({ name: p.product, value: p.count }))} /></div> : null}
    </>}
    <p className="mt-3 text-xs text-[var(--fi-muted)]">Counts reflect who complains and how complaints are matched; they do not rank institutions.</p>
    <EvidenceDetails source="CFPB Consumer Complaint Database" period={latest ? `${years[0].year}–${latest.year}` : "Unavailable"} geography={`${place}, by institution headquarters (not the consumer's location)`} coverage="Complaints matched to institutions in the registry; unmatched complaints are not counted" method="Annual totals; fee-related uses the shared fee-issue definition." />
  </Panel>;
}

function RegulationPanel({ articles, statePosts, place, compact, exploreHref }: { articles: RegArticle[] | null; statePosts: StatePost[] | null; place: string; compact: boolean; exploreHref: string | null }) {
  return <Panel title="Regulatory developments" subtitle="Federal releases, and the state regulator's own posts when a state is selected" explore={exploreHref ?? "/pro/news"}>
    {articles === null ? <Unavailable>Federal releases could not load.</Unavailable> : <ul className="mt-3 divide-y divide-[var(--fi-border)]">{articles.map(a => <li key={a.guid} className="py-3">
      <a className="font-medium text-[var(--fi-ink)] hover:underline" href={a.link} target="_blank" rel="noreferrer">{a.title}</a>
      <p className="mt-1 text-xs text-[var(--fi-muted)]">{SOURCE_LABELS[a.source] ?? a.source} · {a.published_at?.slice(0, 10) ?? "Date not recorded"} · {TOPIC_LABELS[a.topic] ?? a.topic}</p>
    </li>)}</ul>}
    {statePosts?.length ? <><h3 className="mt-4 text-sm font-semibold">{place} regulator</h3><ul className="mt-1 divide-y divide-[var(--fi-border)]">{statePosts.slice(0, compact ? 3 : 6).map(p => <li key={p.link} className="py-3"><a className="font-medium text-[var(--fi-ink)] hover:underline" href={p.link} target="_blank" rel="noreferrer">{p.title}</a><p className="mt-1 text-xs text-[var(--fi-muted)]">{p.publishedAt ?? "Date not recorded"}</p></li>)}</ul></> : null}
    <p className="mt-3 text-xs text-[var(--fi-muted)]">Listed as each agency published them; applicability to your institution is not assessed.</p>
    <EvidenceDetails source="Federal Reserve, FDIC, OCC and CFPB releases; state regulator posts (Regulatory Wire)" period="Per-item publication dates" geography="Publisher's own scope" coverage="Indexed releases, not an exhaustive rule inventory" method="Linked to the original publisher; no legal conclusion is drawn." />
  </Panel>;
}
