import { capFirstItemPrices, stackedLabelKey } from "@/lib/custom-report/stacked-fee-prices";

/** Current, source-proven cap applicability; never supplied by a model or extra flags. */
export const CAP_FIRST_ELIGIBILITY_FLAG = "knox_eligibility:cap_first";
export type CapFirstEligibility = {
  kind: "hold"; canonicalKey: "nsf" | "overdraft"; ownText: string; context: string;
} | { kind: "decline"; reason: "cap_scope_unknown" | "cap_scope_ambiguous" | "cap_category_mismatch" };

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/g;
const hasPrice = (line: string, amount: number) => [...line.matchAll(MONEY)]
  .some(match => Number(match[1].replace(/,/g, "")) === amount);

/** A scope-only review of the existing own-price grammar, without new price authority. */
export function capFirstEligibility(text: string, name: string, amount: number, canonicalKey: string): CapFirstEligibility | null {
  const key = stackedLabelKey(name);
  const matches = capFirstItemPrices(text).filter(row => stackedLabelKey(row.label) === key && row.amount === amount);
  if (matches.length === 0) return null;
  if (matches.some(row => row.canonicalKey !== canonicalKey)) return { kind: "decline", reason: "cap_category_mismatch" };
  if (matches.some(row => row.producerScopeUnknown)) return { kind: "decline", reason: "cap_scope_unknown" };
  if (!matches.some(row => row.eligibilityContext)) return null;
  if (matches.length !== 1) return { kind: "decline", reason: "cap_scope_ambiguous" };

  const own = matches[0];
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  // A different own price is not the target. A second physical occurrence of this
  // same label/price cannot be assigned the cap's applicability from amount alone.
  const competing = lines.some((line, at) => {
    if (at === own.lineIndex) return false;
    if (stackedLabelKey(line) === key) return hasPrice(lines[at + 1] ?? "", amount);
    const dollar = line.indexOf("$");
    if (dollar < 0) return false;
    const label = line.slice(0, dollar).replace(/[.…]{2,}/g, " ").replace(/\s*\|\s*$/, "");
    return stackedLabelKey(label) === key && hasPrice(line.slice(dollar), amount);
  });
  if (competing) return { kind: "decline", reason: "cap_scope_ambiguous" };
  return { kind: "hold", canonicalKey: own.canonicalKey, ownText: own.ownText, context: own.eligibilityContext! };
}
