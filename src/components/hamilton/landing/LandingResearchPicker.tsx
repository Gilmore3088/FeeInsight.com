"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { InstitutionCombobox, type PickedInstitution } from "@/app/for-institutions/institution-combobox";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { HOMEPAGE_MARKET_CATEGORIES } from "@/lib/hamilton/local-market-request";
import { landingResearchHref, RESEARCH_STATE_CODES, type LandingResearchHandoff, type ResearchStateCode } from "@/lib/hamilton/landing-research-handoff";

export function LandingResearchPicker() {
  const id = useId();
  const [scope, setScope] = useState<"national" | "state" | "local">("national");
  const [state, setState] = useState<ResearchStateCode>("WA");
  const [institution, setInstitution] = useState<PickedInstitution | null>(null);
  const [charter, setCharter] = useState<LandingResearchHandoff["charter"]>("all");
  const [categories, setCategories] = useState<string[]>([...HOMEPAGE_MARKET_CATEGORIES]);
  const selection: LandingResearchHandoff | null = categories.length && (scope !== "local" || institution) ? {
    version: 1, task: "compare", charter, categories,
    scope: scope === "local" ? { kind: "local", institutionId: institution!.id } : scope === "state" ? { kind: "state", stateCode: state } : { kind: "national" },
  } : null;
  return <section aria-label="Prepare Hamilton research" className="mt-5 space-y-4 rounded-xl border border-warm-300 bg-white p-4">
    <h2 className="text-lg font-semibold">Compare published fees in Hamilton</h2>
    <div className="flex flex-wrap gap-4">
      <label>Market<select aria-label="Research market" className="block rounded border p-2" value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
        <option value="national">United States</option><option value="state">State or DC</option><option value="local">Local institution market</option>
      </select></label>
      {scope === "state" && <label>State<select aria-label="Research state" className="block rounded border p-2" value={state} onChange={e => setState(e.target.value as ResearchStateCode)}>{RESEARCH_STATE_CODES.map(code => <option key={code}>{code}</option>)}</select></label>}
      <label>Institutions<select aria-label="Institution charter" className="block rounded border p-2" value={charter} onChange={e => setCharter(e.target.value as typeof charter)}><option value="all">Banks and credit unions</option><option value="bank">Banks</option><option value="credit_union">Credit unions</option></select></label>
    </div>
    {scope === "local" && <div><label htmlFor={id}>Research institution</label><InstitutionCombobox id={id} name="researchInstitution" defaultValue="" readOnly={false} className="block w-full rounded border p-2" onPick={setInstitution} /><p className="text-xs">Choose a search result to identify the institution.</p></div>}
    <fieldset><legend className="font-medium">Fee categories</legend><div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">{[...new Set(Object.values(FEE_FAMILIES).flat())].map(category => <label key={category} className="text-sm"><input type="checkbox" disabled={categories.length >= 50 && !categories.includes(category)} checked={categories.includes(category)} onChange={e => setCategories(old => e.target.checked ? [...old, category] : old.filter(c => c !== category))} /> {getDisplayName(category)}</label>)}</div></fieldset>
    {selection ? <div className="flex flex-wrap gap-4"><Link className="font-semibold underline" href={landingResearchHref(selection)}>Review comparison in Hamilton</Link><Link className="font-semibold underline" href={landingResearchHref({ ...selection, task: "board_report" })}>Prepare board-report draft</Link></div> : <p role="status">Choose an institution and at least one fee category to continue.</p>}
    <p className="text-xs text-warm-600">Hamilton access required. Review your selection before running research or saving a report.</p>
  </section>;
}
