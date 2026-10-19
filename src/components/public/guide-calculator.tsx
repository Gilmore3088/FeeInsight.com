"use client";

import { useId, useState } from "react";
import { atmCost, overdraftDayCost } from "@/lib/guides/scenarios";
import { formatAmount } from "@/lib/format";

/**
 * A reader enters their own account's terms and sees the cost. The starting values are
 * illustrative and say so; nothing here is any institution's price.
 */
export function GuideCalculator({
  kind,
  defaults,
  note,
}: {
  kind: "overdraft" | "atm";
  defaults: Record<string, number>;
  /** Replaces the "illustrative" line when the starting values are real published fees. */
  note?: string;
}) {
  return kind === "atm" ? <AtmCalculator defaults={defaults} note={note} /> : <OverdraftCalculator defaults={defaults} note={note} />;
}

function OverdraftCalculator({ defaults, note }: { defaults: Record<string, number>; note?: string }) {
  const [perItem, setPerItem] = useState(String(defaults.perItem ?? ""));
  const [items, setItems] = useState(String(defaults.items ?? 1));
  const [limit, setLimit] = useState(defaults.maxPerDay != null ? String(defaults.maxPerDay) : "");
  const cost = overdraftDayCost(num(perItem), num(items), limit.trim() === "" ? null : num(limit));
  return (
    <Frame
      note={note}
      inputs={
        <>
          <Field label="Fee per item, from your schedule" prefix="$" value={perItem} onChange={setPerItem} />
          <Field label="Payments that overdraw on one day" value={items} onChange={setItems} />
          <Field label="Most fees your account charges a day" hint="Leave blank if there is no limit" value={limit} onChange={setLimit} />
        </>
      }
      result={
        <>
          <p className="text-[13px] text-ink-muted">That day costs</p>
          <p className="text-[28px] font-semibold tabular-nums text-ink">{formatAmount(cost.total)}</p>
          <p className="text-[12.5px] text-ink-muted">
            {cost.charged} {cost.charged === 1 ? "fee" : "fees"} charged
            {cost.charged < num(items) ? `; the limit stops ${num(items) - cost.charged} more` : ""}.
          </p>
        </>
      }
    />
  );
}

function AtmCalculator({ defaults, note }: { defaults: Record<string, number>; note?: string }) {
  const [withdrawals, setWithdrawals] = useState(String(defaults.withdrawals ?? 4));
  const [operatorFee, setOperatorFee] = useState(String(defaults.operatorFee ?? ""));
  const [bankFee, setBankFee] = useState(String(defaults.bankFee ?? ""));
  const [rebate, setRebate] = useState(String(defaults.rebate ?? 0));
  const cost = atmCost(num(withdrawals), num(operatorFee), num(bankFee), num(rebate));
  return (
    <Frame
      note={note}
      inputs={
        <>
          <Field label="Out-of-network withdrawals a month" value={withdrawals} onChange={setWithdrawals} />
          <Field label="Machine owner's fee, shown on screen" prefix="$" value={operatorFee} onChange={setOperatorFee} />
          <Field label="Your bank's out-of-network fee" prefix="$" value={bankFee} onChange={setBankFee} />
          <Field label="Fees your account reimburses a month" hint="Your account agreement sets the limit" prefix="$" value={rebate} onChange={setRebate} />
        </>
      }
      result={
        <>
          <p className="text-[13px] text-ink-muted">Unreimbursed fees</p>
          <p className="text-[28px] font-semibold tabular-nums text-ink">{formatAmount(cost.monthly)}</p>
          <p className="text-[13px] text-ink-muted">a month</p>
          <p className="text-[14px] tabular-nums text-ink-soft">{formatAmount(cost.yearly)} a year</p>
        </>
      }
    />
  );
}

function Frame({ inputs, result, note }: { inputs: React.ReactNode; result: React.ReactNode; note?: string }) {
  return (
    <div className="mt-5 grid gap-4 rounded-xl border border-border bg-surface-0 p-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:p-5">
      <div className="grid gap-3">{inputs}</div>
      <div className="rounded-lg bg-paper p-4" aria-live="polite">
        {result}
        <p className="mt-2 text-[11.5px] text-ink-muted">{note ?? "Starting values are illustrative. Enter your own account\u2019s terms."}</p>
      </div>
    </div>
  );
}

function Field({ label, hint, prefix, value, onChange }: { label: string; hint?: string; prefix?: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {hint && <p className="text-[12px] text-ink-muted">{hint}</p>}
      <div className="mt-1 flex items-center rounded-lg border border-border bg-surface-0 focus-within:outline-2 focus-within:outline-ink">
        {prefix && <span className="pl-3 text-[15px] text-ink-muted">{prefix}</span>}
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          className="min-h-11 w-full rounded-lg bg-transparent px-3 text-[15px] tabular-nums text-ink outline-none"
        />
      </div>
    </div>
  );
}

function num(v: string): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
