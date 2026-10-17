"use client";

import { describeSavedPeerDimensions, type SavedPeerDimensions } from "@/lib/peer-set-dimensions";

export interface HamiltonPeerSetOption {
  id: number;
  name: string;
  tiers: string | null;
  districts: string | null;
  charter_type: string | null;
  /** Asset range, regulator, credit union charter, holding company, metro, closest in assets. */
  advanced?: SavedPeerDimensions | null;
}

interface PeerBaselineSelectorProps {
  id: string;
  value: string | null;
  defaultLabel: string;
  peerSets: HamiltonPeerSetOption[];
  disabled?: boolean;
  onChange: (peerSetId: string | null) => void;
}

function formatCharter(value: string | null): string | null {
  if (!value) return null;
  return value === "credit_union" ? "Credit unions" : value.replace(/_/g, " ");
}

function formatPeerSetSummary(peerSet: HamiltonPeerSetOption): string {
  const parts = [
    formatCharter(peerSet.charter_type),
    peerSet.tiers ? `tiers ${peerSet.tiers}` : null,
    peerSet.districts ? `districts ${peerSet.districts}` : null,
    ...(peerSet.advanced ? describeSavedPeerDimensions(peerSet.advanced) : []),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "custom peer set";
}

export function PeerBaselineSelector({
  id,
  value,
  defaultLabel,
  peerSets,
  disabled = false,
  onChange,
}: PeerBaselineSelectorProps) {
  const selectedValue = value ?? "";
  const hasSelectedPeerSet =
    selectedValue === "" || peerSets.some((peerSet) => String(peerSet.id) === selectedValue);

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] uppercase tracking-[0.2em] mb-2"
        style={{ color: "var(--hamilton-secondary)" }}
      >
        Benchmark Baseline
      </label>
      <select
        id={id}
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition-colors disabled:opacity-50"
        style={{
          borderColor: "var(--hamilton-outline-variant, rgba(216,194,184,0.55))",
          color: "var(--hamilton-on-surface)",
          backgroundColor: "var(--hamilton-surface-container-lowest)",
        }}
      >
        <option value="">{defaultLabel}</option>
        {!hasSelectedPeerSet && (
          <option value={selectedValue}>Saved peer set #{selectedValue}</option>
        )}
        {peerSets.map((peerSet) => (
          <option key={peerSet.id} value={String(peerSet.id)}>
            {peerSet.name} - {formatPeerSetSummary(peerSet)}
          </option>
        ))}
      </select>
      <p
        className="mt-2 text-[11px] leading-relaxed"
        style={{ color: "var(--hamilton-secondary)" }}
      >
        Verified benchmark calculations use this peer baseline, with national fallback labeled when coverage is thin.
      </p>
    </div>
  );
}
