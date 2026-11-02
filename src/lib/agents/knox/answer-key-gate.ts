import { reproducibleFees } from "@/lib/agents/hamilton/rules-recheck";
import { foldedCategory, RETURNED_STATEMENT } from "@/lib/agents/knox/rules";
import { foldContext, foldRetiredCategory, isRetiredCategory, researchSplitCategory, researchSplitTarget, splitLiveCategory } from "@/lib/fee-fold";
import { withFootnotedAtmHeading } from "@/lib/fee-fold-atm-heading";

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
  /** Priced key fees left out of `expected`, by id and reason (`gateKeyExclusion`), never silently. */
  excluded: Array<{ tid: number; fee: string; reason: string }>;
  /** Reads under a retired category, which Darwin always refuses: left out of `reads`, listed. */
  retiredReads: Array<{ tid: number; fee: string }>;
}

/**
 * Categories the key files under one name where Knox may use the other. Lines the keys
 * leave "unmapped" that James folded into an existing category (v26) count under it.
 */
const EQUIVALENT: Record<string, string> = { minimum_balance: "monthly_maintenance" };

const cents = (amount: number) => Math.round(amount * 100);

/**
 * A hand-keyed fee under a category folded into the top 50 counts where the fold rules put it. Once
 * `RESEARCH_SPLIT_LIVE` is on (James, Oct 15, #1398), one keyed account research that is an excess
 * withdrawal or returned mail counts under that type, since the keys were made before; while it is
 * off, `researchSplitCategory` returns null and the key stays account research.
 */
function keyCategory(fee: AnswerKeyDocument["fees"][number], text: string): string | null {
  // A key filed under one of the split types (MI 2001's bare "$2.00" under "Return Mail Fee",
  // corrected to returned mail with v77) counts as account research while the switch is off.
  if (fee.key === "returned_mail" || fee.key === "excess_withdrawal") return researchSplitTarget(fee.key);
  const research = researchSplitCategory(fee.key, fee.source_line);
  if (research) return research;
  const split = splitLiveCategory(fee.key, fee.source_line);
  if (split?.to) return split.to;
  if (!isRetiredCategory(fee.key)) return fee.key;
  const line = fee.source_line ?? "";
  // A bare price line ("$125.00") is named by the label printed above it, as the fold names a
  // bare fee by the schedule above it (James, Oct 8). Null: the fold gives the fee no home.
  const name = /[a-z]/i.test(line) ? line : `${labelAbove(text, line)} ${line}`.trim();
  // A key names the fee the bank's schedule prints, so it is folded with the ATM heading read that
  // sees note marks (#1092) whether or not `FOOTNOTED_ATM_HEADING_LIVE` is on: Texas 2416 is a
  // non-network ATM fee either way. The reads it is scored against follow the switch.
  return withFootnotedAtmHeading(true, () => foldRetiredCategory(fee.key, name, foldContext(text, line))?.to ?? null);
}

/**
 * The nearest non-empty line printed above a key's line in its text. "" when the line is not
 * found, or is printed more than once: a bare "$5.00" twice cannot say which label is the key's. Pure.
 */
function labelAbove(text: string, line: string): string {
  const at = line ? text.indexOf(line) : -1;
  if (at < 0 || text.indexOf(line, at + 1) >= 0) return "";
  const rows = text.slice(0, at).split("\n").map((row) => row.trim()).filter(Boolean);
  return rows.at(-1) ?? "";
}

/**
 * Why the gate leaves a priced key fee out of its count. A key under a category the top-50 fold
 * retired, on a line the fold as it stands gives no home (a free e-statement, a balance inquiry by
 * phone), names a fee Darwin refuses (`retired_category`) and the taxonomy dropped (James, Oct 8:
 * "drop them -- the 248"), so today's pipeline cannot find it. The fold can be wrong: a key it should
 * place is a fold defect, and leaves this list once the fold is fixed (Texas 2416, a non-network ATM
 * inquiry under "Non-TBT or Non-Allpoint ATM1:", left it with the marked ATM heading read, #1092).
 */
export const RETIRED_NO_HOME = "retired_category_no_home";

type KeyVerdict = { key: string; excluded: null } | { key: null; excluded: typeof RETIRED_NO_HOME | null };

/**
 * Several scores added together, as if their documents had been scored at once. A gate that needs
 * a total and its parts scores each document once and adds (the slow part is reading each text).
 */
export function combineScores(scores: GateScore[]): GateScore {
  const total: GateScore = { documents: 0, reads: 0, right: 0, categoryErrors: 0, amountErrors: 0, expected: 0, found: 0, precision: 0, coverage: 0, errors: [], excluded: [], retiredReads: [] };
  for (const score of scores) {
    total.documents += score.documents;
    total.reads += score.reads;
    total.right += score.right;
    total.categoryErrors += score.categoryErrors;
    total.amountErrors += score.amountErrors;
    total.expected += score.expected;
    total.found += score.found;
    total.errors.push(...score.errors);
    total.excluded.push(...score.excluded);
    total.retiredReads.push(...score.retiredReads);
  }
  total.precision = total.reads === 0 ? 0 : total.right / total.reads;
  total.coverage = total.expected === 0 ? 0 : total.found / total.expected;
  return total;
}

/**
 * A key fee as the gate scores it: `category:cents` after the folds and the equivalences, or null
 * when the gate does not score it (no price, an "unmapped" line no fold places, or a retired
 * category the fold gives no home: `gateKeyExclusion`). Deming's daily
 * replay of Knox's answer-key misses (#1099) uses the same key, so a case passes when the gate
 * would count the fee found. Pure.
 */
export function gateKeyFor(fee: AnswerKeyDocument["fees"][number], text: string): string | null {
  return keyVerdict(fee, text).key;
}

/** `RETIRED_NO_HOME` when the gate leaves this priced key fee out of its count, else null. Pure. */
export function gateKeyExclusion(fee: AnswerKeyDocument["fees"][number], text: string): typeof RETIRED_NO_HOME | null {
  return keyVerdict(fee, text).excluded;
}

function keyVerdict(fee: AnswerKeyDocument["fees"][number], text: string): KeyVerdict {
  // v90: the keys mark returned statements "unmapped"; Knox now files them as returned mail (#2454).
  const line = fee.source_line ?? "";
  const unmappedKey = foldedCategory(line) ?? (RETURNED_STATEMENT.test(line) ? researchSplitTarget("returned_mail") : "unmapped");
  const mapped = fee.key === "unmapped" ? { ...fee, key: unmappedKey } : fee;
  if (mapped.key === "unmapped" || mapped.amount == null) return { key: null, excluded: null };
  const key = keyCategory(mapped, text);
  if (key == null) return { key: null, excluded: RETIRED_NO_HOME };
  return { key: `${EQUIVALENT[key] ?? key}:${cents(Number(mapped.amount))}`, excluded: null };
}

/** One read (`category:cents`, from `reproducibleFees`) keyed as the gate compares it. Pure. */
export function gateReadKey(read: string): { key: string; amount: number; normalized: string } {
  const split = read.lastIndexOf(":");
  const key = read.slice(0, split);
  const amount = Number(read.slice(split + 1));
  return { key, amount, normalized: `${EQUIVALENT[key] ?? key}:${amount}` };
}

/** Today's free reads of a text, keyed as the gate compares them (`category:cents`). Pure. */
export function gateReads(text: string): Set<string> {
  return new Set([...reproducibleFees(text)].map((read) => gateReadKey(read).normalized));
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
    excluded: [],
    retiredReads: [],
  };
  for (const document of documents) {
    // The same keys Deming's daily replay of Knox's misses uses (#1099): one implementation.
    const expected = new Set(
      document.fees.map((fee) => gateKeyFor(fee, document.text)).filter((key): key is string => key != null),
    );
    for (const fee of document.fees) {
      const reason = gateKeyExclusion(fee, document.text);
      if (reason) score.excluded.push({ tid: document.tid, fee: `${fee.key}:${cents(Number(fee.amount))}`, reason });
    }
    const keyAmounts = new Set(document.fees.filter((fee) => fee.amount != null).map((fee) => cents(Number(fee.amount))));
    const found = new Set<string>();
    for (const read of reproducibleFees(document.text)) {
      const { key, amount, normalized } = gateReadKey(read);
      // Darwin refuses a read under a retired category (`retired_category`), so it is neither
      // credited against a key the gate leaves out nor charged as wrong; it is listed.
      if (isRetiredCategory(key)) {
        score.retiredReads.push({ tid: document.tid, fee: read });
        continue;
      }
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
