import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

/**
 * Amount error patterns (#2067). A confirmed wrong amount used to teach Knox only that bank's exact
 * name and price (knox/takedown-lessons.ts), so the next bank with the same layout repeated it until
 * someone wrote a rule. Deming's error classes now group extract-stage amount errors by the text
 * around the fee, the layout that misled the read, instead of by fee category, so a layout seen at
 * two or more banks shows up as one class with its owner (Knox).
 *
 * Each row is also re-checked against today's shared source check (`checkFeeAgainstSource`, the
 * check Knox runs on every find before keeping it). A row the check now refuses is already blocked
 * at extract for every bank with that layout; a row it still passes escaped the rules, and its class
 * is the next deterministic extraction rule to write (with its Darwin dry-run count, 2026-10-15).
 * Pure.
 */

export const AMOUNT_PATTERN_VERSION = 1;

/** Extract-stage kinds that say the stored amount is not the fee's price. */
export const AMOUNT_ERROR_KINDS = ["wrong_amount", "threshold", "priced_per_amount", "outside_range", "limit_as_fee"] as const;

export type AmountLayout =
  | "no_document"
  | "name_not_in_text"
  | "footnote_glued_price"
  | "opening_deposit"
  | "amount_in_name"
  | "cap_or_minimum"
  | "free_read_as_price"
  | "price_before_label"
  | "price_on_other_line"
  | "multi_column"
  | "other";

/** Pure: each layout in words, for the class title. */
export const AMOUNT_LAYOUT_LABEL: Record<AmountLayout, string> = {
  no_document: "amounts with no stored document",
  name_not_in_text: "names the document never prints",
  footnote_glued_price: "a footnote mark glued to a $0 price (\"$03\" read as $3)",
  opening_deposit: "an opening deposit or minimum balance read as the fee",
  amount_in_name: "a figure inside the fee's name",
  cap_or_minimum: "a cap, minimum or \"up to\" figure read as the price",
  free_read_as_price: "a free or no-charge row given a price",
  price_before_label: "price-first rows (\"$5 | Name\") paired with the wrong row",
  price_on_other_line: "a price taken from the line above or below",
  multi_column: "rows with several prices or columns",
  other: "amounts with no named layout",
};

const PRICE = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\.\d{2}\b/g;
const LEADING_PRICE = /^\s*[•\-*]?\s*\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\||\s)\s*[A-Za-z]/;
const DEPOSIT = /\b(?:to open|opening deposit|initial deposit|deposit required|minimum (?:daily )?balance|balance of|maintain)\b/i;
const CAP_BEFORE = /\b(?:up to|(?:maximum|minimum|max\.?|min\.?)(?:\s+[a-z]+){0,2}?(?:\s+of)?|cap(?:ped)?(?: at)?|not to exceed|limit(?:ed)? to)\s*$/i;
/** "$03": a $0 price with its footnote number glued on (#1946). */
const GLUED_FOOTNOTE = /\$0(\d)(?![\d.,])/g;
const FREE = /\b(?:no (?:fee|charge)|free|waived|n\/a)\b/i;

const lineWords = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function prices(line: string): number[] {
  return [...line.matchAll(PRICE)].map((match) => Number(match[0].replace(/[$,\s]/g, ""))).filter((value) => Number.isFinite(value));
}

/** The fee's name without a heading prefix ("Fees: o A Minimum Balance Fee" -> "A Minimum Balance Fee"). */
function nameCore(feeName: string): string {
  const parts = feeName.split(/:\s*/);
  const tail = parts.length > 1 ? parts[parts.length - 1] : feeName;
  return lineWords(tail.replace(/^\s*o\s+/i, "").replace(/\([^)]*\)/g, " ")).split(" ").slice(0, 5).join(" ");
}

/** Pure: the index of the line naming the fee, or -1. */
function nameLine(lines: string[], feeName: string): number {
  const core = nameCore(feeName);
  if (core.length < 3) return -1;
  const words = lines.map(lineWords);
  const exact = words.findIndex((line) => line.includes(core));
  if (exact >= 0) return exact;
  const short = core.split(" ").slice(0, 3).join(" ");
  return short.length >= 6 ? words.findIndex((line) => line.includes(short)) : -1;
}

const has = (values: number[], amount: number) => values.some((value) => Math.abs(value - amount) < 0.005);

/** Pure: the layout that put the wrong amount on a fee. */
export function amountLayout(feeName: string, amount: number | null, text: string | null | undefined): AmountLayout {
  if (!text?.trim()) return "no_document";
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const at = nameLine(lines, feeName);
  if (at < 0) return "name_not_in_text";
  const line = lines[at];
  const near = [lines[at - 1] ?? "", line, lines[at + 1] ?? ""].join(" ");
  const value = amount ?? 0;
  if (amount !== null && [...line.matchAll(GLUED_FOOTNOTE)].some((match) => Number(match[1]) === value)) return "footnote_glued_price";
  if (amount !== null && has(prices(feeName), value)) return "amount_in_name";
  if (amount !== null && DEPOSIT.test(near) && !/\bfee\b|\bcharge\b/i.test(line.replace(/monthly (?:maintenance|service) (?:fee|charge)/i, ""))) {
    const own = prices(near);
    if (has(own, value)) return "opening_deposit";
  }
  if (amount !== null) {
    const figure = [...line.matchAll(PRICE)].find((match) => Math.abs(Number(match[0].replace(/[$,\s]/g, "")) - value) < 0.005);
    if (figure && CAP_BEFORE.test(line.slice(0, figure.index))) return "cap_or_minimum";
  }
  const ownPrices = prices(line);
  if (FREE.test(line) && ownPrices.length === 0 && value > 0) return "free_read_as_price";
  if (LEADING_PRICE.test(line) && !(ownPrices.length > 0 && Math.abs(ownPrices[0] - value) < 0.005)) return "price_before_label";
  if (amount !== null && !has(ownPrices, value) && (has(prices(lines[at - 1] ?? ""), value) || has(prices(lines[at + 1] ?? ""), value))) {
    return "price_on_other_line";
  }
  if (ownPrices.length >= 2 || line.split("|").length >= 4) return "multi_column";
  return "other";
}

export interface AmountErrorRow {
  feedback_id: number | string;
  kind: string;
  check_name: string | null;
  institution_id: number | string | null;
  fee_published_id: number | string | null;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  text: string | null;
}

/** One grouped amount class, in the shape the error-class summary reads. */
export interface AmountClassRow {
  about_stage: "extract";
  kind: string;
  pattern: string;
  banks: number;
  fees: number;
  rows: number;
  checks: string[];
  institutions: number[];
  fee_ids: number[];
  feedback_ids: number[];
  /** Rows today's source check still passes: the rules let this layout through. */
  passes_today: number;
}

/** Pure: whether today's shared check would still let Knox keep this read. */
export function passesTodaysCheck(row: Pick<AmountErrorRow, "text" | "fee_name" | "amount" | "canonical_fee_key">): boolean {
  if (!row.text || !row.fee_name || row.amount === null || row.amount === undefined) return false;
  return checkFeeAgainstSource(row.text, row.fee_name, Number(row.amount), ".", row.canonical_fee_key).ok;
}

/** Pure: amount error rows grouped by kind and layout. */
export function amountClassRows(rows: AmountErrorRow[], examples = 5): AmountClassRow[] {
  const groups = new Map<string, { kind: string; layout: AmountLayout; rows: AmountErrorRow[]; passes: number }>();
  for (const row of rows) {
    const layout = amountLayout(row.fee_name ?? "", row.amount === null ? null : Number(row.amount), row.text);
    const key = `${row.kind}|${layout}`;
    const group = groups.get(key) ?? { kind: row.kind, layout, rows: [], passes: 0 };
    group.rows.push(row);
    if (passesTodaysCheck(row)) group.passes += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const institutions = [...new Set(group.rows.map((row) => row.institution_id).filter((id) => id !== null).map(Number))];
    const fees = [...new Set(group.rows.map((row) => row.fee_published_id).filter((id) => id !== null).map(Number))];
    return {
      about_stage: "extract" as const,
      kind: group.kind,
      // A layout no rule names stays unpatterned rather than pooling unrelated rows.
      pattern: group.layout === "other" || group.layout === "no_document" ? "unknown" : `amount:${group.layout}`,
      banks: institutions.length,
      fees: fees.length,
      rows: group.rows.length,
      checks: [...new Set(group.rows.map((row) => (row.check_name ?? "").split(":")[0]).filter(Boolean))].sort(),
      institutions: institutions.slice(0, examples),
      fee_ids: fees.slice(0, examples),
      feedback_ids: group.rows.map((row) => Number(row.feedback_id)).sort((a, b) => b - a).slice(0, examples),
      passes_today: group.passes,
    };
  });
}
