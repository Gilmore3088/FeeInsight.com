"use client";

import { useMemo, useRef, useState } from "react";
import { createPeerSet } from "@/app/pro/(hamilton)/settings/actions";
import { formatPeerAssets, type PeerListResponse } from "@/lib/hamilton/peer-list";
import { defaultPeerSetName } from "@/lib/hamilton/peer-set-name";

type Sort = "selection" | "name" | "assets_desc" | "assets_asc";
export function PeerListView({ response }: { response: PeerListResponse }) {
  const data = response.peerList;
  // A newly answered list owns its selections and save receipt. An old action's
  // completion cannot update the next list or a different research institution.
  const key = JSON.stringify([data.subject?.institutionId, data.queriedAt, data.criteria, data.rows.map(row => row.institutionId)]);
  return <SelectablePeerList key={key} response={response} />;
}

function SelectablePeerList({ response }: { response: PeerListResponse }) {
  const data = response.peerList;
  const [sort, setSort] = useState<Sort>("selection");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
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
  if (data.status !== "ready") return <p role="status" className="text-sm leading-relaxed text-warm-800">{response.shortAnswer}</p>;
  const criteria = data.criteria;
  return (
    <section aria-label="Peer list" className="flex min-w-0 flex-col gap-4 font-sans">
      <div>
        <h2 className="text-xl font-semibold text-warm-900">{response.shortAnswer}</h2>
        <p className="mt-1 text-sm text-warm-700">Research subject: {data.subject?.name ?? "Not available"}. Amounts shown in US dollars.</p>
      </div>
      {criteria ? (
        <details className="rounded-lg border border-warm-300 bg-warm-50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-warm-900">Selection criteria: {criteria.charterType === "credit_union" ? "credit unions" : criteria.charterType === "bank" ? "banks" : "both types"} · {criteria.states.join(" / ") || "nationwide"}{criteria.minAssets ? ` · ${criteria.minAssets.inclusive ? "≥" : ">"} ${formatPeerAssets(criteria.minAssets.value)}` : ""}{criteria.maxAssets ? ` · ${criteria.maxAssets.inclusive ? "≤" : "<"} ${formatPeerAssets(criteria.maxAssets.value)}` : ""}{criteria.peerSetLabel ? ` · ${criteria.peerSetLabel}` : ""}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-warm-700">
            {criteria.descriptions.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </details>
      ) : null}
      {data.notes.map((note, i) => <p key={i} className="text-sm text-warm-700">{note}</p>)}
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
              <p className="text-xs text-warm-600">Leave the name blank to use “{automaticName}”. Saving keeps exactly these institutions; choose Use for all charts in Settings to apply the group.</p>
              <button type="button" onClick={saveSelection} disabled={isSaving || savedName !== null}
                className="self-start rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-50">
                {isSaving ? "Saving peer group..." : `Save ${selectedIds.length} as a peer group`}
              </button>
              {error ? <p role="alert" className="text-sm text-terra-text">{error}</p> : null}
              {savedName ? <p role="status" className="text-sm text-warm-800">Saved {selectedIds.length} selected institutions as “{savedName}”. <a href={`/pro/settings?instId=${data.subject.institutionId}#peer-sets`} className="font-medium text-terra-text underline">Manage peer groups</a></p> : null}
            </div>
          ) : null}
          <p className="text-xs text-warm-600">On a narrow screen, scroll the table horizontally to see every column.</p>
          <div role="region" aria-label="Peer table; scroll horizontally" tabIndex={0} className="min-w-0 overflow-x-auto rounded-lg border border-warm-300 focus:outline-terra">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Institutions matching the criteria, with assets, reporting dates, sources and published-fee coverage</caption>
              <thead className="border-b border-warm-300 bg-warm-100 text-warm-800"><tr>
                <th scope="col" className="p-3">Select</th>
                <th scope="col" className="p-3">Institution</th><th scope="col" className="p-3">Headquarters</th>
                <th scope="col" className="p-3 text-right">Total assets (USD)</th><th scope="col" className="p-3">Reporting date / source</th>
                <th scope="col" className="p-3">Fee data</th>
              </tr></thead>
              <tbody className="divide-y divide-warm-200 bg-white text-warm-900">
                {rows.map(row => <tr key={row.institutionId}>
                  <td className="p-3"><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.institutionId)}
                    onChange={() => toggleSelection(row.institutionId)} disabled={isSaving || (!selected.has(row.institutionId) && selected.size >= 50) || !data.subject}
                    className="accent-terra" /></td>
                  <th scope="row" className="max-w-[240px] p-3 font-normal">
                    <a href={`/institution/${row.institutionId}`} className="font-semibold text-terra-text underline">{row.name}</a>
                    <p className="mt-1 text-xs text-warm-600">{row.charterType === "credit_union" ? "Credit union" : row.charterType === "bank" ? "Bank" : "Type unavailable"}</p>
                    <details className="mt-1 text-xs text-warm-600"><summary className="cursor-pointer">Why included</summary><p>{row.inclusionReason}</p></details>
                  </th>
                  <td className="p-3">{[row.city, row.stateCode].filter(Boolean).join(", ") || "Not available"}</td>
                  <td className="whitespace-nowrap p-3 text-right tabular-nums">{formatPeerAssets(row.totalAssetsUsd)}</td>
                  <td className="p-3"><p className="tabular-nums">{row.reportDate ?? "Not available"}</p>
                    {row.source ? <p className="mt-1 text-xs text-warm-600">{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{row.source.toUpperCase()} filing source</a> : `${row.source.toUpperCase()} filing; link unavailable`}</p> : null}
                  </td>
                  <td className="p-3 text-xs text-warm-700">{row.feeCoverage === "available" ? "Published fees available" : "No published fees on file"}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="text-sm text-warm-800">No institutions matched. Change the criteria in the question field; no replacement peer group was selected.</p>}
      <p className="text-xs text-warm-600">You can refine this exact displayed list by state (for example, “Only Florida”) or save selected institutions as a peer group. Comparing this list&apos;s fees and exporting it are not supported yet.</p>
    </section>
  );
}
