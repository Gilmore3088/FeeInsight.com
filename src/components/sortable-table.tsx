"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  format?: (value: unknown, row: T) => string | React.ReactNode;
  className?: string;
}

interface SortableTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  rows: T[];
  defaultSort?: string;
  defaultDir?: "asc" | "desc";
  pageSize?: number;
  caption?: string;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
}

function getValue(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

export function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  // Timestamps from Postgres arrive as Dates; String(date) starts with the weekday, so compare times.
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b));
}

export function SortableTable<T extends Record<string, unknown>>({
  columns,
  rows,
  defaultSort,
  defaultDir = "asc",
  pageSize = 50,
  caption,
  onRowClick,
  rowKey,
}: SortableTableProps<T>) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const sortKey = searchParams.get("sort") ?? defaultSort ?? columns[0]?.key ?? "";
  const sortDirParam = searchParams.get("dir");
  const sortDir: "asc" | "desc" =
    sortDirParam === "asc" ? "asc" : sortDirParam === "desc" ? "desc" : defaultDir;
  const page = Math.max(0, Number(searchParams.get("page") ?? "0"));

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortable) return rows;
    const s = [...rows].sort((a, b) => compareValues(getValue(a, sortKey), getValue(b, sortKey)));
    return sortDir === "desc" ? s.reverse() : s;
  }, [rows, sortKey, sortDir, columns]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const displayed = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function handleSort(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === sortKey) {
      params.set("dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", key);
      params.set("dir", "desc");
    }
    params.delete("page");
    router.push(`?${params.toString()}`);
  }

  function goToPage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage > 0) {
      params.set("page", String(newPage));
    } else {
      params.delete("page");
    }
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="admin-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50/80 dark:bg-white/[0.03] text-left">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider ${
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""
                  } ${col.className ?? ""}`}
                >
                  {col.sortable !== false ? (
                    <button
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1 group/sort hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                      {col.label}
                      <span className="text-[9px]">
                        {sortKey === col.key ? (
                          sortDir === "desc" ? (
                            <ArrowDown className="w-3 h-3 text-gray-700 dark:text-gray-300" />
                          ) : (
                            <ArrowUp className="w-3 h-3 text-gray-700 dark:text-gray-300" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-gray-300 group-hover/sort:text-gray-400 dark:text-gray-600" />
                        )}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-b last:border-0 hover:bg-blue-50/30 dark:hover:bg-white/[0.03] transition-colors ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => {
                  const val = getValue(row, col.key);
                  return (
                    <td
                      key={col.key}
                      className={`px-4 py-2.5 tabular-nums ${
                        col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""
                      }`}
                    >
                      {col.format ? col.format(val, row) : val === null || val === undefined ? "\u2014" : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t bg-gray-50/50 dark:bg-white/[0.02] text-xs text-gray-500">
          <span>
            Showing {page * pageSize + 1}&ndash;{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-white/[0.05]"
            >
              Prev
            </button>
            <span className="tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => goToPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-white/[0.05]"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {caption && (
        <div className="px-4 py-2 text-[11px] text-gray-400 border-t">
          {caption}
        </div>
      )}
    </div>
  );
}
