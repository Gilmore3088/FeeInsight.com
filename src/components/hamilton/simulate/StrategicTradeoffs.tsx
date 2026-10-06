"use client";

import type { TradeoffDeltas } from "@/lib/hamilton/simulation";

interface Props {
  tradeoffs: TradeoffDeltas | null;
}

interface ImpactRow {
  label: string;
  value: string;
  note: string;
}

// Rows carry only what the simulation computed: the price change and the peer position
// change, each with its own note. No bar: there is no measured scale to draw it against.
function deriveImpactRows(tradeoffs: TradeoffDeltas): ImpactRow[] {
  return [tradeoffs.revenueImpact, tradeoffs.riskMitigation].map(({ label, value, note }) => ({
    label,
    value,
    note,
  }));
}

export function StrategicTradeoffs({ tradeoffs }: Props) {
  if (tradeoffs === null) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="bg-white p-4 border"
            style={{ borderColor: "rgb(231 229 228)" }}
          >
            <div className="flex justify-between items-baseline mb-3">
              <div className="skeleton h-3 w-28 rounded" />
              <div className="skeleton h-3 w-16 rounded" />
            </div>
            <div className="w-full h-1 rounded" style={{ background: "rgb(245 245 244)" }}>
              <div className="skeleton h-1 w-2/5 rounded" />
            </div>
          </div>
        ))}
        <div
          className="p-5 border rounded"
          style={{
            background: "color-mix(in srgb, var(--hamilton-primary-fixed) 30%, transparent)",
            borderColor: "color-mix(in srgb, var(--hamilton-primary) 20%, transparent)",
          }}
        >
          <div className="skeleton h-3 w-36 rounded mb-3" />
          <div className="skeleton h-4 w-full rounded mb-1" />
          <div className="skeleton h-4 w-5/6 rounded" />
        </div>
      </div>
    );
  }

  const rows = deriveImpactRows(tradeoffs);

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.label}
          className="bg-white p-4 border flex flex-col justify-between"
          style={{ borderColor: "rgb(231 229 228)" }}
        >
          <div className="flex justify-between items-baseline">
            <span
              className="font-label text-[9px] uppercase tracking-widest"
              style={{ color: "rgb(168 162 158)" }}
            >
              {row.label}
            </span>
            <span
              className="font-label text-[10px] uppercase tracking-widest font-bold"
              style={{ color: "var(--hamilton-primary)" }}
            >
              {row.value}
            </span>
          </div>
          <p className="mt-2 text-xs" style={{ color: "rgb(120 113 108)" }}>
            {row.note}
          </p>
        </div>
      ))}

      {/* Peer band: where the proposed fee sits among peers */}
      <div
        className="p-5 border rounded"
        style={{
          background: "color-mix(in srgb, var(--hamilton-primary-fixed) 30%, transparent)",
          borderColor: "color-mix(in srgb, var(--hamilton-primary) 20%, transparent)",
        }}
      >
        <label
          className="font-label text-[9px] uppercase tracking-widest mb-2 block"
          style={{ color: "var(--hamilton-on-primary-fixed-variant, #703714)" }}
        >
          {tradeoffs.operationalImpact.label}: {tradeoffs.operationalImpact.value}
        </label>
        <p
          className="font-headline text-sm italic leading-snug"
          style={{ color: "var(--hamilton-on-primary-fixed, #331200)" }}
        >
          {tradeoffs.operationalImpact.note}
        </p>
      </div>
    </div>
  );
}
