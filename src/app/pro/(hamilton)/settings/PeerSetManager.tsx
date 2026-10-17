"use client";

import { useState, useTransition } from "react";
import { InstitutionPicker, type InstitutionSearchResult } from "@/components/hamilton/InstitutionPicker";
import { STATE_NAMES } from "@/lib/us-states";
import { defaultPeerSetName } from "@/lib/hamilton/peer-set-name";
import {
  MAX_NEAREST_PEER_COUNT,
  PEER_REGULATOR_LABELS,
  SAVED_PEER_REGULATORS,
  describeSavedPeerDimensions,
  type SavedPeerDimensions,
} from "@/lib/peer-set-dimensions";
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
  /** Asset range in dollars, regulator, credit union charter, holding company, metro, closest in assets. */
  advanced?: SavedPeerDimensions | null;
}

export interface PeerMarketOption {
  code: number;
  name: string;
}

/** The research subject the wider dimensions are measured against. */
export interface PeerSetSubject {
  name: string | null;
  holdingCompanyRssd: string | null;
  hasAssets: boolean;
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
  initialNotes = {},
  marketOptions = [],
  marketNames = {},
  homeMarket = null,
  subject = null,
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
  /** Why a saved group has no peers right now, by set id. */
  initialNotes?: Record<number, string>;
  /** Metro markets for the metro dropdown, by name. */
  marketOptions?: PeerMarketOption[];
  /** Metro names by code, for saved groups' summaries. */
  marketNames?: Record<number, string>;
  /** The metro holding most of the research institution's branches. */
  homeMarket?: PeerMarketOption | null;
  subject?: PeerSetSubject | null;
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
  const [notes, setNotes] = useState<Record<number, string>>(initialNotes);
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
    setNotes((prev) => {
      const next = { ...prev };
      if (result.note) next[saved.id] = result.note;
      else delete next[saved.id];
      return next;
    });
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
                          {ps.advanced &&
                            describeSavedPeerDimensions(
                              ps.advanced,
                              ps.advanced.market_code !== undefined ? marketNames[ps.advanced.market_code] : null,
                            ).map((part) => <span key={part}>{part}</span>)}
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-warm-700 [font-variant-numeric:tabular-nums]">
                      {notes[ps.id]
                        ? notes[ps.id]
                        : count === undefined
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
          marketOptions={marketOptions}
          marketNames={marketNames}
          homeMarket={homeMarket}
          subject={subject}
          isPending={isPending}
          researchInstitutionId={researchInstitutionId}
          onCancel={() => setEditing(null)}
          onSubmit={(formData) => handleSubmit(formData, editing)}
        />
      )}
    </div>
  );
}

/** Total assets in dollars as the form shows them, in millions. */
function millions(value: number | undefined): string {
  return value === undefined ? "" : String(+(value / 1_000_000).toFixed(3));
}

/** True when any wider dimension is filled in; the server then names the group. */
function hasWiderChoice(form: FormData): boolean {
  return ["asset_min_m", "asset_max_m", "cu_charter", "holding_company_rssd", "market_code", "nearest"].some(
    (key) => String(form.get(key) ?? "").trim() !== "",
  ) || form.getAll("regulators").length > 0;
}

function PeerSetForm({
  initial,
  names,
  marketOptions,
  marketNames,
  homeMarket,
  subject,
  isPending,
  researchInstitutionId,
  onCancel,
  onSubmit,
}: {
  initial: PeerSetRow | null;
  names: Record<number, string>;
  marketOptions: PeerMarketOption[];
  marketNames: Record<number, string>;
  homeMarket: PeerMarketOption | null;
  subject: PeerSetSubject | null;
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
  const advanced = initial?.advanced ?? null;
  const regulators = new Set(advanced?.regulators ?? []);
  const holdingRssd = advanced?.holding_company_rssd ?? subject?.holdingCompanyRssd ?? null;
  const savedMarket = advanced?.market_code;
  const otherMarkets = marketOptions.filter((m) => m.code !== homeMarket?.code);
  const savedMarketListed = savedMarket === undefined || savedMarket === homeMarket?.code || marketOptions.some((m) => m.code === savedMarket);
  const subjectName = subject?.name ?? "your institution";
  const tapLabel = "flex min-h-11 cursor-pointer items-center gap-1.5 text-sm text-warm-800";

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
        if (!String(form.get("name") ?? "").trim() && !(mode === "filters" && hasWiderChoice(form))) {
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
            { value: "filters" as const, label: "By charter, state, size and more" },
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
          <details open={Boolean(advanced)}>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-warm-800">
              More ways to define peers (optional)
            </summary>
            <div className="mt-2 flex flex-col gap-4">
              <fieldset>
                <legend className={fieldLabel}>Total assets range</legend>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-warm-800">
                    <span>Lowest, in $ millions</span>
                    <input
                      name="asset_min_m"
                      inputMode="decimal"
                      defaultValue={millions(advanced?.asset_min)}
                      placeholder="For example 500"
                      className={`${inputClass} min-h-11`}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-warm-800">
                    <span>Highest, in $ millions</span>
                    <input
                      name="asset_max_m"
                      inputMode="decimal"
                      defaultValue={millions(advanced?.asset_max)}
                      placeholder="For example 2000"
                      className={`${inputClass} min-h-11`}
                    />
                  </label>
                </div>
                <p className="mt-1 text-xs text-warm-600">
                  Uses each institution&apos;s latest reported total assets. Fill in one side for an open-ended range.
                </p>
              </fieldset>

              <fieldset>
                <legend className={fieldLabel}>Primary regulator</legend>
                <div className="mt-1 grid grid-cols-2 gap-x-3 sm:grid-cols-4">
                  {SAVED_PEER_REGULATORS.map((key) => (
                    <label key={key} className={tapLabel}>
                      <input
                        type="checkbox"
                        name="regulators"
                        value={key}
                        defaultChecked={regulators.has(key)}
                        className="accent-terra"
                      />
                      {PEER_REGULATOR_LABELS[key]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className={fieldLabel}>Credit union charter</legend>
                <div className="mt-1 flex flex-wrap gap-x-4">
                  {[
                    { value: "", label: "Any" },
                    { value: "federal", label: "Federal charter" },
                    { value: "state", label: "State charter" },
                  ].map((opt) => (
                    <label key={opt.value} className={tapLabel}>
                      <input
                        type="radio"
                        name="cu_charter"
                        value={opt.value}
                        defaultChecked={(advanced?.cu_charter ?? "") === opt.value}
                        className="accent-terra"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-warm-600">Applies to credit unions only.</p>
              </fieldset>

              <div className="flex flex-col gap-1 text-sm text-warm-800">
                <label htmlFor="peer_set_market" className="font-medium">Metro market</label>
                <select
                  id="peer_set_market"
                  aria-describedby="peer_set_market_help"
                  name="market_code"
                  defaultValue={savedMarket === undefined ? "" : String(savedMarket)}
                  className={`${inputClass} min-h-11 sm:w-96`}
                >
                  <option value="">Any metro</option>
                  {homeMarket && <option value={homeMarket.code}>My home market: {homeMarket.name}</option>}
                  {!savedMarketListed && savedMarket !== undefined && (
                    <option value={savedMarket}>{marketNames[savedMarket] ?? `Metro ${savedMarket}`}</option>
                  )}
                  {otherMarkets.length > 0 && (
                    <optgroup label="All metros">
                      {otherMarkets.map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p id="peer_set_market_help" className="text-xs text-warm-600">
                  Institutions with a branch in the metro, from FDIC and NCUA branch records.
                  {!homeMarket && otherMarkets.length === 0 ? " None found: the metro list is not available right now." : ""}
                </p>
              </div>

              <fieldset>
                <legend className={fieldLabel}>Holding company</legend>
                {holdingRssd ? (
                  <label className={tapLabel}>
                    <input
                      type="checkbox"
                      name="holding_company_rssd"
                      value={holdingRssd}
                      defaultChecked={Boolean(advanced?.holding_company_rssd)}
                      className="accent-terra"
                    />
                    {advanced?.holding_company_rssd && advanced.holding_company_rssd !== subject?.holdingCompanyRssd
                      ? "Only institutions in the holding company this group was saved with"
                      : `Only institutions in the same holding company as ${subjectName}`}
                  </label>
                ) : (
                  <p className="mt-1 text-sm text-warm-600">
                    {subject ? `None found: no holding company is on record for ${subjectName}.` : "Choose a research institution above to use this."}
                  </p>
                )}
              </fieldset>

              <div className="flex flex-col gap-1 text-sm text-warm-800">
                <label htmlFor="peer_set_nearest" className="font-medium">Keep only the closest in total assets</label>
                <input
                  id="peer_set_nearest"
                  aria-describedby="peer_set_nearest_help"
                  name="nearest"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_NEAREST_PEER_COUNT}
                  step={1}
                  defaultValue={advanced?.nearest ?? ""}
                  disabled={!subject?.hasAssets && advanced?.nearest === undefined}
                  placeholder={`1 to ${MAX_NEAREST_PEER_COUNT}`}
                  className={`${inputClass} min-h-11 sm:w-40`}
                />
                <p id="peer_set_nearest_help" className="text-xs text-warm-600">
                  {subject?.hasAssets
                    ? `How many to keep, closest to ${subjectName}'s total assets, among institutions that publish fees and meet everything else. Leave blank to keep them all.`
                    : subject
                      ? `None found: no total assets are on record for ${subjectName}, so this can't be measured.`
                      : "Choose a research institution above to use this."}
                </p>
              </div>
            </div>
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
