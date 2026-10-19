import { HOURLY_EXEMPT_KEYS, hourlyFromLine, PERIOD_FEE_KEYS } from "@/lib/fee-frequency";
import { conflictingSpecialUnits, specialUnitInName, specialUnitOnPriceLine, type SpecialUnitFrequency } from "@/lib/fee-unit";
import { feeBullets } from "./fee-bullets";
import { stackedLabelKey } from "./stacked-fee-prices";

export interface OwnFeeUnit {
  frequency: SpecialUnitFrequency;
  sourceLine: string;
}

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/g;
const MAX_OWN_TEXT = 2_000;

function labelKey(label: string): string {
  return stackedLabelKey(label.replace(/^[•●▪‣*-]\s*/, "").replace(/[.…]{2,}/g, " ").replace(/[|•]\s*$/, "").trim());
}

function readLine(line: string, name: string, amount: number): OwnFeeUnit | null | undefined {
  const prices = [...line.matchAll(MONEY)];
  if (prices.length === 0 || Number(prices[0][1].replace(/,/g, "")) !== amount) return undefined;
  const before = line.slice(0, prices[0].index).replace(/\|\s*[•●▪‣*-]?\s*$/, "").trim();
  const prefix = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(before);
  const prefixUnit = specialUnitInName(before);
  if (labelKey(before) !== labelKey(name) && !(prefixUnit && labelKey(prefix![1]) === labelKey(name))) return undefined;
  if (line.length > MAX_OWN_TEXT || prices.length !== 1) return null;
  if (conflictingSpecialUnits(line)) return null;
  const suffixUnit = specialUnitOnPriceLine(line, amount);
  if (prefixUnit && suffixUnit && prefixUnit !== suffixUnit) return null;
  const frequency = suffixUnit ?? (!prefixUnit && hourlyFromLine(line, amount, name) ? "hourly" : null);
  return frequency ? { frequency, sourceLine: line.trim() } : null;
}

/**
 * A bounded literal own label/price/unit witness, independent of category/price admission.
 * Equal-price neighbors and repeated names with incompatible units never choose a unit.
 */
export function ownFeeUnit(text: string, name: string, amount: number, category: string): OwnFeeUnit | null {
  if (!text) return null;
  const reads: Array<OwnFeeUnit | null> = [];
  const physical = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  // An incompletely bound repeated standalone label is not an exhaustive unit witness.
  if (physical.some((line, index) => labelKey(line) === labelKey(name) &&
    !/^[•●▪‣*-]\s*\$/.test(physical[index + 1] ?? ""))) return null;
  for (const line of text.split(/\r?\n/)) {
    const read = readLine(line, name, amount);
    if (read !== undefined) reads.push(read);
  }
  // This annotates an already admitted candidate; it is not the global price/heading reader.
  // An exact one-word label still owns its immediate explicit price bullet ("Photocopies").
  for (let index = 0; index + 1 < physical.length; index++) {
    if (labelKey(physical[index]) !== labelKey(name) || !/^[•●▪‣*-]\s*\$/.test(physical[index + 1])) continue;
    const read = readLine(`${physical[index]} | ${physical[index + 1]}`, name, amount);
    if (read !== undefined) reads.push(read);
  }
  for (const row of feeBullets(text)) {
    if (row.problem || row.price !== amount || labelKey(row.title) !== labelKey(name)) continue;
    const frequency = specialUnitOnPriceLine(row.compactText, amount)
      ?? (hourlyFromLine(row.compactText, amount, name) ? "hourly" : null);
    reads.push(frequency && row.compactText.length <= MAX_OWN_TEXT ? { frequency, sourceLine: row.compactText } : null);
  }
  if (reads.some(row => row === null) || new Set(reads.map(row => row?.frequency)).size !== 1) return null;
  const read = reads[0] ?? null;
  const guarded = PERIOD_FEE_KEYS.has(category) || HOURLY_EXEMPT_KEYS.has(category);
  if (guarded && !(category === "paper_statement" && read?.frequency === "per_statement")) return null;
  return read;
}

export function withOwnFeeUnit<T extends { feeName: string; amount: number; canonicalHint: string; frequency: string | null }>(
  candidate: T, sourceText: string,
): T & { ownUnit?: OwnFeeUnit } {
  const ownUnit = ownFeeUnit(sourceText, candidate.feeName, candidate.amount, candidate.canonicalHint);
  return ownUnit ? { ...candidate, frequency: ownUnit.frequency, ownUnit } : candidate;
}
