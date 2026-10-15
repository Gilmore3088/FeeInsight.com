"use client";

import Link from "next/link";
import { useState } from "react";
import { chargingLess, money, stripScale, type CityStrip } from "./city-view";

/** Dots that land on the same amount stack upward so every institution stays visible. */
function stacked(strip: CityStrip): Map<number, number> {
  const seen = new Map<number, number>();
  const level = new Map<number, number>();
  for (const b of strip.banks) {
    const n = seen.get(b.amount) ?? 0;
    level.set(b.id, n);
    seen.set(b.amount, n + 1);
  }
  return level;
}

/**
 * Each local institution as a dot on one fee's range, the nation's middle half shaded behind.
 * The buttons above switch the fee; tapping a dot says what it charges and how many charge less.
 */
export function CityStripChart({ strips, cityName }: { strips: CityStrip[]; cityName: string }) {
  const usable = strips.filter((s) => s.banks.length > 0);
  const [key, setKey] = useState(usable[0]?.key ?? "");
  const strip = usable.find((s) => s.key === key) ?? usable[0];
  const [picked, setPicked] = useState<number | null>(null);
  if (!strip) return null;

  const x = stripScale(strip);
  const level = stacked(strip);
  const tallest = Math.max(0, ...level.values());
  // Stacks squeeze together past five dots so the chart grows only so far.
  const step = tallest > 5 ? Math.max(0.5, 5.25 / tallest) : 1.05;
  const height = 1.75 + (tallest + 1) * step + 2;
  const bank = strip.banks.find((b) => b.id === picked) ?? strip.banks[0];
  const less = chargingLess(strip, bank.amount);

  return (
    <div className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-5">
      <div role="group" aria-label="Fee" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {usable.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={s.key === strip.key}
            onClick={() => {
              setKey(s.key);
              setPicked(null);
            }}
            className={`min-h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold transition-colors ${
              s.key === strip.key ? "bg-ink text-on-ink" : "text-ink-soft hover:bg-paper"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-[3.75rem]" aria-live="polite">
        <p className="text-[13px] font-semibold text-ink">
          {bank.name} · {money(bank.amount)}
        </p>
        <p className="text-[13px] text-ink-muted">
          {less === 0
            ? `No ${cityName} institution publishing this fee charges less.`
            : `${less} of ${strip.banks.length} ${cityName} institutions publishing this fee charge less.`}
        </p>
      </div>

      <div className="relative mt-2" style={{ height: `${Math.max(height, 7)}rem` }} role="group" aria-label={`${strip.label} in ${cityName}`}>
        {strip.nation && (
          <>
            <span
              aria-hidden="true"
              className="absolute bottom-6 top-0 rounded-md bg-brick-tint/70"
              style={{ left: `${x(strip.nation.p25)}%`, width: `${Math.max(x(strip.nation.p75) - x(strip.nation.p25), 1)}%` }}
            />
            <span aria-hidden="true" className="absolute bottom-6 top-0 w-[2px] bg-brick/60" style={{ left: `${x(strip.nation.median)}%` }} />
          </>
        )}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-6 border-t border-ink/20" />
        {strip.banks.map((b) => {
          const active = b.id === bank.id;
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={active}
              aria-label={`${b.name}: ${money(b.amount)}`}
              onClick={() => setPicked(b.id)}
              className="group absolute flex h-6 w-6 -translate-x-1/2 translate-y-1 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ink"
              style={{ left: `${x(b.amount)}%`, bottom: `${1.75 + (level.get(b.id) ?? 0) * step}rem`, zIndex: active ? 10 : undefined }}
            >
              <span
                aria-hidden="true"
                className={`h-4 w-4 rounded-full ring-2 ring-surface-0 transition-transform ${
                  b.charter === "credit_union" ? "bg-[#2f6b4f]" : "bg-ink"
                } ${active ? "scale-150" : "group-hover:scale-125"}`}
              />
            </button>
          );
        })}
        <span aria-hidden="true" className="absolute bottom-0 left-0 font-mono text-[11px] text-ink-muted">
          $0
        </span>
        {strip.nation && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-brick"
            style={{ left: `${x(strip.nation.median)}%` }}
          >
            U.S. {money(strip.nation.median)}
          </span>
        )}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" /> Bank
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#2f6b4f]" /> Credit union
        </span>
        {strip.nation && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-sm bg-brick-tint" /> U.S. middle half
          </span>
        )}
      </p>

      <p className="mt-3 text-[13px]">
        <Link href={`/institution/${bank.id}`} className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          See all of {bank.name}&apos;s fees
        </Link>
      </p>
    </div>
  );
}
