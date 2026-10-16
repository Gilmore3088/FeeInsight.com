"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { US_STATES } from "@/lib/us-map-paths";
import { lineScale, type MapState, type SampleExhibit } from "./report-view";

const COUNT = new Intl.NumberFormat("en-US");

function money(n: number): string {
  return Number.isInteger(n)
    ? `$${COUNT.format(n)}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const POSITION = {
  above_market: { dot: "bg-brick", word: "Above the local middle half" },
  in_market: { dot: "bg-ink", word: "Inside the local middle half" },
  below_market: { dot: "bg-[#2f6b4f]", word: "Below the local middle half" },
  free: { dot: "bg-[#2f6b4f]", word: "Free, where competitors charge" },
} as const;

const LEGEND = { above_market: "Above the middle half", in_market: "Inside", below_market: "Below" } as const;

/**
 * The live sample's fee lines: the bank's fee as a dot on its local market's middle half. Tapping
 * a line says how many local competitors charge less, the report's own count.
 */
export function SampleLines({ sample }: { sample: SampleExhibit }) {
  const [picked, setPicked] = useState(sample.lines[0]?.key ?? "");
  const line = sample.lines.find((l) => l.key === picked) ?? sample.lines[0];
  return (
    <div className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6">
      <div className="min-h-[4.5rem]" aria-live="polite">
        <p className="text-[13px] font-semibold text-ink">
          {line.label} · {sample.name} {money(line.own)}
        </p>
        <p className="font-mono text-[22px] font-semibold leading-tight tabular-nums text-ink">
          {COUNT.format(line.chargingLess)}
        </p>
        <p className="text-[13px] text-ink-muted">of the {COUNT.format(line.peers)} local competitors publishing this fee charge less. Local median{" "}
          {money(line.median)}.</p>
      </div>
      <ol aria-label={`${sample.name} against its local market`} className="mt-3 divide-y divide-border">
        {sample.lines.map((l) => {
          const x = lineScale(l);
          const pressed = l.key === line.key;
          return (
            <li key={l.key}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => setPicked(l.key)}
                aria-label={`${l.label}: ${money(l.own)}; local middle half ${money(l.p25)} to ${money(l.p75)}; ${POSITION[l.position].word.toLowerCase()}`}
                className={`-mx-2 grid w-[calc(100%+1rem)] grid-cols-[7rem_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-lg px-2 py-2 text-left text-[14px] transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-ink sm:grid-cols-[11rem_minmax(0,1fr)_4.5rem] ${
                  pressed ? "bg-paper ring-1 ring-ink/30" : ""
                }`}
              >
                <span className="min-w-0 leading-tight text-ink">{l.label}</span>
                <span className="relative h-5" aria-hidden="true">
                  <span className="absolute inset-x-0 top-1/2 border-t border-border" />
                  <span
                    className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-brick-tint"
                    style={{ left: `${x(l.p25)}%`, width: `${Math.max(x(l.p75) - x(l.p25), 1)}%` }}
                  />
                  <span className="absolute top-0 h-5 w-[2px] bg-ink/60" style={{ left: `${x(l.median)}%` }} />
                  <span
                    className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${POSITION[l.position].dot}`}
                    style={{ left: `${x(l.own)}%` }}
                  />
                </span>
                <span className="text-right font-mono text-[14px] font-semibold tabular-nums text-ink">{money(l.own)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-full bg-brick-tint" /> Local middle half
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-[2px] bg-ink/60" /> Local median
        </span>
        {(["above_market", "in_market", "below_market"] as const).map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${POSITION[p].dot}`} /> {LEGEND[p]}
          </span>
        ))}
        <span>Tap a fee to count.</span>
      </p>
    </div>
  );
}

/** Shades by institutions with verified fees; a state with none at all stays plain. */
const SHADE = ["fill-[#f6dcd3]", "fill-[#f3c9bd]", "fill-[#e39a84]", "fill-[#c8553f]", "fill-[#8f2f22]"] as const;
const NO_DATA = "fill-[#ece4d8]";

/**
 * Every state's free fee report on one map, shaded by institutions with verified fees. Tapping a
 * state (or picking it below) shows its counts; the state's report is one tap away. Hover only
 * names a state, so moving the pointer to the button never changes the pick.
 */
export function StateReportMap({ states }: { states: MapState[] }) {
  const byCode = useMemo(() => new Map(states.map((s) => [s.code, s])), [states]);
  const best = useMemo(() => [...states].sort((a, b) => b.institutions - a.institutions)[0], [states]);
  const [code, setCode] = useState(best?.code ?? "");
  const shown = byCode.get(code) ?? best;
  if (!shown) return null;

  return (
    <div className="mx-auto max-w-[60rem]">
      <svg viewBox="0 0 960 600" className="h-auto w-full" role="group" aria-label="State fee reports">
        {US_STATES.map((s) => {
          const state = byCode.get(s.id);
          const active = s.id === shown.code;
          return (
            <path
              key={s.id}
              d={s.d}
              className={`${state ? `${SHADE[state.shade]} cursor-pointer hover:opacity-80` : NO_DATA} stroke-[#fbf7f1] transition-opacity ${active ? "stroke-ink" : ""}`}
              strokeWidth={active ? 3 : 1.2}
              onClick={state ? () => setCode(s.id) : undefined}
            >
              <title>{state ? `${state.name}: ${COUNT.format(state.institutions)} institutions` : s.name}</title>
            </path>
          );
        })}
      </svg>
      {/* The picked state, as one bar under the map: never a narrow column beside it. */}
      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <div aria-live="polite" className="flex flex-1 flex-wrap items-end gap-x-8 gap-y-3">
          <div className="min-w-[10rem]">
            <p className="text-[12px] text-ink-muted">Free state report</p>
            <p className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{shown.name}</p>
          </div>
          <dl className="flex gap-8">
            <div>
              <dt className="text-[12px] text-ink-muted">Institutions</dt>
              <dd className="font-mono text-[22px] font-semibold tabular-nums text-ink">{COUNT.format(shown.institutions)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-muted">Verified fees</dt>
              <dd className="font-mono text-[22px] font-semibold tabular-nums text-ink">{COUNT.format(shown.fees)}</dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-col gap-2 sm:w-[16rem]">
          <label className="block text-[12px] text-ink-muted">
            <span className="sr-only">Pick a state</span>
            <select
              value={shown.code}
              onChange={(e) => setCode(e.target.value)}
              className="min-h-11 w-full rounded-md border border-border bg-white px-3 text-[14px] text-ink"
            >
              {[...states]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <Link
            href={`/research/state/${shown.code}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
          >
            Open the {shown.name} report
          </Link>
          {shown.reportReady && (
            <a
              href={`/reports?report=institution&src=reports-map-${shown.code}#request`}
              className="text-center text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              Get a competitor report for {shown.name}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
