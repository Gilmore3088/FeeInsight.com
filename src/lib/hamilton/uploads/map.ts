/**
 * Maps an uploaded table (monthly fee income by GL line, item counts, waivers, affected
 * accounts) to fee categories, and shows the reader what was read before anything is
 * used. Pure; the figures become memory facts only when the reader applies them.
 */

import { matchFeeCategory } from "../workspace/ask";
import { proseFeeName } from "../workspace/names";
import type { Table } from "./parse";

export type UploadColumnRole = "label" | "items" | "income" | "waived" | "accounts" | "period";

export interface UploadFeeFigures {
  feeCategory: string;
  /** e.g. "Overdraft". */
  feeName: string;
  /** The row labels that mapped to this fee, as written in the file. */
  labels: string[];
  /** Items charged in a year, before waivers (scaled to 12 months when the file has a period column). */
  annualItems: number | null;
  /** Fee income in a year, in dollars. */
  annualIncome: number | null;
  /** Share of charged items waived or refunded, 0 to 1. */
  waiverRate: number | null;
  /** Largest affected-account count in the file. */
  affectedAccounts: number | null;
  notes: string[];
}

export interface UploadPreview {
  /** Which header each role was read from; a role with no column is absent. */
  columns: Partial<Record<UploadColumnRole, string>>;
  /** Distinct periods in the file (months), when it has a period column. */
  periods: number | null;
  rowsRead: number;
  fees: UploadFeeFigures[];
  /** Labels no fee category matched, with how many rows carried each. */
  unmatched: { label: string; rows: number }[];
  /** Why nothing could be read, when nothing could. */
  problem: string | null;
}

/** Checked in order; a role found once is not looked for again. */
const ROLE_PATTERNS: [UploadColumnRole, RegExp][] = [
  ["waived", /waiv|revers|refund|forgiv|rebat/i],
  ["accounts", /\baccounts?\b|customers|members|households/i],
  ["label", /description|ledger|\bgl\b|name|category/i],
  ["items", /count|items?\b|events?|occurrences|volume|number|#|qty|quantity|transactions/i],
  ["income", /income|revenue|amount|dollars|\$|total|fees? (collected|charged)/i],
  ["period", /month|period|date|quarter|year/i],
  ["label", /fee|line|type|item/i],
];

function numberOf(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const negative = /^\(.*\)$/.test(cell.trim());
  const n = Number(cell.replace(/[,$\s()]/g, ""));
  if (!Number.isFinite(n) || cell.trim() === "") return null;
  return negative ? -n : n;
}

function isNumeric(cell: string): boolean {
  return numberOf(cell) !== null;
}

/** The header row: the first of the top five with at least two text cells. */
function headerIndex(table: Table): number {
  for (let i = 0; i < Math.min(5, table.length); i++) {
    if (table[i].filter((c) => c && !isNumeric(c)).length >= 2) return i;
  }
  return -1;
}

export function detectColumns(header: string[], body: Table): Partial<Record<UploadColumnRole, number>> {
  const out: Partial<Record<UploadColumnRole, number>> = {};
  const taken = new Set<number>();
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (out[role] !== undefined) continue;
    const index = header.findIndex((h, i) => !taken.has(i) && pattern.test(h));
    if (index >= 0) {
      out[role] = index;
      taken.add(index);
    }
  }
  if (out.label === undefined) {
    // The first column that is mostly text is the label.
    const index = header.findIndex((_, i) => !taken.has(i) && body.filter((r) => r[i] && !isNumeric(r[i])).length > body.length / 2);
    if (index >= 0) out.label = index;
  }
  return out;
}

export function mapUploadTable(table: Table): UploadPreview {
  const empty = (problem: string): UploadPreview => ({ columns: {}, periods: null, rowsRead: 0, fees: [], unmatched: [], problem });
  const h = headerIndex(table);
  if (h < 0) return empty("No header row was found in the first five rows.");
  const header = table[h];
  const body = table.slice(h + 1);
  const cols = detectColumns(header, body);
  if (cols.label === undefined) return empty("No column names the fee or GL line.");
  if (cols.items === undefined && cols.income === undefined && cols.waived === undefined) {
    return empty("No column of item counts, income or waivers was found.");
  }
  const waivedIsDollars = cols.waived !== undefined && /\$|amount|dollars|income|revenue/i.test(header[cols.waived]);

  const byFee = new Map<string, { labels: Set<string>; items: number; income: number; waived: number; accounts: number; has: Set<string> }>();
  const unmatched = new Map<string, number>();
  const periods = new Set<string>();
  let rowsRead = 0;
  for (const row of body) {
    const label = row[cols.label]?.trim();
    if (!label) continue;
    rowsRead++;
    if (cols.period !== undefined && row[cols.period]) periods.add(row[cols.period]);
    const fee = matchFeeCategory(label);
    if (!fee) {
      unmatched.set(label, (unmatched.get(label) ?? 0) + 1);
      continue;
    }
    const agg = byFee.get(fee) ?? { labels: new Set(), items: 0, income: 0, waived: 0, accounts: 0, has: new Set() };
    agg.labels.add(label);
    const add = (role: "items" | "income" | "waived", index: number | undefined) => {
      const n = index === undefined ? null : numberOf(row[index]);
      if (n !== null) {
        agg[role] += Math.abs(n);
        agg.has.add(role);
      }
    };
    add("items", cols.items);
    add("income", cols.income);
    add("waived", cols.waived);
    const accounts = cols.accounts === undefined ? null : numberOf(row[cols.accounts]);
    if (accounts !== null) {
      agg.accounts = Math.max(agg.accounts, accounts);
      agg.has.add("accounts");
    }
    byFee.set(fee, agg);
  }

  const months = periods.size > 0 ? periods.size : null;
  const scale = months && months !== 12 ? 12 / months : 1;
  const fees: UploadFeeFigures[] = [...byFee.entries()].map(([feeCategory, a]) => {
    const notes: string[] = [];
    if (scale !== 1) notes.push(`Scaled from ${months} ${months === 1 ? "period" : "periods"} to a year.`);
    if (!months) notes.push("No period column, so the totals are read as a full year.");
    const annualItems = a.has.has("items") ? Math.round(a.items * scale) : null;
    const annualIncome = a.has.has("income") ? Math.round(a.income * scale * 100) / 100 : null;
    let waiverRate: number | null = null;
    if (a.has.has("waived")) {
      if (!waivedIsDollars && a.has.has("items") && a.items > 0) waiverRate = Math.min(1, a.waived / a.items);
      else if (waivedIsDollars && a.has.has("income") && a.income + a.waived > 0) {
        waiverRate = a.waived / (a.income + a.waived);
        notes.push("Waiver share is waived dollars over income plus waived dollars, assuming income is after waivers.");
      }
    }
    return {
      feeCategory,
      feeName: proseFeeName(feeCategory).replace(/^./, (c) => c.toUpperCase()),
      labels: [...a.labels],
      annualItems,
      annualIncome,
      waiverRate: waiverRate === null ? null : Math.round(waiverRate * 1000) / 1000,
      affectedAccounts: a.has.has("accounts") ? a.accounts : null,
      notes,
    };
  });

  const columns: UploadPreview["columns"] = {};
  for (const [role, index] of Object.entries(cols) as [UploadColumnRole, number][]) columns[role] = header[index];
  return {
    columns,
    periods: months,
    rowsRead,
    fees: fees.sort((x, y) => x.feeName.localeCompare(y.feeName)),
    unmatched: [...unmatched.entries()].map(([label, rows]) => ({ label, rows })).sort((x, y) => y.rows - x.rows),
    problem: rowsRead === 0 ? "No rows under the header carried a fee name." : fees.length === 0 ? "No row matched a fee Hamilton knows." : null,
  };
}

/** The memory facts an applied preview writes, one per figure the file carried. */
export function uploadFacts(preview: UploadPreview, only?: string[]): { fieldKey: string; value: number }[] {
  return preview.fees
    .filter((f) => !only || only.includes(f.feeCategory))
    .flatMap((f) => [
      ...(f.annualItems !== null ? [{ fieldKey: `fee.${f.feeCategory}.annual_items`, value: f.annualItems }] : []),
      ...(f.waiverRate !== null ? [{ fieldKey: `fee.${f.feeCategory}.waiver_rate`, value: f.waiverRate }] : []),
      ...(f.annualIncome !== null ? [{ fieldKey: `fee.${f.feeCategory}.annual_income`, value: f.annualIncome }] : []),
      ...(f.affectedAccounts !== null ? [{ fieldKey: `fee.${f.feeCategory}.affected_accounts`, value: f.affectedAccounts }] : []),
    ]);
}
