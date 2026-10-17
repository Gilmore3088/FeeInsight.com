import type { CostScenario, IllustrativePolicy } from "./types";

export interface ScenarioCost {
  title: string;
  note?: string;
  /** The arithmetic in words, e.g. "3 fees × $35 + $10 extended charge". */
  parts: { label: string; amount: number }[];
  total: number;
  /** True when the policy's daily limit stops some of the fees. */
  limited: boolean;
}

/** What a scenario costs under one illustrative policy: one account, one set of terms. */
export function scenarioCost(policy: IllustrativePolicy, scenario: CostScenario): ScenarioCost {
  if (scenario.transfer && policy.transfer != null) {
    return { title: scenario.title, note: scenario.note, parts: [{ label: "1 transfer", amount: policy.transfer }], total: policy.transfer, limited: false };
  }
  const charged = policy.maxPerDay != null ? Math.min(scenario.items, policy.maxPerDay) : scenario.items;
  const parts = [{ label: `${charged} ${charged === 1 ? "fee" : "fees"}`, amount: round(charged * policy.perItem) }];
  if (scenario.extended && policy.extended != null) parts.push({ label: "extended charge", amount: policy.extended });
  return {
    title: scenario.title,
    note: scenario.note,
    parts,
    total: round(parts.reduce((sum, p) => sum + p.amount, 0)),
    limited: charged < scenario.items,
  };
}

/** A reader's own overdraft terms: fees in a day, capped by the most the account charges per day. */
export function overdraftDayCost(perItem: number, items: number, maxPerDay: number | null): { charged: number; total: number } {
  const charged = Math.max(0, maxPerDay != null && maxPerDay >= 0 ? Math.min(items, maxPerDay) : items);
  return { charged, total: round(charged * Math.max(0, perItem)) };
}

/** A reader's ATM cost: each withdrawal's two fees, less any monthly reimbursement. */
export function atmCost(withdrawals: number, operatorFee: number, bankFee: number, monthlyRebate: number): { monthly: number; yearly: number } {
  const gross = Math.max(0, withdrawals) * (Math.max(0, operatorFee) + Math.max(0, bankFee));
  const monthly = round(Math.max(0, gross - Math.max(0, monthlyRebate)));
  return { monthly, yearly: round(monthly * 12) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
