"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ProductFrame } from "@/components/marketing/product-frame";
import { positionFor } from "@/lib/custom-report/analysis";
import { PRODUCT_NAME } from "@/lib/constants";
import { SAMPLE_REPORT_HREF } from "@/app/landing-shared";
import {
  POSITION_TEXT,
  axisTicks,
  chargingLess,
  feeMoney,
  lineAxisMax,
  rankWindow,
  readOnLabel,
  stackDots,
  type BoardLine,
  type BoardPeer,
  type CompetitorBoard,
} from "./board-math";

const DOT = 10;
const DOT_GAP = 3;
const STRIP_BASE = 18;

function FeeTabs({
  lines,
  active,
  onPick,
  label,
}: {
  lines: BoardLine[];
  active: string;
  onPick: (key: string) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,black_82%,transparent)] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 sm:[mask-image:none]"
    >
      {lines.map((line) => {
        const on = line.key === active;
        return (
          <button
            key={line.key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(line.key)}
            className={
              "min-h-9 shrink-0 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-colors " +
              (on ? "bg-ink text-on-ink" : "bg-paper text-ink-soft ring-1 ring-border hover:text-ink")
            }
          >
            {line.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Every local competitor's published fee as a dot on one axis, equal amounts stacked; the
 * shaded band is the middle half and the line the median. `price` draws the subject's dot
 * (brick); `under`, when set, darkens the competitors charging less than it.
 */
export function DotStrip({
  line,
  price,
  top,
  focus,
  onFocus,
  under = false,
  subject,
}: {
  line: BoardLine;
  price: number;
  top: number;
  focus: number | null;
  onFocus: (id: number | null) => void;
  under?: boolean;
  subject: string;
}) {
  const x = (v: number) => `${Math.min(100, Math.max(0, (v / top) * 100))}%`;
  const levels = stackDots(line.peers.map((p) => p.amount));
  const height = STRIP_BASE + (Math.max(0, ...levels) + 1) * (DOT + DOT_GAP) + 22;
  const ticks = axisTicks(top);
  return (
    <div className="select-none">
      <div className="relative mx-1.5" style={{ height }}>
        <span
          aria-hidden
          className="absolute bottom-0 rounded-md bg-ink/[0.07]"
          style={{ left: x(line.p25), width: `calc(${x(line.p75)} - ${x(line.p25)})`, top: 4, minWidth: 2 }}
        />
        <span aria-hidden className="absolute bottom-0 top-0 w-px bg-ink/60" style={{ left: x(line.median) }} />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-border" />
        {line.peers.map((peer, i) => {
          const low = peer.amount < price;
          const on = focus === peer.id;
          return (
            <button
              key={peer.id}
              type="button"
              tabIndex={-1}
              aria-label={`${peer.name}: ${feeMoney(peer.amount)}`}
              onMouseEnter={() => onFocus(peer.id)}
              onMouseLeave={() => onFocus(null)}
              onClick={() => onFocus(peer.id)}
              className={
                "absolute -translate-x-1/2 rounded-full transition-[background-color,transform] duration-200 focus:outline-none " +
                (on
                  ? "z-10 scale-150 bg-ink ring-2 ring-surface-0"
                  : under
                    ? low
                      ? "bg-ink/85"
                      : "bg-ink/20"
                    : "bg-ink/70 hover:bg-ink")
              }
              style={{ left: x(peer.amount), bottom: 4 + levels[i] * (DOT + DOT_GAP), width: DOT, height: DOT }}
            />
          );
        })}
        <span
          aria-hidden
          className="absolute z-20 flex -translate-x-1/2 flex-col items-center transition-[left] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: x(price), bottom: 0, top: 0 }}
        >
          <span className="h-full w-0.5 rounded bg-brick" />
          <span className="absolute -top-0.5 h-3.5 w-3.5 rounded-full bg-brick ring-2 ring-surface-0" />
        </span>
        <span className="sr-only">
          {subject} {feeMoney(price)}; local median {feeMoney(line.median)}
        </span>
      </div>
      <div className="relative mx-1.5 mt-1 h-4 font-mono text-[11px] text-ink-muted" aria-hidden>
        {ticks.map((t, i) => (
          <span
            key={t}
            className={`absolute ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: x(t) }}
          >
            {feeMoney(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Where every figure in an exhibit comes from, with the newest read date behind it (or no date
 * when none is known). The one wording for every workspace exhibit on the page, the ladder too.
 */
export function SourceFooter({
  readOn: iso,
  readLabel = "latest read",
  children,
}: {
  readOn: string | null;
  /** The words before the date: "latest read", or what the date covers when it is not every figure. */
  readLabel?: string;
  children?: ReactNode;
}) {
  const readOn = readOnLabel(iso);
  return (
    <p className="max-w-[none] flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border bg-paper/60 px-4 py-2.5 text-[11.5px] leading-5 text-ink-muted sm:px-5">
      <span>
        {PRODUCT_NAME} · each fee from the bank&rsquo;s own published schedule{readOn ? ` · ${readLabel} ${readOn}` : ""}
      </span>
      {children}
    </p>
  );
}

/**
 * The market an exhibit covers. From `sm` it sits in the window's title bar; a phone's title bar
 * has no room for it, so there it opens the exhibit's body instead.
 */
function marketAside(label: string | null): ReactNode {
  return label ? <span className="max-sm:hidden">{label}</span> : undefined;
}

function PhoneMarketLine({ label }: { label: string | null }) {
  return label ? <p className="text-[12px] text-ink-muted sm:hidden">{label}</p> : null;
}

function Legend() {
  return (
    <p className="max-w-[none] mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-muted">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-ink/70" />
        A competitor
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-4 rounded-sm bg-ink/[0.12]" />
        Middle half
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px bg-ink/60" />
        Median
      </span>
    </p>
  );
}

/**
 * Hamilton's My fees view on the live sample: one institution against every local competitor
 * that publishes the same fee, by name. Pick a fee; point at a dot to name it.
 */
export function CompetitorBoardExhibit({ board }: { board: CompetitorBoard }) {
  const [active, setActive] = useState(board.leadKey);
  const [focus, setFocus] = useState<number | null>(null);
  const line = board.lines.find((l) => l.key === active) ?? board.lines[0];
  const top = lineAxisMax(line);
  const focused: BoardPeer | null = line.peers.find((p) => p.id === focus) ?? null;
  const less = chargingLess(line.peers, line.own);
  const rows = rankWindow(line, board.institutionName, 5);
  const readOn = readOnLabel(line.readOn);
  return (
    <ProductFrame label="Hamilton · My fees" aside={marketAside(board.marketLabel)} className="shadow-fi-2">
      <div className="space-y-4 p-4 sm:p-5">
        <PhoneMarketLine label={board.marketLabel} />
        <FeeTabs
          lines={board.lines}
          active={line.key}
          onPick={(key) => {
            setActive(key);
            setFocus(null);
          }}
          label="Fee"
        />
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink sm:text-[17px]">{board.institutionName}</p>
            <p className="text-[12.5px] text-ink-muted">{POSITION_TEXT[line.position]}</p>
          </div>
          <p className="shrink-0 font-mono text-[28px] font-semibold tabular-nums tracking-tight text-ink sm:text-[32px]">
            {feeMoney(line.own)}
          </p>
        </div>
        <div>
          <p className="max-w-[none] mb-2 flex min-h-5 items-baseline justify-between gap-3 text-[12.5px]">
            {focused ? (
              <>
                <span aria-hidden className="min-w-0 truncate font-semibold text-ink">{focused.name}</span>
                <span aria-hidden className="shrink-0 font-mono tabular-nums text-ink">{feeMoney(focused.amount)}</span>
              </>
            ) : (
              <>
                <span className="text-ink-soft">
                  {less} of {line.peers.length} local competitors charge less
                </span>
                <span className="shrink-0 text-ink-muted">Median {feeMoney(line.median)}</span>
              </>
            )}
          </p>
          <DotStrip
            line={line}
            price={line.own}
            top={top}
            focus={focus}
            onFocus={setFocus}
            subject={board.institutionName}
          />
          <Legend />
        </div>
        <ol className="space-y-1 border-t border-border pt-3" aria-label={`Nearest competitors on ${line.label}`}>
          {rows.map((row) => {
            const diff = row.amount - line.own;
            return (
              <li
                key={row.id}
                className={`grid grid-cols-[minmax(0,1fr)_4.5rem_4.25rem] items-center gap-3 rounded-md px-2 py-1 text-[12.5px] ${row.self ? "bg-brick/[0.08]" : ""}`}
              >
                <span className={`truncate ${row.self ? "font-semibold text-brick" : "text-ink-soft"}`}>{row.name}</span>
                <span className={`text-right font-mono tabular-nums ${row.self ? "font-semibold text-brick" : "text-ink"}`}>
                  {feeMoney(row.amount)}
                </span>
                <span className="text-right font-mono text-[11.5px] tabular-nums text-ink-muted">
                  {row.self ? "" : diff === 0 ? "same" : `${diff > 0 ? "+" : "−"}${feeMoney(Math.abs(diff))}`}
                </span>
              </li>
            );
          })}
        </ol>
        {line.quote ? (
          <p className="max-w-[none] border-t border-border pt-3 text-[11.5px] leading-5 text-ink-muted">
            {board.institutionName}&rsquo;s schedule: &ldquo;{line.quote}&rdquo;{readOn ? ` · read ${readOn}` : ""}
          </p>
        ) : null}
      </div>
      <SourceFooter readOn={board.readOn}>
        <Link href={SAMPLE_REPORT_HREF} className="font-semibold text-ink underline underline-offset-2">
          From the free sample report
        </Link>
      </SourceFooter>
    </ProductFrame>
  );
}

/**
 * Arrow keys move the price by $1, Shift+arrow by $10 (dragging still lands on cents), kept
 * between $0 and the axis top; null for any other key, and for an arrow pressed with Ctrl, Alt
 * or Meta, so the browser and assistive tech keep their own shortcuts.
 */
export function keyboardPrice(
  price: number,
  key: string,
  shift: boolean,
  top: number,
  otherModifier = false,
): number | null {
  if (otherModifier) return null;
  const sign = key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1 : 0;
  if (sign === 0) return null;
  const next = price + sign * (shift ? 10 : 1);
  return Math.round(Math.min(top, Math.max(0, next)) * 100) / 100;
}

/**
 * Hamilton's Try a price on the live sample's own market: move the fee and count the local
 * competitors charging less. It models a price; it never suggests one.
 */
export function PriceTesterExhibit({ board }: { board: CompetitorBoard }) {
  const sliderId = useId();
  const [active, setActive] = useState(board.leadKey);
  const line = board.lines.find((l) => l.key === active) ?? board.lines[0];
  const [price, setPrice] = useState(line.own);
  const [focus, setFocus] = useState<number | null>(null);
  const top = lineAxisMax(line, line.own * 1.25);
  const less = chargingLess(line.peers, price);
  const position = positionFor(price, line);
  const focused = line.peers.find((p) => p.id === focus) ?? null;
  return (
    <ProductFrame label="Hamilton · Try a price" aside={marketAside(board.marketLabel)} className="shadow-fi-2">
      <div className="space-y-4 p-4 sm:p-5">
        <PhoneMarketLine label={board.marketLabel} />
        <FeeTabs
          lines={board.lines}
          active={line.key}
          onPick={(key) => {
            const next = board.lines.find((l) => l.key === key);
            setActive(key);
            setFocus(null);
            if (next) setPrice(next.own);
          }}
          label="Fee to price"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
          <div>
            <label htmlFor={sliderId} className="text-[12.5px] text-ink-muted">
              Price to try
            </label>
            <p className="font-mono text-[34px] font-semibold leading-none tabular-nums tracking-tight text-brick sm:text-[40px]">
              {feeMoney(price)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[34px] font-semibold leading-none tabular-nums tracking-tight text-ink sm:text-[40px]">
              {less}
              <span className="text-[18px] text-ink-muted sm:text-[20px]">/{line.peers.length}</span>
            </p>
            <p className="text-[12.5px] text-ink-muted">competitors charge less</p>
          </div>
        </div>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={top}
          step={0.01}
          value={price}
          onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100) / 100)}
          onKeyDown={(e) => {
            const next = keyboardPrice(price, e.key, e.shiftKey, top, e.ctrlKey || e.altKey || e.metaKey);
            if (next === null) return;
            e.preventDefault();
            setPrice(next);
          }}
          className="h-11 w-full cursor-pointer accent-brick"
          aria-valuetext={`${feeMoney(price)}: ${less} of ${line.peers.length} local competitors charge less`}
        />
        <div>
          <p className="max-w-[none] mb-2 flex min-h-5 items-baseline justify-between gap-3 text-[12.5px]">
            {focused ? (
              <>
                <span aria-hidden className="min-w-0 truncate font-semibold text-ink">{focused.name}</span>
                <span aria-hidden className="shrink-0 font-mono tabular-nums text-ink">{feeMoney(focused.amount)}</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-ink">{POSITION_TEXT[position]}</span>
                <span className="shrink-0 text-ink-muted">
                  Today {feeMoney(line.own)} · median {feeMoney(line.median)}
                </span>
              </>
            )}
          </p>
          <DotStrip line={line} price={price} top={top} focus={focus} onFocus={setFocus} under subject={board.institutionName} />
        </div>
      </div>
      <SourceFooter readOn={board.readOn} />
    </ProductFrame>
  );
}
