"use client";

import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Logo } from "@/brand/components";
import { PRODUCT_NAME } from "@/lib/constants";
import {
  CHARTERS,
  US,
  cardHref,
  cardMoney,
  cellBars,
  hasMedian,
  inBar,
  type Charter,
  type IndexCardData,
  type IndexCell,
} from "./landing-index-view";

const CHARTER_LABELS: Record<Charter, string> = {
  all: "Banks and credit unions",
  bank: "Banks",
  credit_union: "Credit unions",
};
const CHARTER_WORDS: Record<Charter, string> = {
  all: "banks and credit unions",
  bank: "banks",
  credit_union: "credit unions",
};

const money = (cents: number) => cardMoney(cents / 100);
const count = (n: number) => n.toLocaleString("en-US");
const institutions = (n: number) => `${count(n)} ${n === 1 ? "institution" : "institutions"}`;

function Picker({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="mb-1 block text-[11px] text-ink-muted">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-full border border-control-border bg-surface-0 py-1 pl-3 pr-8 text-[12px] font-medium text-ink outline-offset-2 hover:border-ink-muted"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" />
      </div>
    </div>
  );
}

/** Axis labels under the bars: the first bar's lower bound and the last bar's. */
function barLabel(bar: { min: number | null; max: number | null }): string {
  if (bar.min === null) return `<${cardMoney(Math.round((bar.max ?? 0) + 0.01))}`;
  if (bar.max === null) return `${cardMoney(bar.min)}+`;
  return cardMoney(bar.min);
}

function Histogram({ cell, label }: { cell: IndexCell; label: string }) {
  const bars = cellBars(cell);
  const median = cell.median / 100;
  const top = Math.max(...bars.map((b) => b.total), 1);
  return (
    <figure className="mt-3" aria-label={`${label}: how many institutions fall in each price range`}>
      <div className="flex h-[9.5rem] items-end gap-[3px] border-b border-border sm:h-[10.5rem]" data-index-bars="">
        {bars.map((bar, i) => {
          const isMedian = inBar(bar, median);
          return (
            <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              {isMedian ? (
                <span className="mb-1 self-center whitespace-nowrap rounded-[3px] bg-brick px-1.5 py-0.5 text-[10px] font-semibold leading-none text-on-brick">
                  Median {cardMoney(median)}
                </span>
              ) : null}
              <span
                className={`block w-full rounded-t-[2px] motion-safe:transition-[height] motion-safe:duration-500 motion-safe:ease-out ${isMedian ? "bg-ink" : "bg-ink/15"}`}
                style={{ height: `${Math.max(bar.total > 0 ? 2 : 0, (bar.total / top) * 72)}%` }}
                title={`${barLabel(bar)}: ${bar.total} institutions`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-muted" aria-hidden="true">
        <span>{bars.length ? barLabel(bars[0]) : ""}</span>
        <span>{bars.length > 1 ? barLabel(bars[bars.length - 1]) : ""}</span>
      </div>
      <figcaption className="sr-only">
        {bars.map((b) => `${barLabel(b)}: ${b.total}`).join("; ")}
      </figcaption>
    </figure>
  );
}

function RangeRow({ label, cell, scale }: { label: string; cell: IndexCell | { n: number } | undefined; scale: number }) {
  if (!hasMedian(cell)) {
    return (
      <div className="mb-5">
        <p className="text-[12px] font-semibold text-ink">{label}</p>
        <p className="mt-1 text-[11px] leading-snug text-ink-muted">
          {cell && cell.n > 0 ? "Too few for a median yet" : "No published fees yet"}
        </p>
      </div>
    );
  }
  const at = (c: number) => `${Math.min(100, (c / scale) * 100)}%`;
  return (
    <div className="mb-5" data-index-range="">
      <p className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-ink">{label}</span>
        <b className="whitespace-nowrap font-semibold text-ink">{money(cell.median)} median</b>
      </p>
      <div className="relative mt-2 h-2 rounded-full bg-ink/10">
        <span
          className="absolute inset-y-0 rounded-full bg-ink/30 motion-safe:transition-all motion-safe:duration-500"
          style={{ left: at(cell.p25), width: `calc(${at(cell.p75)} - ${at(cell.p25)})` }}
        />
        <span className="absolute -top-[3px] h-3.5 w-0.5 bg-brick motion-safe:transition-all motion-safe:duration-500" style={{ left: at(cell.median) }} />
      </div>
    </div>
  );
}

/**
 * The hero's working Bank Fee Index: pick a free fee, a state and a charter, and the card shows
 * that pick's median, middle half, distribution and the comparison /fees pairs with it (a state
 * against the U.S., or banks against credit unions). Every figure was worked out on the server
 * by the /fees explorer's functions; this component only chooses which to show.
 */
export function IndexCard({ data, freshness, children }: { data: IndexCardData; freshness: string; children?: ReactNode }) {
  const defaultFee = data.fees.find((f) => f.key === "monthly_maintenance")?.key ?? data.fees[0]?.key ?? "";
  const [fee, setFee] = useState(defaultFee);
  const [place, setPlace] = useState(US);
  const [charter, setCharter] = useState<Charter>("all");
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeId = useId();
  const feeDef = data.fees.find((f) => f.key === fee) ?? data.fees[0];
  const places = data.cells[fee] ?? {};
  const ci = CHARTERS.indexOf(charter);
  const pick = places[place]?.[ci];
  const placeName = place === US ? "the U.S." : (data.states.find((s) => s.code === place)?.name ?? place);
  const benchmarkTitle = place === US ? "U.S. benchmark" : `${placeName} benchmark`;

  const compare =
    place === US
      ? {
          title: "Banks against credit unions",
          rows: [
            { label: "Banks", cell: places[US]?.[1] },
            { label: "Credit unions", cell: places[US]?.[2] },
          ],
        }
      : {
          title: `${placeName} against the U.S.`,
          rows: [
            { label: placeName, cell: places[place]?.[ci] },
            { label: "U.S.", cell: places[US]?.[ci] },
          ],
        };
  const scaleCents =
    Math.max(...compare.rows.map((r) => (hasMedian(r.cell) ? r.cell.p75 : 0)), 100) * 1.3;

  return (
    <div
      className="relative z-[1] rounded-[11px] bg-surface-0 p-4 text-ink shadow-[0_14px_28px_rgb(21_37_55/0.15),0_3px_8px_rgb(21_37_55/0.05)] sm:p-6"
      data-index-card=""
    >
      <div className="flex items-center">
        <h2 className="m-0 leading-none">
          <Logo mark="bank-fee-index-wordmark" height={22} title={PRODUCT_NAME} />
        </h2>
      </div>
      {data.fees.length === 0 ? (
        <p className="mt-6 text-[14px] text-ink-soft">The live figures are being refreshed. The full index is open on its own page.</p>
      ) : (
        <>
          {/* On a phone the benchmark shows first; the three pickers open from one control (James, Oct 18). */}
          <div className="mt-3 flex items-center justify-between gap-3 sm:hidden">
            <p className="min-w-0 truncate text-[12px] text-ink-soft" data-index-scope="">
              {feeDef?.label}
              {charter === "all" ? "" : ` · ${CHARTER_LABELS[charter]}`}
            </p>
            <button
              type="button"
              aria-expanded={scopeOpen}
              aria-controls={scopeId}
              onClick={() => setScopeOpen((v) => !v)}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[12px] font-semibold text-ink underline decoration-border underline-offset-4"
            >
              Change comparison
              <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform ${scopeOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
          <div
            id={scopeId}
            className={`mt-2 grid-cols-1 gap-2 sm:mt-4 sm:grid sm:grid-cols-3 ${scopeOpen ? "grid" : "hidden"}`}
            role="group"
            aria-label="Benchmark scope"
          >
            <Picker
              label="Fee"
              value={fee}
              onChange={setFee}
              options={data.fees.map((f) => ({ value: f.key, label: f.label }))}
            />
            <Picker
              label="State"
              value={place}
              onChange={setPlace}
              options={[{ value: US, label: "United States" }, ...data.states.map((s) => ({ value: s.code, label: s.name }))]}
            />
            <Picker
              label="Institutions"
              value={charter}
              onChange={(v) => setCharter(v as Charter)}
              options={CHARTERS.map((c) => ({ value: c, label: CHARTER_LABELS[c] }))}
            />
          </div>
          {/* One short line is announced when a picker changes, not the whole result area. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true" data-index-summary="">
            {hasMedian(pick)
              ? `${feeDef?.label}, ${CHARTER_WORDS[charter]} in ${placeName}: median ${money(pick.median)}, ${institutions(pick.n)}.`
              : `${feeDef?.label}, ${CHARTER_WORDS[charter]} in ${placeName}: no median yet.`}
          </p>
          <div className="mt-3 grid gap-5 sm:mt-4 sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] sm:gap-5">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-ink">{benchmarkTitle}</h3>
              {hasMedian(pick) ? (
                <>
                  <div className="mt-3 flex items-center gap-3">
                    <strong key={`${fee}-${place}-${charter}`} className="fi-home-fade text-[2.25rem] font-semibold leading-none tracking-[-0.035em] text-ink">
                      {money(pick.median)}
                    </strong>
                    <p className="text-[12px] text-ink-muted">{institutions(pick.n)}</p>
                  </div>
                  <Histogram cell={pick} label={`${feeDef?.label}, ${placeName}`} />
                </>
              ) : (
                <p className="mt-4 rounded-md bg-paper px-3 py-6 text-center text-[13px] text-ink-soft">
                  {pick && pick.n > 0 ? "Too few for a median yet" : "No published fees yet"}
                </p>
              )}
            </div>
            {/* On a phone the card keeps the pick and its bars; the comparison shows from sm up. */}
            <div className="hidden min-w-0 border-border sm:block sm:border-l sm:pl-5">
              <h3 className="mb-4 text-[13px] font-semibold text-ink">{compare.title}</h3>
              {compare.rows.map((row) => (
                <RangeRow key={row.label} label={row.label} cell={row.cell} scale={scaleCents} />
              ))}
            </div>
          </div>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-ink-muted">
        <span>Published fee schedules · {freshness}</span>
        <a href={data.fees.length ? cardHref(fee, place, charter) : "/fees"} className="inline-flex items-center gap-1 font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          See this fee in the index
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </a>
      </div>
      {children}
    </div>
  );
}
