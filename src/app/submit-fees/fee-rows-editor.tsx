"use client";

import { Plus, Trash2 } from "lucide-react";

export interface FeeRow {
  fee_category: string;
  fee_name: string;
  amount: string;
  frequency: string;
}

const FREQUENCIES = [
  { value: "monthly", label: "Per month" },
  { value: "per_occurrence", label: "Per item" },
  { value: "annual", label: "Per year" },
  { value: "one_time", label: "One time" },
] as const;

const INPUT_CLASS =
  "min-w-0 rounded border border-[#D5CBBF] px-2 py-1.5 text-sm outline-none focus:border-[#C44B2E]";

export function FeeRowsEditor({
  fees,
  onUpdate,
  onAdd,
  onRemove,
}: {
  fees: FeeRow[];
  onUpdate: (index: number, field: keyof FeeRow, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  // Closed by default: a link alone is a complete submission, and five open rows read as
  // required work. Typed amounts survive closing it again.
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-[0.12em] text-[#6B6255] hover:text-[#A93D25] [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1">
          <Plus className="h-3.5 w-3.5 transition-transform group-open:rotate-45" aria-hidden="true" />
          Add individual fees (optional)
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[#6B6255]">
          Leave amounts blank to send the link only.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md border border-[#D5CBBF] px-2 py-1 text-xs font-semibold text-[#1A1815] transition-colors hover:border-[#C44B2E] hover:text-[#A93D25]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add fee
        </button>
      </div>

      <div className="mt-3 min-w-0 space-y-2 overflow-hidden">
        {fees.map((fee, i) => (
          <div
            key={i}
            className="fi-row-interaction grid min-w-0 gap-2 border border-[#E0D7C9] bg-[#FDFBF8] p-3 sm:grid-cols-[minmax(0,1fr)_110px_150px_32px]"
          >
            <input
              type="text"
              value={fee.fee_name}
              onChange={(e) => onUpdate(i, "fee_name", e.target.value)}
              aria-label="Fee name"
              className={INPUT_CLASS}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={fee.amount}
              onChange={(e) => onUpdate(i, "amount", e.target.value)}
              placeholder="Amount"
              aria-label="Amount"
              className={`${INPUT_CLASS} tabular-nums sm:text-right`}
            />
            <select
              value={fee.frequency}
              onChange={(e) => onUpdate(i, "frequency", e.target.value)}
              aria-label="Basis"
              className={INPUT_CLASS}
            >
              {FREQUENCIES.map((frequency) => (
                <option key={frequency.value} value={frequency.value}>
                  {frequency.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label="Remove fee"
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#D5CBBF] text-[#6B6255] hover:border-[#C44B2E] hover:text-[#C44B2E]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
