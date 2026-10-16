"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { PRIMARY_CTA_NAV } from "@/components/nav-items";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { getDisplayName, FAMILY_COLORS } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { percentFeeAllowed } from "@/lib/percent-fees";
import type { DistrictMedian, NationalFinding } from "./findings";
import {
  CpiBars,
  DistrictMap,
  FamilyBars,
  POSITION_LABEL,
  PublishBars,
  RangeStrip,
  districtPosition,
  feeRange,
  positionFill,
  rangeSentence,
} from "./national-visuals";

// Phones get tighter cells; sm and up keep the full padding.
const CELL = "px-3 py-2.5 sm:px-4";
const TH = "px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted sm:px-4";
/** Counts use tabular digits in the body face; Geist Mono (the .tabular-nums class) is for fee figures. */
const COUNT = "[font-variant-numeric:tabular-nums]";
/** Range columns the panel already draws: hidden while the panel squeezes the table (lg), back at xl. */
const RANGE_COL = "hidden sm:table-cell lg:hidden xl:table-cell";
const PANEL_ID = "fee-panel";
const DEFAULT_FEE = "overdraft";
/** The query parameter that carries the selected fee, so a forwarded link opens on it. */
export const FEE_PARAM = "fee";
/** The site's primary next step, the institution search; read from the nav so the two cannot drift. */
export const INSTITUTION_SEARCH_HREF = PRIMARY_CTA_NAV.href;
/** The selected row's marker, so a phone can scroll back to it from the panel. */
const ROW_ATTR = "data-fee-row";

const money = (value: number | null) => formatFeeAmount(value) ?? "-";
const count = (n: number) => n.toLocaleString("en-US");
/** "+3.7%", "-0.4%", "0%": one decimal at most. */
const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Number(Math.abs(v).toFixed(1))}%`;
const narrow = () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches === true;

/**
 * One table row as the browser receives it. Bank and credit union counts are Pro columns, so
 * the page sends them only to Pro readers.
 */
export type FeeRow = Pick<
  IndexEntry,
  "fee_category" | "fee_family" | "median_amount" | "p25_amount" | "p75_amount" | "min_amount" | "max_amount" | "institution_count"
> &
  Partial<Pick<IndexEntry, "bank_count" | "cu_count">>;

export interface FeeFamilyGroup {
  family: string;
  entries: FeeRow[];
}

// The URL is read once per render on the client; selections write it with replaceState and
// keep their own state, so nothing needs to subscribe to it.
const subscribeNever = () => () => {};
const readUrlFee = () => new URLSearchParams(window.location.search).get(FEE_PARAM);
const readNoUrlFee = () => null;

/**
 * The national page body: findings as cards, the fee table, and a panel that draws whichever
 * fee is selected. Selecting a row (click, or Enter on its fee name), the overdraft card or a
 * bar in the "most published" card changes the panel. Overdraft also gets a Fed district map,
 * from the same cached read /fees/overdraft makes, compared with the panel's one national
 * median. The selected fee rides in the URL (?fee=), read once on load and kept current with
 * history.replaceState. Below lg, a row tap scrolls up to the panel, which then offers a way
 * back to that row.
 */
export function NationalExplorer({
  header,
  footer,
  findings,
  groups,
  isPro,
  overdraftDistricts,
  cpiSourceUrl,
}: {
  header: ReactNode;
  footer: ReactNode;
  findings: NationalFinding[];
  groups: FeeFamilyGroup[];
  isPro: boolean;
  overdraftDistricts: DistrictMedian[];
  cpiSourceUrl: string;
}) {
  const rows = groups.flatMap((g) => g.entries);
  const byCategory = new Map(rows.map((e) => [e.fee_category, e]));
  const initial = byCategory.has(DEFAULT_FEE) ? DEFAULT_FEE : (rows[0]?.fee_category ?? null);
  // A link that names a fee (?fee=nsf) opens on it. The server render and hydration use the
  // default; the URL is read on the client after that. An unknown or locked fee keeps the default.
  const urlFee = useSyncExternalStore(subscribeNever, readUrlFee, readNoUrlFee);
  const [picked, setSelected] = useState<string | null>(null);
  const selected = picked ?? (urlFee && byCategory.has(urlFee) ? urlFee : initial);
  const [district, setDistrict] = useState<number | null>(null);
  // The fee whose table row a phone visitor tapped to get here; the panel then links back to it.
  const [cameFromRow, setCameFromRow] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const select = (category: string, reveal = false, fromRow = false) => {
    setSelected(category);
    setDistrict(null);
    setCameFromRow(fromRow && reveal && narrow() ? category : null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set(FEE_PARAM, category);
      window.history.replaceState(window.history.state, "", url);
    }
    // Below lg the panel sits above the table: bring it into view so the change is seen.
    if (reveal && narrow()) {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const backToRow = () => {
    const target = cameFromRow ? tableRef.current?.querySelector<HTMLElement>(`[${ROW_ATTR}="${cameFromRow}"]`) : null;
    (target ?? tableRef.current)?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    setCameFromRow(null);
  };

  const entry = selected ? byCategory.get(selected) ?? null : null;
  const columnCount = isPro ? 8 : 3;

  return (
    <div className="grid gap-y-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="lg:col-start-1 lg:row-start-1">{header}</div>

      {findings.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-3 lg:col-start-1 lg:row-start-2" aria-label="Key figures">
          {findings.map((f) => (
            <li key={f.key} className="flex flex-col rounded-xl border border-border/80 bg-surface-0 p-4">
              <FindingCard
                finding={f}
                selected={selected}
                selectable={(c) => byCategory.has(c)}
                onSelect={(c) => select(c, true)}
                cpiSourceUrl={cpiSourceUrl}
              />
            </li>
          ))}
        </ul>
      )}

      <aside className="lg:col-start-2 lg:row-span-4 lg:row-start-1" aria-label="Selected fee">
        <div
          ref={panelRef}
          id={PANEL_ID}
          className="scroll-mt-20 rounded-2xl border border-border/80 bg-surface-0 p-4 shadow-fi-1 sm:p-5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
        >
          {entry ? (
            <FeePanel
              entry={entry}
              districts={entry.fee_category === DEFAULT_FEE ? overdraftDistricts : []}
              district={district}
              onDistrict={setDistrict}
              family={groups.find((g) => g.family === entry.fee_family)?.entries ?? []}
              onSelect={(c) => select(c)}
            />
          ) : null}
          {entry && cameFromRow === entry.fee_category ? (
            <button
              type="button"
              onClick={backToRow}
              className="mt-3 inline-flex min-h-10 items-center gap-1 text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-brick lg:hidden"
            >
              <span aria-hidden="true">&darr;</span> Back to the table
            </button>
          ) : null}
        </div>
      </aside>

      <div ref={tableRef} className="scroll-mt-20 overflow-hidden rounded-xl border border-border/80 bg-white/70 lg:col-start-1 lg:row-start-3">
        <div className="overflow-x-auto">
          {/* On a phone the table is two columns (fee with its institution count beneath, then
              the median), so it fits a 360px screen with no sideways scroll. */}
          <table className={`w-full text-left text-sm ${isPro ? "sm:min-w-[760px] lg:min-w-0 xl:min-w-[760px]" : ""}`}>
            <caption className="sr-only">
              National median fees. Select a fee to show its range in the panel.
            </caption>
            <thead>
              <tr className="border-b border-border/60 bg-paper/60">
                <th scope="col" className={TH}>Fee</th>
                <th scope="col" className={`${TH} text-right`}>Median</th>
                {isPro && (
                  <>
                    <th scope="col" className={`${TH} text-right ${RANGE_COL}`}>P25</th>
                    <th scope="col" className={`${TH} text-right ${RANGE_COL}`}>P75</th>
                    <th scope="col" className={`${TH} text-right ${RANGE_COL}`}>Range</th>
                    <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>Banks</th>
                    <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>CUs</th>
                  </>
                )}
                <th scope="col" className={`hidden ${TH} text-right sm:table-cell`}>Institutions</th>
              </tr>
            </thead>
            {groups.map(({ family, entries }) => {
              const colors = FAMILY_COLORS[family];
              return (
                <tbody key={family} className="divide-y divide-border/50 border-b border-border/60 last:border-b-0">
                  <tr>
                    <th
                      scope="rowgroup"
                      colSpan={columnCount}
                      className={`${CELL} pb-1.5 pt-3 text-left text-[12px] font-bold ${colors?.text ?? "text-ink-soft"}`}
                    >
                      {family}
                    </th>
                  </tr>
                  {entries.map((e) => {
                    const isSelected = e.fee_category === selected;
                    return (
                      <tr
                        key={e.fee_category}
                        data-selected={isSelected || undefined}
                        data-fee-row={e.fee_category}
                        onClick={() => select(e.fee_category, true, true)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-brick-tint/45 shadow-[inset_3px_0_0_var(--fi-brick)]" : "hover:bg-paper/60"
                        }`}
                      >
                        <td className={CELL}>
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            aria-controls={PANEL_ID}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              select(e.fee_category, true, true);
                            }}
                            className="rounded-sm text-left font-medium text-ink transition-colors hover:text-brick focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                          >
                            {getDisplayName(e.fee_category)}
                          </button>
                          <span className={`mt-0.5 block text-[12px] text-ink-muted sm:hidden ${COUNT}`}>
                            {count(e.institution_count)} institutions
                          </span>
                        </td>
                        <td className={`${CELL} text-right align-top font-semibold tabular-nums text-ink sm:align-middle`}>
                          {money(e.median_amount)}
                        </td>
                        {isPro && (
                          <>
                            <td className={`${CELL} text-right tabular-nums text-ink-muted ${RANGE_COL}`}>{money(e.p25_amount)}</td>
                            <td className={`${CELL} text-right tabular-nums text-ink-muted ${RANGE_COL}`}>{money(e.p75_amount)}</td>
                            <td className={`${CELL} text-right tabular-nums text-ink-muted ${RANGE_COL}`}>
                              {money(e.min_amount)} &ndash; {money(e.max_amount)}
                            </td>
                            <td className={`hidden ${CELL} text-right text-ink-muted sm:table-cell ${COUNT}`}>{e.bank_count === undefined ? "-" : count(e.bank_count)}</td>
                            <td className={`hidden ${CELL} text-right text-ink-muted sm:table-cell ${COUNT}`}>{e.cu_count === undefined ? "-" : count(e.cu_count)}</td>
                          </>
                        )}
                        <td className={`hidden ${CELL} text-right text-ink-muted sm:table-cell ${COUNT}`}>
                          {count(e.institution_count)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>

      <div className="lg:col-start-1 lg:row-start-4">{footer}</div>
    </div>
  );
}

function FindingCard({
  finding: f,
  selected,
  selectable,
  onSelect,
  cpiSourceUrl,
}: {
  finding: NationalFinding;
  selected: string | null;
  selectable: (category: string) => boolean;
  onSelect: (category: string) => void;
  cpiSourceUrl: string;
}) {
  const figure = "text-[2rem] font-extrabold leading-none tracking-[-0.02em] text-ink sm:text-[2.25rem]";
  const label = "mt-1.5 text-[13px] leading-snug text-ink-soft";
  if (f.key === "overdraft") {
    const canSelect = selectable("overdraft");
    const body = (
      <>
        <span className={`block ${figure}`}>{money(f.median)}</span>
        <span className={`block ${label}`}>
          Median overdraft fee, <span className={COUNT}>{count(f.institutions)}</span> institutions
        </span>
        {f.range && (
          <span className="mt-auto block pt-3">
            <RangeStrip name="Overdraft" range={f.range} height={44} />
            <span className="mt-1.5 flex justify-between text-[12px] text-ink-muted [font-variant-numeric:tabular-nums]">
              <span>{money(f.range.min)}</span>
              <span>
                Middle half <span className="font-semibold text-ink">{money(f.range.p25)} to {money(f.range.p75)}</span>
              </span>
              <span>{money(f.range.max)}</span>
            </span>
          </span>
        )}
      </>
    );
    return canSelect ? (
      <button
        type="button"
        onClick={() => onSelect("overdraft")}
        aria-pressed={selected === "overdraft"}
        // A short name: without it a screen reader reads the whole range strip as the button's name.
        aria-label={`Show overdraft: ${money(f.median)} median, ${count(f.institutions)} institutions`}
        aria-controls={PANEL_ID}
        className="-m-1 flex h-full flex-col rounded-lg p-1 text-left focus-visible:outline-2 focus-visible:outline-ink"
      >
        {body}
      </button>
    ) : (
      <div className="flex h-full flex-col">{body}</div>
    );
  }
  if (f.key === "most_published") {
    return (
      <div className="flex h-full flex-col">
        <p className={figure}>{count(f.institutions)}</p>
        <p className={label}>publish a {f.label} fee, more than any other</p>
        <div className="mt-auto pt-3">
          <PublishBars leaders={f.leaders} selected={selected} selectable={selectable} onSelect={onSelect} />
        </div>
      </div>
    );
  }
  const sign = f.bankPct > 0 ? "+" : f.bankPct < 0 ? "-" : "";
  return (
    <div className="flex h-full flex-col">
      <p className={figure}>
        {sign}
        {Number(Math.abs(f.bankPct).toFixed(1))}%
      </p>
      <p className={label}>
        Bank services prices, year to {f.month}, against{" "}
        <span className={`font-semibold text-ink ${COUNT}`}>{signedPct(f.allPct)}</span> for all items.{" "}
        <a href={cpiSourceUrl} rel="noopener" className="whitespace-nowrap text-ink-muted underline underline-offset-2 hover:text-brick">
          BLS CPI
        </a>
      </p>
      <div className="mt-auto pt-3">
        <CpiBars bankPct={f.bankPct} allPct={f.allPct} />
      </div>
      <p className="sr-only">{f.text}</p>
    </div>
  );
}

function FeePanel({
  entry,
  districts,
  district,
  onDistrict,
  family,
  onSelect,
}: {
  entry: FeeRow;
  districts: DistrictMedian[];
  district: number | null;
  onDistrict: (d: number | null) => void;
  family: FeeRow[];
  onSelect: (category: string) => void;
}) {
  const name = getDisplayName(entry.fee_category);
  const range = feeRange(entry);
  // The panel shows one national median, the snapshot's (the same figure as the table and
  // the overdraft card); the map compares each district with that figure.
  const national = entry.median_amount;
  const showMap = national !== null && districts.some((d) => d.median !== null);
  const familyMedians = family.flatMap((e) =>
    e.median_amount === null ? [] : [{ category: e.fee_category, label: getDisplayName(e.fee_category), median: e.median_amount }],
  );
  const active = district !== null ? districts.find((d) => d.district === district) ?? null : null;

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {`${name}: median ${money(entry.median_amount)}, ${count(entry.institution_count)} institutions.`}
      </p>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brick">{entry.fee_family ?? "Fee"}</p>
      <h2 className="mt-1 text-[1.25rem] font-extrabold leading-tight tracking-[-0.01em] text-ink">{name}</h2>
      <div className="mt-3 flex items-end gap-3">
        <p className="text-[2.75rem] font-extrabold leading-none tracking-[-0.03em] text-ink sm:text-[3.25rem] lg:text-[2.75rem]">
          {money(entry.median_amount)}
        </p>
        <p className="pb-1 text-[13px] leading-snug text-ink-soft">
          median
          <br />
          <span className={COUNT}>{count(entry.institution_count)}</span> institutions
        </p>
      </div>

      {range && (
        <div className="mt-4">
          <RangeStrip name={name} range={range} height={34} />
          <dl className="mt-1.5 grid grid-cols-3 text-[12px] [font-variant-numeric:tabular-nums]">
            <div>
              <dt className="text-ink-muted">Lowest</dt>
              <dd className="font-semibold text-ink">{money(range.min)}</dd>
            </div>
            <div className="text-center">
              <dt className="text-ink-muted">Middle half</dt>
              <dd className="font-semibold text-ink">
                {money(range.p25)} to {money(range.p75)}
              </dd>
            </div>
            <div className="text-right">
              <dt className="text-ink-muted">Highest</dt>
              <dd className="font-semibold text-ink">{money(range.max)}</dd>
            </div>
          </dl>
          <p className="sr-only">{rangeSentence(name, range)}</p>
        </div>
      )}

      {showMap && national !== null && (
        <div className="mt-5 border-t border-border/70 pt-4 lg:mt-4 lg:pt-3">
          <p className="text-[12px] font-bold text-ink">By Fed district</p>
          <p className="mt-0.5 min-h-[2.5em] text-[12px] leading-snug text-ink-soft">
            {active ? (
              active.median === null ? (
                <>
                  <Link
                    href={`/research/district/${active.district}`}
                    className="text-ink underline underline-offset-2 hover:text-brick"
                  >
                    {active.name}
                  </Link>
                  : too few institutions for a median.
                </>
              ) : (
                <>
                  <Link
                    href={`/research/district/${active.district}`}
                    className="text-ink underline underline-offset-2 hover:text-brick"
                  >
                    {active.name}
                  </Link>
                  : <span className="font-semibold text-ink">{money(active.median)}</span> median,{" "}
                  <span className={COUNT}>{count(active.institutions)}</span> institutions.{" "}
                  {POSITION_LABEL[districtPosition(active.median, national)]}.
                </>
              )
            ) : (
              <>Each district&apos;s median against the national {money(national)}. Select a district.</>
            )}
          </p>
          {/* Compact at lg so the sticky panel fits a 768px-tall screen. */}
          <div className="mt-2">
            <DistrictMap
              mapClassName="max-w-[22rem] lg:max-w-[12rem]" districts={districts} national={national} selected={district} onSelect={onDistrict} />
          </div>
          {/* Visible at every width: on a phone each chip stacks the district over its median. */}
          <ul className="mt-3 grid grid-cols-3 gap-1 lg:mt-2" aria-label="Overdraft median by Fed district">
            {districts.map((d) => {
              const isActive = d.district === district;
              const position = districtPosition(d.median, national);
              return (
                <li key={d.district}>
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onDistrict(isActive ? null : d.district)}
                    aria-label={`${d.name}: ${d.median === null ? "too few institutions" : `${money(d.median)} median, ${POSITION_LABEL[position].toLowerCase()}`}`}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-md border px-1.5 py-1 text-[11px] leading-tight lg:py-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-ink sm:flex-row sm:items-center sm:justify-between sm:gap-1 ${
                      isActive ? "border-ink/40 bg-paper" : "border-border/70 hover:bg-paper"
                    }`}
                  >
                    <span className="w-full min-w-0 truncate text-left text-ink-soft sm:w-auto">{d.name}</span>
                    <span className="flex items-center gap-1 font-semibold text-ink [font-variant-numeric:tabular-nums]">
                      <span className="h-2 w-2 rounded-full" style={{ background: positionFill(position) }} aria-hidden="true" />
                      {d.median === null ? "-" : money(d.median)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!showMap && familyMedians.length > 1 && (
        <div className="mt-5 border-t border-border/70 pt-4">
          <p className="text-[12px] font-bold text-ink">Medians in {entry.fee_family}</p>
          <div className="mt-2">
            <FamilyBars items={familyMedians} selected={entry.fee_category} onSelect={onSelect} />
          </div>
        </div>
      )}

      {percentFeeAllowed(entry.fee_category) && (
        <p className="mt-4 text-[12px] leading-snug text-ink-muted lg:mt-3" data-rate-note="">
          Dollar amounts only. A fee stated as a percentage is counted separately and is not in
          this median.
        </p>
      )}

      <Link
        href={`/fees/${entry.fee_category}`}
        className="mt-4 inline-block text-[13px] font-semibold text-brick hover:underline lg:mt-3"
      >
        {name} in detail &rarr;
      </Link>

      <p className="mt-3 border-t border-border/70 pt-3 text-[13px] leading-snug text-ink-soft">
        Where does your {feeNoun(name)} sit?{" "}
        <Link href={INSTITUTION_SEARCH_HREF} className="text-ink underline underline-offset-2 hover:text-brick">
          See where your fees stand
        </Link>
      </p>
    </div>
  );
}

/** "Overdraft (OD) fee", but "Monthly Maintenance Fee" stays as it is. */
function feeNoun(name: string): string {
  return /\bfees?\b/i.test(name) ? name : `${name} fee`;
}
