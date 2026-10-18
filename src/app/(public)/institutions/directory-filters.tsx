"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { STATE_NAMES } from "@/lib/us-states";

interface DirectoryFiltersProps {
  query: string;
  stateCode: string;
  charterType: string;
  /** Fee focus (`?fee=`) arriving from a consumer guide; changing a filter keeps it. */
  feeCategory?: string;
}

const SELECT_CLASS =
  "min-h-10 rounded-md border border-border bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-brick disabled:opacity-60";

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
  // The pick shows at once and stays while the directory loads (#1953: the dropdown snapped back
  // to the old value for seconds, so a reader thought the first choice was lost).
  const [picked, setPicked] = useOptimistic({ stateCode, charterType });

  function apply(next: { stateCode?: string; charterType?: string }) {
    const merged = { ...picked, ...next };
    const href = buildHref({ query, feeCategory, ...merged });
    // An async action stays pending until the new page commits, and the pick shows until then.
    startTransition(async () => {
      setPicked(merged);
      await router.push(href);
    });
  }

  return (
    <div className="fi-reveal fi-reveal-delay-2 flex flex-wrap items-center gap-3 border-b border-border py-4">
      <label className="sr-only" htmlFor="institution-state-filter">
        Filter by state
      </label>
      <select
        id="institution-state-filter"
        name="state"
        value={picked.stateCode}
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
        value={picked.charterType}
        onChange={(event) => apply({ charterType: event.target.value })}
        className={SELECT_CLASS}
      >
        <option value="">Banks and credit unions</option>
        <option value="bank">Banks only</option>
        <option value="credit_union">Credit unions only</option>
      </select>
      {isPending && <span className="text-sm text-ink-muted">Updating…</span>}
    </div>
  );
}
