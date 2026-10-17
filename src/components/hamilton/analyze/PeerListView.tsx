"use client";

import { PeerGroupEmpty } from "@/components/hamilton/PeerGroupEmpty";
import { hamiltonInstitutionHref, publicInstitutionHref } from "@/lib/hamilton/context-link";
import { useMemo, useRef, useState } from "react";
import { createPeerSet } from "@/app/pro/(hamilton)/settings/actions";
import { formatPeerAssets, peerListPageOffsets, type PeerListResponse, type PeerListContinuation } from "@/lib/hamilton/peer-list";
import { peerListCsv, peerListCsvFilename } from "@/lib/hamilton/peer-list-export";
import { defaultPeerSetName } from "@/lib/hamilton/peer-set-name";
import { fmtMoney } from "@/components/hamilton/memo/memo";
import { sourceDateWithAge } from "@/components/hamilton/memo/exhibit-view";

const FREQUENCY_LABELS: Record<string, string> = {
  per_item: "Per item", per_transaction: "Per transaction", per_occurrence: "Per occurrence", one_time: "One time",
  monthly: "Monthly", annual: "Annual", quarterly: "Quarterly", weekly: "Weekly", daily: "Daily", hourly: "Hourly",
};

/** Stored frequency codes ("per_item") read as words in the table; the CSV keeps the code. */
export function frequencyLabel(frequency: string | null | undefined): string {
  if (!frequency) return "Not stated";
  const words = FREQUENCY_LABELS[frequency] ?? frequency.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Sort = "selection" | "name" | "assets_desc" | "assets_asc";
export interface PeerSaveContext {
  question: string;
  institutionId: string | null;
  /** Present only for a follow-up; a new list's save leaves it out (a null still means a follow-up). */
  previousPeerList?: PeerListContinuation | null;
  /** The displayed page's offset, so saving re-checks that page; absent for the first page. */
  peerListOffset?: number;
}
interface PeerListViewProps {
  response: PeerListResponse;
  saveContext?: PeerSaveContext;
  /** Asks for the page that starts at this offset (#977, H02-T08); absent where the list cannot page. */
  onPage?: (offset: number) => void;
  /** True while a page is loading. */
  paging?: boolean;
  /** Set on a reopened saved snapshot: the question it answered (the page shows it as its heading). */
  savedQuestion?: string;
}
export function PeerListView(props: PeerListViewProps) {
  const data = props.response.peerList;
  // A newly answered list owns its selections and save receipt. An old action's
  // completion cannot update the next list or a different research institution.
  const key = JSON.stringify([data.subject?.institutionId, data.queriedAt, data.criteria, data.offset ?? 0, data.rows.map(row => row.institutionId)]);
  return <SelectablePeerList key={key} {...props} />;
}

/** Saves the displayed list as a CSV file; the file is built from the same data as the table. */
function downloadCsv(data: PeerListResponse["peerList"]) {
  const text = peerListCsv(data);
  if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = peerListCsvFilename(data);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function SelectablePeerList({ response, saveContext, onPage, paging = false, savedQuestion }: PeerListViewProps) {
  const data = response.peerList;
  const [sort, setSort] = useState<Sort>("selection");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [savingResearch, setSavingResearch] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [savedResearchId, setSavedResearchId] = useState<string | null>(null);
  const researchSaving = useRef(false);
  async function saveResearch() {
    if (!saveContext || researchSaving.current || !data.subject || data.status !== "ready") return;
    researchSaving.current = true;
    setSavingResearch(true);
    setResearchError(null);
    try {
      const answer = await fetch("/api/hamilton/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saveContext, expectedPeerList: data, savePeerResearchSnapshot: true }),
      });
      const result = await answer.json() as { savedAnalysisId?: string; error?: string };
      if (!answer.ok || !result.savedAnalysisId) throw new Error(result.error ?? "The list changed after it was shown. Ask the question again to see the current list, then save it.");
      setSavedResearchId(result.savedAnalysisId);
    } catch (err) {
      setResearchError(err instanceof Error ? err.message : "Could not save research. Retry.");
    } finally { researchSaving.current = false; setSavingResearch(false); }
  }
  const selectedIds = data.rows.filter(row => selected.has(row.institutionId)).map(row => row.institutionId);
  const automaticName = defaultPeerSetName({ institution_ids: selectedIds }, data.subject?.name);
  function toggleSelection(id: number) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
    setError(null);
    setSavedName(null);
  }
  async function saveSelection() {
    if (saving.current || !selectedIds.length || !data.subject) return;
    saving.current = true;
    setIsSaving(true);
    setError(null);
    const groupName = name.trim() || automaticName;
    const form = new FormData();
    form.set("name", groupName);
    form.set("mode", "institutions");
    form.set("research_institution_id", String(data.subject.institutionId));
    for (const id of selectedIds) form.append("institution_ids", String(id));
    try {
      const result = await createPeerSet(form);
      if (result.success) setSavedName(groupName);
      else setError(result.error ?? "Could not save the peer group. Try again.");
    } catch {
      setError("Could not save the peer group. Try again.");
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }
  const rows = useMemo(() => {
    const copy = [...data.rows];
    if (sort === "selection") return copy;
    return copy.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) || a.institutionId - b.institutionId;
      if (a.totalAssetsUsd === null) return b.totalAssetsUsd === null ? a.name.localeCompare(b.name) : 1;
      if (b.totalAssetsUsd === null) return -1;
      return (sort === "assets_desc" ? b.totalAssetsUsd - a.totalAssetsUsd : a.totalAssetsUsd - b.totalAssetsUsd) || a.name.localeCompare(b.name) || a.institutionId - b.institutionId;
    });
  }, [data.rows, sort]);
  if (data.status !== "ready") {
    return data.peerGroupEmpty
      ? <PeerGroupEmpty group={data.peerGroupEmpty} />
      : <p role="status" className="text-sm leading-relaxed text-warm-800">{response.shortAnswer}</p>;
  }
  const criteria = data.criteria;
  const pages = onPage ? peerListPageOffsets(data) : { previous: null, next: null };
  const pageSize = criteria?.limit ?? 50;
  // Snapshots saved before #1538 carry no label; every one of them compared NSF fees.
  const feeLabel = data.feeComparison?.label ?? "NSF";
  // Missing is not $0. A fee charged as a rate is listed as that rate on its own line, never as dollars.
  const noFeeLine = `No published consumer ${feeLabel} fee on file`;
  // Snapshots saved before rates were listed carry no rate lines.
  const rateFees = data.feeComparison?.rateFees ?? [];
  const hasPages = pages.previous !== null || pages.next !== null;
  const offset = data.offset ?? 0;
  const rangeText = `${(offset + 1).toLocaleString("en-US")} to ${(offset + data.rows.length).toLocaleString("en-US")}`;
  // Turning a page shows a new list, so a selection on this page does not carry over.
  const clears = selectedIds.length > 0 ? " (clears your selection)" : "";
  return (
    <section aria-label="Peer list" className="flex min-w-0 flex-col gap-4 font-sans">
      <div>
        <h2 className="text-xl font-semibold text-warm-900">{response.shortAnswer}</h2>
        <p className="mt-1 text-sm text-warm-700">Research subject: {data.subject?.name ?? "Not available"}. Amounts shown in US dollars{rateFees.length ? "; fees charged as a rate are shown as a percentage" : ""}.</p>
      </div>
      {criteria ? (
        <details className="rounded-lg border border-warm-300 bg-warm-50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-warm-900">Selection criteria: {criteria.charterType === "credit_union" ? "credit unions" : criteria.charterType === "bank" ? "banks" : "both types"} · {criteria.states.join(" / ") || (criteria.basis === "saved_peer_set" ? "saved group" : "nationwide")}{criteria.minAssets ? ` · ${criteria.minAssets.inclusive ? "≥" : ">"} ${formatPeerAssets(criteria.minAssets.value)}` : ""}{criteria.maxAssets ? ` · ${criteria.maxAssets.inclusive ? "≤" : "<"} ${formatPeerAssets(criteria.maxAssets.value)}` : ""}{criteria.peerSetLabel ? ` · ${criteria.peerSetLabel}` : ""}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-warm-700">
            {criteria.descriptions.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </details>
      ) : null}
      {data.notes.map((note, i) => <p key={i} className="text-sm text-warm-700">{note}</p>)}
      {data.feeComparison ? (
        <div className="rounded-lg border border-warm-300 p-4">
          <h3 className="text-lg font-semibold text-warm-900">Published {feeLabel} fees for the selected peers</h3>
          <p className="mt-1 text-sm text-warm-700">{data.feeComparison.note}</p>
          <div className="mt-3 overflow-x-auto">
            <table role="table" aria-label={`Published ${feeLabel} charges`} className="w-full text-left text-sm max-md:block">
              {/* Below md every charge is a card of label and value, so a phone never scrolls sideways. */}
              <thead role="rowgroup" className="max-md:sr-only"><tr role="row"><th role="columnheader" scope="col" className="p-2">Institution</th><th role="columnheader" scope="col" className="p-2">Fee</th><th role="columnheader" scope="col" className="p-2">{rateFees.length ? "Amount or rate" : "Amount"}</th><th role="columnheader" scope="col" className="p-2">Frequency</th><th role="columnheader" scope="col" className="p-2">Published / source</th></tr></thead>
              <tbody role="rowgroup" className="max-md:block">
                {[...data.rows.map(row => ({ id: row.institutionId, name: row.name, isAccount: false })),
                  ...(data.feeComparison.account ? [{ id: data.feeComparison.account.institutionId, name: data.feeComparison.account.name, isAccount: true }] : [])
                ].map(item => {
                  // Dollar lines first, then rate lines; each stays its own line and nothing is pooled.
                  const charges = [
                    ...data.feeComparison!.fees.filter(fee => fee.institutionId === item.id)
                      .map(fee => ({ ...fee, key: `${item.id}:${fee.id}`, shown: fee.amount === null ? "Amount not stated" : fmtMoney(fee.amount) })),
                    ...rateFees.filter(fee => fee.institutionId === item.id)
                      .map(fee => ({ ...fee, key: `${item.id}:rate:${fee.id}`, shown: fee.rateLabel })),
                  ];
                  return charges.length ? charges.map(charge => (
                    <tr role="row" key={charge.key} className="border-t border-warm-200 max-md:block max-md:py-2">
                      <th role="rowheader" scope="row" className="p-2 font-medium max-md:block max-md:px-0 max-md:py-0.5">{item.name}{item.isAccount ? " (your institution)" : ""}</th>
                      <td role="cell" className="p-2 max-md:block max-md:px-0 max-md:py-0.5"><span aria-hidden className="mr-1 font-medium text-warm-600 md:hidden">Fee:</span>{charge.name}</td>
                      <td role="cell" className="p-2 tabular-nums max-md:block max-md:px-0 max-md:py-0.5"><span aria-hidden className="mr-1 font-medium text-warm-600 md:hidden">{rateFees.length ? "Amount or rate:" : "Amount:"}</span>{charge.shown}</td>
                      <td role="cell" className="p-2 max-md:block max-md:px-0 max-md:py-0.5"><span aria-hidden className="mr-1 font-medium text-warm-600 md:hidden">Frequency:</span>{frequencyLabel(charge.frequency)}</td>
                      <td role="cell" className="p-2 max-md:block max-md:px-0 max-md:py-0.5"><span aria-hidden className="mr-1 font-medium text-warm-600 md:hidden">Published:</span>{sourceDateWithAge(charge.publishedAt) ?? "Date not recorded"}
                        {charge.documentUrl || charge.sourceUrl ? <a href={charge.documentUrl ?? charge.sourceUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="ml-2 underline">Fee schedule</a> : <span className="ml-2">Source link unavailable</span>}
                      </td>
                    </tr>
                  )) : <tr role="row" key={item.id} className="border-t border-warm-200 max-md:block max-md:py-2"><th role="rowheader" scope="row" className="p-2 font-medium max-md:block max-md:px-0 max-md:py-0.5">{item.name}{item.isAccount ? " (your institution)" : ""}</th><td role="cell" colSpan={4} className="p-2 max-md:block max-md:px-0 max-md:py-0.5">{noFeeLine}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {rows.length ? (
        <>
          <label className="flex flex-wrap items-center gap-2 text-sm text-warm-700">
            Sort displayed rows
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="rounded-md border border-warm-300 bg-white p-2 text-warm-900">
              <option value="selection">Selection order</option><option value="name">Institution name</option>
              <option value="assets_desc">Assets: largest first</option><option value="assets_asc">Assets: smallest first</option>
            </select>
          </label>
          <p className="text-sm text-warm-700">Select up to 50 institutions to save a peer group.</p>
          {selectedIds.length > 0 && data.subject ? (
            <div className="flex flex-col gap-3 rounded-lg border border-warm-300 bg-warm-50 p-4">
              <label className="flex flex-col gap-1 text-sm text-warm-800">
                <span className="font-medium">Group name (optional)</span>
                <input value={name} maxLength={100} placeholder={automaticName} disabled={isSaving}
                  onChange={event => { setName(event.target.value); setSavedName(null); setError(null); }}
                  className="rounded-md border border-warm-300 bg-white px-3 py-2 text-warm-900" />
              </label>
              <p className="text-xs text-warm-600">Leave the name blank to use “{automaticName}”. Saving keeps exactly these institutions.</p>
              <button type="button" onClick={saveSelection} disabled={isSaving || savedName !== null}
                className="min-h-11 self-start rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-50 sm:min-h-9">
                {isSaving ? "Saving peer group..." : `Save ${selectedIds.length} as a peer group`}
              </button>
              {error ? <p role="alert" className="text-sm text-terra-text">{error}</p> : null}
              {savedName ? <p role="status" className="text-sm text-warm-800">Saved {selectedIds.length} selected institutions as “{savedName}”. <a href={`/pro/settings?instId=${data.subject.institutionId}#peer-sets`} className="font-medium text-terra-text underline">Use it for all charts in Settings</a></p> : null}
            </div>
          ) : null}
          <div className="min-w-0 overflow-x-auto rounded-lg border border-warm-300">
            <table role="table" aria-label="Peer table" className="w-full text-left text-sm max-md:block">
              <caption className="sr-only">Institutions matching the criteria, with assets, reporting dates, sources and published-fee coverage</caption>
              <thead role="rowgroup" className="border-b border-warm-300 bg-warm-100 text-warm-800 max-md:sr-only"><tr role="row">
                <th role="columnheader" scope="col" className="p-3">Select</th>
                <th role="columnheader" scope="col" className="p-3">Institution</th><th role="columnheader" scope="col" className="p-3">Headquarters</th>
                <th role="columnheader" scope="col" className="p-3 text-right">Total assets (USD)</th><th role="columnheader" scope="col" className="p-3">Reporting date / source</th>
                <th role="columnheader" scope="col" className="p-3">Fee data</th>
              </tr></thead>
              <tbody role="rowgroup" className="divide-y divide-warm-200 bg-white text-warm-900 max-md:block">
                {/* Below md each institution is a card: the checkbox on the left, its facts stacked beside it. */}
                {rows.map(row => <tr role="row" key={row.institutionId} className="max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:gap-x-3 max-md:px-3 max-md:py-3">
                  <td role="cell" className="p-3 max-md:row-span-5 max-md:p-0"><label className="grid min-h-11 min-w-11 cursor-pointer place-items-center md:min-h-0 md:min-w-0 md:place-items-start">
                    <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.institutionId)}
                    onChange={() => toggleSelection(row.institutionId)} disabled={isSaving || (!selected.has(row.institutionId) && selected.size >= 50) || !data.subject}
                    className="h-5 w-5 accent-terra md:h-4 md:w-4" /></label></td>
                  <th role="rowheader" scope="row" className="max-w-[240px] p-3 font-normal max-md:col-start-2 max-md:max-w-none max-md:block max-md:px-0 max-md:py-0.5">
                    <a href={hamiltonInstitutionHref(row.institutionId)} className="font-semibold text-terra-text underline">{row.name}</a>
                    <p className="mt-1 text-xs text-warm-600">{row.charterType === "credit_union" ? "Credit union" : row.charterType === "bank" ? "Bank" : "Type unavailable"} · <a href={publicInstitutionHref(row.institutionId)} className="underline">Public page</a></p>
                    <details className="mt-1 text-xs text-warm-600"><summary className="cursor-pointer">Why included</summary><p>{row.inclusionReason}</p></details>
                  </th>
                  <td role="cell" className="p-3 max-md:col-start-2 max-md:block max-md:px-0 max-md:py-0.5"><span aria-hidden className="mr-1 font-medium text-warm-600 md:hidden">Headquarters:</span>{[row.city, row.stateCode].filter(Boolean).join(", ") || "Not available"}</td>
                  <td role="cell" className="whitespace-nowrap p-3 text-right tabular-nums max-md:col-start-2 max-md:text-left max-md:block max-md:px-0 max-md:py-0.5"><span aria-hidden className="mr-1 font-medium text-warm-600 md:hidden">Total assets:</span>{formatPeerAssets(row.totalAssetsUsd)}</td>
                  <td role="cell" className="p-3 max-md:col-start-2 max-md:block max-md:px-0 max-md:py-0.5"><span aria-hidden className="mr-1 font-medium text-warm-600 md:hidden">Reporting date:</span><p className="tabular-nums max-md:inline">{sourceDateWithAge(row.reportDate) ?? "Not available"}</p>
                    {row.source ? <p className="mt-1 text-xs text-warm-600">{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{row.source.toUpperCase()} filing source</a> : `${row.source.toUpperCase()} filing; link unavailable`}</p> : null}
                  </td>
                  <td role="cell" className="p-3 text-xs text-warm-700 max-md:col-start-2 max-md:block max-md:px-0 max-md:py-0.5">{row.feeCoverage === "available" ? "Published fees available" : "No published fees on file"}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {hasPages ? (
            <nav aria-label="Pages of this list" className="flex flex-wrap items-center gap-3">
              <p aria-live="polite" className="text-sm text-warm-800">Showing {rangeText} of {(data.totalMatches ?? 0).toLocaleString("en-US")}.</p>
              {pages.previous !== null ? <button type="button" disabled={paging} onClick={() => onPage?.(pages.previous!)}
                className="min-h-11 rounded-md border border-warm-300 px-3 py-2 text-sm font-medium text-warm-900 disabled:opacity-50 sm:min-h-9">Previous {pageSize}{clears}</button> : null}
              {pages.next !== null ? <button type="button" disabled={paging} onClick={() => onPage?.(pages.next!)}
                className="min-h-11 rounded-md border border-warm-300 px-3 py-2 text-sm font-medium text-warm-900 disabled:opacity-50 sm:min-h-9">{paging ? "Loading..." : `Next ${Math.min(pageSize, (data.totalMatches ?? 0) - pages.next, (criteria?.requestedCount ?? Number.POSITIVE_INFINITY) - pages.next)}${clears}`}</button> : null}
              <p className="w-full text-xs text-warm-600">Each page is read fresh from the data, in the same order. Selections, saves and the CSV download cover only the page shown.</p>
            </nav>
          ) : null}
        </>
      ) : <p className="text-sm text-warm-800">No institutions match these criteria. Try a wider asset range or another state in the question box below.</p>}
      {/* Criteria and rows lead; saving and the file follow them. */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => downloadCsv(data)}
          className="min-h-11 rounded-md border border-warm-300 px-3 py-2 text-sm font-medium text-warm-900 sm:min-h-9">
          {hasPages ? `Download rows ${rangeText} (CSV)` : "Download this list (CSV)"}
        </button>
        <p className="text-xs text-warm-600">The CSV holds the rows, criteria, notes and fees shown on this page.</p>
      </div>
      {saveContext ? <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={saveResearch} disabled={savingResearch || savedResearchId !== null}
          className="min-h-11 rounded-md border border-warm-300 px-3 py-2 text-sm font-medium text-warm-900 disabled:opacity-50 sm:min-h-9">
          {savingResearch ? "Saving research..." : "Save this peer research"}
        </button>
        {!savedResearchId && !savingResearch ? <p className="text-sm text-warm-700">Fee answers are saved automatically. A peer list is saved only when you choose Save this peer research.</p> : null}
        {researchError ? <p role="alert" className="text-sm text-terra-text">{researchError}</p> : null}
        {savedResearchId ? <p role="status" className="text-sm text-warm-700">Research snapshot saved. <a className="font-medium text-terra-text underline" href={`/pro/peer-research/${encodeURIComponent(savedResearchId)}`}>Reopen saved research</a></p> : null}
      </div> : null}
      {savedQuestion !== undefined
        ? <p className="text-xs text-warm-600">This is the list as it was saved. To refine it or compare fees, run the question again.</p>
        : <p className="text-xs text-warm-600">Refine this list by state (for example, “Only Florida”) or save selected institutions as a peer group. Fee comparisons use only the institutions shown.</p>}
    </section>
  );
}
