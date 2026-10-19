"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { STATE_NAMES } from "@/lib/us-states";

const STATES = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

/** Let consumers choose their market explicitly before browsing its cities and institutions. */
export function ConsumerMarketLookup() {
  const router = useRouter();
  const id = useId();
  const [state, setState] = useState("");

  return (
    <form
      aria-label="Explore your local banking options"
      onSubmit={(event) => {
        event.preventDefault();
        if (!Object.prototype.hasOwnProperty.call(STATE_NAMES, state)) return;
        router.push(`/fees/city/${state.toLowerCase()}`);
      }}
    >
      <label htmlFor={`${id}-state`} className="block text-[14px] font-semibold text-ink">
        Your state or territory
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <select
          id={`${id}-state`}
          name="state"
          required
          value={state}
          onChange={(event) => setState(event.target.value)}
          aria-describedby={`${id}-help`}
          className="min-h-12 min-w-0 flex-1 rounded-md border border-control-border bg-surface-0 px-3 text-[16px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brick"
        >
          <option value="">Choose a state or territory</option>
          {STATES.map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-12 shrink-0 rounded-md bg-ink px-5 py-3 text-[15px] font-semibold text-on-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brick"
        >
          Explore local options
        </button>
      </div>
      <p id={`${id}-help`} className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        Choose your state, then your city to see banks, credit unions and available fee schedules.
      </p>
    </form>
  );
}
