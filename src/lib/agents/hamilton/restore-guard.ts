import { categoryOpinion, type CategoryModel } from "@/lib/agents/darwin/category-model";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { limitGuardVerdict } from "@/lib/agents/hamilton/limit-guard";

/**
 * The quality bar for bringing back a fee an earlier rules re-check took down although its
 * own text still states it (James, 7 Oct: restore past disputed takedowns, "with a quality
 * bar so we don't bring misreads back"). A fee comes back only when all of these hold:
 *
 * 1. The second look passes: its name and price trace in its own text
 *    (`checkFeeAgainstSource`) and the category guard accepts its name (`checkFeeCategory`).
 * 2. Darwin's category model agrees with its category: the model's top category for the name
 *    is the fee's own, with probability at least `RESTORE_MODEL_MIN_PROBABILITY`. Darwin's
 *    dispute threshold (0.05) let "Fax Service" back as account research and an in-network
 *    ATM as non-network in the first hand-check.
 * 3. The text states the fee on a row of its own (`statesPriceOnItsOwnRow`): on a
 *    two-column page the trace can match a name in one column to the price of the row
 *    beside it ("Legal Processing fee ... | Stop payments ... $35").
 * 4. The row is a fee, not a refundable deposit ("Night Depository access key is $2.00
 *    refundable"), a transaction limit (the limit guard), a markup on a cost ("UPS Fee +
 *    $1") or a sentence cut off before its figure ("Receive a discount of $10"), and a
 *    copy of an item is filed as document reproduction, not as the item.
 * 5. The price is not $0 and the category is not minimum_balance: in the hand-checks most
 *    $0 rows were a free in-house service filed as another bank's, and most minimum-balance
 *    rows were a balance to open or keep, not a charge.
 * 6. When the name joins cells across a pipe ("Research Fee | (via Online Bill Pay)"), the
 *    model files its first cell under the fee's category and disputes none of the others
 *    ("Credit card cash advance | Size 10x10").
 *
 * Hand-checked on fresh random samples of the 3,156 candidates (2026-10-07): with Darwin's
 * 0.05 threshold alone 16 of 20 were right; each later bar was checked on a new sample until
 * one passed (19 of 20, the 18-of-20 bar). docs/project/FINDINGS.md has the rounds.
 */
export const RESTORE_MODEL_MIN_PROBABILITY = 0.8;

/** Categories whose rows on a schedule are more often a requirement than a charge. */
const REQUIREMENT_CATEGORIES = new Set(["minimum_balance"]);
/** A name that ends on a word that needs its figure: prose cut before the amount. */
const DANGLING_END = /\b(of|is|are|was|be|than|to|a|an|by|for|at|the|and|or|with|from|over|under|below|above|exceeds?|least|only)\s*[(:—–-]?\s*$/i;
/** A copy of an item, which is document reproduction whatever the item ("Copy of Money Order check"). */
const COPY_OF = /^\W*(copy|copies|reproduction|photocopy|reprint)s?\s+of\b/i;
const COPY_CATEGORIES = new Set(["document_reproduction", "check_image"]);
/** A markup on a cost ("UPS Fee +", "Cost plus"). */
const MARKUP_END = /(\+|\bplus)\s*$/i;

export type RestoreGuardVerdict =
  | { restore: true }
  | { restore: false; reason: string };

/** A price on a schedule: "$5", "$ 5.00", or a bare "5.00". Bare whole numbers are counts. */
const PRICE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?|\b(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\b/g;
/** Words a cell may hold beside a price without being another fee ("Free $5.00"). */
const ZERO_WORDS = /\b(free|no charge|no fee|n\/c|none)\b/g;

function prices(segment: string): Array<{ value: number; index: number; end: number }> {
  const values: Array<{ value: number; index: number; end: number }> = [];
  for (const match of segment.matchAll(PRICE)) {
    const whole = Number((match[1] ?? match[3]).replace(/,/g, ""));
    const centsText = match[2] ?? match[4];
    const cents = centsText ? Number(centsText.padEnd(2, "0")) / 100 : 0;
    values.push({ value: whole + cents, index: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return values;
}

function squash(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The fee's name as it would appear in the text: no trailing leaders, pipes or dashes. */
function nameInText(name: string): string {
  return squash(name).replace(/[\s.…|:—–-]+$/u, "").replace(/^[\s.…|:—–-]+/u, "").trim();
}

/**
 * True when the text states the fee on a row of its own: a line names the fee with no price
 * before the name, and the first price after the name (on that line, or on the next line
 * for a schedule printed name-over-price) is the fee's, with no other cell's words between
 * them and no second price after it. Two-column pages fail this ("Legal Processing fee ... |
 * Stop payments ... $35"; "$12^ Stop Payment Fee ....", where the $12 ends the row before),
 * and so do rows with several prices, which the trace may pair wrongly. A name the text
 * does not spell out fails too. Pure.
 */
export function statesPriceOnItsOwnRow(text: string, feeName: string, amount: number): boolean {
  const name = nameInText(feeName);
  if (name.length < 4) return false;
  const lines = text.split("\n").map(squash);
  for (let i = 0; i < lines.length; i += 1) {
    const at = lines[i].indexOf(name);
    if (at < 0 || prices(lines[i].slice(0, at)).length > 0) continue;
    let after = lines[i].slice(at + name.length);
    if (prices(after).length === 0) {
      const next = lines.slice(i + 1).find((line) => line !== "");
      if (next === undefined) continue;
      after = `${after} ${next}`;
    }
    const [first, ...rest] = prices(after);
    if (!first || Math.abs(first.value - amount) >= 0.005 || rest.length > 0) continue;
    if (/\|[^|]*[a-z]{3,}/.test(after.slice(0, first.index).replace(ZERO_WORDS, ""))) continue;
    return true;
  }
  return false;
}

/** A refundable deposit stated where a fee would be ("access key is $2.00 refundable"). Pure. */
export function statesRefundableDeposit(text: string, feeName: string): boolean {
  const name = nameInText(feeName);
  if (name.length < 4) return false;
  return text.split("\n").some((rawLine) => {
    const line = squash(rawLine);
    const at = line.indexOf(name);
    return at >= 0 && /(?<!non-?\s?)\brefundable\b/.test(line.slice(at));
  });
}

/**
 * Whether a fee an earlier re-check took down, whose own text is `text`, meets the bar to
 * come back. `model` is Darwin's category model (`loadCategoryModel`); without it nothing
 * comes back this way. Pure.
 */
export function disputedRestoreVerdict(
  text: string,
  fee: { feeName: string; amount: number; canonicalFeeKey: string },
  model: CategoryModel | null,
): RestoreGuardVerdict {
  if (!model) return { restore: false, reason: "no_category_model" };
  if (!(fee.amount > 0)) return { restore: false, reason: "zero_amount" };
  if (REQUIREMENT_CATEGORIES.has(fee.canonicalFeeKey)) return { restore: false, reason: "requirement_category" };
  const name = fee.feeName.replace(/[\s.…|]+$/u, "");
  if (MARKUP_END.test(name)) return { restore: false, reason: "markup_on_cost" };
  if (DANGLING_END.test(name)) return { restore: false, reason: "name_cut_before_figure" };
  if (COPY_OF.test(name) && !COPY_CATEGORIES.has(fee.canonicalFeeKey)) return { restore: false, reason: "copy_of_item" };
  if (limitGuardVerdict({ canonical_fee_key: fee.canonicalFeeKey, fee_name: fee.feeName, amount: fee.amount, conditions: null })) {
    return { restore: false, reason: "limit_as_fee" };
  }
  const traced = checkFeeAgainstSource(text, fee.feeName, fee.amount, ".", fee.canonicalFeeKey);
  if (!traced.ok && traced.reason !== "tiered_fee") return { restore: false, reason: `source_trace:${traced.reason}` };
  const category = checkFeeCategory(fee.canonicalFeeKey, fee.feeName);
  if (!category.ok) return { restore: false, reason: `category_guard:${category.code}` };
  const opinion = categoryOpinion(model, fee.feeName, fee.canonicalFeeKey);
  if (!opinion) return { restore: false, reason: "category_model:no_opinion" };
  if (opinion.suggested !== fee.canonicalFeeKey || opinion.probability < RESTORE_MODEL_MIN_PROBABILITY) {
    return { restore: false, reason: `category_model:${opinion.suggested}` };
  }
  const cells = fee.feeName.split("|").map((cell) => cell.trim()).filter(Boolean);
  if (cells.length > 1) {
    // The first cell names the fee; a later cell may only qualify it ("Size 10x10" beside
    // "Credit card cash advance" is the next table's).
    const first = categoryOpinion(model, cells[0], fee.canonicalFeeKey);
    if (first && first.suggested !== fee.canonicalFeeKey) return { restore: false, reason: `category_model_first_cell:${first.suggested}` };
    const other = cells.slice(1).map((cell) => categoryOpinion(model, cell, fee.canonicalFeeKey)).find((opinion) => opinion?.disputed);
    if (other) return { restore: false, reason: `category_model_other_cell:${other.suggested}` };
  }
  if (!statesPriceOnItsOwnRow(text, fee.feeName, fee.amount)) return { restore: false, reason: "price_not_on_its_own_row" };
  if (statesRefundableDeposit(text, fee.feeName)) return { restore: false, reason: "refundable_deposit" };
  return { restore: true };
}
