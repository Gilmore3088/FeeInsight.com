"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface StateOption {
  code: string;
  name: string;
  institutions: number;
}

/** A state dropdown and a button that opens that state's city fee pages: a phone-friendly stand-in for a map. */
export function StatePicker({ states }: { states: StateOption[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (code) router.push(`/fees/city/${code.toLowerCase()}`);
      }}
    >
      <label htmlFor="alternatives-state" className="sr-only">
        State
      </label>
      <select
        id="alternatives-state"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-full border border-border bg-surface-0 px-4 text-[14px] font-semibold text-ink"
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
      <button
        type="submit"
        disabled={!code}
        className="fi-btn fi-btn-secondary inline-flex min-h-11 shrink-0 items-center justify-center px-5 disabled:opacity-50"
      >
        Show cities
      </button>
    </form>
  );
}
