"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { STATE_NAMES } from "@/lib/us-states";

interface DirectoryFiltersProps {
  query: string;
  stateCode: string;
  charterType: string;
  /** Fee focus (`?fee=`) arriving from a consumer guide; changing a filter keeps it. */
  feeCategory?: string;
}

const SELECT_CLASS =
  "min-h-10 rounded-md border border-[#D5CBBF] bg-[#FDFBF8] px-3 py-2 text-sm text-[#1A1815] outline-none focus:border-[#C44B2E] disabled:opacity-60";

function buildHref(next: {
  query: string;
  stateCode: string;
  charterType: string;
  feeCategory?: string;
}): string {
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  if (next.stateCode) params.set("state", next.stateCode);
  if (next.charterType) params.set("charter", next.charterType);
  if (next.feeCategory) params.set("fee", next.feeCategory);
  const search = params.toString();
  return search ? `/institutions?${search}` : "/institutions";
}

/** State and institution-type filters that apply as soon as they change. */
export function DirectoryFilters({ query, stateCode, charterType, feeCategory = "" }: DirectoryFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function apply(next: Partial<DirectoryFiltersProps>) {
    const href = buildHref({ query, stateCode, charterType, feeCategory, ...next });
    startTransition(() => router.push(href));
  }

  return (
    <div className="fi-reveal fi-reveal-delay-2 flex flex-wrap items-center gap-3 border-b border-[#E0D7C9] py-4">
      <label className="sr-only" htmlFor="institution-state-filter">
        Filter by state
      </label>
      <select
        id="institution-state-filter"
        name="state"
        value={stateCode}
        disabled={isPending}
        onChange={(event) => apply({ stateCode: event.target.value })}
        className={SELECT_CLASS}
      >
        <option value="">All states</option>
        {Object.entries(STATE_NAMES).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="institution-charter-filter">
        Filter by institution type
      </label>
      <select
        id="institution-charter-filter"
        name="charter"
        value={charterType}
        disabled={isPending}
        onChange={(event) => apply({ charterType: event.target.value })}
        className={SELECT_CLASS}
      >
        <option value="">Banks and credit unions</option>
        <option value="bank">Banks only</option>
        <option value="credit_union">Credit unions only</option>
      </select>
      {isPending && <span className="text-sm text-[#6B6255]">Updating…</span>}
    </div>
  );
}
