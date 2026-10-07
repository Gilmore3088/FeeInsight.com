"use client";

import { useState, useTransition } from "react";
import { createPeerSet, removePeerSet } from "./actions";

const inputClass =
  "w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra";

interface SavedPeerSet {
  id: number;
  name: string;
  tiers: string | null;
  districts: string | null;
  charter_type: string | null;
  created_at: string;
}

export function PeerSetManager({
  initialPeerSets,
}: {
  initialPeerSets: SavedPeerSet[];
}) {
  const [peerSets, setPeerSets] = useState(initialPeerSets);
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: number) {
    startTransition(async () => {
      const result = await removePeerSet(id);
      if (result.success) {
        setPeerSets((prev) => prev.filter((ps) => ps.id !== id));
      }
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await createPeerSet(formData);
      if (result.success) {
        // Refresh by adding to local state
        const newSet: SavedPeerSet = {
          id: result.id ?? Date.now(),
          name: formData.get("name") as string,
          charter_type: (formData.get("charter_type") as string) || null,
          tiers: formData.getAll("asset_tiers").filter(Boolean).join(",") || null,
          districts: formData.getAll("fed_districts").filter(Boolean).join(",") || null,
          created_at: new Date().toISOString(),
        };
        setPeerSets((prev) => [...prev, newSet]);
        form.reset();
        setShowForm(false);
      }
    });
  }

  const TIERS = [
    { value: "a", label: "Under $100M" },
    { value: "b", label: "$100M-$500M" },
    { value: "c", label: "$500M-$1B" },
    { value: "d", label: "$1B-$10B" },
    { value: "e", label: "$10B-$50B" },
    { value: "f", label: "Over $50B" },
  ];

  const tierLabel = (code: string) => TIERS.find((t) => t.value === code)?.label ?? code;
  const fieldLabel = "block text-sm font-medium text-warm-800";

  return (
    <div className="flex flex-col gap-4">
      {peerSets.length === 0 && !showForm && (
        <p className="text-sm text-warm-700">
          You have no peer groups yet. Add one to compare against it in Try a price and Reports.
        </p>
      )}

      {peerSets.length > 0 && (
        <ul className="divide-y divide-warm-200 border-y border-warm-200">
          {peerSets.map((ps) => (
            <li key={ps.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-warm-900">{ps.name}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-600">
                  <span>
                    {ps.charter_type === "credit_union"
                      ? "Credit unions"
                      : ps.charter_type === "bank"
                        ? "Banks"
                        : "Banks and credit unions"}
                  </span>
                  {ps.tiers && <span>Assets: {ps.tiers.split(",").map(tierLabel).join(", ")}</span>}
                  {ps.districts && <span>Fed districts: {ps.districts.split(",").join(", ")}</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(ps.id)}
                disabled={isPending}
                className="text-sm font-medium text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!showForm ? (
        <div>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark"
          >
            Add a peer group
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-md border border-warm-200 bg-white p-4">
          <label className="flex flex-col gap-1 text-sm text-warm-800">
            <span className="font-medium">Name</span>
            <input
              name="name"
              required
              className={inputClass}
              placeholder="For example, Mid-Atlantic community banks"
            />
          </label>

          <fieldset>
            <legend className={fieldLabel}>Charter</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {[
                { value: "", label: "Banks and credit unions" },
                { value: "bank", label: "Banks only" },
                { value: "credit_union", label: "Credit unions only" },
              ].map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-sm text-warm-800">
                  <input type="radio" name="charter_type" value={opt.value} defaultChecked={opt.value === ""} className="accent-terra" />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={fieldLabel}>Asset size</legend>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {TIERS.map((t) => (
                <label key={t.value} className="flex cursor-pointer items-center gap-1.5 text-sm text-warm-800">
                  <input type="checkbox" name="asset_tiers" value={t.value} className="accent-terra" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={fieldLabel}>Federal Reserve districts</legend>
            <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((d) => (
                <label key={d} className="flex cursor-pointer items-center gap-1 text-sm text-warm-800 [font-variant-numeric:tabular-nums]">
                  <input type="checkbox" name="fed_districts" value={d} className="accent-terra" />
                  {d}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-warm-600">Leave asset size or districts blank to include all.</p>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save peer group"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 hover:border-warm-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
