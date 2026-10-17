"use client";

import { useState } from "react";
import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";

export interface StateOption {
  code: string;
  name: string;
  institutions: number;
}

/**
 * The entrance to a state's city fee pages: a U.S. outline with the chosen state marked and a
 * state dropdown, both setting one choice, and a link that opens that state's cities. Every
 * state with data is filled the same; color marks only the choice, never a cheaper or dearer
 * place. Phones get the dropdown alone, since states are too small to tap.
 */
export function StatePicker({ states, initial }: { states: StateOption[]; initial?: string }) {
  const byCode = new Map(states.map((s) => [s.code, s]));
  const [code, setCode] = useState(initial && byCode.has(initial) ? initial : (states[0]?.code ?? ""));
  const chosen = byCode.get(code) ?? null;
  return (
    <div className="min-w-0">
      <svg viewBox="0 0 960 600" aria-hidden="true" className="hidden h-auto w-full sm:block">
        {US_STATES.map((state) => {
          const hasData = byCode.has(state.id);
          const selected = state.id === code;
          return (
            <path
              key={state.id}
              d={state.d}
              onClick={hasData ? () => setCode(state.id) : undefined}
              className={`stroke-[1.5] transition-colors ${
                selected
                  ? "fill-brick stroke-paper"
                  : hasData
                    ? "cursor-pointer fill-surface-200 stroke-paper hover:fill-brick-tint"
                    : "fill-paper stroke-border"
              }`}
            />
          );
        })}
      </svg>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="alternatives-state" className="sr-only">
          State
        </label>
        <select
          id="alternatives-state"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="min-h-11 w-full min-w-0 rounded-full border border-border bg-surface-0 px-4 text-[14px] font-semibold text-ink sm:w-auto sm:flex-1"
        >
          {states.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name}
            </option>
          ))}
        </select>
        {chosen && (
          <Link
            href={`/fees/city/${chosen.code.toLowerCase()}`}
            className="fi-btn fi-btn-secondary inline-flex min-h-11 shrink-0 items-center justify-center px-5"
          >
            Compare {chosen.name} cities
          </Link>
        )}
      </div>
      {chosen && (
        <p className="mt-2 text-[13px] text-ink-muted sm:mx-0 sm:text-left" aria-live="polite">
          {chosen.institutions === 1
            ? `1 bank or credit union headquartered in ${chosen.name} has published fees.`
            : `${chosen.institutions.toLocaleString("en-US")} banks and credit unions headquartered in ${chosen.name} have published fees.`}
        </p>
      )}
    </div>
  );
}
