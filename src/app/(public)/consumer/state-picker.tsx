"use client";

import { useRouter } from "next/navigation";

export interface StateOption {
  code: string;
  name: string;
  institutions: number;
}

/** A state dropdown that opens that state's city fee pages: a phone-friendly stand-in for a map. */
export function StatePicker({ states }: { states: StateOption[] }) {
  const router = useRouter();
  return (
    <div>
      <label htmlFor="alternatives-state" className="sr-only">
        State
      </label>
      <select
        id="alternatives-state"
        defaultValue=""
        onChange={(event) => {
          if (event.target.value) router.push(`/fees/city/${event.target.value.toLowerCase()}`);
        }}
        className="min-h-11 w-full rounded-full border border-border bg-surface-0 px-4 text-[14px] font-semibold text-ink"
      >
        <option value="" disabled>
          Choose a state
        </option>
        {states.map((state) => (
          <option key={state.code} value={state.code}>
            {state.name}, {state.institutions.toLocaleString("en-US")} with published fees
          </option>
        ))}
      </select>
    </div>
  );
}
