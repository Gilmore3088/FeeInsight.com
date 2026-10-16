"use client";

import { useState } from "react";
import { formatFeeAmount } from "@/lib/format";

/**
 * Banks against credit unions as one field of fee tiles, grouped by which charter has the lower
 * median. The groups are named in words, not told apart by color. A tile picked shows both
 * medians and how many institutions stand behind each; the smaller group is pulled out as large
 * side-by-side figures, and the full matrix sits behind a disclosure.
 */

export interface CharterFee {
  key: string;
  name: string;
  bank: number;
  cu: number;
  banks: number;
  creditUnions: number;
}

const money = (n: number) => formatFeeAmount(n) ?? "-";
const COUNT = new Intl.NumberFormat("en-US");

type Side = "cu" | "bank" | "same";

function sideOf(f: CharterFee): Side {
  if (f.cu < f.bank) return "cu";
  if (f.bank < f.cu) return "bank";
  return "same";
}

const GROUP_LABEL: Record<Side, string> = {
  cu: "Lower at credit unions",
  bank: "Lower at banks",
  same: "The same",
};

export function charterGroups(fees: CharterFee[]): { side: Side; fees: CharterFee[] }[] {
  const order: Side[] = ["cu", "bank", "same"];
  const groups = order.map((side) => ({ side, fees: fees.filter((f) => sideOf(f) === side) })).filter((g) => g.fees.length > 0);
  // The larger group leads; the exceptions follow it.
  return groups.sort((a, b) => (a.side === "same" ? 1 : b.side === "same" ? -1 : b.fees.length - a.fees.length));
}

function Pair({ f, size }: { f: CharterFee; size: "lg" | "md" }) {
  const figure = size === "lg" ? "text-[44px] sm:text-[56px]" : "text-[28px]";
  const lower = sideOf(f);
  return (
    <div className="grid grid-cols-2 gap-4">
      {(
        [
          { who: "Banks", value: f.bank, n: f.banks, lower: lower === "bank" },
          { who: "Credit unions", value: f.cu, n: f.creditUnions, lower: lower === "cu" },
        ] as const
      ).map((s) => (
        <div key={s.who}>
          <p className={`font-mono font-semibold leading-none tabular-nums tracking-[-0.02em] ${figure} ${s.lower ? "text-ink" : "text-ink-muted"}`}>
            {money(s.value)}
          </p>
          <p className="mt-2 text-[13px] font-semibold text-ink">{s.who}</p>
          <p className="text-[12px] text-ink-muted">median of {COUNT.format(s.n)}</p>
        </div>
      ))}
    </div>
  );
}

export function CharterField({ fees, place }: { fees: CharterFee[]; place: string }) {
  const groups = charterGroups(fees);
  const exceptions = groups.length > 1 && groups[1].side !== "same" ? groups[1].fees : [];
  const [picked, setPicked] = useState<string>(groups[0]?.fees[0]?.key ?? "");
  const current = fees.find((f) => f.key === picked) ?? null;

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-12">
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.side} role="group" aria-label={`${GROUP_LABEL[g.side]}: ${g.fees.length}`}>
              <p className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold text-ink">
                {GROUP_LABEL[g.side]}
                <span className="font-mono text-[13px] tabular-nums text-ink-muted">{g.fees.length}</span>
              </p>
              <ul className="flex flex-wrap gap-2">
                {g.fees.map((f) => {
                  const pressed = f.key === picked;
                  return (
                    <li key={f.key}>
                      <button
                        type="button"
                        aria-pressed={pressed}
                        onClick={() => setPicked(f.key)}
                        className={`min-h-11 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ink ${
                          pressed
                            ? "bg-ink text-on-ink"
                            : g.side === "cu"
                              ? "bg-surface-200 text-ink hover:bg-ink/15"
                              : "border border-ink/40 bg-transparent text-ink hover:border-ink"
                        }`}
                      >
                        {f.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        {current && (
          <div aria-live="polite" className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <p className="text-[15px] font-semibold text-ink">{current.name}</p>
            <p className="mb-5 text-[12px] text-ink-muted">
              {current.cu === current.bank
                ? `The same median in the ${place}.`
                : `${current.cu < current.bank ? "Credit unions" : "Banks"} ${money(Math.abs(current.bank - current.cu))} lower in the ${place}.`}
            </p>
            <Pair f={current} size="md" />
          </div>
        )}
      </div>

      {exceptions.length > 0 && (
        <div>
          <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-ink sm:text-[22px]">
            {exceptions.length === 1 ? "The exception" : `The ${exceptions.length === 2 ? "two" : COUNT.format(exceptions.length)} exceptions`}
          </h3>
          <div className="mt-5 grid gap-10 sm:grid-cols-2 sm:gap-12">
            {exceptions.map((f) => (
              <div key={f.key}>
                <p className="mb-4 text-[14px] font-medium text-ink-soft">{f.name}</p>
                <Pair f={f} size="lg" />
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="group/disc border-t border-border pt-4">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform group-open/disc:rotate-90">
            &rsaquo;
          </span>
          Every fee, banks against credit unions
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">Bank and credit union medians in the {place}; the lower median is shaded.</caption>
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                <th scope="col" className="py-2 pr-3">Fee</th>
                <th scope="col" className="px-3 py-2 text-right">Banks</th>
                <th scope="col" className="px-3 py-2 text-right">Credit unions</th>
                <th scope="col" className="py-2 pl-3 text-right">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200">
              {fees.map((f) => {
                const side = sideOf(f);
                const shade = "rounded bg-surface-200 px-1.5 py-0.5 font-semibold text-ink";
                return (
                  <tr key={f.key}>
                    <th scope="row" className="py-2 pr-3 font-medium text-ink">{f.name}</th>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      <span className={side === "bank" ? shade : ""}>{money(f.bank)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      <span className={side === "cu" ? shade : ""}>{money(f.cu)}</span>
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-ink-soft">
                      {side === "same" ? "Same" : money(Math.abs(f.bank - f.cu))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
