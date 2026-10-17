"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import type { CityFeeKey, CityMarketInstitution } from "@/lib/data-store";
import type { LocalFee } from "./market-view";
import { ACCOUNT_NOT_STATED, meaningfulConditions } from "./account-details";
import { ComparisonBars, feeBars } from "./comparison-bars";
import { CITY_SORTS, FEE_SELECT_EVENT, lowerLabel, money, type CitySort, type FeeSelectDetail } from "./format";
import { orderInstitutions, type CharterFilter } from "./table-order";

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

/** Rows shown before "Show all". */
const FIRST_ROWS = 10;

const READ = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const CHARTERS: { key: CharterFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "bank", label: "Banks" },
  { key: "credit_union", label: "Credit unions" },
];

const CONTROL = "min-h-11 w-full rounded-full border border-border bg-surface-0 px-4 text-[14px] text-ink";
const GRID = "md:grid-cols-[minmax(0,1.3fr)_4.5rem_6rem_minmax(0,1.7fr)_6.5rem]";

/** Keeps the chosen fee and order in the address, so a shared link opens the same view. */
function writeQuery(fee: string, sort: CitySort) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("fee", fee);
    if (sort === "branches") url.searchParams.delete("sort");
    else url.searchParams.set("sort", sort);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // The address is a convenience; the view works without it.
  }
}

/**
 * The fee picker, the chosen fee's median here against the state and the U.S., and every
 * institution with a branch in the area behind it. Search, a bank or credit union filter and
 * an order let a reader see who publishes a lower or higher amount. Phones get stacked cards,
 * so nothing scrolls sideways.
 */
export function MarketTable({
  institutions,
  fees,
  placeName,
  stateName,
  initialFee = "overdraft",
  initialSort = "branches",
}: {
  institutions: CityMarketInstitution[];
  fees: LocalFee[];
  placeName: string;
  stateName: string;
  initialFee?: CityFeeKey;
  initialSort?: CitySort;
}) {
  const [key, setKey] = useState<CityFeeKey>(initialFee);
  const [sort, setSort] = useState<CitySort>(initialSort);
  const [charter, setCharter] = useState<CharterFilter>("all");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const ids = useId();
  const fee = fees.find((f) => f.key === key) ?? fees[0];

  useEffect(() => {
    const onSelect = (event: Event) => {
      const detail = (event as CustomEvent<FeeSelectDetail>).detail;
      if (!detail || !fees.some((f) => f.key === detail.fee)) return;
      setKey(detail.fee as CityFeeKey);
      setSort(detail.sort);
      setCharter("all");
      setQuery("");
      setAll(false);
      writeQuery(detail.fee, detail.sort);
    };
    window.addEventListener(FEE_SELECT_EVENT, onSelect);
    return () => window.removeEventListener(FEE_SELECT_EVENT, onSelect);
  }, [fees]);

  const rows = useMemo(() => orderInstitutions(institutions, key, sort, charter, query), [institutions, key, sort, charter, query]);
  const filtered = charter !== "all" || query.trim() !== "";
  const listed = all || filtered ? rows : rows.slice(0, FIRST_ROWS);
  const publishing = rows.filter((i) => i.fees[key]).length;

  return (
    <div>
      {/* The fee and its comparison. */}
      <div className="rounded-2xl border border-border bg-surface-0 p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10">
          <div>
            <label htmlFor={`${ids}-fee`} className="text-[13px] font-medium text-ink">
              Fee
            </label>
            <select
              id={`${ids}-fee`}
              value={key}
              onChange={(e) => {
                const next = e.target.value as CityFeeKey;
                setKey(next);
                writeQuery(next, sort);
              }}
              className="mt-1 min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[15px] font-semibold text-ink"
            >
              {fees.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} ({f.n})
                </option>
              ))}
            </select>
            {fee.min != null && fee.max != null && fee.n >= 2 && fee.max > fee.min && (
              <p className="mt-3 text-[13px] text-ink-soft">
                Published amounts here run from <span className="font-mono tabular-nums text-ink">{money(fee.min)}</span> to{" "}
                <span className="font-mono tabular-nums text-ink">{money(fee.max)}</span>.
              </p>
            )}
          </div>
          <div>
            <p className="text-[14px] font-semibold text-ink">Median published {lowerLabel(fee.label)} fee</p>
            <div className="mt-3">
              <ComparisonBars bars={feeBars(fee, placeName, stateName)} />
            </div>
          </div>
        </div>
        <p className="mt-5 border-t border-border pt-3 text-[12px] text-ink-muted">
          {placeName} covers every institution with a branch here, wherever it is headquartered. {stateName} covers institutions
          headquartered in the state. U.S. covers every institution in the Bank Fee Index.
        </p>
      </div>

      {/* The institutions behind it. */}
      <h3 className="mt-10 text-[17px] font-semibold text-ink sm:text-[19px]">The institutions behind the comparison</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto_12rem] lg:items-end">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="sr-only">Search institutions</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or home city" className={CONTROL} />
        </label>
        <div className="flex rounded-full border border-border bg-surface-0 p-1 text-[13px] font-semibold" role="group" aria-label="Institution type">
          {CHARTERS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={charter === c.key}
              onClick={() => setCharter(c.key)}
              className={`min-h-9 flex-1 whitespace-nowrap rounded-full px-3 ${charter === c.key ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 lg:block">
          <span className="shrink-0 text-[12px] text-ink-muted">Sort by</span>
          <select
            value={sort}
            onChange={(e) => {
              const next = e.target.value as CitySort;
              setSort(next);
              writeQuery(key, next);
            }}
            className={`lg:mt-0.5 ${CONTROL}`}
          >
            {CITY_SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 text-[13px] text-ink-muted" aria-live="polite">
        {rows.length === 0
          ? "No institution here matches."
          : `${rows.length} ${rows.length === 1 ? "institution" : "institutions"}, ${publishing} with a published ${lowerLabel(fee.label)} fee.`}
      </p>

      {rows.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface-0">
          <div className={`hidden border-b border-border bg-paper px-5 py-2 text-[12px] font-medium text-ink-muted md:grid md:gap-4 ${GRID}`} aria-hidden="true">
            <span>Institution</span>
            <span className="text-right">Branches here</span>
            <span className="text-right">{fee.label}</span>
            <span>Account details</span>
            <span>Read on</span>
          </div>
          <ul className="divide-y divide-border">
            {listed.map((inst) => {
              const v = inst.fees[key];
              const conditions = v ? meaningfulConditions(v.conditions, v.fee_name, fee.label) : [];
              return (
                <li key={inst.id} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 py-3 text-[14px] md:items-baseline md:px-5 ${GRID}`}>
                  <div className="min-w-0">
                    <Link href={`/institution/${inst.id}`} className="font-semibold text-ink underline decoration-transparent underline-offset-4 hover:decoration-ink">
                      {inst.name}
                    </Link>
                    <p className="text-[12px] text-ink-muted">
                      {inst.charter === "credit_union" ? "Credit union, membership rules apply" : "Bank"}
                      {inst.hq_city && inst.hq_state ? ` · based in ${placeCase(inst.hq_city)}, ${inst.hq_state}` : ""}
                      <span className="md:hidden">
                        {" "}
                        · {inst.branches} {inst.branches === 1 ? "branch" : "branches"} here
                      </span>
                    </p>
                  </div>
                  <span className="hidden text-right font-mono tabular-nums text-ink md:block">{inst.branches}</span>
                  <span className="text-right">
                    {v ? (
                      v.source_url ? (
                        <a
                          href={v.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[15px] tabular-nums text-ink underline decoration-border underline-offset-2 hover:decoration-brick"
                        >
                          {money(v.amount)}
                        </a>
                      ) : (
                        <span className="font-mono text-[15px] tabular-nums text-ink">{money(v.amount)}</span>
                      )
                    ) : (
                      <span className="text-[12px] text-ink-muted">{missingNote(inst)}</span>
                    )}
                  </span>
                  <div className="col-span-2 min-w-0 text-[13px] md:col-span-1">
                    {v ? (
                      <>
                        <p className={v.account ? "text-ink" : "text-ink-muted"}>{v.account ?? ACCOUNT_NOT_STATED}</p>
                        {conditions.length > 0 && <p className="text-[12px] text-ink-soft">{conditions.join(" · ")}</p>}
                        {v.source_line && (
                          <details className="mt-1 text-[12px]">
                            <summary className="cursor-pointer text-ink-muted hover:text-ink">Source wording</summary>
                            <blockquote className="mt-1 border-l-2 border-border pl-3 text-ink-soft [overflow-wrap:anywhere]">
                              &ldquo;{v.source_line}&rdquo;
                            </blockquote>
                          </details>
                        )}
                      </>
                    ) : null}
                  </div>
                  <span className="col-span-2 text-[12px] text-ink-muted md:col-span-1">
                    {v?.read_on ? (
                      <>
                        <span className="md:hidden">Read on </span>
                        {READ.format(new Date(`${v.read_on}T00:00:00Z`))}
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {listed.length < rows.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-ink px-5 text-[14px] font-semibold text-ink hover:bg-surface-0"
        >
          Show all {rows.length} institutions
        </button>
      )}
    </div>
  );
}
