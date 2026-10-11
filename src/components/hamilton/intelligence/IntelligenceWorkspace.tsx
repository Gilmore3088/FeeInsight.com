import Link from "next/link";
import { decodeLandingResearch, encodeLandingResearch, landingResearchHref, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import { loadLandingGeographicResearch } from "@/lib/hamilton/landing-geographic-research";
import { getStateEconomicContext } from "@/lib/data-store/economic-context";
import { getRevenueTrend } from "@/lib/data-store/call-reports";
import { getArticles } from "@/lib/data-store/news";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { STATE_NAMES } from "@/lib/us-states";
import { ScopeControls } from "./ScopeControls";
import { EvidenceDetails } from "./EvidenceDetails";
import { FeeLandscapeChart, IntelligenceTrend } from "./IntelligenceCharts";
import { LandingResearchResults } from "@/components/hamilton/landing/LandingResearchResults";

const LENSES = [{ id: "fees", label: "Fee landscape" }, { id: "financials", label: "Financials" }, { id: "economy", label: "Economy" }, { id: "complaints", label: "Complaints" }, { id: "regulation", label: "Regulation" }];
const DEFAULT: LandingResearchHandoff = { version: 1, task: "compare", scope: { kind: "national" }, charter: "all", categories: ["monthly_maintenance", "wire_domestic_outgoing", "atm_non_network"] };
const dollars = (v: number | null) => v === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

export async function IntelligenceWorkspace({ params, overview = false }: { params: { research?: string; lens?: string; instId?: string }; overview?: boolean }) {
  let selection: LandingResearchHandoff;
  try { selection = decodeLandingResearch(params.research) ?? DEFAULT; }
  catch { return <p role="alert">This research selection is invalid. <Link href={overview ? "/pro/hamilton" : "/pro/intelligence"}>Reset selection</Link></p>; }
  if (selection.scope.kind === "local") return <LandingResearchResults selection={{ ...selection, task: "compare" }} />;
  selection = { ...selection, task: "compare" };
  const state = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const place = state ? STATE_NAMES[state] ?? state : "United States";
  const lens = LENSES.some(l => l.id === params.lens) ? params.lens! : "fees";
  const pathname = overview ? "/pro/hamilton" : "/pro/intelligence";
  const scopedHref = (id: string) => `/pro/intelligence?${new URLSearchParams({ research: encodeLandingResearch(selection), lens: id, ...(params.instId ? { instId: params.instId } : {}) })}`;
  const askHref = `/pro/analyze?${new URLSearchParams({ research: encodeLandingResearch(selection), q: `What should we review about ${place}'s fee landscape and market conditions?`, ...(params.instId ? { instId: params.instId } : {}) })}`;
  return <div className="mx-auto flex max-w-6xl flex-col gap-7">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold sm:text-4xl">{overview ? "Intelligence overview" : "Research"}</h1><p className="mt-2 text-warm-600">{overview ? `What is happening across ${state ? place : "the U.S. banking landscape"}?` : "Explore the evidence behind your next decision."}</p></div>
      <Link href={landingResearchHref({ ...selection, task: "board_report" })} className="rounded-md bg-terra px-5 py-3 text-sm font-medium text-white no-underline">Build board brief</Link></header>
    <Link className="text-sm text-terra-text underline" href={`/pro/intelligence?${new URLSearchParams({ view: "institution", ...(params.instId ? { instId: params.instId } : {}) })}`}>Open institution briefing</Link>
    <ScopeControls selection={selection} pathname={pathname} lens={lens} />
    <nav aria-label="Research lenses" className="intelligence-tabs">{LENSES.map(l => <Link key={l.id} href={`${pathname}?${new URLSearchParams({ research: encodeLandingResearch(selection), lens: l.id })}`} aria-current={lens === l.id ? "page" : undefined}>{l.label}</Link>)}</nav>
    {lens === "fees" ? <FeeLens selection={selection} place={place} state={state} overview={overview} /> : null}
    {lens === "economy" ? <EconomyLens state={state} place={place} /> : null}
    {lens === "financials" ? <FinancialLens state={state} /> : null}
    {lens === "complaints" ? <section className="intelligence-panel"><h2>Consumer complaints</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-warm-700">Inspect complaints for a named institution in the existing institution research view. A comparable state or national trend with reporting periods is not available in this view yet.</p><p className="mt-3 text-sm text-warm-700">Complaint counts reflect reporting and coverage; they do not rank institution quality.</p><Link className="mt-5 inline-block text-terra-text underline" href="/pro/data">Find an institution</Link><EvidenceDetails source="CFPB Consumer Complaint Database" period="Select an institution to inspect recorded years" geography={place} coverage="Institution records; geographic aggregate coverage not verified" method="Consumer-reported complaints; no unsupported peer ranking" /></section> : null}
    {lens === "regulation" ? <RegulationLens /> : null}
    {overview ? <section><h2 className="text-lg font-semibold">Connected intelligence</h2><div className="mt-4 grid gap-4 sm:grid-cols-3">{LENSES.filter(l => ["financials", "economy", "complaints"].includes(l.id)).map(l => <Link className="intelligence-panel no-underline hover:border-terra" href={scopedHref(l.id)} key={l.id}><h3 className="font-semibold">{l.label} →</h3><p className="mt-2 text-sm text-warm-600">Explore reporting periods, comparisons and underlying evidence.</p></Link>)}</div></section> : null}
    <Link className="rounded-md border border-warm-300 bg-white p-4 text-sm text-terra-text no-underline" href={askHref}>Ask Hamilton about this market →</Link>
  </div>;
}

async function FeeLens({ selection, place, state, overview }: { selection: LandingResearchHandoff; place: string; state: string | null; overview: boolean }) {
  const result = await loadLandingGeographicResearch(selection).catch(() => null);
  if (!result) return <section className="intelligence-panel" role="status"><h2>Fee landscape temporarily unavailable</h2><p className="mt-3 text-sm text-warm-700">Published comparisons could not load. Refresh this page to retry; no substitute figures are shown.</p></section>;
  const available = result.comparisons.filter(row => row.selected.status === "available");
  const ranged = available.filter(row => row.selected.p25 !== null && row.selected.p75 !== null && row.selected.p75 > row.selected.p25);
  return <>
    <section className="intelligence-read"><h2 className="font-semibold">Hamilton’s read <span className="font-normal text-warm-600">· Interpretation</span></h2><ol>
      <li><strong>{available.length} of {result.comparisons.length} selected fees have a supported median.</strong>Thin or missing cohorts are withheld from comparison.</li>
      <li><strong>{ranged.length ? "Published fees vary within the market." : "Compare equivalent terms."}</strong>{ranged.length ? "Review the middle half of observed amounts in the evidence table before drawing a pricing conclusion." : "Charging basis, products and waivers matter alongside the published amount."}</li>
      <li><strong>{state ? "Keep a national reference." : "Explore a regional market."}</strong>{state ? "State and U.S. figures use the same institution-type filter." : "Select a state to compare its published fees with the same national cohort."}</li>
    </ol></section>
    <section className="intelligence-panel"><h2>Published fee landscape</h2><p className="mt-1 text-sm text-warm-600">{place} · {selection.charter === "all" ? "Banks & credit unions" : selection.charter === "bank" ? "Banks" : "Credit unions"} · Verified-only consumer fee benchmark</p>
      {available.length ? <div className="mt-5"><FeeLandscapeChart state={state ? place : null} rows={result.comparisons.map(row => ({ fee: getDisplayName(row.category), selected: row.selected.median, national: row.national?.median ?? null }))} /></div> : <p className="mt-5 text-sm">Insufficient published evidence for the selected fees. Missing observations are not $0 fees.</p>}
      <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Fee comparisons; scroll horizontally if needed"><table className="w-full text-left text-sm"><caption className="sr-only">Exact fee amounts, coverage and observation dates</caption><thead><tr className="border-b border-warm-300">{["Fee", "Median", "Middle half", "Institutions", ...(state ? ["U.S. median"] : []), "As of"].map(s => <th scope="col" key={s} className="p-3">{s}</th>)}</tr></thead><tbody>{result.comparisons.map(row => <tr key={row.category} className="border-b border-warm-200"><th scope="row" className="p-3 font-medium">{getDisplayName(row.category)}</th><td className="p-3">{row.selected.status === "available" ? dollars(row.selected.median) : row.selected.status === "insufficient" ? "Insufficient evidence" : "Not observed"}</td><td className="p-3">{row.selected.p25 !== null && row.selected.p75 !== null ? `${dollars(row.selected.p25)}–${dollars(row.selected.p75)}` : "Unavailable"}</td><td className="p-3">{row.selected.institutions.toLocaleString()}</td>{state ? <td className="p-3">{dollars(row.national?.median ?? null)}</td> : null}<td className="p-3">{row.selected.lastUpdated?.slice(0,10) ?? "Not recorded"}</td></tr>)}</tbody></table></div>
      <EvidenceDetails source="Bank Fee Index · published fee catalog" period="Per-category observation dates shown in the table" geography={place} coverage="Qualifying published consumer fees from the selected institution cohort; limited cohorts withheld" method="Institution-level medians and 25th–75th percentiles. Same-charter national reference. Missing is not zero. Published record dates are not a fresh schedule recheck." />
    </section>
    {overview && !state ? <Link href={`/pro/hamilton?${new URLSearchParams({ research: encodeLandingResearch({ ...selection, scope: { kind: "state", stateCode: "FL" } }) })}`} className="intelligence-panel text-terra-text no-underline"><h2>Explore Florida →</h2><p className="mt-2 text-sm text-warm-600">Compare state and national conditions using the same research scope.</p></Link> : null}
  </>;
}

async function EconomyLens({ state, place }: { state: string | null; place: string }) {
  const data = await getStateEconomicContext(state ?? "US", null).catch(() => null);
  const series = state ? data?.state_unemployment : data?.national_unemployment;
  return <section className="intelligence-panel"><h2>{state ? `${place} unemployment` : "U.S. unemployment"}</h2>{series ? <><p className="mt-2 text-sm text-warm-600">{series.latest.value}% · {series.latest.date}</p><IntelligenceTrend label="Unemployment" unit="percent" rows={series.history.map(p => ({ period: p.date, value: p.value }))} />{state && data?.national_unemployment ? <p className="text-sm">U.S. reference: {data.national_unemployment.latest.value}% · {data.national_unemployment.latest.date}{data.national_unemployment.latest.date !== series.latest.date ? " · reporting periods differ" : ""}</p> : null}<details className="mt-4 text-sm"><summary className="cursor-pointer text-terra-text">Underlying observations</summary><ul className="mt-3 max-h-64 overflow-auto">{series.history.map(p => <li key={p.date} className="flex justify-between border-b border-warm-200 p-2"><span>{p.date}</span><span>{p.value}%</span></li>)}</ul></details></> : <p className="mt-4 text-sm">No unemployment series could be loaded for this scope.</p>}<EvidenceDetails source={series ? `BLS, via FRED · ${series.series_id}` : "BLS, via FRED"} period={series?.latest.date ?? "Unavailable"} geography={place} coverage="Recorded monthly observations; missing periods are not filled" method="Reported unemployment rate; national and state dates displayed separately. No district commentary is relabeled as state data." />
  </section>;
}

async function FinancialLens({ state }: { state: string | null }) {
  const data = state ? null : await getRevenueTrend(8).catch(() => null);
  return <section className="intelligence-panel"><h2>Deposit service-charge income</h2>{data?.quarters.length ? <><p className="mt-2 text-sm text-warm-600">National reported totals · banks and credit unions combined · USD billions</p><IntelligenceTrend label="Deposit service-charge income" unit="USD billions" rows={[...data.quarters].reverse().map(p => ({ period: p.quarter, value: p.total_service_charges / 1_000_000 }))} /><div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Financial filing observations"><table className="w-full text-left text-sm"><thead><tr><th scope="col" className="p-2">Quarter</th><th scope="col" className="p-2">Service charges (USD)</th><th scope="col" className="p-2">Institutions</th></tr></thead><tbody>{data.quarters.map(p => <tr key={p.quarter} className="border-t border-warm-200"><th scope="row" className="p-2 font-normal">{p.quarter}</th><td className="p-2">{dollars(p.total_service_charges * 1000)}</td><td className="p-2">{p.total_institutions}</td></tr>)}</tbody></table></div></> : <p className="mt-4 text-sm">{state ? "A state-filtered financial aggregate is not available here. Select a named institution to inspect its filing history." : "No national financial trend could be loaded."}</p>}<Link href="/pro/data" className="mt-4 inline-block text-terra-text underline">Inspect an institution’s financials</Link><EvidenceDetails source="FDIC Call Reports / NCUA 5300 filings" period={data?.latest?.quarter ?? "Select an institution or national scope"} geography={state ? "State aggregate unavailable" : "United States"} coverage="Banks and credit unions combined, independent of the fee-landscape charter filter; coverage can vary by quarter" method="Quarterly totals; credit union year-to-date filings are converted by the existing reader. Deposit service charges are not wire-specific income." /></section>;
}

async function RegulationLens() {
  const articles = await getArticles({ limit: 8 }).catch(() => []);
  return <section className="intelligence-panel"><h2>Regulatory developments</h2><p className="mt-2 text-sm text-warm-600">Federal and state updates retain their publisher and original scope. Applicability needs review.</p><ul className="mt-5 divide-y divide-warm-200">{articles.map(a => <li key={a.guid} className="py-4"><a className="font-medium text-terra-text underline" href={a.link} target="_blank" rel="noreferrer">{a.title}</a><p className="mt-2 text-xs text-warm-600">{a.source} · {a.published_at?.slice(0,10) ?? "Publication date not recorded"} · {a.topic} · Applicability not assessed</p></li>)}</ul>{articles.length === 0 ? <p className="mt-4 text-sm">No regulatory updates could be loaded.</p> : null}<EvidenceDetails source="Original publishers linked on each update" period="Per-item publication dates" geography="Publisher scope; not filtered to the selected state" coverage="Indexed updates; not an exhaustive rule inventory" method="Source facts are linked separately from interpretation; no automatic legal applicability conclusion" /></section>;
}
