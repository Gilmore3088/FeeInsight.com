"use client";
import { useRouter } from "next/navigation";
import { encodeLandingResearch, RESEARCH_STATE_CODES, type LandingResearchHandoff, type ResearchStateCode } from "@/lib/hamilton/landing-research-handoff";
import { STATE_NAMES } from "@/lib/us-states";

export function ScopeControls({ selection, pathname, lens }: { selection: LandingResearchHandoff; pathname: string; lens: string }) {
  const router = useRouter();
  function change(next: LandingResearchHandoff) {
    router.push(`${pathname}?${new URLSearchParams({ research: encodeLandingResearch(next), lens })}`);
  }
  return <div className="intelligence-controls">
    <label>Geography<select aria-label="Geography" value={selection.scope.kind === "state" ? selection.scope.stateCode : "national"} onChange={e => change({ ...selection, scope: e.target.value === "national" ? { kind: "national" } : { kind: "state", stateCode: e.target.value as ResearchStateCode } })}>
      <option value="national">United States</option>{RESEARCH_STATE_CODES.map(code => <option key={code} value={code}>{STATE_NAMES[code] ?? code}</option>)}
    </select></label>
    <label>Institution type<select aria-label="Institution type" value={selection.charter} onChange={e => change({ ...selection, charter: e.target.value as LandingResearchHandoff["charter"] })}>
      <option value="all">Banks & credit unions</option><option value="bank">Banks</option><option value="credit_union">Credit unions</option>
    </select></label>
    <label>Fee categories<select aria-label="Fee categories" value={selection.categories.length === 1 ? selection.categories[0] : "all"} onChange={e => change({ ...selection, categories: e.target.value === "all" ? ["monthly_maintenance", "wire_domestic_outgoing", "atm_non_network"] : [e.target.value] })}>
      <option value="all">Selected fee landscape</option><option value="monthly_maintenance">Monthly maintenance</option><option value="wire_domestic_outgoing">Outgoing domestic wire</option><option value="atm_non_network">Non-network ATM</option><option value="overdraft">Overdraft</option><option value="nsf">NSF</option>
    </select></label>
    <label>Reporting periods<span className="mt-1.5 block rounded border border-warm-300 bg-white p-3 text-sm text-warm-900">Latest available per exhibit</span></label>
  </div>;
}
