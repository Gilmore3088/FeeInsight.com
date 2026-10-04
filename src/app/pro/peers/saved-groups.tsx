"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getSavedGroups,
  saveGroup,
  deleteGroup,
  type SavedGroup,
} from "./actions";

interface SavedGroupsProps {
  currentCharter: string;
  currentTiers: string[];
  currentDistricts: number[];
  hasFilters: boolean;
}

export function SavedGroups({
  currentCharter,
  currentTiers,
  currentDistricts,
  hasFilters,
}: SavedGroupsProps) {
  const router = useRouter();
  const [groups, setGroups] = useState<SavedGroup[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");
  const [saving, startSave] = useTransition();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getSavedGroups().then((g) => {
      setGroups(g);
      setLoaded(true);
    });
  }, []);

  function loadGroup(group: SavedGroup) {
    const params = new URLSearchParams();
    if (group.charter_type) params.set("charter", group.charter_type);
    if (group.tiers) params.set("tier", group.tiers);
    if (group.districts) params.set("district", group.districts);
    const qs = params.toString();
    router.push(qs ? `/pro/peers?${qs}` : "/pro/peers");
  }

  function handleSave() {
    if (!name.trim()) return;
    startSave(async () => {
      try {
        await saveGroup(name.trim(), {
          charter: currentCharter || undefined,
          tiers: currentTiers.length > 0 ? currentTiers : undefined,
          districts: currentDistricts.length > 0 ? currentDistricts : undefined,
        });
        setShowSave(false);
        setName("");
        const updated = await getSavedGroups();
        setGroups(updated);
      } catch {
        // ignore
      }
    });
  }

  function handleDelete(id: number) {
    startSave(async () => {
      await deleteGroup(id);
      const updated = await getSavedGroups();
      setGroups(updated);
    });
  }

  if (!loaded) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Saved group pills */}
      {groups.map((g) => (
        <div
          key={g.id}
          className="group flex items-center gap-1 rounded-full border border-warm-200 bg-white pl-3 pr-1 py-1 text-[11px]"
        >
          <button
            onClick={() => loadGroup(g)}
            className="font-medium text-warm-700 hover:text-terra transition-colors"
          >
            {g.name}
          </button>
          <button
            onClick={() => handleDelete(g.id)}
            className="flex items-center justify-center h-4 w-4 rounded-full text-warm-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
            aria-label={`Delete ${g.name}`}
          >
            <svg aria-hidden="true" className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}

      {/* Save current button */}
      {hasFilters && !showSave && groups.length < 10 && (
        <button
          onClick={() => setShowSave(true)}
          className="flex items-center gap-1 rounded-full border border-dashed border-warm-300 px-3 py-1 text-[11px] font-medium text-warm-500 hover:border-terra/40 hover:text-terra transition-colors"
        >
          <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Save peer group
        </button>
      )}

      {/* Save input */}
      {showSave && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Group name..."
            autoFocus
            className="rounded-full border border-warm-200 bg-white px-3 py-1 text-[11px] text-warm-900 placeholder:text-warm-500 outline-none focus:ring-1 focus:ring-terra/30 w-[140px]"
          />
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded-full bg-terra px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-terra-dark transition-colors disabled:opacity-40"
          >
            {saving ? "..." : "Save"}
          </button>
          <button
            onClick={() => { setShowSave(false); setName(""); }}
            className="text-warm-500 hover:text-warm-700 transition-colors text-[11px]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
