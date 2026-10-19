"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { STATE_NAMES } from "@/lib/us-states";
import { directoryHref } from "./directory-view";

const STATES = Object.keys(STATE_NAMES).sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b]));

interface StatePickerProps {
  query: string;
  stateCode: string;
  charter: string;
  /** Fee focus (`?fee=`) arriving from a consumer guide; changing the state keeps it. */
  fee?: string;
  /** The "Fees available" filter; changing the state keeps it. */
  fees?: boolean;
  className?: string;
}

/** The state filter: a native dropdown, applied as soon as it changes. Works on every screen. */
export function StatePicker({ query, stateCode, charter, fee = "", fees = false, className = "" }: StatePickerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className={className}>
      <label className="sr-only" htmlFor="institution-state-filter">
        State
      </label>
      <select
        id="institution-state-filter"
        name="state"
        value={stateCode}
        aria-busy={isPending}
        onChange={(event) => {
          const href = directoryHref({ q: query, state: event.target.value, charter, fee, fees });
          startTransition(() => router.push(href));
        }}
        className={`min-h-11 w-full rounded-full border border-control-border bg-surface-0 px-4 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brick ${
          isPending ? "opacity-60" : ""
        }`}
      >
        <option value="">All states</option>
        {STATES.map((code) => (
          <option key={code} value={code}>
            {STATE_NAMES[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
