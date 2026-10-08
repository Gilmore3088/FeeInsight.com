import { reproducibleFees } from "@/lib/agents/hamilton/rules-recheck";
import { foldedCategory } from "@/lib/agents/knox/rules";
import { foldContext, foldRetiredCategory, isRetiredCategory, splitLiveCategory } from "@/lib/fee-fold";

/**
 * Knox's rule-change gate: scores today's free extractor team (plus Darwin's rule checks,
 * the same set the rules re-check keeps live) against hand-checked answer keys. Pure.
 * `answer-key-gate.test.ts` runs it on the Texas keys in CI, so a rules change that reads
 * fewer right fees or more wrong ones fails before it can take live fees down.
 *
 *   precision  distinct (category, price) reads that are in the key / all distinct reads
 *   coverage   key fees read / key fees with a category and a price
 *   category   reads whose price is in the key under another category
 *   amount     reads whose price is not in the key at all
 */

export interface AnswerKeyDocument {
  tid: number;
  institution: string;
  /** `tuning` keys were used while writing rules; `holdout` keys were not. */
  set: "tuning" | "holdout";
  fees: Array<{ key: string; amount: number | null; source_line?: string | null }>;
  text: string;
}

export interface GateScore {
  documents: number;
  reads: number;
  right: number;
  categoryErrors: number;
  amountErrors: number;
  expected: number;
  found: number;
  precision: number;
  coverage: number;
  errors: Array<{ tid: number; kind: "category" | "amount"; fee: string }>;
}

/**
 * Categories the key files under one name where Knox may use the other. Lines the keys
 * leave "unmapped" that James folded into an existing category (v26) count under it.
 */
const EQUIVALENT: Record<string, string> = { minimum_balance: "monthly_maintenance" };

const cents = (amount: number) => Math.round(amount * 100);

/** A hand-keyed fee under a category folded into the top 50 counts where the fold rules put it. */
function keyCategory(fee: AnswerKeyDocument["fees"][number], text: string): string {
  const split = splitLiveCategory(fee.key, fee.source_line);
  if (split?.to) return split.to;
  if (!isRetiredCategory(fee.key)) return fee.key;
  const line = fee.source_line ?? "";
  return foldRetiredCategory(fee.key, line, foldContext(text, line))?.to ?? fee.key;
}

export function scoreAnswerKeys(documents: AnswerKeyDocument[]): GateScore {
  const score: GateScore = {
    documents: documents.length,
    reads: 0,
    right: 0,
    categoryErrors: 0,
    amountErrors: 0,
    expected: 0,
    found: 0,
    precision: 0,
    coverage: 0,
    errors: [],
  };
  for (const document of documents) {
    const priced = document.fees
      .map((fee) => (fee.key === "unmapped" ? { ...fee, key: foldedCategory(fee.source_line ?? "") ?? "unmapped" } : fee))
      .filter((fee) => fee.key !== "unmapped" && fee.amount != null)
      .map((fee) => ({ ...fee, key: keyCategory(fee, document.text) }));
    const expected = new Set(priced.map((fee) => `${EQUIVALENT[fee.key] ?? fee.key}:${cents(Number(fee.amount))}`));
    const keyAmounts = new Set(document.fees.filter((fee) => fee.amount != null).map((fee) => cents(Number(fee.amount))));
    const found = new Set<string>();
    for (const read of reproducibleFees(document.text)) {
      const split = read.lastIndexOf(":");
      const key = read.slice(0, split);
      const amount = Number(read.slice(split + 1));
      const normalized = `${EQUIVALENT[key] ?? key}:${amount}`;
      score.reads += 1;
      if (expected.has(normalized)) {
        score.right += 1;
        found.add(normalized);
      } else if (keyAmounts.has(amount)) {
        score.categoryErrors += 1;
        score.errors.push({ tid: document.tid, kind: "category", fee: read });
      } else {
        score.amountErrors += 1;
        score.errors.push({ tid: document.tid, kind: "amount", fee: read });
      }
    }
    score.expected += expected.size;
    score.found += found.size;
  }
  score.precision = score.reads === 0 ? 0 : score.right / score.reads;
  score.coverage = score.expected === 0 ? 0 : score.found / score.expected;
  return score;
}
