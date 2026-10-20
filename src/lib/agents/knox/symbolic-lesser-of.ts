import { stackedLabelKey } from "@/lib/custom-report/stacked-fee-prices";

/** Applicability evidence derived only from the complete own source row. */
export const SYMBOLIC_LESSER_ELIGIBILITY_FLAG = "knox_eligibility:symbolic_lesser";
export type SymbolicLesserReview = { kind: "hold"; ownText: string }
  | { kind: "decline"; ownText: string; reason: "symbolic_formula_unsupported" | "symbolic_owner_ambiguous" };

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/g;
const SYMBOLIC = /\bminimum payment\b/i;
const LESSER = /\bwhichever is (?:less|lower|smaller)\b|\blesser of\b/i;
const COMPLETE_TAIL = /^\s*(?:(?:each|per) billing (?:period|cycle)\s+)?or\s+(?:the\s+)?(?:amount of\s+(?:the\s+)?)?minimum payment\s*,?\s*whichever is (?:less|lower|smaller)[.!]?\s*\|?\s*$/i;
const labelKey = (value: string) => stackedLabelKey(value.replace(/^\s*\|\s*/, "")
  .replace(/^[•●▪‣*-]\s*/, "").replace(/[.…]{2,}/g, " ").replace(/\|\s*$/, "").trim());

/** Only this late-payment family acquires a missing-content source requirement. */
export function mayHaveSymbolicLesserFee(name: string, canonicalKey: string): boolean {
  return canonicalKey === "late_payment" || /\blate (?:payment|fees?|charges?)\b|\bdelinquen(?:t|cy)\b/i.test(name);
}

/**
 * A literal dollar bound and a symbolic minimum payment do not form a flat price.
 * This never adds price authority, a rate, a frequency or a category. Other formula
 * grammars (including percentages) and wrapped/stacked layouts remain outside it.
 */
export function symbolicLesserOfReview(text: string, name: string, amount: number): SymbolicLesserReview | null {
  if (!(amount > 0) || !Number.isFinite(amount)) return null;
  const key = labelKey(name);
  if (!key) return null;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const owned: string[] = [];
  const formulas: SymbolicLesserReview[] = [];
  for (const line of lines) {
    const prices = [...line.matchAll(MONEY)];
    const first = prices[0];
    if (!first || !prices.some(price => Number(price[1].replace(/,/g, "")) === amount)
      || labelKey(line.slice(0, first.index)) !== key) continue;
    owned.push(line);
    if (!SYMBOLIC.test(line) || !LESSER.test(line) || /%|\bpercent\b/i.test(line)) continue;
    const complete = prices.length === 1 && line.length <= 2_000
      && COMPLETE_TAIL.test(line.slice(first.index! + first[0].length));
    formulas.push(complete ? { kind: "hold", ownText: line }
      : { kind: "decline", ownText: line, reason: "symbolic_formula_unsupported" });
  }
  if (formulas.length === 0) return null;
  const standalone = lines.some((line, at) => labelKey(line) === key
    && [...(lines[at + 1] ?? "").matchAll(MONEY)].some(price => Number(price[1].replace(/,/g, "")) === amount));
  if (owned.length !== 1 || standalone) return { kind: "decline", ownText: formulas[0].ownText, reason: "symbolic_owner_ambiguous" };
  return formulas[0];
}
