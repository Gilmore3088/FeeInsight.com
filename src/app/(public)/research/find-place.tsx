"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

const NUMBER = new Intl.NumberFormat("en-US");

export interface PlaceState {
  code: string;
  name: string;
  institutions: number;
}

export interface PlaceDistrict {
  id: number;
  name: string;
}

/**
 * The hub's geography finder, right under the hero: one state dropdown and the 12 district
 * links, so a reader reaches their own report before the national findings. No map here; the
 * state map sits lower on wider screens.
 */
export function FindPlace({ states, districts }: { states: PlaceState[]; districts: PlaceDistrict[] }) {
  const router = useRouter();
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-8">
      <div>
        <label htmlFor="find-state" className="block text-[13px] font-semibold text-ink">
          State report
        </label>
        <select
          id="find-state"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) router.push(e.target.value);
          }}
          className="mt-2 min-h-11 w-full rounded-full border border-border bg-surface-0 px-4 text-[14px] font-semibold text-ink"
        >
          <option value="" disabled>
            Choose a state
          </option>
          {states.map((s) => (
            <option key={s.code} value={`/research/state/${s.code}`}>
              {s.name} ({NUMBER.format(s.institutions)} institutions)
            </option>
          ))}
        </select>
        <a
          href="#states"
          className="mt-1 hidden min-h-11 items-center text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink sm:inline-flex"
        >
          All states on a map
        </a>
      </div>
      <div>
        <p id="find-district-label" className="text-[13px] font-semibold text-ink sm:mx-0 sm:text-left">
          Federal Reserve district report
        </p>
        <ul aria-labelledby="find-district-label" className="mt-2 grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 lg:grid-cols-4">
          {districts.map((d) => (
            <li key={d.id}>
              <Link
                href={`/research/district/${d.id}`}
                className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-0 px-3 text-[13px] font-semibold text-ink hover:border-ink hover:text-brick"
              >
                <span aria-hidden="true" className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
                  {d.id}
                </span>
                <span className="min-w-0 truncate">
                  <span className="sr-only">District {d.id}, </span>
                  {d.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
