"use client";

/**
 * One answer, two readers: the board view (money at stake, risk, governance, notice) and the
 * market view (positioning, competitor moves, message). Same facts underneath.
 */
import { useState, type ReactNode } from "react";

export function LensSwitch({ finance, market }: { finance: ReactNode; market: ReactNode }) {
  const [lens, setLens] = useState<"finance" | "market">("finance");
  const tab = (key: "finance" | "market", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={lens === key}
      onClick={() => setLens(key)}
      className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${lens === key ? "bg-white text-warm-900 shadow-sm" : "text-warm-600 hover:text-warm-900"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Reader" className="inline-flex w-fit gap-1 rounded-lg bg-warm-150 p-1 print:hidden">
        {tab("finance", "Board view")}
        {tab("market", "Market view")}
      </div>
      <div role="tabpanel" className="print:hidden">
        {lens === "finance" ? finance : market}
      </div>
      {/* Printed copies carry both views. */}
      <div className="hidden flex-col gap-4 print:flex">
        {finance}
        {market}
      </div>
    </div>
  );
}
