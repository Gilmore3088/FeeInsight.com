"use client";

import { useState, useTransition } from "react";
import { InstitutionPicker, type InstitutionSearchResult } from "@/components/hamilton/InstitutionPicker";
import { STATE_NAMES } from "@/lib/us-states";
import { defaultPeerSetName } from "@/lib/hamilton/peer-set-name";
import {
  createPeerSet,
  editPeerSet,
  removePeerSet,
  setPeerSetForAllCharts,
  type PeerSetActionResult,
} from "./actions";

const inputClass =
  "w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra";

const MAX_CHOSEN_PEERS = 50;

export interface PeerSetRow {
  id: number;
  name: string;
  tiers: string | null;
  districts: string | null;
  charter_type: string | null;
  created_by: string;
  created_at: string;
  institution_ids: number[] | null;
  states: string[] | null;
  institution_id: number | null;
  is_default: boolean;
}

export interface PeerSetCount {
  institutions: number;
  publishing: number;
}

/** The asset tiers institutions are filed under (institution_sources.asset_size_tier). */
const TIERS = [
  { value: "community_small", label: "Under $300M" },
  { value: "community_mid", label: "$300M to $1B" },
  { value: "community_large", label: "$1B to $10B" },
  { value: "regional", label: "$10B to $50B" },
  { value: "large_regional", label: "$50B to $250B" },
  { value: "super_regional", label: "Over $250B" },
];

const STATE_OPTIONS = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

function tierLabel(code: string): string {
  return TIERS.find((t) => t.value === code)?.label ?? code.replace(/_/g, " ");
}

function charterLabel(value: string | null): string {
  if (value === "credit_union") return "Credit unions";
  if (value === "bank") return "Banks";
  return "Banks and credit unions";
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The default charts use: the team's first, else the user's personal one (as the resolver does). */
function effectiveDefaultId(sets: PeerSetRow[]): number | null {
  const team = sets.find((s) => s.is_default && s.institution_id !== null);
  const personal = sets.find((s) => s.is_default && s.institution_id === null);
  return (team ?? personal)?.id ?? null;
}

export function PeerSetManager({
  initialPeerSets,
  initialCounts = {},
  initialInstitutionNames = {},
  workspaceName = null,
  canEditWorkspaceSets = true,
  currentUserId = "",
  researchInstitutionId,
  minPeers,
  widerGroupLabel = "the national index",
}: {
  initialPeerSets: PeerSetRow[];
  initialCounts?: Record<number, PeerSetCount>;
  initialInstitutionNames?: Record<number, string>;
  /** The team workspace new sets are shared with; null when sets are personal. */
  workspaceName?: string | null;
  canEditWorkspaceSets?: boolean;
  currentUserId?: string;
  /** The displayed research subject; null explicitly creates personal groups. */
  researchInstitutionId?: number | null;
  /** The engine's minimum peers for a position (MIN_PEERS_FOR_POSITION), passed from the server. */
  minPeers: number;
  /** The group charts widen to when a set is too thin for a fee. */
  widerGroupLabel?: string;
}) {
  const [peerSets, setPeerSets] = useState(initialPeerSets);
  const [counts, setCounts] = useState<Record<number, PeerSetCount>>(initialCounts);
  const [names, setNames] = useState<Record<number, string>>(initialInstitutionNames);
  const [editing, setEditing] = useState<PeerSetRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const defaultId = effectiveDefaultId(peerSets);
  const teamDefaultLocked =
    !canEditWorkspaceSets && peerSets.some((s) => s.is_default && s.institution_id !== null);

  function canEdit(set: PeerSetRow): boolean {
    return set.created_by === currentUserId || (set.institution_id !== null && canEditWorkspaceSets);
  }

  function applySaved(result: PeerSetActionResult) {
    if (!result.peerSet) return;
    const saved = result.peerSet;
    setPeerSets((prev) => {
      const exists = prev.some((s) => s.id === saved.id);
      return exists ? prev.map((s) => (s.id === saved.id ? saved : s)) : [saved, ...prev];
    });
    if (result.count) setCounts((prev) => ({ ...prev, [saved.id]: result.count as PeerSetCount }));
    if (result.institutionNames) setNames((prev) => ({ ...prev, ...result.institutionNames }));
  }

  function handleDelete(id: number) {
    setError(null);
    startTransition(async () => {
      const result = await removePeerSet(id);
      if (result.success) {
        setPeerSets((prev) => prev.filter((ps) => ps.id !== id));
      } else {
        setError(result.error ?? "Could not remove the peer group.");
      }
    });
  }

  function handleDefault(id: number | null) {
    setError(null);
    startTransition(async () => {
      const result = await setPeerSetForAllCharts(id);
      if (!result.success) {
        setError(result.error ?? "Could not change the peer group charts use.");
        return;
      }
      setPeerSets((prev) => {
        const chosen = prev.find((s) => s.id === id);
        return prev.map((s) => {
          if (id === null) return { ...s, is_default: false };
          if (s.id === id) return { ...s, is_default: true };
          // Same scope loses its default; a personal pick also clears the team's default.
          const sameScope = s.institution_id === (chosen?.institution_id ?? null);
          const teamCleared = chosen?.institution_id === null && s.institution_id !== null && canEditWorkspaceSets;
          return sameScope || teamCleared ? { ...s, is_default: false } : s;
        });
      });
    });
  }

  function handleSubmit(formData: FormData, target: PeerSetRow | "new") {
    setError(null);
    startTransition(async () => {
      const result = target === "new" ? await createPeerSet(formData) : await editPeerSet(target.id, formData);
      if (!result.success) {
        setError(result.error ?? "Could not save the peer group.");
        return;
      }
      applySaved(result);
      setEditing(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-warm-700">
        Pick the institutions you compare yourself with. The group set to <b>Use for all charts</b> is the one
        every Pro chart, benchmark, Try a price and report compares against.
        {workspaceName ? ` Groups you add are shared with everyone on ${workspaceName}'s team.` : ""}
      </p>

      {error && (
        <p role="alert" className="rounded-md border border-terra/40 bg-terra-soft px-3 py-2 text-sm text-terra-text">
          {error}
        </p>
      )}

      <fieldset className="flex flex-col gap-0">
        <legend className="sr-only">Peer group for all charts</legend>
        {teamDefaultLocked && (
          <p className="mb-2 text-sm text-warm-600">Your team&apos;s owner or admin picks the peer group charts use.</p>
        )}
        <ul className="divide-y divide-warm-200 border-y border-warm-200">
          <li className="flex items-start gap-3 py-3">
            <input
              type="radio"
              name="peer_default"
              id="peer_default_auto"
              checked={defaultId === null}
              onChange={() => handleDefault(null)}
              disabled={isPending || teamDefaultLocked}
              className="mt-1 accent-terra"
            />
            <label htmlFor="peer_default_auto" className="min-w-0 cursor-pointer">
              <span className="block text-sm font-medium text-warm-900">Automatic peers</span>
              <span className="block text-sm text-warm-600">
                Hamilton picks institutions like yours by state, charter and asset size.
              </span>
            </label>
          </li>

          {peerSets.map((ps) => {
            const count = counts[ps.id];
            const chosen = ps.institution_ids ?? [];
            const thin = count !== undefined && count.publishing < minPeers;
            return (
              <li key={ps.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    type="radio"
                    name="peer_default"
                    id={`peer_default_${ps.id}`}
                    checked={defaultId === ps.id}
                    onChange={() => handleDefault(ps.id)}
                    disabled={isPending || teamDefaultLocked}
              className="mt-1 accent-terra"
                  />
                  <div className="min-w-0">
                    <label htmlFor={`peer_default_${ps.id}`} className="cursor-pointer text-sm font-medium text-warm-900">
                      {ps.name}
                    </label>
                    {defaultId === ps.id && (
                      <span className="ml-2 rounded bg-warm-150 px-1.5 py-0.5 text-xs text-warm-800">Use for all charts</span>
                    )}
                    {ps.institution_id === null && workspaceName && (
                      <span className="ml-2 text-xs text-warm-600">Personal</span>
                    )}
                    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-600">
                      {chosen.length > 0 ? (
                        <span>
                          {plural(chosen.length, "chosen institution", "chosen institutions")}:{" "}
                          {chosen.slice(0, 6).map((id) => names[id] ?? `Institution ${id}`).join(", ")}
                          {chosen.length > 6 ? ` and ${chosen.length - 6} more` : ""}
                        </span>
                      ) : (
                        <>
                          <span>{charterLabel(ps.charter_type)}</span>
                          {ps.states && ps.states.length > 0 && (
                            <span>States: {ps.states.map((st) => STATE_NAMES[st] ?? st).join(", ")}</span>
                          )}
                          {ps.tiers && <span>Assets: {ps.tiers.split(",").map(tierLabel).join(", ")}</span>}
                          {ps.districts && <span>Fed districts: {ps.districts.split(",").join(", ")}</span>}
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-warm-700 [font-variant-numeric:tabular-nums]">
                      {count === undefined
                        ? "Peer count not available right now."
                        : `${plural(count.institutions, "institution", "institutions")} in this group; ${count.publishing.toLocaleString("en-US")} publish live fees.`}
                    </p>
                    <p className={`mt-0.5 text-xs ${thin ? "text-terra-text" : "text-warm-600"}`}>
                      Where fewer than {minPeers} institutions in this group publish a fee, charts widen to {widerGroupLabel} for that fee (or wider, if that group is thin too).
                    </p>
                  </div>
                </div>
                {canEdit(ps) && (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setEditing(ps)}
                      disabled={isPending}
                      className="text-sm font-medium text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(ps.id)}
                      disabled={isPending}
                      className="text-sm font-medium text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {editing === null ? (
        canEditWorkspaceSets || !workspaceName ? (
          <div>
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark"
            >
              Add a peer group
            </button>
          </div>
        ) : null
      ) : (
        <PeerSetForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          names={names}
          isPending={isPending}
          researchInstitutionId={researchInstitutionId}
          onCancel={() => setEditing(null)}
          onSubmit={(formData) => handleSubmit(formData, editing)}
        />
      )}
    </div>
  );
}

function PeerSetForm({
  initial,
  names,
  isPending,
  researchInstitutionId,
  onCancel,
  onSubmit,
}: {
  initial: PeerSetRow | null;
  names: Record<number, string>;
  isPending: boolean;
  researchInstitutionId?: number | null;
  onCancel: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  const fieldLabel = "block text-sm font-medium text-warm-800";
  const [mode, setMode] = useState<"filters" | "institutions">(
    initial?.institution_ids?.length ? "institutions" : "filters",
  );
  const [chosen, setChosen] = useState<{ id: number; name: string }[]>(
    (initial?.institution_ids ?? []).map((id) => ({ id, name: names[id] ?? `Institution ${id}` })),
  );
  const [states, setStates] = useState<string[]>(initial?.states ?? []);
  const [pickerKey, setPickerKey] = useState(0);
  const tiers = new Set((initial?.tiers ?? "").split(",").filter(Boolean));
  const districts = new Set((initial?.districts ?? "").split(",").filter(Boolean).map(Number));

  function addInstitution(result: InstitutionSearchResult | null) {
    if (!result) return;
    setChosen((prev) =>
      prev.some((p) => p.id === result.id) || prev.length >= MAX_CHOSEN_PEERS
        ? prev
        : [...prev, { id: result.id, name: result.institution_name }],
    );
    setPickerKey((k) => k + 1);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        if (!String(form.get("name") ?? "").trim()) {
          form.set("name", defaultPeerSetName(mode === "institutions" ? { institution_ids: chosen.map(peer => peer.id) } : {
            charter_type: String(form.get("charter_type") ?? ""),
            states,
            asset_tiers: form.getAll("asset_tiers").map(String),
            fed_districts: form.getAll("fed_districts").map(Number),
          }));
        }
        onSubmit(form);
      }}
      className="flex flex-col gap-4 rounded-md border border-warm-200 bg-white p-4"
    >
      {researchInstitutionId !== undefined ? <input type="hidden" name="research_institution_id" value={researchInstitutionId ?? ""} /> : null}
      <label className="flex flex-col gap-1 text-sm text-warm-800">
        <span className="font-medium">Name (optional)</span>
        <input
          name="name"
          maxLength={100}
          defaultValue={initial?.name ?? ""}
          className={inputClass}
          placeholder="Leave blank to name this group from your selection"
        />
        <span className="text-xs text-warm-600">We will use your selected institutions or filters as the name. You can rename it later.</span>
      </label>

      <fieldset>
        <legend className={fieldLabel}>How to pick peers</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {[
            { value: "filters" as const, label: "By charter, state and size" },
            { value: "institutions" as const, label: "Choose institutions by name" },
          ].map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-sm text-warm-800">
              <input
                type="radio"
                name="mode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => setMode(opt.value)}
                className="accent-terra"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "institutions" ? (
        <div className="flex flex-col gap-2">
          {chosen.length < MAX_CHOSEN_PEERS ? (
            <InstitutionPicker
              key={pickerKey}
              inputId="peer_set_institution_search"
              name="peer_set_picker"
              label="Add an institution"
              help={`Up to ${MAX_CHOSEN_PEERS} institutions. Charts compare you with exactly these.`}
              onSelect={addInstitution}
              labelClassName="text-sm font-medium"
              labelStyle={{ color: "var(--color-warm-800)" }}
              inputClassName={inputClass}
              inputStyle={{}}
            />
          ) : (
            <p className="text-sm text-warm-600">You have chosen {MAX_CHOSEN_PEERS}, the most a group can hold.</p>
          )}
          {chosen.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Chosen institutions">
              {chosen.map((inst) => (
                <li
                  key={inst.id}
                  className="flex items-center gap-1.5 rounded-full border border-warm-300 bg-warm-50 py-1 pl-3 pr-1.5 text-sm text-warm-900"
                >
                  <input type="hidden" name="institution_ids" value={inst.id} />
                  {inst.name}
                  <button
                    type="button"
                    onClick={() => setChosen((prev) => prev.filter((p) => p.id !== inst.id))}
                    aria-label={`Remove ${inst.name}`}
                    className="rounded-full px-1.5 text-warm-600 hover:bg-warm-150 hover:text-terra-text"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-warm-600 [font-variant-numeric:tabular-nums]">
            {chosen.length} of {MAX_CHOSEN_PEERS} chosen.
          </p>
        </div>
      ) : (
        <>
          <fieldset>
            <legend className={fieldLabel}>Charter</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {[
                { value: "", label: "Banks and credit unions" },
                { value: "bank", label: "Banks only" },
                { value: "credit_union", label: "Credit unions only" },
              ].map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-sm text-warm-800">
                  <input
                    type="radio"
                    name="charter_type"
                    value={opt.value}
                    defaultChecked={(initial?.charter_type ?? "") === opt.value}
                    className="accent-terra"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={fieldLabel}>States</legend>
            <select
              aria-label="Add a state"
              value=""
              onChange={(e) => {
                const code = e.target.value;
                if (code) setStates((prev) => (prev.includes(code) ? prev : [...prev, code]));
              }}
              className={`${inputClass} mt-2 sm:w-64`}
            >
              <option value="">Add a state</option>
              {STATE_OPTIONS.filter(([code]) => !states.includes(code)).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            {states.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Chosen states">
                {states.map((code) => (
                  <li
                    key={code}
                    className="flex items-center gap-1.5 rounded-full border border-warm-300 bg-warm-50 py-1 pl-3 pr-1.5 text-sm text-warm-900"
                  >
                    <input type="hidden" name="states" value={code} />
                    {STATE_NAMES[code] ?? code}
                    <button
                      type="button"
                      onClick={() => setStates((prev) => prev.filter((s) => s !== code))}
                      aria-label={`Remove ${STATE_NAMES[code] ?? code}`}
                      className="rounded-full px-1.5 text-warm-600 hover:bg-warm-150 hover:text-terra-text"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <fieldset>
            <legend className={fieldLabel}>Asset size</legend>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {TIERS.map((t) => (
                <label key={t.value} className="flex cursor-pointer items-center gap-1.5 text-sm text-warm-800">
                  <input
                    type="checkbox"
                    name="asset_tiers"
                    value={t.value}
                    defaultChecked={tiers.has(t.value)}
                    className="accent-terra"
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>

          <details open={districts.size > 0}>
            <summary className="cursor-pointer text-sm font-medium text-warm-800">Advanced filters: Federal Reserve districts (optional)</summary>
            <fieldset className="mt-2">
            <legend className="sr-only">Federal Reserve districts (optional)</legend>
            <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((d) => (
                <label key={d} className="flex cursor-pointer items-center gap-1 text-sm text-warm-800 [font-variant-numeric:tabular-nums]">
                  <input
                    type="checkbox"
                    name="fed_districts"
                    value={d}
                    defaultChecked={districts.has(d)}
                    className="accent-terra"
                  />
                  {d}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-warm-600">Leave districts blank to include every district.</p>
            </fieldset>
          </details>
          <p className="text-xs text-warm-600">Leave states or asset size blank to include all.</p>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-50"
        >
          {isPending ? "Saving..." : initial ? "Save changes" : "Save peer group"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 hover:border-warm-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
