import Link from "next/link";
import { encodeLandingResearch } from "@/lib/hamilton/landing-research-handoff";
import { INTELLIGENCE_LENSES, type MarketQuestion } from "@/lib/hamilton/market-question";
import { shortSegmentLabel } from "@/lib/hamilton/workspace/segment";
import { BoardBriefButton } from "./BoardBriefButton";
import { lensPanels, loadIntelligence, readFindings, stateLinks, type Loaded } from "./IntelligenceWorkspace";

const CHARTER_LABEL = { all: "Banks and credit unions", bank: "Banks", credit_union: "Credit unions" } as const;

/**
 * Ask Hamilton's answer to a market question: the facts first, then the exhibits for each topic
 * asked, every one from a governed reader with its source. Deterministic; no provider call.
 */
export async function MarketBrief({ question, market, instId }: { question: string; market: MarketQuestion; instId?: string | null }) {
  const data = await loadIntelligence(market.selection, market.lenses, { compact: false, segment: market.segment });
  return <MarketBriefView question={question} market={market} data={data} instId={instId} />;
}

/** The brief for already-loaded data. */
export function MarketBriefView({ question, market, data, instId }: { question: string; market: MarketQuestion; data: Loaded; instId?: string | null }) {
  const { selection, lenses, segment, place } = market;
  const state = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const findings = readFindings(data, state ? place : "the United States", state, selection.categories[0]).filter(f => lenses.includes(f.lens));
  const research = (lens: string) => `/pro/intelligence?${new URLSearchParams({ research: encodeLandingResearch(selection), lens })}`;
  const panels = lensPanels({
    data, selection, compact: false,
    stateHrefs: stateLinks(selection, "/pro/intelligence", "fees"),
    explore: id => research(id),
    peerNote: segment ? `(${shortSegmentLabel({ ...segment, charterType: null, stateCode: null, largest: null }).replace(/ institutions$/, "")} only)` : undefined,
  });
  const topics = INTELLIGENCE_LENSES.filter(l => lenses.includes(l.id)).map(l => l.label.toLowerCase());
  const limits = [
    segment ? `The asset-size range you named (${segment.label}) narrows the institution table; the other exhibits cover every size.` : null,
    state && lenses.includes("financials") ? "Service-charge income is reported nationally here; a state total is not available yet." : null,
    "Hamilton reports what the data shows. It does not recommend a price.",
  ].filter((line): line is string => line !== null);

  return <div className="mx-auto flex max-w-7xl flex-col gap-7">
    <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:text-left">
      <div className="max-w-3xl">
        <p className="fi-text-label text-[var(--fi-muted)]">Ask Hamilton · Market brief</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{state ? place : "United States"}: {topics.length === 5 ? "fees, finances and market" : listWords(topics)}</h1>
        <p className="mt-2 text-[var(--fi-muted)]">You asked: “{question}”</p>
        <p className="mt-1 text-sm text-[var(--fi-muted)]">{CHARTER_LABEL[selection.charter]} · {state ? `${place}, by institution headquarters` : "nationwide"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={research(lenses[0])} className="fi-btn fi-btn-secondary no-underline">Open in Research</Link>
        <BoardBriefButton selection={selection} lenses={lenses} />
      </div>
    </header>

    <section className="intelligence-read" aria-labelledby="brief-answer">
      <h2 id="brief-answer" className="font-semibold">Hamilton&apos;s answer <span className="font-normal text-[var(--fi-muted)]">· Observed in the data below</span></h2>
      {findings.length
        ? <ol>{findings.map(f => <li key={f.title}><strong>{f.title}</strong>{f.body} <span className="mt-1 block text-xs text-[var(--fi-muted)]">Source: {f.source}</span></li>)}</ol>
        : <p className="mt-3 text-sm">The data for this question could not load just now. Each exhibit below says what is missing.</p>}
    </section>

    {lenses.map(id => <div key={id}>{panels[id]}</div>)}

    <section aria-labelledby="brief-limits" className="rounded-lg border border-[var(--fi-border)] bg-[var(--fi-surface-0)] p-5 text-sm">
      <h2 id="brief-limits" className="font-semibold">What this brief covers</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--fi-muted)]">{limits.map(line => <li key={line}>{line}</li>)}</ul>
    </section>

    <form action="/pro/analyze" method="get" className="flex flex-col gap-3 rounded-lg border border-[var(--fi-control-border)] bg-[var(--fi-surface-0)] p-4 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm font-medium">Ask a follow-up
        <input name="q" required maxLength={500} placeholder={`For example: How do credit unions in ${state ? place : "the U.S."} compare on overdraft fees?`} className="mt-1 w-full rounded-md border border-[var(--fi-control-border)] bg-transparent p-2.5 text-base font-normal" />
      </label>
      <input type="hidden" name="send" value="1" />
      {instId ? <input type="hidden" name="instId" value={instId} /> : null}
      <button type="submit" className="fi-btn fi-btn-primary min-h-11">Ask</button>
    </form>
  </div>;
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
