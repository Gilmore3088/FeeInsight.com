"use client";

import Link from "next/link";
import { useState } from "react";
import type { CityFeeKey, CityMarketInstitution } from "@/lib/data-store";
import type { LocalFee } from "./market-view";

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** Why a cell is empty: we hold no schedule, we found one but publish none of it yet, or it lists no such fee. */
function missingNote(inst: CityMarketInstitution): string {
  if (inst.schedule === "none") return "No fee schedule found yet";
  if (inst.schedule === "found") return "Schedule found, fees not yet published";
  return "Not found on its schedule";
}

/** "ORLANDO" as "Orlando"; a name already in mixed case is kept. */
function placeCase(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name;
}

/** Rows shown before "Show all": the institutions with the most branches here. */
const FIRST_ROWS = 15;

const READ = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Every institution with a branch in the area, most branches first, with one fee at a time.
 * The state and U.S. medians sit above the table for the chosen fee; no reference graphic per
 * cell. Phones get stacked rows, so nothing scrolls sideways.
 */
export function MarketTable({
  institutions,
  fees,
  placeName,
  stateName,
  initialFee = "overdraft",
}: {
  institutions: CityMarketInstitution[];
  fees: LocalFee[];
  placeName: string;
  stateName: string;
  initialFee?: CityFeeKey;
}) {
  const [key, setKey] = useState<CityFeeKey>(initialFee);
  const [all, setAll] = useState(false);
  const listed = all ? institutions : institutions.slice(0, FIRST_ROWS);
  const fee = fees.find((f) => f.key === key) ?? fees[0];
  const refs = [
    fee.median != null ? `${placeName} median ${money(fee.median)} (${fee.n})` : `${fee.n} here publish it, too few for a local median`,
    fee.state_median != null ? `${stateName} median ${money(fee.state_median)}` : null,
    fee.us_median != null ? `U.S. median ${money(fee.us_median)}` : null,
  ].filter(Boolean);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block sm:w-72">
          <span className="text-[13px] font-medium text-ink">Fee</span>
          <select
            value={key}
            onChange={(e) => setKey(e.target.value as CityFeeKey)}
            className="mt-1 min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[14px] font-semibold text-ink"
          >
            {fees.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label} ({f.n})
              </option>
            ))}
          </select>
        </label>
        <p className="text-[13px] text-ink-soft">{refs.join(" · ")}</p>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface-0">
        <div className="hidden border-b border-border bg-paper px-5 py-2 text-[12px] font-medium text-ink-muted sm:grid sm:grid-cols-[minmax(0,1.4fr)_5rem_6rem_minmax(0,1.6fr)_7rem] sm:gap-4" aria-hidden="true">
          <span>Institution</span>
          <span className="text-right">Branches here</span>
          <span className="text-right">{fee.label}</span>
          <span>Account or conditions</span>
          <span>Read</span>
        </div>
        <ul className="divide-y divide-border">
          {listed.map((inst) => {
            const v = inst.fees[key];
            return (
              <li key={inst.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 text-[14px] sm:grid-cols-[minmax(0,1.4fr)_5rem_6rem_minmax(0,1.6fr)_7rem] sm:items-baseline sm:px-5">
                <div className="min-w-0">
                  <Link href={`/institution/${inst.id}`} className="font-semibold text-ink underline decoration-transparent underline-offset-4 hover:decoration-ink">
                    {inst.name}
                  </Link>
                  <p className="text-[12px] text-ink-muted">
                    {inst.charter === "credit_union" ? "Credit union, membership rules apply" : "Bank"}
                    {inst.hq_city && inst.hq_state ? ` · based in ${placeCase(inst.hq_city)}, ${inst.hq_state}` : ""}
                    <span className="sm:hidden"> · {inst.branches} {inst.branches === 1 ? "branch" : "branches"} here</span>
                  </p>
                </div>
                <span className="hidden text-right font-mono tabular-nums text-ink sm:block">{inst.branches}</span>
                <span className="text-right">
                  {v ? (
                    v.source_url ? (
                      <a href={v.source_url} target="_blank" rel="noopener noreferrer" className="font-mono tabular-nums text-ink underline decoration-border underline-offset-2 hover:decoration-brick">
                        {money(v.amount)}
                      </a>
                    ) : (
                      <span className="font-mono tabular-nums text-ink">{money(v.amount)}</span>
                    )
                  ) : (
                    <span className="text-[12px] text-ink-muted">{missingNote(inst)}</span>
                  )}
                </span>
                <span className="col-span-2 text-[12px] text-ink-soft sm:col-span-1 sm:text-[13px]">
                  {v ? (
                    <>
                      {v.fee_name}
                      {v.conditions ? <span className="text-ink-muted"> · {v.conditions}</span> : null}
                    </>
                  ) : null}
                </span>
                <span className="col-span-2 text-[12px] text-ink-muted sm:col-span-1">{v?.read_on ? READ.format(new Date(`${v.read_on}T00:00:00Z`)) : null}</span>
              </li>
            );
          })}
        </ul>
      </div>
      {listed.length < institutions.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-ink px-5 text-[14px] font-semibold text-ink hover:bg-surface-0"
        >
          Show all {institutions.length} institutions
        </button>
      )}
    </div>
  );
}
