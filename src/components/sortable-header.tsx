"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function SortableHeader({
  column,
  label,
  className = "",
}: {
  column: string;
  label: string;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const currentSort = searchParams.get("sort");
  const currentDir = searchParams.get("dir");
  const isActive = currentSort === column;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";

  const params = new URLSearchParams(searchParams.toString());
  params.set("sort", column);
  params.set("dir", nextDir);
  params.delete("page");

  return (
    <th className={`px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider ${className}`}>
      <Link
        href={`?${params.toString()}`}
        className={`inline-flex items-center gap-0.5 hover:text-gray-600 transition-colors ${
          isActive ? "text-gray-600" : ""
        }`}
      >
        {label}
        <span className="inline-flex flex-col leading-none -space-y-0.5">
          <svg aria-hidden="true"
            viewBox="0 0 8 5"
            className={`w-2 h-1.5 ${isActive && currentDir === "asc" ? "text-gray-900" : "text-gray-300"}`}
            fill="currentColor"
          >
            <path d="M4 0L8 5H0z" />
          </svg>
          <svg aria-hidden="true"
            viewBox="0 0 8 5"
            className={`w-2 h-1.5 ${isActive && currentDir === "desc" ? "text-gray-900" : "text-gray-300"}`}
            fill="currentColor"
          >
            <path d="M4 5L0 0h8z" />
          </svg>
        </span>
      </Link>
    </th>
  );
}
