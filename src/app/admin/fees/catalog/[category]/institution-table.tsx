"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, ChevronRight, ChevronDown } from "lucide-react";
import type { FeeInstance } from "@/lib/data-store";
import { formatAmount, formatAssets } from "@/lib/format";

interface InstitutionGroup {
  institution_id: number;
  institution_name: string;
  charter_type: string;
  state_code: string | null;
  asset_size_tier: string | null;
  asset_size: number | null;
  fees: FeeInstance[];
  primary_amount: number | null;
  min_amount: number | null;
  max_amount: number | null;
  fee_count: number;
}

type SortKey =
  | "institution_name"
  | "amount"
  | "charter_type"
  | "state_code"
  | "asset_size"
  | "fee_count";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 25;

function SortIcon({
  column,
  sortKey,
  sortDir,
}: {
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (sortKey !== column) {
    return <ArrowUpDown className="h-3 w-3 text-gray-400" />;
  }
  return sortDir === "asc" ? (
    <ArrowUp className="h-3 w-3 text-blue-600" />
  ) : (
    <ArrowDown className="h-3 w-3 text-blue-600" />
  );
}

export function InstitutionTable({
  fees,
  median,
  highestTier = false,
}: {
  fees: FeeInstance[];
  median: number | null;
  /** The category counts a bank at its highest tier (overdraft), not its median. */
  highestTier?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [charterFilter, setCharterFilter] = useState<"all" | "bank" | "credit_union">("all");
  const [showAll, setShowAll] = useState(false);
  const [expandedInst, setExpandedInst] = useState<Set<number>>(new Set());

  // Group fees by institution
  const groups = useMemo(() => {
    const map = new Map<number, InstitutionGroup>();
    for (const fee of fees) {
      if (!map.has(fee.institution_id)) {
        map.set(fee.institution_id, {
          institution_id: fee.institution_id,
          institution_name: fee.institution_name,
          charter_type: fee.charter_type,
          state_code: fee.state_code,
          asset_size_tier: fee.asset_size_tier,
          asset_size: fee.asset_size,
          fees: [],
          primary_amount: null,
          min_amount: null,
          max_amount: null,
          fee_count: 0,
        });
      }
      const group = map.get(fee.institution_id)!;
      group.fees.push(fee);
      group.fee_count++;
    }

    // Compute aggregate amounts per institution
    for (const group of map.values()) {
      const amounts = group.fees
        .map((f) => f.amount)
        .filter((a): a is number => a !== null && a > 0)
        .sort((a, b) => a - b);

      if (amounts.length > 0) {
        group.min_amount = amounts[0];
        group.max_amount = amounts[amounts.length - 1];
        // Primary = the value the index counts for this institution: its highest tier
        // for overdraft, otherwise the median of its fees.
        group.primary_amount = highestTier
          ? amounts[amounts.length - 1]
          : amounts.length % 2 === 0
            ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
            : amounts[Math.floor(amounts.length / 2)];
      }
    }

    return Array.from(map.values());
  }, [fees, highestTier]);

  const filtered = useMemo(() => {
    let result = groups;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((g) =>
        g.institution_name.toLowerCase().includes(q)
      );
    }

    if (charterFilter !== "all") {
      result = result.filter((g) => g.charter_type === charterFilter);
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "institution_name":
          cmp = a.institution_name.localeCompare(b.institution_name);
          break;
        case "amount":
          cmp = (a.primary_amount ?? -1) - (b.primary_amount ?? -1);
          break;
        case "charter_type":
          cmp = a.charter_type.localeCompare(b.charter_type);
          break;
        case "state_code":
          cmp = (a.state_code ?? "").localeCompare(b.state_code ?? "");
          break;
        case "asset_size":
          cmp = (a.asset_size ?? 0) - (b.asset_size ?? 0);
          break;
        case "fee_count":
          cmp = a.fee_count - b.fee_count;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [groups, search, charterFilter, sortKey, sortDir]);

  const displayed = showAll ? filtered : filtered.slice(0, PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "institution_name" ? "asc" : "desc");
    }
  }

  function toggleExpand(id: number) {
    setExpandedInst((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="admin-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50 dark:bg-white/[0.03] flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-gray-700 mr-auto">
          Institutions ({filtered.length})
          <span className="text-xs font-normal text-gray-400 ml-2">
            {fees.length} total fee entries
          </span>
        </h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search institutions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-gray-300 pl-8 pr-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       dark:bg-[oklch(0.18_0_0)] dark:border-white/[0.12] dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "bank", "credit_union"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setCharterFilter(filter)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                charterFilter === filter
                  ? filter === "bank"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : filter === "credit_union"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-gray-200 text-gray-700 dark:bg-white/[0.12] dark:text-gray-300"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400 dark:hover:bg-white/[0.1]"
              }`}
            >
              {filter === "all" ? "All" : filter === "bank" ? "Banks" : "CUs"}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="px-4 py-2 font-medium w-8"></th>
              <th className="px-4 py-2 font-medium sticky left-0 bg-white dark:bg-[oklch(0.205_0_0)] z-10 min-w-[200px]">
                <button
                  onClick={() => handleSort("institution_name")}
                  className="flex items-center gap-1 hover:text-gray-900"
                >
                  Institution <SortIcon column="institution_name" sortKey={sortKey} sortDir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-2 font-medium text-right">
                <button
                  onClick={() => handleSort("amount")}
                  className="flex items-center gap-1 ml-auto hover:text-gray-900"
                >
                  Amount <SortIcon column="amount" sortKey={sortKey} sortDir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-2 font-medium text-center">
                <button
                  onClick={() => handleSort("fee_count")}
                  className="flex items-center gap-1 mx-auto hover:text-gray-900"
                >
                  Entries <SortIcon column="fee_count" sortKey={sortKey} sortDir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-2 font-medium">
                <button
                  onClick={() => handleSort("charter_type")}
                  className="flex items-center gap-1 hover:text-gray-900"
                >
                  Type <SortIcon column="charter_type" sortKey={sortKey} sortDir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-2 font-medium">
                <button
                  onClick={() => handleSort("state_code")}
                  className="flex items-center gap-1 hover:text-gray-900"
                >
                  State <SortIcon column="state_code" sortKey={sortKey} sortDir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-2 font-medium text-right">
                <button
                  onClick={() => handleSort("asset_size")}
                  className="flex items-center gap-1 ml-auto hover:text-gray-900"
                >
                  Assets <SortIcon column="asset_size" sortKey={sortKey} sortDir={sortDir} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((group) => {
              const isExpanded = expandedInst.has(group.institution_id);
              const isHigh =
                median !== null &&
                group.primary_amount !== null &&
                group.primary_amount > median * 1.5;
              const isLow =
                median !== null &&
                group.primary_amount !== null &&
                median > 0 &&
                group.primary_amount < median * 0.5;
              const hasMultiple = group.fee_count > 1;

              return (
                <>
                  <tr
                    key={group.institution_id}
                    className={`border-b hover:bg-gray-50 dark:hover:bg-white/[0.03] ${
                      hasMultiple ? "cursor-pointer" : ""
                    } ${isExpanded ? "bg-blue-50/30 dark:bg-blue-900/10" : ""}`}
                    onClick={hasMultiple ? () => toggleExpand(group.institution_id) : undefined}
                  >
                    <td className="px-4 py-2 text-gray-400">
                      {hasMultiple ? (
                        isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )
                      ) : null}
                    </td>
                    <td className="px-4 py-2 sticky left-0 bg-white dark:bg-[oklch(0.205_0_0)] z-10">
                      <Link
                        href={`/admin/peers/${group.institution_id}`}
                        className="text-blue-600 hover:underline font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {group.institution_name}
                      </Link>
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-semibold ${
                        isHigh
                          ? "text-red-600 dark:text-red-400"
                          : isLow
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-gray-900 dark:text-gray-100"
                      }`}
                    >
                      {group.primary_amount !== null ? (
                        <span>
                          {formatAmount(group.primary_amount)}
                          {hasMultiple && group.min_amount !== group.max_amount && (
                            <span className="block text-xs font-normal text-gray-400">
                              {formatAmount(group.min_amount)} to {formatAmount(group.max_amount)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {hasMultiple ? (
                        <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-400">
                          {group.fee_count}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">1</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          group.charter_type === "bank"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        }`}
                      >
                        {group.charter_type === "bank" ? "Bank" : "CU"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {group.state_code ?? "-"}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                      {formatAssets(group.asset_size)}
                    </td>
                  </tr>
                  {isExpanded &&
                    group.fees.map((fee) => (
                      <tr
                        key={fee.id}
                        className="border-b bg-gray-50/50 dark:bg-white/[0.02]"
                      >
                        <td className="px-4 py-1.5"></td>
                        <td className="px-4 py-1.5 pl-8 text-xs text-gray-500 sticky left-0 bg-gray-50/50 dark:bg-[oklch(0.17_0_0)] z-10">
                          {fee.conditions || fee.frequency || "—"}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-xs text-gray-700 dark:text-gray-300">
                          {formatAmount(fee.amount)}
                        </td>
                        <td className="px-4 py-1.5 text-center text-xs text-gray-400">
                          {fee.frequency ?? "-"}
                        </td>
                        <td className="px-4 py-1.5" colSpan={2}>
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              fee.review_status === "approved"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : fee.review_status === "staged"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                  : "bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400"
                            }`}
                          >
                            {fee.review_status}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right text-[10px] text-gray-400 tabular-nums">
                          {(fee.extraction_confidence * 100).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > PAGE_SIZE && !showAll && (
        <div className="px-4 py-3 border-t text-center">
          <button
            onClick={() => setShowAll(true)}
            className="text-sm text-blue-600 hover:underline font-medium"
          >
            Show all {filtered.length} institutions
          </button>
        </div>
      )}
      {showAll && filtered.length > PAGE_SIZE && (
        <div className="px-4 py-3 border-t text-center">
          <button
            onClick={() => setShowAll(false)}
            className="text-sm text-gray-500 hover:underline"
          >
            Show fewer
          </button>
        </div>
      )}
    </div>
  );
}
