"use client";

/**
 * One reviewable research panel inside the existing Hamilton workspace.
 * This is NOT another Ask composer or a provider/AI request. The visitor's URL
 * represents a prepared selection, never permission to execute a paid request.
 * The host Analyze page supplies a server-validated selection after Pro auth.
 */
import { useRef, useState } from "react";
import { getDisplayName } from "@/lib/fee-taxonomy";
import {
  type LandingResearchHandoff,
  landingResearchHref,
} from "@/lib/hamilton/landing-research-handoff";
import type { LocalMarketAnswer } from "@/lib/hamilton/local-market-answer";
import type { GeographicResearchResult, GeographicFeeMeasure } from "@/lib/hamilton/landing-geographic-research";

type Result = LocalMarketAnswer | GeographicResearchResult;
const dollars = (amount: number | null | undefined) =>
  amount === null || amount === undefined ? "Not on file" :
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
const integer = (count: number) => count.toLocaleString("en-US");

function isLocal(result: Result): result is LocalMarketAnswer {
  return "competitors" in result && "institutionId" in result;
}

/** Check that the rendered evidence belongs to the exact user-confirmed research scope. */
export function checkedLandingResearchResult(selection: LandingResearchHandoff, value: unknown): Result {
  const bad = () => new Error("The market response did not match the selected research. Run the comparison again.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad();
  const result = value as Record<string, unknown>;
  const matchesCategories = (actual: unknown) =>
    Array.isArray(actual) &&
    actual.length === selection.categories.length &&
    actual.every((category, index) => category === selection.categories[index]);
  if (!matchesCategories(result.categories)) throw bad();
  if (selection.scope.kind === "local") {
    if (result.institutionId !== selection.scope.institutionId ||
        result.charter !== selection.charter ||
        !Array.isArray(result.competitors) || !Array.isArray(result.sources) ||
        !result.market || typeof result.market !== "object" ||
        !result.you || typeof result.you !== "object") throw bad();
  } else {
    const scope = result.scope;
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw bad();
    const returnedScope = scope as Record<string, unknown>;
    if (returnedScope.kind !== selection.scope.kind ||
        (selection.scope.kind === "state" && returnedScope.stateCode !== selection.scope.stateCode) ||
        result.charter !== selection.charter ||
        !Array.isArray(result.comparisons) ||
        result.comparisons.length !== selection.categories.length ||
        result.comparisons.some((row, index) =>
          !row || typeof row !== "object" || row.category !== selection.categories[index])) throw bad();
  }
  return value as Result;
}

function statusText(measure: GeographicFeeMeasure): string {
  if (measure.status === "not_observed") return "Not observed";
  if (measure.status === "insufficient") return "Insufficient evidence";
  return dollars(measure.median);
}

export function LandingResearchResults({ selection }: { selection: LandingResearchHandoff }) {
  // Unmount results and pending requests whenever the complete explicit scope changes.
  return <LandingResearchResultsForSelection key={JSON.stringify(selection)} selection={selection} />;
}

function LandingResearchResultsForSelection({ selection }: { selection: LandingResearchHandoff }) {
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"ready" | "loading" | "done" | "error">("ready");
  const [message, setMessage] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const scopeLabel = selection.scope.kind === "national"
    ? "United States"
    : selection.scope.kind === "state"
      ? selection.scope.stateCode
      : "Local branch market";
  const charterLabel = selection.charter === "all"
    ? "Banks and credit unions"
    : selection.charter === "bank" ? "Banks" : "Credit unions";

  async function runSelection() {
    if (status === "loading") return;
    const generation = ++requestGeneration.current;
    setStatus("loading");
    setResult(null);
    setMessage(null);
    try {
      const body = { research: selection };
      const response = await fetch("/api/hamilton/ask/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const error = payload && typeof payload === "object" && "error" in payload
          ? (payload as { error?: unknown }).error
          : null;
        throw new Error(typeof error === "string" ? error : "The comparison could not be loaded.");
      }
      const checked = checkedLandingResearchResult(selection, payload);
      if (requestGeneration.current !== generation) return;
      setResult(checked);
      setStatus("done");
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setMessage(error instanceof Error ? error.message : "The comparison could not be loaded.");
      setStatus("error");
    }
  }

  return (
    <section aria-label="Your selected market research" className="rounded-xl border border-warm-300 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-warm-600">Research selected on Fee Insight</p>
          <h2 className="mt-1 text-xl font-semibold text-warm-900">{scopeLabel} fee comparison</h2>
          <p className="mt-2 text-sm text-warm-700">{charterLabel} · {selection.categories.map(getDisplayName).join(", ")}</p>
          <p className="mt-1 text-xs text-warm-600">Read-only published fee research. No report or AI answer will be generated automatically.</p>
        </div>
        <button type="button" onClick={() => void runSelection()} disabled={status === "loading"}
          className="rounded-md bg-warm-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {status === "loading" ? "Reading published data…" : result ? "Refresh comparison" : "Run comparison"}
        </button>
      </div>
      {result ? (
        <a href={landingResearchHref({ ...selection, task: "board_report" })}
          className="mt-4 inline-block rounded-md border border-warm-300 px-4 py-2 text-sm font-medium underline">
          Prepare board report from this selection
        </a>
      ) : null}
      {message ? <p role="alert" className="mt-4 text-sm text-red-700">{message}</p> : null}
      {result && isLocal(result) ? (
        <div className="mt-6 space-y-5">
          <div>
            <h3 className="text-lg font-semibold text-warm-900">{result.institutionName}: {result.market.label}</h3>
            <p className="mt-1 text-sm text-warm-700">
              {integer(result.competitors.length)} named competitors · {result.market.basis === "branch_counties" ? "FDIC branch counties" : "Headquarters city"} · {result.market.sodYear} branch/deposit reference
            </p>
            {result.unmapped > 0 ? <p className="text-xs text-warm-600">{result.unmapped} subject branches have no map coordinates.</p> : null}
          </div>
          {result.map ? (
            <div className="space-y-2">
              <p className="text-xs text-warm-600">Map shows the full branch footprint for geographic context; the fee table applies your institution-type filter.</p>
              <div role="img" aria-label={"Competitor branch footprint for " + result.market.label}
                className="overflow-x-auto rounded-md border border-warm-200"
                dangerouslySetInnerHTML={{ __html: result.map.html }} />
              <div className="text-xs text-warm-600" aria-label="Branch map legend" dangerouslySetInnerHTML={{ __html: result.map.legend }} />
            </div>
          ) : null}
          {result.network ? (
            <div role="img" aria-label={"Branch network map for " + result.institutionName}
              className="overflow-x-auto rounded-md border border-warm-200"
              dangerouslySetInnerHTML={{ __html: result.network }} />
          ) : <p className="text-sm text-warm-600">No geocoded branch map is available for this market.</p>}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="pb-2 text-left font-medium text-warm-900">Named competitors and selected published fees</caption>
              <thead><tr className="border-b border-warm-300">
                <th scope="col" className="p-2">Institution</th>
                <th scope="col" className="p-2">Market branches</th>
                {selection.categories.map(category => <th scope="col" className="p-2" key={category}>{getDisplayName(category)}</th>)}
              </tr></thead>
              <tbody>
                <tr className="border-b border-warm-200 bg-warm-50">
                  <th scope="row" className="p-2">{result.institutionName} (subject)</th>
                  <td className="p-2">{result.you.branchesInMarket ?? "Unavailable"}</td>
                  {selection.categories.map(category => <td key={category} className="p-2">{dollars(result.you.fees[category])}</td>)}
                </tr>
                {result.competitors.map(peer => (
                  <tr key={peer.institutionId} className="border-b border-warm-100">
                    <th scope="row" className="p-2 font-medium"><a className="underline" href={`/institution/${peer.institutionId}`}>{peer.name}</a><div className="text-xs font-normal">{peer.evidenceUrl && /^https?:\/\//i.test(peer.evidenceUrl) ? <a className="underline" href={peer.evidenceUrl} target="_blank" rel="noreferrer">Published schedule</a> : "Schedule link unavailable"}{peer.evidenceDate ? ` · ${peer.evidenceDate}` : ""}</div></th>
                    <td className="p-2">{peer.branches ?? "Unavailable"}</td>
                    {selection.categories.map(category => <td key={category} className="p-2">{dollars(peer.fees[category])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.competitors.length === 0 ? <p className="text-sm text-warm-700">No qualifying named competitors were found. Filters were not relaxed.</p> : null}
          <div className="text-xs text-warm-600">
            <p className="font-medium text-warm-800">Evidence and dates</p>
            {result.sources.map(source => <p key={source.label}>{source.label}{source.asOf ? ": " + source.asOf : ": date not recorded"}</p>)}
            <p>Unavailable fee values are not zero-dollar fees. Published fee evidence is distinct from branch/deposit filings.</p>
          </div>
        </div>
      ) : null}
      {result && !isLocal(result) ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-warm-700">Published fee index · {charterLabel} · {scopeLabel}. State figures use a same-charter national comparison; limited observations are withheld.</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="pb-2 text-left font-medium text-warm-900">Selected categories and current index evidence</caption>
              <thead><tr className="border-b border-warm-300">
                <th scope="col" className="p-2">Fee</th>
                <th scope="col" className="p-2">Selected median</th>
                <th scope="col" className="p-2">Institutions</th>
                {selection.scope.kind === "state" ? <th scope="col" className="p-2">National median</th> : null}
                <th scope="col" className="p-2">As of</th>
              </tr></thead>
              <tbody>
                {result.comparisons.map(row => (
                  <tr key={row.category} className="border-b border-warm-100">
                    <th scope="row" className="p-2 font-medium">{getDisplayName(row.category)}</th>
                    <td className="p-2">{statusText(row.selected)}</td>
                    <td className="p-2">{integer(row.selected.institutions)}</td>
                    {selection.scope.kind === "state" ? <td className="p-2">{row.national ? statusText(row.national) : "Unavailable"}</td> : null}
                    <td className="p-2">{row.selected.lastUpdated ?? "Date unavailable"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-warm-600">Source: Bank Fee Index published fee catalog. Cohort counts and dates refer to the published index, not an independent audit of each current fee schedule. Drill-down source lineage is not yet available here.</p>
        </div>
      ) : null}
    </section>
  );
}
