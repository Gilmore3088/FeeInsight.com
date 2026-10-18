import Link from "next/link";
import type { ReactNode } from "react";
import { decodeLandingResearch, encodeLandingResearch, RESEARCH_STATE_CODES, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import { loadLandingGeographicResearch, type GeographicResearchResult } from "@/lib/hamilton/landing-geographic-research";
import { getStateEconomicContext, type IndicatorSeries, type StateEconomicContext } from "@/lib/data-store/economic-context";
import { getRevenueByTier, getRevenueTrend, type RevenueTrend, type TierRevenue } from "@/lib/data-store/call-reports";
import { getArticles, SOURCE_LABELS, TOPIC_LABELS, type RegArticle } from "@/lib/data-store/news";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { proseFeeName } from "@/lib/hamilton/workspace/names";
import { STATE_NAMES } from "@/lib/us-states";
import { STATE_TO_DISTRICT, DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatAssets } from "@/lib/format";
import {
  joinSeries, loadComplaintTrend, loadFeeMap, loadPeerTable, loadStatePosts, percentChange, yearOverYear,
  type ComplaintTrend, type FeeMap, type FeeSpread, type PeerTable, type StatePost,
} from "@/lib/hamilton/intelligence-data";
import { INTELLIGENCE_LENSES, MARKET_BRIEF_CATEGORIES, type Lens } from "@/lib/hamilton/market-question";
import { assetSizeFor, type AssetSize } from "@/lib/hamilton/asset-size";
import { ScopeControls } from "./ScopeControls";
import { BoardBriefButton } from "./BoardBriefButton";
import { EvidenceDetails } from "./EvidenceDetails";
import { FeeLandscapeChart, HorizontalBars, MultiTrend, StateFeeMap } from "./IntelligenceCharts";
import { LandingResearchResults } from "@/components/hamilton/landing/LandingResearchResults";

const LENSES = INTELLIGENCE_LENSES;
export type { Lens };

const DEFAULT: LandingResearchHandoff = { version: 1, task: "compare", scope: { kind: "national" }, charter: "all", categories: [...MARKET_BRIEF_CATEGORIES] };
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
export async function IntelligenceWorkspace({ params, overview = false }: { params: { research?: string; lens?: string; instId?: string; size?: string }; overview?: boolean }) {
  let selection: LandingResearchHandoff;
  try { selection = decodeLandingResearch(params.research) ?? DEFAULT; }
  catch { return <p role="alert">This research selection is invalid. <Link href={overview ? "/pro/hamilton" : "/pro/intelligence"}>Reset selection</Link></p>; }
  if (selection.scope.kind === "local") return <LandingResearchResults selection={{ ...selection, task: "compare" }} />;
  selection = { ...selection, task: "compare" };
  const lens: Lens = LENSES.find(l => l.id === params.lens)?.id ?? "fees";
  const size = assetSizeFor(params.size);
  const data = await loadIntelligence(selection, overview ? LENSES.map(l => l.id) : [lens], { compact: overview, segment: size.id === "all" ? null : size });
  return <IntelligenceView selection={selection} data={data} lens={lens} overview={overview} instId={params.instId} size={size} />;
}

/** Loads only what the chosen lenses show, in parallel; a reader that fails leaves its slot null. */
export async function loadIntelligence(selection: LandingResearchHandoff, lenses: readonly Lens[], { compact, segment = null }: { compact: boolean; segment?: { minAssets: number | null; maxAssets: number | null; tiers?: readonly string[] | null } | null }): Promise<Loaded> {
  const state = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const district = state ? STATE_TO_DISTRICT[state] ?? null : null;
  const primary = selection.categories[0];
  const want = (id: Lens) => lenses.includes(id);
  const tiers = segment?.tiers ?? null;
  return Object.fromEntries(await Promise.all(([
    ["fees", want("fees") ? loadLandingGeographicResearch(selection, undefined, tiers).catch(() => null) : null],
    ["feeMap", want("fees") && primary ? loadFeeMap(primary, selection.charter, state, tiers) : null],
    ["peers", want("fees") && primary && (state || !compact) ? loadPeerTable(state, selection.charter, primary, compact ? 10 : 25, segment) : null],
    ["revenue", want("financials") ? getRevenueTrend(12).catch(() => null) : null],
    ["tiers", !compact && want("financials") ? getRevenueByTier().catch(() => null) : null],
    ["economy", want("economy") ? getStateEconomicContext(state ?? "US", district).catch(() => null) : null],
    ["complaints", want("complaints") ? loadComplaintTrend(state) : null],
    ["articles", want("regulation") ? getArticles({ limit: compact ? 5 : 12 }).catch(() => null) : null],
    ["statePosts", want("regulation") && state ? loadStatePosts(state) : null],
  ] as const).map(async ([key, value]) => [key, await value]))) as unknown as Loaded;
}

/** The rendered workspace for already-loaded data; kept apart from loading so it can be checked with sample data. */
export function IntelligenceView({ selection, data, lens, overview, instId, size = assetSizeFor(null) }: { selection: LandingResearchHandoff; data: Loaded; lens: Lens; overview: boolean; instId?: string; size?: AssetSize }) {
  const state = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const place = state ? STATE_NAMES[state] ?? state : "United States";
  const pathname = overview ? "/pro/hamilton" : "/pro/intelligence";
  const primary = selection.categories[0];
  const sized: Record<string, string> = size.id === "all" ? {} : { size: size.id };
  const lensHref = (id: Lens) => `/pro/intelligence?${new URLSearchParams({ research: encodeLandingResearch(selection), lens: id, ...sized })}`;
  const stateHrefs = stateLinks(selection, pathname, overview ? undefined : lens, size.id);

  const askHref = `/pro/analyze?${new URLSearchParams({ research: encodeLandingResearch(selection), ...(instId ? { instId: instId } : {}) })}`;
  const panels = lensPanels({ data, selection, stateHrefs, compact: overview, explore: id => overview ? lensHref(id) : null, size });

  return <div className="mx-auto flex max-w-7xl flex-col gap-7">
    <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:text-left">
      <div>
        <p className="fi-text-label text-[var(--fi-muted)]">{overview ? "Intelligence overview" : "Research"}</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{overview ? (state ? `${place}: fees, finances and market` : "The U.S. fee landscape") : `Research · ${place}`}</h1>
        <p className="mt-2 text-[var(--fi-muted)]">{CHARTER_LABEL[selection.charter]} · {overview ? "What is happening, how it compares, and where to look next." : "Explore the evidence behind your next decision."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={askHref} className="fi-btn fi-btn-secondary no-underline">Ask Hamilton about {state ? place : "this market"}</Link>
        <BoardBriefButton selection={selection} lenses={overview ? LENSES.map(l => l.id) : [lens]} size={size.id} />
      </div>
    </header>
    <ScopeControls selection={selection} pathname={pathname} lens={lens} size={size.id} />
    {size.id !== "all" ? <p className="-mt-3 text-xs text-[var(--fi-muted)]">{size.label}: the fee exhibits, including the U.S. reference, cover institutions of this size. The institution table sorts by each one&apos;s latest reported assets. Financials, economy, complaints and regulation cover every size.</p> : null}
    {overview ? <HamiltonRead data={data} place={place} state={state} primary={primary} /> : null}
    {overview ? <>
      {panels.fees}
      {panels.financials}
      {panels.economy}
      {panels.complaints}
      {panels.regulation}
      <Link className="text-sm font-medium text-[var(--fi-ink)] underline" href={`/pro/intelligence?${new URLSearchParams({ view: "institution", ...(instId ? { instId: instId } : {}) })}`}>Open your institution&apos;s monthly briefing</Link>
    </> : <>
      <nav aria-label="Research lenses" className="intelligence-tabs">{LENSES.map(l => <Link key={l.id} href={lensHref(l.id)} aria-current={lens === l.id ? "page" : undefined}>{l.label}</Link>)}</nav>
      {panels[lens]}
    </>}
  </div>;
}

/** Each lens's exhibits for loaded data; Overview, Research and the Ask market brief share them. */
export function lensPanels({ data, selection, stateHrefs, compact, explore, peerNote, size = assetSizeFor(null) }: {
  data: Loaded; selection: LandingResearchHandoff; stateHrefs: Record<string, string>; compact: boolean; explore: (id: Lens) => string | null; peerNote?: string; size?: AssetSize;
}): Record<Lens, ReactNode> {
  const state = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const place = state ? STATE_NAMES[state] ?? state : "United States";
  const district = state ? STATE_TO_DISTRICT[state] ?? null : null;
  return {
    fees: <FeePanels data={data} selection={selection} place={place} state={state} stateHrefs={stateHrefs} compact={compact} exploreHref={explore("fees")} peerNote={peerNote ?? (size.id === "all" ? undefined : `(${size.label} only)`)} sizeNote={size.id === "all" ? undefined : `(${size.label} only)`} focusHref={category => feeFocusHref(selection, category, size)} />,
    financials: <FinancialPanel revenue={data.revenue} tiers={data.tiers} state={state} compact={compact} exploreHref={explore("financials")} />,
    economy: <EconomyPanel economy={data.economy} place={place} state={state} district={district} compact={compact} exploreHref={explore("economy")} />,
    complaints: <ComplaintPanel complaints={data.complaints} place={place} compact={compact} exploreHref={explore("complaints")} />,
    regulation: <RegulationPanel articles={data.articles} statePosts={data.statePosts} place={place} compact={compact} exploreHref={explore("regulation")} />,
  };
}

/** Links that open each state in the same view. */
export function stateLinks(selection: LandingResearchHandoff, path: string, lens?: Lens, size?: string): Record<string, string> {
  return Object.fromEntries(RESEARCH_STATE_CODES.map(code => [code, `${path}?${new URLSearchParams({ research: encodeLandingResearch({ ...selection, scope: { kind: "state", stateCode: code } }), ...(lens ? { lens } : {}), ...(size && size !== "all" ? { size } : {}) })}`]));
}

/** Research on the fees lens with one fee in focus: its map, spread and institutions; the other fees stay in the landscape. */
export function feeFocusHref(selection: LandingResearchHandoff, category: string, size?: AssetSize): string {
  const categories = [category, ...selection.categories.filter(c => c !== category)].slice(0, 5);
  return `/pro/intelligence?${new URLSearchParams({ research: encodeLandingResearch({ ...selection, categories }), lens: "fees", ...(size && size.id !== "all" ? { size: size.id } : {}) })}`;
}

/** A display name mid-sentence: "Non-Network ATM" becomes "non-network ATM"; acronyms keep their case. */
function midSentence(name: string): string {
  return name.split(" ").map((w) => (/^\(?[A-Z0-9']{2,5}\)?$/.test(w) ? w : w.toLowerCase())).join(" ");
}

export interface Finding { lens: Lens; title: string; body: string; source: string }

/** Observed facts from loaded data, one per lens at most, each naming its source; no interpretation, no pricing advice. */
export function readFindings(data: Loaded, place: string, state: string | null, primary: string | undefined): Finding[] {
  const findings: Finding[] = [];
  const row = data.fees?.comparisons.find(c => c.category === primary) ?? data.fees?.comparisons.find(c => c.selected.status === "available");
  if (row && row.selected.status === "available") {
    const fee = proseFeeName(row.category);
    findings.push({
      lens: "fees",
      title: `${place}'s median ${fee} is ${dollars(row.selected.median)}.`,
      body: `Across ${row.selected.institutions.toLocaleString()} institutions with a published amount${state && row.national?.median != null ? (row.difference != null && Math.abs(row.difference) < 0.005 ? `, the same as the ${dollars(row.national.median)} national median` : `, against ${dollars(row.national.median)} nationally (${row.difference != null ? `${row.difference >= 0 ? "+" : "-"}${dollars(Math.abs(row.difference))}` : "difference unavailable"})`) : ""}. The middle half runs ${dollars(row.selected.p25)} to ${dollars(row.selected.p75)}.`,
      source: "Bank Fee Index published catalog",
    });
  }
  const latest = data.revenue?.latest;
  if (latest) {
    findings.push({
      lens: "financials",
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
      lens: "economy",
      title: `${place} unemployment is ${e.state_unemployment.latest.value.toFixed(1)}%.`,
      body: `${e.national_unemployment ? `The U.S. rate is ${e.national_unemployment.latest.value.toFixed(1)}% (${e.national_unemployment.latest.date.slice(0, 7)})` : "The U.S. comparison is unavailable"}; state figure as of ${e.state_unemployment.latest.date.slice(0, 7)}.`,
      source: "BLS via FRED",
    });
  } else if (bankYoY !== null) {
    findings.push({
      lens: "economy",
      title: `Prices for bank services rose ${pct(bankYoY)} over twelve months.`,
      body: `${allYoY !== null ? `All consumer prices rose ${pct(allYoY)} over the same period` : "The all-items comparison is unavailable"}, to ${bank!.latest.date.slice(0, 7)}.`,
      source: "BLS consumer price index via FRED",
    });
  }
  const years = data.complaints?.years ?? [];
  const year = years[years.length - 1];
  if (year && year.total > 0) {
    const prior = years[years.length - 2];
    findings.push({
      lens: "complaints",
      title: `${year.total.toLocaleString()} CFPB complaints in ${yearLabel(year.year)} named institutions headquartered in ${place}.`,
      body: `${((year.feeRelated / year.total) * 100).toFixed(1)}% were about fees${prior ? `; ${prior.year}${isCurrentYear(year.year) ? ", a full year," : ""} had ${prior.total.toLocaleString()}` : ""}. Counts follow who complains and how complaints are matched, so they do not rank institutions.`,
      source: "CFPB Consumer Complaint Database",
    });
  }
  const release = data.articles?.[0];
  if (release) {
    findings.push({
      lens: "regulation",
      title: `The latest federal release on file: “${release.title}”.`,
      body: `${SOURCE_LABELS[release.source] ?? release.source}, ${release.published_at?.slice(0, 10) ?? "date not recorded"}${data.statePosts?.length ? `. The ${place} regulator's latest post: “${data.statePosts[0].title}”` : ""}. Listed as published; applicability to an institution is not assessed.`,
      source: "Regulatory Wire",
    });
  }
  return findings;
}

/** Overview: the first three facts. */
function HamiltonRead({ data, place, state, primary }: { data: Loaded; place: string; state: string | null; primary: string | undefined }) {
  const findings = readFindings(data, place, state, primary).slice(0, 3);
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

function FeePanels({ data, selection, place, state, stateHrefs, compact, exploreHref, peerNote, sizeNote, focusHref }: {
  data: Loaded; selection: LandingResearchHandoff; place: string; state: string | null; stateHrefs: Record<string, string>; compact: boolean; exploreHref: string | null; peerNote?: string; sizeNote?: string; focusHref: (category: string) => string;
}) {
  const result = data.fees;
  const primary = selection.categories[0];
  const primaryName = primary ? getDisplayName(primary) : "Selected fee";
  const comparisons = result?.comparisons ?? [];
  const available = comparisons.filter(row => row.selected.status === "available");
  const focusable = [...new Set([...selection.categories, ...MARKET_BRIEF_CATEGORIES])];
  return <>
    {!compact ? <nav aria-label="Fee in focus" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-[var(--fi-muted)]">Drill into a fee:</span>
      {focusable.map(category => <Link key={category} href={focusHref(category)} aria-current={category === primary ? "true" : undefined}
        className={`rounded-full border px-3 py-1 no-underline ${category === primary ? "border-[var(--fi-ink)] bg-[var(--fi-ink)] text-white" : "border-[var(--fi-control-border)] text-[var(--fi-ink)] hover:border-[var(--fi-ink)]"}`}>{getDisplayName(category)}</Link>)}
    </nav> : null}
    <div className="flex flex-col gap-6">
      <Panel title="Published fee landscape" subtitle={`${place} · ${CHARTER_LABEL[selection.charter]}${sizeNote ? ` ${sizeNote}` : ""} · medians of one value per institution`} explore={exploreHref}>
        {!result ? <Unavailable>Published comparisons could not load. Refresh to retry; no substitute figures are shown.</Unavailable>
          : available.length ? <div className="mt-5"><FeeLandscapeChart state={state ? place : null} rows={comparisons.map(row => ({ fee: getDisplayName(row.category), selected: row.selected.median, national: row.national?.median ?? null }))} /></div>
          : <Unavailable>Too few institutions publish the selected fees here for a median. Missing observations are not $0 fees.</Unavailable>}
        {result ? <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Fee comparisons; scroll horizontally if needed">
          <table className="w-full text-left text-sm"><caption className="sr-only">Exact fee amounts, coverage and observation dates</caption>
            <thead><tr className="border-b border-[var(--fi-border)] text-xs uppercase tracking-wide text-[var(--fi-muted)]">{["Fee", "Median", "Middle half", "Institutions", ...(state ? ["U.S. median"] : []), "Latest record"].map(s => <th scope="col" key={s} className="p-2.5 font-semibold">{s}</th>)}</tr></thead>
            <tbody>{comparisons.map(row => <tr key={row.category} className="border-b border-[var(--fi-border)]">
              <th scope="row" className="p-2.5 font-medium"><Link href={focusHref(row.category)} className="text-[var(--fi-ink)] underline decoration-[var(--fi-border)] underline-offset-2 hover:decoration-[var(--fi-ink)]">{getDisplayName(row.category)}</Link></th>
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
      <Panel title={`${primaryName} by state`} subtitle={`Published median by state · ${CHARTER_LABEL[selection.charter]}${sizeNote ? ` ${sizeNote}` : ""}${data.feeMap?.nationalMedian != null ? ` · U.S. ${dollars(data.feeMap.nationalMedian)}` : ""}`}>
        {data.feeMap && data.feeMap.states.length ? <div className="mt-4"><StateFeeMap states={data.feeMap.states} selected={state} hrefs={stateHrefs} feeLabel={primaryName} /></div>
          : <Unavailable>The state map could not load for {midSentence(primaryName)}.</Unavailable>}
        <EvidenceDetails source="Bank Fee Index · published fee catalog" period="Live catalog at page load" geography="States by institution headquarters" coverage={data.feeMap ? `${data.feeMap.nationalInstitutions.toLocaleString()} institutions publish this fee; states with too few are hatched` : "Unavailable"} method="One value per institution, median per state. A state shaded lighter has a lower published median; branches outside the headquarters state are not counted." />
      </Panel>
    </div>
    {!compact && data.feeMap?.spread ? <SpreadPanel spread={data.feeMap.spread} place={place} primaryName={primaryName} charter={selection.charter} note={sizeNote} /> : null}
    {data.peers ? <PeerTablePanel peers={data.peers} place={place} primaryName={primaryName} charter={selection.charter} compact={compact} exploreHref={exploreHref} note={peerNote} /> : null}
  </>;
}

function PeerTablePanel({ peers, place, primaryName, charter, compact, exploreHref, note }: { peers: PeerTable; place: string; primaryName: string; charter: LandingResearchHandoff["charter"]; compact: boolean; exploreHref: string | null; note?: string }) {
  const amounts = peers.rows.map(r => r.amount).sort((a, b) => a - b);
  return <Panel title={`Largest institutions in ${place}: ${midSentence(primaryName)}`} subtitle={`${peers.rows.length} shown of ${peers.institutionsInScope.toLocaleString()} ${CHARTER_LABEL[charter].toLowerCase()}${note ? ` ${note}` : ""} in scope, largest by assets first`} explore={exploreHref}>
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
    </div> : <Unavailable>No institution in this scope publishes {midSentence(primaryName)} yet.</Unavailable>}
    {!compact && amounts.length ? <p className="mt-3 text-sm text-[var(--fi-muted)]">Among these {amounts.length}: lowest {dollars(amounts[0])}, highest {dollars(amounts[amounts.length - 1])}.</p> : null}
    <EvidenceDetails source="Bank Fee Index · published fee catalog; assets from FDIC and NCUA filings" period="Each row's published date" geography={place} coverage="Institutions in scope with a published value; others are not shown, not $0" method="One value per institution under the statistics contract; each links to the fee schedule it was read from." />
  </Panel>;
}

function SpreadPanel({ spread, place, primaryName, charter, note }: { spread: FeeSpread; place: string; primaryName: string; charter: LandingResearchHandoff["charter"]; note?: string }) {
  const money = (v: number) => Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
  const range = (from: number, to: number) => `${money(from)} to ${money(to)}`;
  const where = place === "United States" ? "the United States" : place;
  const medianBin = spread.bins.find(b => spread.median >= b.from && spread.median < b.to) ?? spread.bins[spread.bins.length - 1];
  return <Panel title={`${primaryName}: how ${where} prices it`} subtitle={`${spread.count.toLocaleString()} ${CHARTER_LABEL[charter].toLowerCase()}${note ? ` ${note}` : ""} with a published amount · institutions per price band`}>
    <p className="mt-3 text-sm">Median <strong className="tabular-nums">{dollars(spread.median)}</strong>; the middle half charge <span className="tabular-nums">{dollars(spread.p25)}</span> to <span className="tabular-nums">{dollars(spread.p75)}</span>. Published amounts run from <span className="tabular-nums">{dollars(spread.low)}</span> to <span className="tabular-nums">{dollars(spread.high)}</span>.</p>
    <div className="mt-4"><HorizontalBars label={`Institutions by ${primaryName} price band`} valueLabel="Institutions" highlight={range(medianBin.from, medianBin.to)} rows={spread.bins.map(b => ({ name: range(b.from, b.to), value: b.count }))} /></div>
    <table className="sr-only"><caption>Institutions per {primaryName} price band</caption><thead><tr><th scope="col">Price band</th><th scope="col">Institutions</th></tr></thead>
      <tbody>{spread.bins.map(b => <tr key={b.from}><th scope="row">{range(b.from, b.to)}</th><td>{b.count}</td></tr>)}</tbody></table>
    <p className="mt-2 text-xs text-[var(--fi-muted)]">Each band includes its lower amount and stops just under its upper one. The highlighted band holds the median.</p>
    <EvidenceDetails source="Bank Fee Index · published fee catalog" period="Live catalog at page load" geography={place} coverage={`Every institution in scope with a published ${primaryName} amount; institutions without one are not counted as $0`} method="One value per institution, read the same way as the landscape table, so the median and middle half match it. Even-width price bands." />
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

/** The current calendar year is still being counted, so its total is labelled as partial. */
function isCurrentYear(year: string | number): boolean {
  return Number(year) === new Date().getUTCFullYear();
}

function yearLabel(year: string | number): string {
  return isCurrentYear(year) ? `${year} to date` : String(year);
}

function ComplaintPanel({ complaints, place, compact, exploreHref }: { complaints: ComplaintTrend | null; place: string; compact: boolean; exploreHref: string | null }) {
  const years = complaints?.years ?? [];
  const latest = years[years.length - 1];
  return <Panel title="Consumer complaints" subtitle={`${place} · CFPB complaints matched to institutions headquartered here`} explore={exploreHref}>
    {!complaints ? <Unavailable>Complaint records could not load.</Unavailable> : years.length === 0 ? <Unavailable>No complaint records are matched to institutions in this scope.</Unavailable> : <>
      {latest ? <p className="mt-3 text-sm"><span className="text-2xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{latest.total.toLocaleString()}</span> complaints in {yearLabel(latest.year)}, {latest.total ? `${((latest.feeRelated / latest.total) * 100).toFixed(1)}%` : "0%"} about fees, across {latest.institutions.toLocaleString()} institutions.</p> : null}
      <div className="mt-3"><MultiTrend rows={years.map(y => ({ period: isCurrentYear(y.year) ? `${y.year} to date` : y.year, total: y.total, fees: y.feeRelated }))} series={[{ key: "total", name: "All complaints" }, { key: "fees", name: "Fee-related" }]} label="Complaints per year" unit="complaints" height={compact ? 200 : 240} /></div>
      {!compact && complaints.products.length ? <div className="mt-5"><h3 className="text-sm font-semibold">Products complained about, {latest ? yearLabel(latest.year) : null}</h3><HorizontalBars label="Complaints by product" valueLabel="Complaints" rows={complaints.products.map(p => ({ name: p.product, value: p.count }))} /></div> : null}
    </>}
    <p className="mt-3 text-xs text-[var(--fi-muted)]">Counts reflect who complains and how complaints are matched; they do not rank institutions.</p>
    <EvidenceDetails source="CFPB Consumer Complaint Database" period={latest ? `${years[0].year}–${latest.year}${isCurrentYear(latest.year) ? " (latest year to date)" : ""}` : "Unavailable"} geography={`${place}, by institution headquarters (not the consumer's location)`} coverage="Complaints matched to institutions in the registry; unmatched complaints are not counted" method="Annual totals; the current year counts complaints received so far. Fee-related uses the shared fee-issue definition." />
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
