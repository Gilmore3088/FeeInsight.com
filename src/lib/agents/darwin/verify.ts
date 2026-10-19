import { ANCILLARY_PRODUCT_FLAG, primaryAncillaryProduct } from "../knox/ancillary-product";
import { productKey, productKeySql, sameProduct } from "@/lib/fee-product";
import { scopedFeeStatements, type FeeAudience } from "@/lib/fee-audience";
import { CAP_FIRST_ELIGIBILITY_FLAG } from "../knox/cap-first-eligibility";
import { SYMBOLIC_LESSER_ELIGIBILITY_FLAG } from "../knox/symbolic-lesser-of";
import { darwinAudience, type DarwinAudience } from "./audience";
import {
  admittedRawMatches, completeAudienceAdmission, prepareVerificationAudience, requireSameAudienceAdmission,
  VerificationAudienceDeferred, type VerificationAudienceAdmission,
} from "./verification-audience";
import { tierPerkZero } from "./tier-perk";
import { requireInternationalVerification } from "./international-verification";
import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { countOutcomes, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { WHOLE_DOCUMENT_BATCH } from "@/lib/agents/document-batch";
import { currentCopySchemaReady } from "@/lib/agents/magellan/current-copy";
import { CATEGORY_GUARD_VERSION, checkFeeCategory, refileCategory, refileFromLine } from "@/lib/fee-category-guard";
import { RETIRED_CATEGORIES } from "@/lib/fee-fold";
import { RULE_WHY, ruleFor } from "@/lib/agents/hamilton/eval-verdicts";
import { checkFeeAgainstSource, checkRateAgainstSource, sourceLines } from "@/lib/custom-report/source-check";
import { perEventFrequency, settledFrequency } from "@/lib/fee-frequency";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { sourceLinkSkipReason } from "@/lib/agents/hamilton/source-link";
import { PERCENT_FEE_RANGES, isPercentFee, percentFeeAllowed, ratePercentOf, type RateFields } from "@/lib/percent-fees";
import { darwinFeedbackRows, recordDarwinFeedback } from "./feedback";
import { recheckVerifiedFees, type VerifiedRecheckResult } from "./verified-recheck";
import { recheckDocumentOwners, type DocumentOwnerResult } from "./document-owner";
import {
  categoryChangeCandidates,
  DARWIN_CATEGORY_CHANGE_LIMIT,
  DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE,
  DARWIN_TAKEOVER_CATEGORY_PROOF_LIVE,
  selectCategoryChangeRows,
  summarizeCategoryChange,
  type CategoryChangeRejudgeSummary,
} from "./category-change";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";
import { inSavepoint } from "@/lib/agents/savepoint";
import { institutionTier } from "@/lib/agents/state-expert/memory";
import {
  DARWIN_CATEGORY_MODEL_STRATEGY,
  categoryOpinion,
  loadCategoryModel,
  type CategoryOpinion,
} from "./category-model";

import {
  isExplicitZeroFee,
  ZERO_FEE_RAW_FLAG,
  ZERO_FEE_VERIFIED_FLAG,
  CATEGORY_AMOUNT_ENVELOPES,
} from "./envelopes";
import { darwinEnvelopeFor, loadLearnedEnvelopes, type LearnedEnvelope } from "./learned-envelopes";
import {
  DARWIN_PEER_GRADED_VERSIONS,
  DARWIN_PEER_STRATEGY,
  entersPeerCheck,
  DARWIN_SECOND_SOURCE_STRATEGY,
  districtOfState,
  holdsForPeerReview,
  loadSourceCopies,
  PeerLevelCache,
  peerCheck,
  peerOutlierReason,
  SECOND_SOURCE_FLAG,
  secondSourceCheck,
  type PeerCheckResult,
  type SecondSourceResult,
} from "./peer-checks";

type SqlTag = typeof sql;

/**
 * The verifier recorded in the attempt log; bump the version when the rules change.
 * v3 added the category guard (src/lib/fee-category-guard.ts): a fee name must support
 * the category it was filed under.
 */
// The `not_in_source` check joined version 3 without a bump on purpose: a new version
// re-selects every decided row, and rows once held back as `duplicate_in_batch` would
// then be verified as second copies of an already verified fee (only `fee_raw_id` is unique).
export const DARWIN_VERIFY_STRATEGY = { strategy: "verify.rules", version: 3 } as const;
/**
 * The source check (`checkFeeAgainstSource`, Accuracy's `src/lib/custom-report/source-check.ts`)
 * as Darwin read it, recorded on every decision. A `not_in_source` rejection was final: the row
 * was never read again, so a fee the check could not trace before a fix stayed rejected after it
 * (1,126 rows at 499 banks by 2026-10-09, Northern Trust's wrapped-name $25 overdraft among them).
 * Raising this number gives every `not_in_source` rejection stamped lower one more read, the way
 * a guard bump re-checks `category_mismatch`; a row the check still fails is stamped and done.
 * Bump it when a source-check fix lands that should reach rejected rows. v1: 2026-10-09, after
 * Knox v62 (#861) taught the check wrapped leader names, per-wire lines and former-fee columns.
 * v2: 2026-10-09 (a1119f26), after the check learned customer audience: a completed fee
 * elimination scoped to one audience is read as that audience's $0, an NSF price on a schedule
 * whose completed change statement does not name it is not the fee, a price that conflicts with
 * the schedule's audience statement is not the fee, and an overdraft cushion or a per-day total
 * is not a per-item overdraft or NSF price.
 */
export const DARWIN_SOURCE_CHECK_VERSION = 2;
/**
 * The verified row's frequency was settled from the fee's own schedule line (`settledFrequency`,
 * the same rule as Hamilton's frequency fill and Knox v52) because Knox's stated frequency
 * contradicted it or was never stated there: "$1.00 per withdrawal in excess of six per month"
 * read as monthly is charged per item (held excess-withdrawal rows, Oct 9). Since #1196 an NSF fee
 * never keeps a period (`perEventFrequency`): it takes its line's per-item wording or none.
 */
export const FREQUENCY_SETTLED_FLAG = "darwin_frequency_settled";

export const DARWIN_VERIFY_DEFAULT_LIMIT = 100;
export const DARWIN_VERIFY_MAX_LIMIT = 500;

const VALID_CANONICAL_KEYS = new Set(Object.values(CANONICAL_KEY_MAP));

/**
 * Why Darwin did not verify a row. Every skipped row carries exactly one code, in the
 * attempt log and in the review signal's reason counts.
 */
export type DarwinReasonCode =
  | "missing_canonical"
  | "missing_name"
  | "category_mismatch"
  | "missing_lineage"
  | "invalid_amount"
  | "not_in_source"
  | "outside_envelope"
  | "peer_outlier"
  | "duplicate_in_batch"
  | "duplicate_verified"
  | "percent_not_publishable"
  | "category_lesson_pending"
  | "retired_category"
  | "conditional_zero"
  | "tier_perk_zero"
  | "name_rule"
  | "insert_failed";

/**
 * `rejected`: the row cannot become a verified fee as read. `needs_review`: the row may
 * be right but a person should look first (an amount outside its category's range).
 * `duplicate`: the same fee was already verified. All three are terminal for this rule
 * version, so a skipped row never comes back to starve the batch.
 */
export type DarwinDecision = "verified" | "rejected" | "needs_review" | "duplicate";

export const DARWIN_REASON_TEXT: Readonly<Record<DarwinReasonCode, string>> = {
  missing_canonical: "Missing or invalid canonical hint",
  missing_name: "Missing fee name",
  category_mismatch: "Fee name does not support its category",
  missing_lineage: "Missing source lineage",
  invalid_amount: "Missing or invalid amount",
  not_in_source: "Fee and amount not found in the bank's own stored schedule",
  outside_envelope: "Amount outside the category's plausible range",
  peer_outlier: "Amount far outside the state's peer range for this fee and asset size",
  duplicate_in_batch: "Same fee already verified in this batch",
  duplicate_verified: "Duplicate verified row",
  percent_not_publishable: "A rate in a category that does not publish rates (often an interest rate, not a fee)",
  category_lesson_pending: "Fee name belongs to a category the guard does not place it in yet; held until the guard learns it",
  retired_category: "Category retired by the top-50 fold and the name has no home in a live one; Hamilton never publishes it",
  conditional_zero: "A $0 fee whose own schedule line prices it ($0 if a condition is met, else a charge); the charge is the fee",
  tier_perk_zero: "A $0 from one account tier's own schedule (premium, private banking, BankOn) or named for that account: the tier's perk, not the bank's price",
  name_rule: "The name or line fails a rule Hamilton would take the live fee down for",
  insert_failed: "The database refused the verified row; held for review so the rest of the batch still runs",
};

const NONZERO_DOLLAR = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
const PRICE_CELL = /\$|\bfree\b|\bn\/c\b|\bno charge\b/i;
// Words of a fee name that every fee shares; a cell has to carry one of the name's other words
// before it is this fee's ("Garnish & Levy Fee" is not the "Notary Fee" cell).
const GENERIC_NAME_WORDS = new Set(["fee", "fees", "charge", "charges", "service", "services", "per", "each", "item", "account", "acct", "occurrence"]);
const NON_CUSTOMER = "non-?\\s?(?:members?|customers?|clients?|account\\s?holders?)";
// "$5 - Non-Members", "Non-members $5", "$10 for non-customers": the other party's price, never this
// customer's condition (UAT, 2026-10-09: Notary Fee "$0 - Members $5 - Non-Members" is a free fee).
const NON_CUSTOMER_PRICE = new RegExp(`\\$\\s*\\d[\\d,]*(?:\\.\\d{1,2})?[^$|]{0,25}?${NON_CUSTOMER}|${NON_CUSTOMER}[^$|]{0,25}?\\$\\s*\\d[\\d,]*(?:\\.\\d{1,2})?`, "gi");
// "$1 minimum opening requirement", "Minimum deposit to open: $25", "$50 minimum to open": the deposit
// that opens the account, not a price the fee falls back to.
const OPENING_DEPOSIT = /\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:minimum\s+)?(?:opening|to\s+open|deposit\s+to\s+open)(?!\s*:)|(?:minimum\s+(?:deposit\s+)?to\s+open|minimum\s+opening\s+(?:deposit|balance|requirement)|opening\s+(?:deposit|requirement))[^$|]{0,20}?\$\s*\d[\d,]*(?:\.\d{1,2})?/gi;
// A "Label:" inside a cell that lists several ("Monthly Service Charge: FREE Minimum Balance: $1.00"):
// a run of capitalised words (lower-case fillers allowed) ending in a colon.
const CELL_LABEL = /(?<=^|\s)(?:[A-Z][\w/&()*'-]*(?:\s(?:to|of|for|and|or|per|in|on|a|an|the))*\s){0,5}[A-Z][\w/&()*'-]*:\s/g;

function nameTokens(feeName: string | null | undefined): string[] {
  return (feeName ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? [];
}

/** Index of the part that carries the most words of the fee name, -1 when none does. */
function bestPart(parts: string[], tokens: string[]): number {
  const specific = tokens.filter((token) => !GENERIC_NAME_WORDS.has(token));
  let best = -1;
  let bestScore = 0;
  parts.forEach((part, index) => {
    const lower = part.toLowerCase();
    // A name with its own words needs one of them in the part; a generic word alone is not a match.
    if (specific.length > 0 && !specific.some((token) => lower.includes(token))) return;
    const score = tokens.filter((token) => lower.includes(token)).length;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

// A cell that opens with its own label of two or more words ("Certified Letter Fee: $10",
// "Subordination agreement: $175.00") is another fee's, not this fee's price (#1571).
// Only a label that names a fee of its own counts, never one that states a condition ("Paper
// statements: $5", "Without Direct Deposit: $10", "Each Additional Item: $30"; review of #1571).
const LABELLED_CELL = /^\s*([A-Za-z][^$\d:|]*\s[^$\d:|]*[A-Za-z]):\s*(?:\$|\d|free\b|no charge\b|none\b)/i;

function labelledCell(cell: string, feeName: string | null | undefined): boolean {
  const label = LABELLED_CELL.exec(cell)?.[1];
  return label != null && namesOtherFee(label, feeName);
}

function isPriceCell(cell: string | undefined, feeName?: string | null): boolean {
  return cell != null && PRICE_CELL.test(cell) && (cell.match(/[a-z]+/gi)?.length ?? 0) <= 4 && !labelledCell(cell, feeName);
}

// A $0 price as a schedule prints it.
const ZERO_PRICE = /\bfree\b|\bno charge\b|\bn\/c\b|\bnone\b|\bno fee\b|\$\s*0(?:\.0{1,2})?(?![\d,]*\.?\d*[1-9])|(?<![\d.$])0\.00\b/i;
// Words that make the text after a $0 that fee's own terms, not the next row: a balance band, a
// channel, a statement or account type, a member or age tier, a requirement ("FREE Balance under
// $500 $5", "No Charge Online $30 In Branch", "FREE Premium Checking $5.00 All Others"; review of
// #1571).
const CONDITION_WORDS = /\b(?:bal|avg|average|balances?|e-?statements?|statements?|paper|members?|online|branch(?:es)?|phone|mobile|telephone|teller|person|others?|everyone|requires?|required|requirements?|senior|seniors|students?|ages?|youth|adults?|military|premium|platinum|gold|relationship|standard|basic|club|regular|clients?|months?|monthly|quarterly|years?|days?|thereafter|otherwise|waived?|minimum|maximum|deposits?|with|without|if|when|unless|after|first|second|each|additional|subsequent|over|under|below|above|less|more|fewer|via|network|non-network|out-of-network|written|self-service|assisted|tier|level|consumers?|business|personal|qualif\w*|enroll\w*|limit|charged|pays?|applies|apply|will|not|foreign|non-?proprietary|proprietary|surcharge|extra|third|rush|instant|expedited|larger|designer|duplicate|hr|min)\b/i;
// A noun that names a fee of its own ("Replacement key", "Copy of Transaction", "ATM Transaction
// fee"): only a label carrying one is read as the next row.
const FEE_NOUN = /\b(?:fees?|charges?|cards?|checks?|wires?|cop(?:y|ies)|keys?|depository|box(?:es)?|orders?|stamps?|notary|research|printing|reconcil\w*|agreements?)\b/i;

const GENERIC_LABEL_WORDS = new Set(["fee", "fees", "charge", "charges", "service", "services", "per", "each", "item", "items", "the", "and", "for"]);

/**
 * True when a label names another fee: a fee noun, no word that states a condition (parentheses
 * included: "Stop Payment Fee (Teller Assisted) $30"), and no specific word of this fee's own name,
 * since "Safe Deposit Box FREE Larger Boxes $50" or "Card Replacement FREE Third Card $5" price the
 * same fee at another tier (third review of #1571).
 */
function namesOtherFee(label: string, feeName: string | null | undefined): boolean {
  if (!FEE_NOUN.test(label.replace(/\([^)]*\)/g, " ")) || CONDITION_WORDS.test(label)) return false;
  // One stem for singular and plural on both sides ("Notice"/"Notices", "Charge"/"Charges"), so a
  // plural never hides the fee's own word (final review of #1571).
  const stem = (word: string) => word.replace(/ies$/, "y").replace(/s$/, "").replace(/e$/, "");
  const own = new Set(words(feeName ?? "").map((entry) => stem(entry.word)).filter((word) => word.length >= 3 && !GENERIC_LABEL_WORDS.has(word)));
  return !words(label).some((entry) => own.has(stem(entry.word)));
}
const LEADING_ZERO_NAME = /^\s*(?:free|no charge|no fee|none|no)\b/i;
const PRICE_AT = /\$\s*\d|\b\d[\d,]*\.\d{2}\b/;

/**
 * True when the text after a fee's $0 is the next row of a run-on line: it opens with a
 * capitalised label that names a fee of its own (`namesOtherFee`, parentheses aside) and reaches a
 * non-zero price, and neither the label nor the words after that price state a condition
 * ("FREE Replacement key $50.00", "FREE ATM Transaction fee (per transaction ...) $2.00").
 * Anything else stays the fee's own terms, so an unclear tail keeps the $0 conditional. Pure.
 */
function nextRow(tail: string, feeName: string | null | undefined): boolean {
  const text = tail.replace(/^[\s.;,:*\u2013\u2014-]+/, "");
  if (!/^[A-Z]/.test(text)) return false;
  const price = PRICE_AT.exec(text);
  // #1593: a label priced $0 before any other price is the next free row ("Mobile Deposit FREE MX
  // Personal Financial Management FREE Online Banking FREE ... $25.00"), never this fee's condition.
  const zero = ZERO_PRICE.exec(text);
  if (zero && zero.index > 0 && (!price || zero.index < price.index) && otherFeeLabel(text.slice(0, zero.index), feeName)) return true;
  if (!price) return false;
  if (!namesOtherFee(text.slice(0, price.index), feeName)) return false;
  const after = text.slice(price.index + price[0].length).replace(/^[\d,.]*/, "").slice(0, 40);
  return !CONDITION_WORDS.test(after.split(PRICE_AT)[0]);
}

function words(text: string): Array<{ word: string; start: number; end: number }> {
  return [...text.matchAll(/[a-z0-9]+/gi)].map((match) => ({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length }));
}

/** The longest run of the fee name's leading words that the text prints in order. */
function nameRun(text: string, feeName: string): { start: number; end: number; length: number } | null {
  const name = words(feeName).map((entry) => entry.word);
  const line = words(text);
  let best: { start: number; end: number; length: number } | null = null;
  for (let i = 0; i < line.length; i += 1) {
    let k = 0;
    while (k < name.length && i + k < line.length && line[i + k].word === name[k]) k += 1;
    if (k > 0 && (!best || k > best.length)) best = { start: line[i].start, end: line[i + k - 1].end, length: k };
  }
  return best && best.length >= Math.min(2, name.length) ? best : null;
}

/**
 * The fee's own row inside a run-on cell, where a stored line runs several schedule rows together
 * with no cell break (#1571): "Record Searches $30/$25 Notary Services No Charge", "Check Free
 * (bill pay) FREE Replacement key $50.00". Prose is first cut to the sentence that carries the
 * fee name and the sentences after it. Then the row runs from the fee name to its $0 price, plus
 * what follows unless that is plainly the next row (`nextRow`). Null when the cell does not print
 * the fee name. Text before the name is dropped only when a $0 follows it and the row does not
 * open with a price. Pure.
 */
function ownRow(cell: string, feeName: string | null | undefined, documentText: string | null = null): string | null {
  // A name that opens with its own $0 ("Free official checks", "No Monthly Maintenance Fee") is an
  // account's feature list, not a priced row: read the cell whole (final review of #1571).
  if (!feeName || LEADING_ZERO_NAME.test(feeName)) return null;
  const sentences = cell.split(/(?<=[A-Za-z0-9)%][.!?])\s+(?=[A-Z0-9$])/);
  let group = cell;
  if (sentences.length > 1) {
    const tokens = words(feeName).map((entry) => entry.word).filter((word) => word.length >= 3 || /\d/.test(word));
    const score = (sentence: string) => {
      const present = new Set(words(sentence).map((entry) => entry.word));
      return tokens.filter((token) => present.has(token)).length * 100 + (nameRun(sentence, feeName)?.length ?? 0);
    };
    const scores = sentences.map(score);
    const best = scores.indexOf(Math.max(...scores));
    const nameWords = new Set(words(feeName).map((entry) => entry.word));
    const ownTerms = words(sentences[best]).filter((entry) => !nameWords.has(entry.word)).map((entry) => entry.word).join(" ");
    // The sentences after it stay: they may state its terms ("Free. Paper statements: $5."). A
    // sentence that states its own condition ("No Monthly Fee When Qualifications Are Met") keeps
    // the sentences before it too, since they may price it (final review of #1571).
    if (CONDITION_WORDS.test(ownTerms)) return cell;
    group = sentences.slice(best).join(" ");
    // A sentence that names the fee but prints no price ("Courtesy pay covers ... overdraw. No fee
    // for transactions $15 and under") leaves its price to the next one: read the cell whole.
    if (!/\$\s*\d/.test(group) && !ZERO_PRICE.test(group)) group = cell;
  }
  const run = nameRun(group, feeName);
  if (!run) return null;
  const rest = group.slice(run.end);
  const zero = ZERO_PRICE.exec(rest);
  // No $0 after the name, or a price leads the row ("$5.00 Paper Statement Fee (FREE with
  // e-Statements)"): nothing before the name is dropped.
  if (!zero || /^\s*\$?\s*\d/.test(group)) return group;
  const zeroEnd = run.end + zero.index + zero[0].length;
  // In prose, words before the name in its own sentence are its terms ("One credit = $2 off your
  // monthly service charge"): only a run-on row of cells drops them (final review of #1571).
  const from = sentences.length > 1 ? 0 : run.start;
  const tail = group.slice(zeroEnd);
  return nextRow(tail, feeName) || otherColumnTail(tail, feeName, documentText) ? group.slice(from, zeroEnd) : group.slice(from);
}

/**
 * True when the text after a fee's $0 on a run-on line is the other column of a two-column page
 * (#1593). It fails safe: the tail must not state a condition anywhere, notes in parentheses
 * included (`tailStatesCondition`), and the document must show positively that it is another fee's
 * row:
 * - a line of two text cells sits next to it ("Blue Lion Checking | Account Early Closure"), the
 *   tail is a priced row the page also prints on a line of its own, and the
 *   same row, the fee's whole name and its $0, prints on another line followed by a priced text that
 *   shares no word with this tail ("Maintenance Fee (per statement cycle) $0.00 (per account, per
 *   hour) $25.00" beside the line "(per account, per hour) $25.00"); or
 * - the tail opens with a Title Case label under a right-column heading on the line above that
 *   names another fee, and that label opens the right column on a line next to it ("Foreign ATM
 *   usage No Charge Customer (incoming) $15.00" under "POS transactions No Charge Wire Transfers",
 *   over "Replacement Card $10.00 Customer Domestic (outgoing) $30.00").
 * Without the document, or with no such evidence, the tail stays the fee's terms: a held real $0 is
 * the safe miss, a freed conditional one is not (re-review of #1621). Pure.
 */
function otherColumnTail(tail: string, feeName: string | null | undefined, documentText: string | null): boolean {
  if (!documentText || !feeName || AUDIENCE_NAME.test(feeName)) return false;
  const text = tail.replace(/^[\s.;,:*–—-]+/, "");
  const price = PRICE_AT.exec(text);
  if (!price) return false;
  const flat = text.replace(/\s+/g, " ").trim();
  // "(if balance falls below $100) $5.00", "Maintain $500 daily balance or $10.00", "Overnight
  // Delivery $35.00": the fee's own terms (reviews of #1621).
  if (tailStatesCondition(flat)) return false;
  const lines = documentLines(documentText);
  const here = lines.flatMap((line, index) => (line.includes(flat) ? [index] : []));
  const near = (index: number) => [index - 2, index - 1, index + 1, index + 2].map((k) => lines[k]).filter((line): line is string => line != null);
  const label = text.slice(0, price.index);
  // A line of two text cells next to it ("Blue Lion Checking | Account Early Closure"): the page
  // is laid out in two columns here.
  const twoColumns = here.some((index) => near(index).some((line) => {
    const cells = line.split(/\s\|\s/);
    return cells.length === 2 && cells.every((cell) => (cell.match(/[a-z]{3,}/gi) ?? []).length >= 2);
  }));
  // A fee noun alone is no proof (third review of #1621): the page must print the tail as a row.
  const rowOfItsOwn = lines.some((line) => line === flat);
  if (twoColumns && rowOfItsOwn && !LABEL_AUDIENCE.test(flat)) {
    const own = new Set(labelWords(flat));
    const repeated = lines.some((line) => {
      const after = rowTail(line, feeName);
      return after != null && after.replace(/\s+/g, " ").trim() !== flat && PRICE_AT.test(after) && !labelWords(after).some((word) => own.has(word));
    });
    if (repeated) return true;
  }
  if (!otherFeeLabel(label, feeName, true, true) || !titleCase(label)) return false;
  // The right column's own heading, on the line above, names another fee ("Wire Transfers").
  if (!here.some((index) => rightColumnFee(lines[index - 1], feeName))) return false;
  const lead = labelWords(label)[0];
  if (!lead) return false;
  const opensColumn = (part: string) => part.toLowerCase().startsWith(lead) && PRICE_AT.test(part);
  return here.some((index) => near(index).some((line) => {
    const first = PRICE_AT.exec(line);
    const right = first ? line.slice(first.index + first[0].length).replace(/^[\d,.]*\s*/, "") : "";
    return opensColumn(right) || opensColumn(line);
  }));
}

// Words that make a tail the fee's own terms wherever they sit: a fallback price ("or $10.00") or
// a way to avoid it ("Maintain", "Keep", "Avoid", "otherwise").
const TAIL_TERMS = /\bor\s+\$|\b(?:otherwise|avoid\w*|maintain\w*|keep\w*|direct|needed|needs?|recurring)\b/i;
// A delivery tier or channel prices the same fee another way ("Overnight Delivery $35.00", "Verbal
// Request $30.00", "Inactive Status $5.00"): on a two-column page it is never another fee's row.
// So does an account's activity or a choice its holder made ("Low Activity $5.00", "No Debit Card
// Activity $5.00", "Opted Out Of Overdraft $4.00"): third review of #1621.
const DELIVERY_WORDS = /\b(?:overnight|expedited|rush|express|priority|same[\s-]?day|next[\s-]?day|shipping|shipped|delivery|delivered|mail(?:ed)?|courier|verbal|written|inactive|inactivity|dormant|paper|electronic|e-?mail|activity|usage|use|opted|enrolled|below|under)\b/i;
// A label that opens like a quantity or a negation prices the same fee another way ("Range of
// Checks $30.00", "Each additional $5", "No Debit Card Activity $5.00").
const QUALIFIER_OPENING = /^\s*(?:no|range\s+of|multiple|each\s+additional|per)\b/i;

/** The tail states a condition: a condition word anywhere, notes in parentheses included. Pure. */
function tailStatesCondition(tail: string): boolean {
  return CONDITION_WORDS.test(tail) || TAIL_TERMS.test(tail) || DELIVERY_WORDS.test(tail) || QUALIFIER_OPENING.test(tail);
}

/** Every word of three letters or more outside parentheses opens with a capital ("Account History"). Pure. */
function titleCase(label: string): boolean {
  const found = label.replace(/\([^)]*\)/g, " ").match(/[A-Za-z][A-Za-z']{2,}/g) ?? [];
  return found.length > 0 && found.every((word) => /^[A-Z]/.test(word));
}

function documentLines(documentText: string): string[] {
  return documentText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length > 0);
}

/**
 * The line just above opens a right column whose heading names fees: a two-cell line with no
 * price whose right cell carries a fee noun and no word of this fee's name ("Bill Pay | Other
 * Fees"), or a line that ends, after its last price, with another fee's heading (`rightColumnFee`).
 * Pure.
 */
function headedByFees(line: string | undefined, feeName: string): boolean {
  if (!line) return false;
  if (rightColumnFee(line, feeName)) return true;
  const cells = line.split(/\s\|\s/);
  if (cells.length !== 2 || PRICE_AT.test(line) || ZERO_PRICE.test(line)) return false;
  const heading = cells[1].trim();
  const stem = (word: string) => word.replace(/ies$/, "y").replace(/s$/, "").replace(/e$/, "");
  const own = new Set(labelWords(feeName).map(stem));
  return /^[A-Z]/.test(heading) && FEE_NOUN.test(heading) && !labelWords(heading).some((word) => own.has(stem(word)));
}

/**
 * The label is positively another fee's: a Title Case name (two words or more, or one with a fee
 * noun) that the page also prints as its own priced row on another line, or that sits under a
 * right-column heading naming fees (`headedByFees`). A fee noun alone is no proof ("No Debit Card
 * Activity $5.00", "Range of Checks $30.00"). A delivery tier, channel, activity or holder's choice
 * ("Overnight Shipping", "Verbal Request", "Low Activity", "Opted Out Of Overdraft"), or a label
 * that opens like a quantity or a negation, never is. Pure (reviews of #1621).
 */
function positivelyOtherFee(label: string, feeName: string, line: string | null, documentText: string | null): boolean {
  if (DELIVERY_WORDS.test(label) || QUALIFIER_OPENING.test(label)) return false;
  if (!titleCase(label) || (labelWords(label).length < 2 && !FEE_NOUN.test(label)) || !documentText || !line) return false;
  const name = label.replace(/[\s.…:|*_–—-]+$/, "").trim().toLowerCase();
  const lines = documentLines(documentText);
  const flat = line.replace(/\s+/g, " ").trim();
  const elsewhere = lines.some((other) => other !== flat && other.split(/\s\|\s/).some((cell) => {
    const lower = cell.toLowerCase();
    return lower.startsWith(name) && PRICE_AT.test(cell.slice(name.length));
  }));
  return elsewhere || lines.some((other, index) => other === flat && headedByFees(lines[index - 1], feeName));
}

/**
 * The line ends, after its last price, with a heading of the right column that names another fee
 * ("POS transactions No Charge Wire Transfers"). Pure.
 */
function rightColumnFee(line: string | undefined, feeName: string): boolean {
  if (!line) return false;
  const prices = [...line.matchAll(new RegExp(`${PRICE_AT.source}|${ZERO_PRICE.source}`, "gi"))];
  const last = prices.at(-1);
  if (!last) return false;
  const heading = line.slice(last.index + last[0].length).replace(/^[\d,.]*\s*/, "");
  return /^[A-Z]/.test(heading) && FEE_NOUN.test(heading) && otherFeeLabel(heading, feeName);
}

/** The text after the fee's whole name and its $0 on a line, or null when the line does not print that row. */
function rowTail(line: string, feeName: string): string | null {
  if (!printsOwnZero(line, feeName)) return null;
  const run = nameRun(line, feeName);
  if (!run) return null;
  const zero = ZERO_PRICE.exec(line.slice(run.end));
  return zero ? line.slice(run.end + zero.index + zero[0].length) : null;
}

/**
 * The part of a schedule line that belongs to this fee: on a table line (cells split by " | ")
 * the cell that carries the most words of the fee name, plus the next cell when it reads as a
 * price ("$6.95 per Month", "FREE") and is the only price cell that follows; a prose line is used
 * whole. Keeps a neighbour's price in the same table row ("Monthly Maintenance | Free | Assisted
 * Phone Transactions* | $3") from being read as this fee's. A row of a comparison table ("Monthly
 * fee | $0 | $5* | $0") prices one fee per product column, so only the name cell is this fee's;
 * inside a cell that lists several "Label: value" pairs, only the fee's own label and value count.
 * Pure.
 */
export function ownSegment(line: string, feeName: string | null | undefined, documentText: string | null = null): string {
  // Cells: table columns (" | "), items of a comma list ("FREE Debit Card, FREE Bill Pay, ... up to
  // $10"), and dot-leader entries ("Garnish & Levy Fee ……… $25.00 per Item Research ……… $20.00").
  const cells = line.split(/\s\|\s|,\s+|[.…]{3,}\s*/).filter((cell) => cell.trim().length > 0);
  const tokens = nameTokens(feeName);
  if (cells.length < 2) return bestPart(cells, tokens) < 0 ? "" : ownPart(line, feeName, tokens, documentText);
  const best = bestPart(cells, tokens);
  // No cell carries a word of the name: the line's prices cannot be this fee's.
  if (best < 0) return "";
  const next = cells[best + 1];
  const comparisonRow = isPriceCell(next, feeName) && isPriceCell(cells[best + 2], feeName);
  // #1593: a price that opens the fee's cell right after another fee's label cell is that fee's
  // ("5x10x20 Safe Deposit Box Annually | $75.00 Bill Pay | No Charge"); with no label before it,
  // the price stays this fee's ("$5.00 Paper Statement Fee (FREE with e-Statements)").
  const cell = best > 0 && priceOfLabelBefore(line, cells[best - 1], cells[best], feeName) ? cells[best].replace(LEADING_PRICE, "") : cells[best];
  const own = ownPart(cell, feeName, tokens, documentText);
  return isPriceCell(next, feeName) && !comparisonRow && !otherColumnCell(own, next, feeName, line, documentText) ?`${own} | ${next}` : own;
}

const LEADING_PRICE = /^\s*\$\s*\d[\d,]*(?:\.\d{1,2})?\s*/;

/**
 * The price opening this table cell closes the table cell before it: the cells are split by " | "
 * and the one before names another fee with a fee noun and no price of its own ("Account research
 * and reconciliation | $40 per hour Notary | FREE"). A comma list ("Debit card only account, $10.95
 * monthly account fee") is prose, and keeps its price (#1593). Pure.
 */
function priceOfLabelBefore(line: string, before: string, cell: string, feeName: string | null | undefined): boolean {
  if (!LEADING_PRICE.test(cell) || !FEE_NOUN.test(before) || !otherFeeLabel(before, feeName, false)) return false;
  const at = line.indexOf(`${before}`);
  return at >= 0 && /^\s\|\s/.test(line.slice(at + before.length));
}

// A fee name that is one audience's or age band's own price ("Check Printing (members over 62)"):
// whether its $0 is the bank's price is a person's call, so the two-column reading never frees it.
const AUDIENCE_NAME = /\b(?:members?|non-?members?|seniors?|students?|youth|ages?|over\s+\d+|under\s+\d+|\d+\s*\+)\b/i;
// A label that names who pays rather than what is paid for ("Commercial Accounts", "Customer").
const LABEL_AUDIENCE = /\b(?:customers?|non-?customers?|commercial|business(?:es)?|consumers?|personal|retail|members?|non-?members?|seniors?|students?|youth|clients?|accounts|account\s?holders?)\b/i;
// Words left out when two labels are compared.
const OTHER_LABEL_SKIP = new Set([...GENERIC_LABEL_WORDS, "per"]);

/** A label's content words: three letters or more, generic words and "per" left out. */
function labelWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((word) => !OTHER_LABEL_SKIP.has(word));
}

/**
 * True when text is another fee's label: words of its own, no word that states a condition, no
 * price of its own and no specific word of this fee's name. `capitalised` asks for a label that
 * opens like a row's name ("Account History", "Night Depository Bags & Key"). Pure (#1593).
 */
function otherFeeLabel(text: string | undefined, feeName: string | null | undefined, capitalised = true, allowAudience = false): boolean {
  if (!text || !feeName) return false;
  const label = text.replace(/[\s.…:|*_–—-]+$/, "").trim();
  if (capitalised && !/^[A-Z]/.test(label)) return false;
  // "Safe Deposit Box", "Night Deposit" and "Personal Financial Management" name services; "deposit"
  // or "personal" alone is a condition ("with direct deposit", "personal accounts").
  const conditionText = label.replace(/\b(?:safe|night)\s+deposit\b|\bpersonal\s+financial\s+management\b/gi, " ");
  // "Commercial Accounts $0.10 per roll", "Customer $5.00": another audience's price of this same
  // fee, never another fee's row (review of #1621). Only a caller with more evidence lets it by.
  if (!allowAudience && LABEL_AUDIENCE.test(conditionText)) return false;
  if (labelWords(label).length === 0 || CONDITION_WORDS.test(conditionText) || PRICE_AT.test(label) || ZERO_PRICE.test(label)) return false;
  const stem = (word: string) => word.replace(/ies$/, "y").replace(/s$/, "").replace(/e$/, "");
  const own = new Set(labelWords(feeName).map(stem));
  return !labelWords(label).some((word) => own.has(stem(word)));
}

/**
 * The next cell is the other column of a two-column page, not this fee's price: the fee's own cell
 * already prints its $0 after its whole name, and the next cell opens with another fee's label
 * before its own price ("Bill Pay ---- No Charge | Account History ---- $3.00 each", "Foreign
 * Transaction Fees No Charge | Night Depository Bags & Key $ 30.00"). A label that states a
 * condition ("Paper statements: $5") or shares the fee's words stays this fee's terms (#1593), and
 * one with no fee noun needs the page's own evidence (`positivelyOtherFee`): "Stop Payment FREE |
 * Verbal Request $30.00" prices the same fee by channel (re-review of #1621). Pure.
 */
function otherColumnCell(own: string, next: string | undefined, feeName: string | null | undefined, line: string | null = null, documentText: string | null = null): boolean {
  if (!next || !feeName || AUDIENCE_NAME.test(feeName) || !printsOwnZero(own, feeName)) return false;
  const price = PRICE_AT.exec(next);
  if (!price) return false;
  const label = next.slice(0, price.index);
  return otherFeeLabel(label, feeName) && positivelyOtherFee(label, feeName, line, documentText);
}

/**
 * The fee's own part of one cell: its "Label: value" clause when the cell holds several labelled
 * clauses ("Monthly Service Charge: FREE Minimum Balance: $1.00"), else its own row of a run-on
 * cell (`ownRow`, #1571), else the cell.
 */
function ownPart(cell: string, feeName: string | null | undefined, tokens: string[], documentText: string | null = null): string {
  const clause = ownClause(cell, tokens);
  return clause !== cell ? clause : ownRow(cell, feeName, documentText) ?? cell;
}

/** The "Label: value" clause of a cell that names this fee, when the cell holds several. */
function ownClause(cell: string, tokens: string[]): string {
  const starts = [...cell.matchAll(CELL_LABEL)].map((match) => match.index).filter((index) => index > 0);
  if (starts.length === 0) return cell;
  const clauses = [0, ...starts].map((start, index, all) => cell.slice(start, all[index + 1]).trim()).filter((clause) => clause.length > 0);
  if (clauses.length < 2) return cell;
  const best = bestPart(clauses, tokens);
  return best < 0 ? cell : clauses[best];
}

/**
 * A $0 fee is conditional when its own part of the line (or its name) also prices it or names a
 * balance band: "Monthly Fee: $0 with $100 minimum daily balance OR $2.50/month", "Bill Pay - FREE
 * with E-Statements and Debit Card | $6.95 per Month", "Monthly fee for balance of $500 & over |
 * FREE" (the $5 row is the line below). The customer who misses the condition pays the charge, so
 * $0 is not the fee; the row is held, never verified as free (UAT, 2026-10-09: 3 of the 4 wrong
 * rows in a 20-row check of the not_in_source re-select were $0 readings of priced fees). Not
 * conditions (UAT 7/10 takedown check, 2026-10-09): a neighbour's price in the same table row,
 * comma list or dot-leader run ("Monthly Maintenance | Free | Assisted Phone Transactions* | $3");
 * the other columns of a comparison table ("Monthly fee | $0 | $5* | $0"); a non-member or
 * non-customer price ("$0 - Members $5 - Non-Members"); another label in the same cell ("Monthly
 * Service Charge: FREE Minimum Balance: $1.00 | Monthly Balance Fee: $7.50"); and the deposit that
 * opens the account ("No monthly service fee and just $1 minimum opening requirement"). Pure.
 */
export function conditionalZero(
  amount: number | null,
  line: string | null | undefined,
  feeName: string | null | undefined,
  context: { documentText?: string | null; canonicalFeeKey?: string | null } = {},
): boolean {
  if (amount !== 0) return false;
  // In a completed audience-specific elimination, the other audience's old/new
  // prices are not conditions on this consumer's $0. Exact source pairing only.
  if (scopedFeeStatements(line ?? "").some((fee) =>
    fee.amount === 0 && fee.feeTreatment === "eliminated" && fee.feeName.toLowerCase() === feeName?.toLowerCase())) return false;
  const segment = line ? ownSegment(line, feeName, context.documentText ?? null) : "";
  const text = otherWireSide(`${segment} ${feeName ?? ""}`, context.canonicalFeeKey)
    .replace(NON_CUSTOMER_PRICE, " ").replace(OPENING_DEPOSIT, " ");
  return [...text.matchAll(NONZERO_DOLLAR)].some((match) => Number(match[1].replace(/,/g, "")) > 0);
}

const MONEY = "\\$\\s*\\d[\\d,]*(?:\\.\\d{1,2})?";
const INTL_SIDE = "(?:international|foreign|intl)";
// A row labels each side either after its price ("$25.00 (International)") or before it
// ("International $25.00"); the row's own convention decides which label a price carries.
const SIDE_AFTER_PRICE = new RegExp(`${MONEY}\\s*\\(\\s*(?:domestic|${INTL_SIDE})\\b`, "i");
const sidePrice = (side: string, after: boolean) =>
  new RegExp(after ? `${MONEY}\\s*\\(\\s*${side}\\b` : `\\b${side}\\b\\)?\\s*[:\\u2013-]?\\s*${MONEY}`, "gi");

/**
 * #1593: a wire row that prices both sides ("Wire Transfers: Incoming | No Charge(Domestic) $25.00
 * (International)") gives a domestic wire fee the international price as another fee's, not as a
 * condition on its $0, and the other way round. Only when the row names the fee's own side. Pure.
 */
function otherWireSide(text: string, canonicalFeeKey: string | null | undefined): string {
  const after = SIDE_AFTER_PRICE.test(text);
  if (canonicalFeeKey?.startsWith("wire_domestic_") && /\bdomestic\b/i.test(text)) return text.replace(sidePrice(INTL_SIDE, after), " ");
  if (canonicalFeeKey?.startsWith("wire_intl_") && new RegExp(`\\b${INTL_SIDE}\\b`, "i").test(text)) return text.replace(sidePrice("domestic", after), " ");
  return text;
}

/**
 * Category lessons Darwin knows before the shared guard does. The guard
 * (`src/lib/fee-category-guard.ts`, Accuracy's) is the one place a name is matched to a
 * category, so Darwin never re-files a row itself: a row whose filed category matches a
 * lesson here is held as `category_lesson_pending` (needs_review, no verified row, so Hamilton
 * cannot publish it) and comes back for one more read when `CATEGORY_GUARD_VERSION` rises,
 * the same path a `category_mismatch` takes. Once the guard carries the lesson its re-file rule
 * moves the row and the hold no longer matches; drop the entry here in the same change.
 * 2026-10-09: "Bond return items" $35 (raw 246460) filed `nsf` passed the v57 guard; a returned
 * bond or coupon is a returned deposited item (RDI), not a customer NSF.
 */
export const DARWIN_CATEGORY_HOLDS: ReadonlyArray<{
  filedAs: string;
  shouldBe: string;
  when: RegExp;
  since: string;
}> = [
  // The bond-return hold (2026-10-09) ended with guard v58, which re-files those rows.
];

/** The pending category lesson that holds this row, if any. */
export function pendingCategoryLesson(canonicalFeeKey: string | null, feeName: string | null | undefined) {
  if (!canonicalFeeKey || !feeName) return null;
  return DARWIN_CATEGORY_HOLDS.find((hold) => hold.filedAs === canonicalFeeKey && hold.when.test(feeName)) ?? null;
}

function decisionFor(code: DarwinReasonCode | null): DarwinDecision {
  if (code == null) return "verified";
  if (code === "outside_envelope" || code === "peer_outlier" || code === "category_lesson_pending" || code === "conditional_zero" || code === "insert_failed") return "needs_review";
  if (code === "duplicate_in_batch" || code === "duplicate_verified") return "duplicate";
  return "rejected";
}

export interface RawFeeRow extends RateFields {
  product_name?: string | null;
  fee_audience?: FeeAudience;
  fee_raw_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  document_r2_key: string | null;
  extraction_confidence: number | string | null;
  fee_name: string;
  amount: number | string | null;
  frequency: string | null;
  outlier_flags: unknown;
  conditions: string | null;
  institution_name?: string | null;
  source_document_id?: number | string | null;
  /** The source document's own URL, the link publish falls back to (#1350). */
  document_url?: string | null;
  state_code?: string | null;
  asset_size_tier?: string | null;
  asset_size?: number | string | null;
}

export interface DarwinVerificationResult {
  feeRawId: number;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  status: "verified" | "skipped";
  decision: DarwinDecision;
  reasonCode: DarwinReasonCode | null;
  reason: string | null;
  feeVerifiedId: number | null;
  /** Pass 2 peer check; null when the state has too few peers for this fee. */
  peerCheck?: PeerCheckResult | null;
  /** Pass 2 second-source check; null when no other stored document has this fee. */
  secondSource?: SecondSourceResult | null;
  /** Layer 2 learned category check, in shadow: recorded, never decides. Null without a model. */
  categoryModel?: CategoryOpinion | null;
}

export interface RunDarwinVerifyOptions {
  runId: number;
  stepId?: number;
  limit?: number;
  institutionId?: number;
  stateCode?: string;
  dryRun?: boolean;
  db?: SqlTag;
}

export interface RunDarwinVerifyResult {
  selectedRawFees: number;
  processedRawFees: number;
  /** Transient source/raw contention or changed admission: no ordinary decision is recorded. */
  deferredRawFees?: number;
  deferrals?: Array<{ feeRawId: number; reason: string }>;
  verifiedFees: number;
  skippedFees: number;
  limit: number;
  dryRun: boolean;
  learning: boolean;
  outcomes: Partial<Record<AttemptOutcome, number>>;
  /** Skipped rows by reason code. */
  reasonCounts: Partial<Record<DarwinReasonCode, number>>;
  recheck: VerifiedRecheckResult | null;
  /** Whose schedule each shared document is, by its own text (#1455); shadow until switched on. */
  documentOwner: DocumentOwnerResult | null;
  /** #1295: rows whose Knox category changed since Darwin's decision; null without the learning log. */
  categoryChange: CategoryChangeRejudgeSummary | null;
  /** Verified rows that are explicit $0 (free) fees. */
  zeroFeesVerified: number;
  /** Pass 2: rows held for review as far outside their state peers. */
  peerOutliers: number;
  /** Pass 2: rows compared with their Fed district or national peers (state had too few). */
  peerFallbackChecks: number;
  /** Pass 2: fallback comparisons far outside the district or national range (recorded, not held). */
  peerFallbackOutliers: number;
  /** Rows held because the amount is above a learned (not hand-set) category range. */
  learnedEnvelopeHolds: number;
  /** Pass 2: rows whose amount another stored document of the same bank confirms. */
  secondSourceAgreements: number;
  /** Pass 2: rows another stored document of the same bank shows at a different amount. */
  secondSourceDisagreements: number;
  /** Layer 2 (shadow): rows whose category the learned model disputes. */
  categoryModelDisputes: number;
  /** Judgements written to `pipeline_feedback`; null when skipped (dry run, no store yet, or a write error). */
  feedbackWritten: number | null;
  results: DarwinVerificationResult[];
}

/** The attempt-log fingerprint for one raw row. */
export function rawFeeFingerprint(feeRawId: number | string): string {
  return `raw:${feeRawId}`;
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DARWIN_VERIFY_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), DARWIN_VERIFY_MAX_LIMIT);
}

function parseFlags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseFlags(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

/** Knox's category for the row: its first `canonical_hint:` flag, else `canonical_hint=` in conditions. */
export function canonicalHintFrom(row: Pick<RawFeeRow, "outlier_flags" | "conditions">): string | null {
  const fromFlag = parseFlags(row.outlier_flags)
    .find((flag) => flag.startsWith("canonical_hint:"))
    ?.slice("canonical_hint:".length)
    .trim();
  const hint = fromFlag || row.conditions?.match(/canonical_hint=([a-z0-9_]+)/i)?.[1] || null;
  if (!hint) return null;
  return VALID_CANONICAL_KEYS.has(hint) ? hint : null;
}

/** Existing refile behavior, shared with prospective checks on the actual current raw row. */
export function resolvedRawCategory(row: RawFeeRow): string | null {
  return refileFromLine(canonicalHintFrom(row), row.fee_name, row) ?? refileCategory(canonicalHintFrom(row), row.fee_name);
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function normalizedAmount(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

const NO_LEARNED_ENVELOPES: ReadonlyMap<string, LearnedEnvelope> = new Map();

/** The first rule a row fails, or null when it can be verified. Exported for tests. */
export function verificationReasonCode(
  row: RawFeeRow,
  canonicalFeeKey: string | null,
  learnedEnvelopes: ReadonlyMap<string, LearnedEnvelope> = NO_LEARNED_ENVELOPES,
): DarwinReasonCode | null {
  if (!canonicalFeeKey) return "missing_canonical";
  if (!row.fee_name?.trim()) return "missing_name";
  if (!checkFeeCategory(canonicalFeeKey, row.fee_name, row).ok) return "category_mismatch";
  // #1350: Hamilton's publish rule (#1345, `sourceLinkSkipReason`): a source document and an
  // http(s) link, the row's own or its document's. A stored file key alone is no lineage, so a row
  // Hamilton would refuse forever is held here instead of verified.
  if (sourceLinkSkipReason(row)) return "missing_lineage";
  if (isPercentFee(row)) {
    if (!percentFeeAllowed(canonicalFeeKey)) return "percent_not_publishable";
    const rate = ratePercentOf(row);
    if (rate == null || row.amount != null) return "invalid_amount";
    const range = PERCENT_FEE_RANGES[canonicalFeeKey];
    return rate < range.min || rate > range.max ? "outside_envelope" : null;
  }
  const amount = normalizedAmount(row.amount);
  if (amount == null || amount < 0) return "invalid_amount";
  if (amount === 0) {
    return isExplicitZeroFee(amount, parseFlags(row.outlier_flags), ZERO_FEE_RAW_FLAG) ? null : "invalid_amount";
  }
  const envelope = darwinEnvelopeFor(canonicalFeeKey, learnedEnvelopes);
  if (amount < envelope.min || amount > envelope.max) return "outside_envelope";
  return null;
}

/** The reason text recorded for a code; a lineage hold carries Hamilton's own publish refusal (#1350). */
export function verificationReasonText(
  row: Pick<RawFeeRow, "source_url" | "document_url" | "source_document_id"> & Partial<RawFeeRow>,
  code: DarwinReasonCode,
): string {
  return (code === "missing_lineage" ? sourceLinkSkipReason(row) : null) ?? DARWIN_REASON_TEXT[code];
}

/** New v1 ownership must be witnessed again; a generic neighbouring price is insufficient. */
function ownedSourceText(row: Partial<Pick<RawFeeRow, "product_name" | "outlier_flags">>, text: string): string | null {
  if (!parseFlags(row.outlier_flags).includes(ANCILLARY_PRODUCT_FLAG)) return text;
  const owner = primaryAncillaryProduct(text);
  return owner && productKey(row.product_name) && sameProduct(row.product_name, owner.productName) ? owner.block : null;
}

/**
 * Is the fee stated in the stored text of the document Knox read it from? The shared
 * accuracy check (`checkFeeAgainstSource`), with Hamilton's reading: a tiered price is the
 * bank's real price for its band. A row with no stored text cannot be traced. Exported for tests.
 */
export function statedInOwnSource(
  row: Pick<RawFeeRow, "fee_name" | "amount" | "source_document_id" | "amount_kind" | "rate_percent"> & Partial<Pick<RawFeeRow,"product_name" | "outlier_flags">>,
  texts: ReadonlyMap<number, string>,
  canonicalFeeKey?: string | null,
): boolean {
  if (isPercentFee(row)) {
    const rate = ratePercentOf(row);
    const text = row.source_document_id == null ? undefined : texts.get(Number(row.source_document_id));
    return rate != null && !!text && checkRateAgainstSource(text, row.fee_name, rate, ".").ok;
  }
  const amount = normalizedAmount(row.amount);
  if (amount == null || row.source_document_id == null) return false;
  const stored = texts.get(Number(row.source_document_id));
  const text = stored ? ownedSourceText(row, stored) : null;
  if (!text) return false;
  const result = checkFeeAgainstSource(text, row.fee_name, amount, ".", canonicalFeeKey);
  return result.ok || result.reason === "tiered_fee";
}

/** The schedule line the shared source check traced the fee to, or null when it did not. */
export function sourceLineFor(
  row: Pick<RawFeeRow, "fee_name" | "amount" | "source_document_id" | "amount_kind" | "rate_percent"> & Partial<Pick<RawFeeRow,"product_name" | "outlier_flags">>,
  texts: ReadonlyMap<number, string>,
  canonicalFeeKey?: string | null,
): string | null {
  if (isPercentFee(row)) return null;
  const amount = normalizedAmount(row.amount);
  if (amount == null || row.source_document_id == null) return null;
  const stored = texts.get(Number(row.source_document_id));
  const text = stored ? ownedSourceText(row, stored) : null;
  if (!text) return null;
  const result = checkFeeAgainstSource(text, row.fee_name, amount, ".", canonicalFeeKey);
  if (!result.ok) return null;
  // #1593: a $0 traced to a line that does not print it ("If an individual overdraft payment is
  // $20 or less any overdraft fees are waived" for "Overdraft Transfer Fee | $0"; a long line cut
  // off before "Mobile Deposit FREE") is read on the line that prints its whole name with its $0.
  // Only when the traced line lacks a word of the fee's own name: a line that carries them all keeps
  // its own terms ("Monthly Service Charge 0.00 for 1st account 2nd account $5.00").
  if (amount !== 0 || !missesOwnWord(result.sourceLine, row.fee_name)) return result.sourceLine;
  return ownZeroLine(text, row.fee_name, canonicalFeeKey) ?? result.sourceLine;
}

/** The line lacks a word of the fee's name other than the generic ones ("fee", "service", "charge"). */
function missesOwnWord(line: string, feeName: string | null | undefined): boolean {
  const present = new Set(words(line).map((entry) => entry.word));
  return words(feeName ?? "").some((entry) => !GENERIC_NAME_WORDS.has(entry.word) && !present.has(entry.word));
}

// What may sit between a fee's name and its price on its own row: leaders, a colon, a cell break.
const NAME_TO_PRICE = /^[\s.…:|*_–—)-]*$/;

/** The line prints the fee's whole name (two words or more) with a $0 straight after it. Pure. */
function printsOwnZero(line: string, feeName: string | null | undefined): boolean {
  if (!feeName) return false;
  const length = words(feeName).length;
  if (length < 2) return false;
  const run = nameRun(line, feeName);
  if (!run || run.length < length) return false;
  const zero = ZERO_PRICE.exec(line.slice(run.end));
  return zero != null && NAME_TO_PRICE.test(line.slice(run.end, run.end + zero.index));
}

/**
 * The first line of the document that prints the fee's whole name with its $0 straight after it
 * and that the shared source check traces on its own, or null (#1593). A long run-on line is read
 * from the fee's name on, as far as the shared check's own trace length, so the name is never cut
 * off. Pure.
 */
function ownZeroLine(text: string, feeName: string, canonicalFeeKey?: string | null): string | null {
  for (const line of sourceLines(text)) {
    if (!printsOwnZero(line, feeName) || !checkFeeAgainstSource(line, feeName, 0, ".", canonicalFeeKey).ok) continue;
    const start = nameRun(line, feeName)?.start ?? 0;
    // A $0 that is one audience's price ("Monthly Maintenance Service Charge | $0 for students ages
    // 15-25") is not read in place of the traced line.
    if (AUDIENCE_NAME.test((rowTail(line, feeName) ?? "").slice(0, 60))) continue;
    return line.length <= TRACED_LINE_LENGTH ? line : line.slice(start, start + TRACED_LINE_LENGTH);
  }
  return null;
}
// The shared source check's traced line is at most this long.
const TRACED_LINE_LENGTH = 240;

/**
 * The checks a verified row must still pass after the shared source check has traced it:
 * a live category, not a conditional $0, and none of the name rules Hamilton takes a live fee
 * down for (`ruleFor`), applied before the row is verified instead of after it is published.
 * `line` is the traced schedule line, else Knox's excerpt. Pure.
 */
export function postSourceCheck(
  canonicalFeeKey: string,
  feeName: string,
  amount: number | null,
  line: string | null,
  documentText: string | null = null,
): { code: "retired_category" | "conditional_zero" | "name_rule"; rule?: string } | null {
  if (canonicalFeeKey in RETIRED_CATEGORIES) return { code: "retired_category" };
  if (conditionalZero(amount, line, feeName, { documentText, canonicalFeeKey })) return { code: "conditional_zero" };
  const rule = ruleFor(canonicalFeeKey, feeName, amount, line);
  return rule ? { code: "name_rule", rule } : null;
}

/** The newest completed text of each document, as Hamilton's source check reads it. */
export async function loadSourceTexts(db: SqlTag, documentIds: number[]): Promise<Map<number, string>> {
  if (documentIds.length === 0) return new Map();
  const texts = await db<{ source_document_id: number | string; normalized_text: string }[]>`
    SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
      FROM agent_source_texts
     WHERE source_document_id = ANY(${documentIds}::bigint[])
       AND status = 'completed'
       AND normalized_text IS NOT NULL
     ORDER BY source_document_id, id DESC
  `;
  return new Map(texts.map((text) => [Number(text.source_document_id), text.normalized_text]));
}

/**
 * Version of the in-batch duplicate key, recorded on each attempt. Version 1 keyed on the
 * source URL, so a fee on a bank's current copy of a page was held as a duplicate of the
 * same fee on an older copy at that URL, and only the older copy was ever verified.
 * Version 2 keys on the stored document. Version 3 adds the fee's own source line, so two
 * products' fees with one price on one document ("Money Market Savings Account (below $2,500) |
 * $15/mo." and "Interest Checking (below $1,500) | $15/mo.", SCCU 8109) are two fees, while the
 * same line read twice (two Knox runs of one document) is still one.
 */
export const DARWIN_BATCH_KEY_VERSION = 4;

/** The source line Knox read, spacing folded; empty when the row has none. */
function sourceLineKey(conditions: string | null): string {
  return (excerptOf(conditions) ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Same institution, category, amount, frequency, document and source line: the same fee line. */
function batchKey(row: RawFeeRow, canonicalFeeKey: string): string {
  return [
    Number(row.institution_id),
    canonicalFeeKey,
    normalizedAmount(row.amount),
    isPercentFee(row) ? `rate:${ratePercentOf(row)}` : "",
    (row.frequency ?? "").trim().toLowerCase(),
    row.source_document_id != null
      ? `doc:${Number(row.source_document_id)}`
      : (row.source_url ?? row.document_r2_key ?? "").trim(),
    sourceLineKey(row.conditions),
    row.fee_audience ?? "unknown",
    productKey(row.product_name),
  ].join("|");
}

/** A SQL string literal; the inputs are this file's own constants, never user text. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * SQL (raw row alias `fr`): a `verify.rules` decision under today's rule version still stands
 * for this row. The selection, the state-lane scheduler and the daily health check all read
 * this one test (#1052), so a row the verify step would select again always wakes a lane and
 * always counts as waiting. Before, the scheduler and health counted only rows with no decision
 * at all: a row due again after a guard bump in a state with nothing else to do (26 rows in
 * Puerto Rico and Guam on 2026-10-14, the oldest due since Oct 9) waited for a lane that never
 * came, and the backlog read 0.
 *
 * The constants are inlined so callers using either query form can embed it.
 */
export function darwinStandingDecisionSql(currentCopy = true): string {
  const envelopes = `${sqlLiteral(JSON.stringify(CATEGORY_AMOUNT_ENVELOPES))}::jsonb`;
  // A row held as an in-batch duplicate under an older key is re-checked once when it sits
  // on the bank's current copy and nothing on that same document is verified as the same fee
  // from the same source line (v3); a row with a verified twin on its own line stays a
  // duplicate. Needs the current-copy column (source_documents.superseded_by_id).
  const duplicateRecheck = currentCopy ? `
              AND NOT (
                pa.detail->>'reason_code' = 'duplicate_in_batch'
                AND COALESCE((pa.detail->>'batch_key_version')::int, 1) < ${DARWIN_BATCH_KEY_VERSION}
                AND EXISTS (
                  SELECT 1 FROM source_documents sd
                   WHERE sd.id = fr.source_document_id AND sd.superseded_by_id IS NULL
                )
                AND NOT EXISTS (
                  SELECT 1
                    FROM verified_fee_observations twin
                    JOIN raw_fee_observations twin_raw ON twin_raw.fee_raw_id = twin.fee_raw_id
                   WHERE twin_raw.source_document_id = fr.source_document_id
                     AND twin.canonical_fee_key = pa.detail->>'canonical_fee_key'
                     AND twin.amount IS NOT DISTINCT FROM fr.amount
                     AND lower(regexp_replace(COALESCE(substring(COALESCE(twin_raw.extraction_note, twin_raw.conditions) from 'excerpt="?(.*?)"?$'), ''), '\\s+', ' ', 'g'))
                         = lower(regexp_replace(COALESCE(substring(COALESCE(fr.extraction_note, fr.conditions) from 'excerpt="?(.*?)"?$'), ''), '\\s+', ' ', 'g'))
                )
              )` : "";
  // A row this rule version already decided is never selected again, so rejected rows cannot
  // starve the batch. The exceptions are re-read once each:
  // - a category rejection under an older guard version (CATEGORY_GUARD_VERSION), so a real fee
  //   a rule wrongly rejected, or one a new re-file rule now places, is not lost; a row held for
  //   a category lesson the guard has not learned yet (DARWIN_CATEGORY_HOLDS) takes the same path;
  // - a `not_in_source` rejection under an older source-check version (DARWIN_SOURCE_CHECK_VERSION),
  //   so a fix to the shared source check reaches the rows it was made for;
  // - a hold outside a hand-set amount envelope that today's envelope takes (the account_research
  //   floor went from $5 to $1 on 2026-10-09); learned envelopes move with the data and never re-select.
  // - a peer hold under an older peer version (v5, #1112). Attempts record `peer_version` from v5
  //   on; an older hold is re-decided only when its own run's peer attempt was a graded version
  //   (DARWIN_PEER_GRADED_VERSIONS: v3 and v4, Oct 10 on) and held it, so the ungraded v1/v2 holds
  //   of Oct 5–10 stay held.
  return `EXISTS (
           SELECT 1
             FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
              AND pa.strategy = ${sqlLiteral(DARWIN_VERIFY_STRATEGY.strategy)}
              AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
              AND NOT (
                pa.detail->>'reason_code' IN ('category_mismatch', 'category_lesson_pending')
                AND COALESCE((pa.detail->>'category_guard_version')::int, 0) < ${CATEGORY_GUARD_VERSION}
              )
              AND NOT (
                pa.detail->>'reason_code' = 'not_in_source'
                AND COALESCE((pa.detail->>'source_check_version')::int, 0) < ${DARWIN_SOURCE_CHECK_VERSION}
              )
              AND NOT (
                pa.detail->>'reason_code' = 'peer_outlier'
                AND (
                  (pa.detail->>'peer_version' IS NOT NULL
                   AND (pa.detail->>'peer_version')::int < ${DARWIN_PEER_STRATEGY.version})
                  OR (pa.detail->>'peer_version' IS NULL
                      AND EXISTS (
                        SELECT 1
                          FROM pipeline_attempts peer
                         WHERE peer.input_fingerprint = pa.input_fingerprint
                           AND peer.strategy = ${sqlLiteral(DARWIN_PEER_STRATEGY.strategy)}
                           AND peer.strategy_version IN (${DARWIN_PEER_GRADED_VERSIONS.join(", ")})
                           AND peer.agent_run_id = pa.agent_run_id
                           AND (peer.detail->>'peer_held')::boolean
                      ))
                )
              )
              AND NOT (
                pa.detail->>'reason_code' = 'outside_envelope'
                AND ${envelopes} ? (pa.detail->>'canonical_fee_key')
                AND (pa.detail->>'amount')::numeric
                    BETWEEN (${envelopes}->(pa.detail->>'canonical_fee_key')->>'min')::numeric
                        AND (${envelopes}->(pa.detail->>'canonical_fee_key')->>'max')::numeric
              )
${duplicateRecheck}
         )`;
}

/**
 * SQL (raw row alias `fr`): a Knox row Darwin's verify step would select now, either never
 * decided or due again under today's rules. Rows the audience trigger refuses are left out,
 * as the selection leaves them out (#1113).
 */
export function darwinDueSql(currentCopy = true): string {
  return `fr.source = 'knox'
         AND fr.outlier_flags ? 'needs_darwin_verification'
         AND NOT (fr.outlier_flags ? 'audience_correction_required')
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
         AND NOT ${darwinStandingDecisionSql(currentCopy)}`;
}

async function selectRawFees(
  db: SqlTag,
  limit: number,
  learning: boolean,
  institutionId?: number,
  stateCode?: string,
  currentCopy = false,
  /** Only these rows, with no decision filter: Knox changed their category (#1295). */
  onlyIds?: readonly number[],
): Promise<RawFeeRow[]> {
  const params: Array<number | string | number[]> = [limit];
  const filters: string[] = [];
  if (onlyIds) {
    params.push([...onlyIds]);
    filters.push(`AND fr.fee_raw_id = ANY($${params.length}::bigint[])`);
  }
  if (institutionId) {
    params.push(institutionId);
    filters.push(`AND fr.institution_id = $${params.length}`);
  }
  const normalizedState = normalizeStateCode(stateCode);
  if (normalizedState) {
    params.push(normalizedState);
    filters.push(`AND upper(btrim(inst.state_code)) = $${params.length}`);
  }
  if (learning && !onlyIds) filters.push(`AND NOT ${darwinStandingDecisionSql(currentCopy)}`);
  return db.unsafe<RawFeeRow[]>(
    `
      WITH eligible AS (
      SELECT fr.fee_raw_id,
             fr.institution_id,
             fr.source_url,
             fr.document_r2_key,
             fr.extraction_confidence,
             fr.fee_name,
             fr.amount,
             fr.frequency,
             fr.outlier_flags,
             COALESCE(fr.extraction_note, fr.conditions) AS conditions,
             fr.fee_audience,
             fr.product_name,
             fr.amount_kind,
             fr.rate_percent,
             fr.rate_min_amount,
             fr.rate_max_amount,
             fr.rate_basis,
             inst.institution_name,
             fr.source_document_id,
             (SELECT sd.document_url FROM source_documents sd WHERE sd.id = fr.source_document_id) AS document_url,
             upper(btrim(inst.state_code)) AS state_code,
             inst.asset_size_tier,
             inst.asset_size,
             COALESCE(fr.source_document_id::text, 'row:' || fr.fee_raw_id::text) AS batch_document_key,
             fr.created_at AS batch_created_at
        FROM raw_fee_observations fr
        JOIN institution_sources inst ON inst.id = fr.institution_id
       WHERE fr.source = 'knox'
         AND fr.outlier_flags ? 'needs_darwin_verification'
         -- The audience trigger refuses these rows; selecting one would fail the step (#1113).
         AND NOT (fr.outlier_flags ? 'audience_correction_required')
         ${filters.join("\n         ")}
         AND NOT EXISTS (
           SELECT 1
             FROM verified_fee_observations fv
            WHERE fv.fee_raw_id = fr.fee_raw_id
         )
      )
      ${WHOLE_DOCUMENT_BATCH}
       ORDER BY eligible.batch_created_at ASC, eligible.fee_raw_id ASC
    `,
    params,
  );
}

/** Caller must hold the run-ledger transaction: the raw product lock spans this insert.
 * inSavepoint alone does not start a transaction; standalone autocommit is not supported here.
 */
export interface InsertVerifiedFeeOptions {
  runId: number;
  row: RawFeeRow;
  canonicalFeeKey: string;
  secondSourceAgrees?: boolean;
  extraFlags?: string[];
  /** The document's newest text, for Darwin's audience decision (#1059). */
  sourceText?: string | null;
  /** A decision already made for this row; null means none (the raw row's audience stands). */
  audience?: DarwinAudience | null;
  /** A completed caller admission on current facts, never model/caller authority. */
  audienceAdmission?: VerificationAudienceAdmission;
}

export async function insertVerifiedFee(db: SqlTag, options: InsertVerifiedFeeOptions): Promise<number | null> {
  return inSavepoint(db, scope => insertCurrentVerifiedFee(scope, options));
}

async function insertCurrentVerifiedFee(db: SqlTag, options: InsertVerifiedFeeOptions): Promise<number | null> {
  const admitted = options.audienceAdmission;
  const current = await prepareVerificationAudience(db, admitted?.row ?? options.row, options.sourceText);
  requireSameAudienceAdmission(current, admitted, options.canonicalFeeKey);
  const effectiveAudience = current.audience?.feeAudience ?? current.row.fee_audience ?? "unknown";
  if (admitted && (options.row.fee_audience ?? "unknown") !== effectiveAudience) {
    throw new VerificationAudienceDeferred("admitted_audience_changed");
  }
  // A derived audience must not masquerade as the original raw label in the CAS.
  const callerRaw = admitted ? { ...options.row, fee_audience: admitted.row.fee_audience, frequency: admitted.row.frequency } : options.row;
  if (admitted && options.row.frequency !== admitted.writeFrequency) throw new VerificationAudienceDeferred("admitted_frequency_changed");
  if (!admittedRawMatches(callerRaw, current.row)) throw new VerificationAudienceDeferred("admitted_raw_changed");
  requireInternationalVerification(current, options.canonicalFeeKey, resolvedRawCategory(current.row));
  const row = admitted ? { ...current.row, frequency: admitted.writeFrequency ?? current.row.frequency } : current.row;
  const feeRawId = Number(row.fee_raw_id);
  const institutionId = Number(row.institution_id);
  const percent = isPercentFee(row);
  const amount = percent ? null : normalizedAmount(row.amount);
  const eventId = stableUuid(`darwin:${options.runId}:${feeRawId}:${options.canonicalFeeKey}`);
  const flags = ["agentic_darwin_verified"];
  if (amount === 0) flags.push(ZERO_FEE_VERIFIED_FLAG);
  if (options.secondSourceAgrees) flags.push(SECOND_SOURCE_FLAG);
  if (options.extraFlags) flags.push(...options.extraFlags);
  const stated = row.frequency ?? null;
  const line = excerptOf(row.conditions);
  // #1456: Darwin keeps an hourly frequency Knox stated but does not read one itself; live fees
  // become hourly through the switched live re-check (hourly-frequency-check.ts).
  const settled = amount == null ? stated : settledFrequency(line, amount, stated, options.canonicalFeeKey, { hourly: false });
  // #1196: an NSF fee is charged per item; a period on one is a misread, so it is never verified.
  const frequency = perEventFrequency(options.canonicalFeeKey, settled, line, amount);
  if (frequency !== stated) flags.push(FREQUENCY_SETTLED_FLAG);
  // With no decision the trigger copies the raw row's audience, as before.
  const audience = current.audience;
  // Every caller locks current raw state, including legacy rows with no represented product.
  {
    const current = await db`
      SELECT fr.fee_raw_id FROM raw_fee_observations fr WHERE fr.fee_raw_id = ${feeRawId}
        AND (${row.product_name === undefined} OR
          ${db.unsafe(productKeySql("fr.product_name"))} = ${productKey(row.product_name)})
        -- The current raw proof owns this decision, including a stale different category.
        -- Do not require a needs flag: legitimate historical rejudges may lack it.
        AND NOT (COALESCE(fr.outlier_flags, '[]'::jsonb) ? 'knox_review:eligibility'
          AND (COALESCE(fr.outlier_flags, '[]'::jsonb) ? 'canonical_hint:monthly_maintenance'
            OR COALESCE(fr.outlier_flags, '[]'::jsonb) ? ${CAP_FIRST_ELIGIBILITY_FLAG}
            OR COALESCE(fr.outlier_flags, '[]'::jsonb) ? ${SYMBOLIC_LESSER_ELIGIBILITY_FLAG}))
      FOR UPDATE OF fr`;
    if (current.length === 0) return null;
  }
  const inserted = await db`
    INSERT INTO verified_fee_observations (
      fee_raw_id,
      institution_id,
      source_url,
      document_r2_key,
      extraction_confidence,
      canonical_fee_key,
      variant_type,
      outlier_flags,
      verified_by_agent_event_id,
      fee_name,
      amount,
      frequency,
      review_status,
      amount_kind,
      rate_percent,
      rate_min_amount,
      rate_max_amount,
      rate_basis,
      fee_audience,
      audience_evidence
    )
    VALUES (
      ${feeRawId},
      ${institutionId},
      ${row.source_url},
      ${row.document_r2_key},
      ${row.extraction_confidence},
      ${options.canonicalFeeKey},
      ${null},
      ${JSON.stringify(flags)}::jsonb,
      ${eventId}::uuid,
      ${row.fee_name},
      ${amount},
      ${frequency},
      'verified',
      ${percent ? "percent" : "flat"},
      ${percent ? ratePercentOf(row) : null},
      ${percent ? row.rate_min_amount ?? null : null},
      ${percent ? row.rate_max_amount ?? null : null},
      ${percent ? row.rate_basis ?? null : null},
      ${audience?.feeAudience ?? "unknown"},
      ${audience?.audienceEvidence ?? null}
    )
    ON CONFLICT DO NOTHING
    RETURNING fee_verified_id
  `;
  return inserted[0]?.fee_verified_id == null ? null : Number(inserted[0].fee_verified_id);
}

function institutionLabel(row: Pick<RawFeeRow, "institution_id" | "institution_name">): string {
  return row.institution_name?.trim() || `Institution ${row.institution_id}`;
}

function rowCountLabel(count: number): string {
  return `${count} fee row${count === 1 ? "" : "s"}`;
}

async function recordVerificationSignals(
  db: SqlTag,
  runId: number,
  results: DarwinVerificationResult[],
  rowByRawFeeId: Map<number, RawFeeRow>,
  learnedEnvelopes: ReadonlyMap<string, LearnedEnvelope>,
): Promise<void> {
  const grouped = new Map<number, {
    institutionName: string;
    feeRawIds: number[];
    feeVerifiedIds: number[];
    canonicalFeeKeys: string[];
  }>();
  const reviewGrouped = new Map<number, {
    institutionName: string;
    feeRawIds: number[];
    canonicalFeeKeys: string[];
    reasons: Map<DarwinReasonCode, number>;
    envelopes: Record<string, { min: number; max: number; source: string }>;
    peerOutliers: Array<Record<string, string | number | boolean | null>>;
  }>();

  results.forEach((result) => {
    const row = rowByRawFeeId.get(result.feeRawId);
    const institutionId = result.institutionId;
    if (result.status === "skipped") {
      const group = reviewGrouped.get(institutionId) ?? {
        institutionName: row ? institutionLabel(row) : `Institution ${institutionId}`,
        feeRawIds: [],
        canonicalFeeKeys: [],
        reasons: new Map<DarwinReasonCode, number>(),
        envelopes: {},
        peerOutliers: [],
      };
      group.feeRawIds.push(result.feeRawId);
      if (result.canonicalFeeKey) group.canonicalFeeKeys.push(result.canonicalFeeKey);
      const code = result.reasonCode ?? "invalid_amount";
      group.reasons.set(code, (group.reasons.get(code) ?? 0) + 1);
      if (code === "outside_envelope" && result.canonicalFeeKey) {
        group.envelopes[result.canonicalFeeKey] = darwinEnvelopeFor(result.canonicalFeeKey, learnedEnvelopes);
      }
      if (code === "peer_outlier" && result.peerCheck) {
        group.peerOutliers.push({
          fee_raw_id: result.feeRawId,
          canonical_fee_key: result.canonicalFeeKey,
          amount: result.amount,
          peer_low: result.peerCheck.low,
          peer_high: result.peerCheck.high,
          peer_median: result.peerCheck.median,
          peer_count: result.peerCheck.peerCount,
          peer_tier: result.peerCheck.levelTier,
          reason: result.reason,
          second_source: result.secondSource?.verdict ?? null,
        });
      }
      reviewGrouped.set(institutionId, group);
      return;
    }

    if (result.status !== "verified" || !result.feeVerifiedId) return;
    const group = grouped.get(institutionId) ?? {
      institutionName: row ? institutionLabel(row) : `Institution ${institutionId}`,
      feeRawIds: [],
      feeVerifiedIds: [],
      canonicalFeeKeys: [],
    };
    group.feeRawIds.push(result.feeRawId);
    group.feeVerifiedIds.push(result.feeVerifiedId);
    if (result.canonicalFeeKey) group.canonicalFeeKeys.push(result.canonicalFeeKey);
    grouped.set(institutionId, group);
  });

  for (const [institutionId, group] of grouped) {
    const count = group.feeVerifiedIds.length;
    await inSavepoint(db, (scope) => recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "darwin_verification_completed",
        severity: "medium",
        title: `${group.institutionName} - ${rowCountLabel(count)} verified`,
        body:
          `Darwin verified ${rowCountLabel(count)} from source-grounded Knox observations. ` +
          "These rows are ready for Hamilton publication review before verified benchmark scoring changes.",
        sourceJson: {
          source: "darwin_verification",
          run_id: runId,
          pipeline_stage: "verified_unpublished",
          verified_fee_ids: group.feeVerifiedIds,
          raw_fee_ids: group.feeRawIds,
          canonical_fee_keys: Array.from(new Set(group.canonicalFeeKeys)),
          verified_fee_count: count,
          provider_call_queued: false,
        },
      },
      scope,
    )).catch((error) => {
      console.error("recordDarwinVerificationSignal failed:", error);
    });
  }

  for (const [institutionId, group] of reviewGrouped) {
    const count = group.feeRawIds.length;
    await inSavepoint(db, (scope) => recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "darwin_verification_needs_review",
        severity: "medium",
        title: `${group.institutionName} - ${rowCountLabel(count)} needs verification review`,
        body:
          `Darwin skipped ${rowCountLabel(count)} during deterministic verification. ` +
          "Review canonical hints, amounts, and source lineage before publishing or using these rows in benchmark scoring.",
        sourceJson: {
          source: "darwin_verification",
          run_id: runId,
          pipeline_stage: "verification_needs_review",
          raw_fee_ids: group.feeRawIds,
          canonical_fee_keys: Array.from(new Set(group.canonicalFeeKeys)),
          reason_counts: Object.fromEntries(group.reasons),
          reason_text: Object.fromEntries(
            Array.from(group.reasons.keys()).map((code) => [code, DARWIN_REASON_TEXT[code]]),
          ),
          ...(Object.keys(group.envelopes).length > 0 ? { amount_envelopes: group.envelopes } : {}),
          ...(group.peerOutliers.length > 0 ? { peer_outliers: group.peerOutliers } : {}),
          skipped_fee_count: count,
          provider_call_queued: false,
        },
      },
      scope,
    )).catch((error) => {
      console.error("recordDarwinVerificationReviewSignal failed:", error);
    });
  }
}

function attemptOutcome(result: DarwinVerificationResult): AttemptOutcome {
  if (result.decision === "verified") return "ok";
  return result.decision === "duplicate" ? "unchanged" : "rejected";
}

/** One attempt per pass 2 check that had evidence to work with, each its own strategy. */
async function recordPassTwoAttempts(
  db: SqlTag,
  options: RunDarwinVerifyOptions,
  result: DarwinVerificationResult,
): Promise<void> {
  const common = {
    institutionId: result.institutionId,
    stage: "verify" as const,
    fingerprint: rawFeeFingerprint(result.feeRawId),
    costMicrousd: 0,
    runId: options.runId,
    stepId: options.stepId ?? null,
  };
  if (result.peerCheck) {
    await recordAttempt(db, {
      ...common,
      strategy: DARWIN_PEER_STRATEGY.strategy,
      version: DARWIN_PEER_STRATEGY.version,
      // A peer outlier is a flag for review, not a rejection.
      outcome: result.peerCheck.outlier ? "evidence_mismatch" : "ok",
      yieldCount: result.peerCheck.outlier ? 0 : 1,
      detail: {
        fee_raw_id: result.feeRawId,
        canonical_fee_key: result.canonicalFeeKey,
        amount: result.amount,
        peer_outlier: result.peerCheck.outlier,
        peer_scope: result.peerCheck.scope,
        peer_held: holdsForPeerReview(result.peerCheck, result.canonicalFeeKey),
        peer_low: result.peerCheck.low,
        peer_high: result.peerCheck.high,
        peer_p25: result.peerCheck.p25,
        peer_median: result.peerCheck.median,
        peer_p75: result.peerCheck.p75,
        peer_count: result.peerCheck.peerCount,
        institution_tier: result.peerCheck.tier,
        peer_tier: result.peerCheck.levelTier,
        decision: result.decision,
        reason: result.peerCheck.outlier ? result.reason : null,
      },
    });
  }
  if (result.categoryModel) {
    const opinion = result.categoryModel;
    await recordAttempt(db, {
      ...common,
      strategy: DARWIN_CATEGORY_MODEL_STRATEGY.strategy,
      version: DARWIN_CATEGORY_MODEL_STRATEGY.version,
      // Shadow: a dispute is evidence for the adjudicator, not a rejection.
      outcome: opinion.disputed ? "evidence_mismatch" : "ok",
      yieldCount: opinion.disputed ? 0 : 1,
      detail: {
        fee_raw_id: result.feeRawId,
        fee_name: result.feeName,
        canonical_fee_key: result.canonicalFeeKey,
        amount: result.amount,
        disputed: opinion.disputed,
        probability: Number(opinion.probability.toFixed(4)),
        suggested_key: opinion.suggested,
        suggested_probability: Number(opinion.suggestedProbability.toFixed(4)),
        decision: result.decision,
      },
    });
  }
  if (result.secondSource) {
    await recordAttempt(db, {
      ...common,
      strategy: DARWIN_SECOND_SOURCE_STRATEGY.strategy,
      version: DARWIN_SECOND_SOURCE_STRATEGY.version,
      outcome: result.secondSource.verdict === "agrees" ? "ok" : "evidence_mismatch",
      yieldCount: result.secondSource.agreeingDocumentIds.length,
      detail: {
        fee_raw_id: result.feeRawId,
        fee_verified_id: result.feeVerifiedId,
        canonical_fee_key: result.canonicalFeeKey,
        amount: result.amount,
        verdict: result.secondSource.verdict,
        agreeing_source_document_ids: result.secondSource.agreeingDocumentIds,
        disagreeing: result.secondSource.disagreeing,
      },
    });
  }
}

/**
 * #1295: rows Knox re-filed under a category Darwin never judged them under (`category-change.ts`).
 * Counted and sampled on every step that can read the learning log, a dry run included; handed
 * to the batch only when `DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE` is on and the step writes.
 */
async function categoryChangeRejudge(
  db: SqlTag,
  options: {
    learning: boolean;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string;
    alreadySelected: ReadonlySet<number>;
    currentCopy: boolean;
  },
): Promise<{ rows: RawFeeRow[]; summary: CategoryChangeRejudgeSummary | null }> {
  const canRead = options.learning || (options.dryRun && (await learningSchemaReady(db)));
  if (!canRead) return { rows: [], summary: null };
  // In a savepoint: a failed read (a timeout) would otherwise abort the run-ledger transaction
  // and fail the whole verify step, `.catch` or not.
  const scanned = await inSavepoint(db, (scope) => selectCategoryChangeRows(scope, {
    strategy: DARWIN_VERIFY_STRATEGY.strategy,
    version: DARWIN_VERIFY_STRATEGY.version,
    institutionId: options.institutionId,
    stateCode: options.stateCode,
  })).catch((error) => {
    console.warn("[darwin] category change read failed", error instanceof Error ? error.message : error);
    return null;
  });
  if (!scanned) return { rows: [], summary: null };
  // Rows only a take-over's `knox_takeover_from:` flag proves join only with that switch on;
  // off, they are counted and sampled for James.
  const takeoverLive = DARWIN_TAKEOVER_CATEGORY_PROOF_LIVE;
  const withoutTakeover = categoryChangeCandidates(scanned, canonicalHintFrom, { takeoverProof: false });
  const withTakeover = categoryChangeCandidates(scanned, canonicalHintFrom, { takeoverProof: true });
  const provenWithout = new Set(withoutTakeover.map((candidate) => candidate.feeRawId));
  const takeoverOnly = withTakeover.filter((candidate) => !provenWithout.has(candidate.feeRawId));
  const candidates = takeoverLive ? withTakeover : withoutTakeover;
  const live = DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE && options.learning;
  const ids = live
    ? candidates
        .map((candidate) => candidate.feeRawId)
        .filter((id) => !options.alreadySelected.has(id))
        .slice(0, DARWIN_CATEGORY_CHANGE_LIMIT)
    : [];
  const rows = ids.length > 0
    ? await selectRawFees(db, ids.length, options.learning, options.institutionId, options.stateCode, options.currentCopy, ids)
    : [];
  return { rows, summary: summarizeCategoryChange(candidates, scanned.length, rows.length, live, takeoverOnly, takeoverLive) };
}

export async function runDarwinVerify(
  options: RunDarwinVerifyOptions,
): Promise<RunDarwinVerifyResult> {
  const db = options.db ?? sql;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const learning = !dryRun && (await learningSchemaReady(db));
  const currentCopy = learning && (await currentCopySchemaReady(db));
  const selected = await selectRawFees(db, limit, learning, options.institutionId, options.stateCode, currentCopy);
  // #1295: rows Knox re-filed under a category Darwin never judged them under. Read-only while
  // the switch is off; on, they join this batch for a new decision under today's category.
  const categoryChange = await categoryChangeRejudge(db, {
    learning,
    dryRun,
    institutionId: options.institutionId,
    stateCode: options.stateCode,
    alreadySelected: new Set(selected.map((row) => Number(row.fee_raw_id))),
    currentCopy,
  });
  const rows = categoryChange.rows.length > 0 ? [...selected, ...categoryChange.rows] : selected;
  const rowByRawFeeId = new Map(rows.map((row) => [Number(row.fee_raw_id), row]));
  const results: DarwinVerificationResult[] = [];

  const verifiedInBatch = new Set<string>();
  const categoryModel = rows.length > 0 ? await loadCategoryModel(db).catch(() => null) : null;
  const learnedEnvelopes = rows.length > 0 ? await loadLearnedEnvelopes(db) : NO_LEARNED_ENVELOPES;
  const sourceTexts = await loadSourceTexts(
    db,
    Array.from(new Set(rows.flatMap((row) => (row.source_document_id == null ? [] : [Number(row.source_document_id)])))),
  );

  // Pass 2 evidence, loaded once per batch: state peer levels and the banks' other
  // stored documents for the same fees.
  const peers = new PeerLevelCache(db);
  // A row Knox filed under a neighbouring category is checked under the one its own source line
  // (guard v62) or its name says.
  const categoryOf = resolvedRawCategory;
  const hintedRows = rows.filter((row) => canonicalHintFrom(row) != null);
  const sourceCopies = await loadSourceCopies(
    db,
    Array.from(new Set(hintedRows.map((row) => Number(row.institution_id)))),
    Array.from(new Set(hintedRows.map((row) => canonicalHintFrom(row) as string))),
    canonicalHintFrom,
  );

  const deferrals: Array<{ feeRawId: number; reason: string }> = [];
  let deferredRawFees = 0;
  for (const knoxRow of rows) {
    try {
      await inSavepoint(db, async scope => {
        // Darwin's audience decision (#1059) is the audience every check below reads, and the one
        // written: a consumer fee enters the consumer peer check, a business fee never does.
        const legacySourceText = knoxRow.source_document_id == null ? null : sourceTexts.get(Number(knoxRow.source_document_id)) ?? null;
        const admission = dryRun ? null : await prepareVerificationAudience(scope, knoxRow, legacySourceText);
        const admittedRaw = admission?.row ?? knoxRow;
        const sourceText = admission ? admission.sourceText : legacySourceText;
        const audience = admission ? admission.audience : darwinAudience(admittedRaw, isPercentFee(admittedRaw) ? null : normalizedAmount(admittedRaw.amount), sourceText);
        const row: RawFeeRow = audience ? { ...admittedRaw, fee_audience: audience.feeAudience } : admittedRaw;
        const rowSourceTexts = new Map(sourceTexts);
        if (row.source_document_id != null && sourceText != null) rowSourceTexts.set(Number(row.source_document_id), sourceText);
        const canonicalFeeKey = categoryOf(row);
        if (admission) requireInternationalVerification(admission, canonicalFeeKey, categoryOf(admission.row));
        let reasonCode = verificationReasonCode(row, canonicalFeeKey, learnedEnvelopes);
        const categoryHold = reasonCode ? null : pendingCategoryLesson(canonicalFeeKey, row.fee_name);
        if (categoryHold) reasonCode = "category_lesson_pending";
        if (!reasonCode && !statedInOwnSource(row, rowSourceTexts, canonicalFeeKey)) reasonCode = "not_in_source";
        // Traced to its line: the line must also price it as read, in a live category, under
        // Hamilton's own name rules (2026-10-09: the re-select verified "$0 if condition" fees).
        const sourceLine = reasonCode || !canonicalFeeKey ? null : sourceLineFor(row, rowSourceTexts, canonicalFeeKey) ?? excerptOf(row.conditions);
        const postCheck = reasonCode || !canonicalFeeKey ? null : postSourceCheck(canonicalFeeKey, row.fee_name, normalizedAmount(row.amount), sourceLine, sourceText);
        if (postCheck) reasonCode = postCheck.code;
        // #1397: a $0 a premium or private-banking schedule grants is that tier's perk, not the bank's price.
        if (!reasonCode && tierPerkZero(normalizedAmount(row.amount), row.fee_name, row.source_url, sourceText, canonicalFeeKey)) reasonCode = "tier_perk_zero";
        if (!reasonCode && canonicalFeeKey && verifiedInBatch.has(batchKey(row, canonicalFeeKey))) {
          reasonCode = "duplicate_in_batch";
        }
        const base = {
          feeRawId: Number(row.fee_raw_id),
          institutionId: Number(row.institution_id),
          feeName: row.fee_name,
          amount: normalizedAmount(row.amount),
          canonicalFeeKey,
        };

        // Pass 2 runs only on rows the rules accept.
        let peer: PeerCheckResult | null = null;
        let secondSource: SecondSourceResult | null = null;
        if (!reasonCode && canonicalFeeKey && base.amount != null) {
          // The peer levels are the benchmark population, so a fee enters on the benchmarks' terms
          // (#1112): consumer, both, and unknown unless its schedule is business-only; never business.
          // Second-source evidence is separate; it still gives no confidence to an unknown fee.
          if (entersPeerCheck(row.fee_audience, row.source_url)) {
            const stateCode = row.state_code ?? options.stateCode;
            const levels = await peers.forState(stateCode);
            peer = peerCheck(
              levels,
              canonicalFeeKey,
              institutionTier(row.asset_size_tier, row.asset_size),
              base.amount,
              await peers.widerLevels(),
              districtOfState(stateCode),
            );
          }
          secondSource = secondSourceCheck(
            {
              feeRawId: base.feeRawId,
              institutionId: base.institutionId,
              sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
              canonicalFeeKey,
              amount: base.amount,
              feeAudience: row.fee_audience ?? "unknown",
              productName: row.product_name,
            },
            sourceCopies,
          );
          if (holdsForPeerReview(peer, canonicalFeeKey)) reasonCode = "peer_outlier";
        }

        let result: DarwinVerificationResult;
        if (reasonCode || !canonicalFeeKey) {
          const code = reasonCode ?? "missing_canonical";
          result = {
            ...base,
            status: "skipped",
            decision: decisionFor(code),
            reasonCode: code,
            reason: code === "peer_outlier" && peer && base.amount != null
              ? `${DARWIN_REASON_TEXT[code]}: ${peerOutlierReason(peer, base.amount)}`
              : code === "name_rule" && postCheck?.rule
                ? `${DARWIN_REASON_TEXT[code]}: ${postCheck.rule} (${RULE_WHY[postCheck.rule as keyof typeof RULE_WHY]})`
                : verificationReasonText(row, code),
            feeVerifiedId: null,
            peerCheck: peer,
            secondSource,
          };
        } else {
          // One refused insert must not roll back the whole step (#1113): the insert runs in
          // its own savepoint, and a failure holds only this row.
          let insertFailed = false;
          const feeVerifiedId = dryRun
            ? null
            : await inSavepoint(scope, (insertScope) => insertVerifiedFee(insertScope, {
              runId: options.runId,
              row,
              canonicalFeeKey,
              secondSourceAgrees: secondSource?.verdict === "agrees",
              audience,
              sourceText,
              audienceAdmission: admission ? completeAudienceAdmission(admission, canonicalFeeKey) : undefined,
            })).catch((error) => {
              if (error instanceof VerificationAudienceDeferred) throw error;
              insertFailed = true;
              return null;
            });
          const verified = Boolean(feeVerifiedId) || dryRun;
          const code: DarwinReasonCode | null = verified ? null : insertFailed ? "insert_failed" : "duplicate_verified";
          if (verified) verifiedInBatch.add(batchKey(row, canonicalFeeKey));
          result = {
            ...base,
            status: verified ? "verified" : "skipped",
            decision: decisionFor(code),
            reasonCode: code,
            reason: code ? DARWIN_REASON_TEXT[code] : null,
            feeVerifiedId,
            peerCheck: peer,
            secondSource,
          };
        }
        result.categoryModel = categoryModel && canonicalFeeKey
          ? categoryOpinion(categoryModel, row.fee_name, canonicalFeeKey)
          : null;
        results.push(result);

        if (learning) {
          await recordAttempt(scope, {
            institutionId: result.institutionId,
            stage: "verify",
            strategy: DARWIN_VERIFY_STRATEGY.strategy,
            version: DARWIN_VERIFY_STRATEGY.version,
            fingerprint: rawFeeFingerprint(result.feeRawId),
            outcome: attemptOutcome(result),
            yieldCount: result.status === "verified" ? 1 : 0,
            costMicrousd: 0,
            runId: options.runId,
            stepId: options.stepId ?? null,
            detail: {
              fee_raw_id: result.feeRawId,
              fee_verified_id: result.feeVerifiedId,
              canonical_fee_key: result.canonicalFeeKey,
              // Knox's category as Darwin read it, so a later Knox re-file is a new decision (#1295).
              knox_category: canonicalHintFrom(rowByRawFeeId.get(result.feeRawId) ?? { outlier_flags: null, conditions: null }),
              amount: result.amount,
              decision: result.decision,
              reason_code: result.reasonCode,
              reason: result.reason,
              category_guard_version: CATEGORY_GUARD_VERSION,
              source_check_version: DARWIN_SOURCE_CHECK_VERSION,
              // A peer hold is re-decided once when the peer check's version rises (v5, #1112).
              peer_version: DARWIN_PEER_STRATEGY.version,
              batch_key_version: DARWIN_BATCH_KEY_VERSION,
              // Darwin's audience decision (#1059), when it made one; else the raw row's stands.
              fee_audience: row.fee_audience ?? "unknown",
              audience_evidence: audience?.audienceEvidence,
              category_hold: categoryHold
                ? { filed_as: categoryHold.filedAs, should_be: categoryHold.shouldBe, since: categoryHold.since }
                : undefined,
              name_rule: postCheck?.rule,
              source_line: postCheck && sourceLine ? sourceLine.slice(0, 300) : undefined,
              amount_envelope: result.reasonCode === "outside_envelope" && result.canonicalFeeKey
                ? darwinEnvelopeFor(result.canonicalFeeKey, learnedEnvelopes)
                : undefined,
            },
          });
          await recordPassTwoAttempts(scope, options, result);
        }
      });
    } catch (error) {
      if (!(error instanceof VerificationAudienceDeferred)) throw error;
      deferredRawFees += 1;
      if (deferrals.length < 25) deferrals.push({ feeRawId: Number(knoxRow.fee_raw_id), reason: error.reason });
    }
  }

  if (!dryRun) {
    await recordVerificationSignals(db, options.runId, results, rowByRawFeeId, learnedEnvelopes);
  }

  // Each decision goes to the shared learning store as a judgement on Knox's read.
  const feedbackWritten = !dryRun && learning
    ? await recordDarwinFeedback(
        db,
        darwinFeedbackRows(results, rowByRawFeeId, { runId: options.runId, verifyVersion: DARWIN_VERIFY_STRATEGY.version }),
      )
    : null;

  const reasonCounts: Partial<Record<DarwinReasonCode, number>> = {};
  for (const result of results) {
    if (result.reasonCode) reasonCounts[result.reasonCode] = (reasonCounts[result.reasonCode] ?? 0) + 1;
  }

  // Darwin's second look at rows it verified earlier under weaker checks (verified-recheck.ts).
  const recheck = learning
    ? await recheckVerifiedFees(db, { runId: options.runId, stepId: options.stepId ?? null }).catch((error) => {
        console.warn("[darwin] verified recheck failed", error instanceof Error ? error.message : error);
        return null;
      })
    : null;
  // Darwin's re-check of shared documents against the bank their own text names (document-owner.ts).
  const documentOwner = learning
    ? await recheckDocumentOwners(db, { runId: options.runId, stepId: options.stepId ?? null }).catch((error) => {
        console.warn("[darwin] document owner recheck failed", error instanceof Error ? error.message : error);
        return null;
      })
    : null;

  return {
    selectedRawFees: rows.length,
    processedRawFees: results.length,
    deferredRawFees,
    deferrals,
    verifiedFees: results.filter((result) => result.status === "verified").length,
    skippedFees: results.filter((result) => result.status === "skipped").length,
    limit,
    dryRun,
    learning,
    outcomes: learning ? countOutcomes(results.map(attemptOutcome)) : {},
    reasonCounts,
    recheck,
    documentOwner,
    categoryChange: categoryChange.summary,
    zeroFeesVerified: results.filter((result) => result.status === "verified" && result.amount === 0).length,
    peerOutliers: results.filter((result) => result.reasonCode === "peer_outlier").length,
    peerFallbackChecks: results.filter((result) => result.peerCheck && result.peerCheck.scope !== "state").length,
    peerFallbackOutliers: results.filter((result) => result.peerCheck?.outlier && result.peerCheck.scope !== "state").length,
    learnedEnvelopeHolds: results.filter((result) =>
      result.reasonCode === "outside_envelope" &&
      result.canonicalFeeKey != null &&
      darwinEnvelopeFor(result.canonicalFeeKey, learnedEnvelopes).source === "learned"
    ).length,
    secondSourceAgreements: results.filter((result) => result.secondSource?.verdict === "agrees").length,
    secondSourceDisagreements: results.filter((result) => result.secondSource?.verdict === "disagrees").length,
    categoryModelDisputes: results.filter((result) => result.categoryModel?.disputed).length,
    feedbackWritten,
    results,
  };
}
