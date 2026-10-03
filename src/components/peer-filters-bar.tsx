"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FDIC_TIER_LABELS, FDIC_TIER_ORDER, DISTRICT_NAMES } from "@/lib/fed-districts";

const selectClasses =
  "rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 " +
  "hover:border-gray-300 transition-colors " +
  "dark:bg-[oklch(0.18_0_0)] dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-white/[0.15]";

export function PeerFiltersBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const charter = searchParams.get("charter") ?? "";
  const tier = searchParams.get("tier") ?? "";
  const district = searchParams.get("district") ?? "";
  const range = searchParams.get("range") ?? "";

  const selectedDistricts = district
    ? district.split(",").map((d) => parseInt(d, 10))
    : [];

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    router.push(`/admin?${params.toString()}`);
  }

  const hasFilters = charter || tier || district || range;

  function resetAll() {
    router.push("/admin");
  }

  const activeCount = [charter, tier, district, range].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 print:hidden">
      <div className="flex items-center gap-1.5 mr-1">
        <svg aria-hidden="true"
          viewBox="0 0 16 16"
          className="w-3.5 h-3.5 text-gray-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M1.5 3h13M3.5 7h9M5.5 11h5" />
        </svg>
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">
          Filters
        </span>
        {activeCount > 0 && (
          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-[9px] font-bold text-white tabular-nums">
            {activeCount}
          </span>
        )}
      </div>

      <select
        value={charter}
        onChange={(e) => updateParams({ charter: e.target.value })}
        className={selectClasses}
      >
        <option value="">All Charters</option>
        <option value="bank">Banks</option>
        <option value="credit_union">Credit Unions</option>
      </select>

      <select
        value={tier}
        onChange={(e) => updateParams({ tier: e.target.value })}
        className={selectClasses}
      >
        <option value="">All Tiers</option>
        {FDIC_TIER_ORDER.map((t) => (
          <option key={t} value={t}>
            {FDIC_TIER_LABELS[t]}
          </option>
        ))}
      </select>

      <select
        value={
          selectedDistricts.length === 1
            ? String(selectedDistricts[0])
            : selectedDistricts.length > 1
              ? "multi"
              : ""
        }
        onChange={(e) => {
          const val = e.target.value;
          if (val === "" || val === "multi") {
            updateParams({ district: "" });
          } else {
            updateParams({ district: val });
          }
        }}
        className={selectClasses}
      >
        <option value="">All Districts</option>
        {Object.entries(DISTRICT_NAMES).map(([num, name]) => (
          <option key={num} value={num}>
            {num} - {name}
          </option>
        ))}
        {selectedDistricts.length > 1 && (
          <option value="multi" disabled>
            {selectedDistricts.length} districts
          </option>
        )}
      </select>

      <select
        value={range}
        onChange={(e) => updateParams({ range: e.target.value })}
        className={selectClasses}
      >
        <option value="">All Time</option>
        <option value="7d">7 days</option>
        <option value="30d">30 days</option>
        <option value="90d">90 days</option>
      </select>

      {hasFilters && (
        <button
          onClick={resetAll}
          className="rounded-md px-2 py-1.5 text-[11px] font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100
                     dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/[0.06] transition-colors"
        >
          Clear
        </button>
      )}

      {selectedDistricts.length > 1 && (
        <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium tabular-nums">
          D{selectedDistricts.join(", ")}
        </span>
      )}
    </div>
  );
}
