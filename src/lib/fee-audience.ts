/** Customer audience is not an account product name. Unknown is never labeled consumer. */
export type FeeAudience = "consumer" | "business" | "both" | "unknown";
export type FeeTreatment = "charged" | "no_charge" | "eliminated" | "unknown";

export interface FeeApplicability {
  feeAudience: FeeAudience;
  audienceEvidence: string | null;
  feeTreatment: FeeTreatment;
}

export interface ScopedFeeStatement extends FeeApplicability {
  feeName: string;
  canonicalHint: "nsf";
  amount: number;
  /** Verbatim source, including both clauses; never a synthetic fee schedule. */
  excerpt: string;
}

const clean = (text: string) => text.replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
const audience = (word: string): "consumer" | "business" => /^(consumer|personal)$/i.test(word) ? "consumer" : "business";
const NSF_NAME = String.raw`(?:Non[- ]sufficient Funds(?:\s*\(NSF\))?(?: Returned Item)?|NSF(?: Returned Item)?) fees?`;
const PEOPLE = String.raw`(?:clients?|customers?|accounts?)`;
const SCOPE = String.raw`(consumer|personal|business|commercial)`;
const MONEY = String.raw`\$\s*(\d{1,3}(?:\.\d{2})?)`;
// Completed, unconditional statements only. Future notices, waivers and quoted hypotheticals
// must not be interpreted as an effective $0. This deliberately does not infer effective dates.
const ELIMINATED = new RegExp(String.raw`^(?:[-•]\s*)?(?:We(?:'ve|’ve| have)\s+)?eliminated\s+(${NSF_NAME})\s+for\s+${SCOPE}\s+${PEOPLE}(.*)$`, "i");
const OTHER_PRICE = new RegExp(String.raw`^\s+and\s+(?:lowered|reduced|decreased|raised|increased|changed)\s+them\s+from\s+${MONEY}\s+to\s+${MONEY}\s+for\s+${SCOPE}\s+${PEOPLE}\s*\.?$`, "i");
const CONSUMER = /\b(?:consumer|personal)\s+(?:clients?|customers?|accounts?|checking|savings)\b|\((?:consumer|personal)\)/i;
const BUSINESS = /\b(?:business|commercial|corporate)\s+(?:clients?|customers?|accounts?|checking|savings)\b|\((?:business|commercial)\)|\bbusiness[- ]only\b/i;
const BOTH = /\b(?:all|both consumer and business|consumer and business|personal and business)\s+(?:clients?|customers?|accounts?)\b/i;

/**
 * Knox v173 (backlog dry run 6): a misspelt "account" with the same letters ("accoutns", "acocunt",
 * "acconts" is not one) still names the account, so "Business accoutns:" is a business label (LM FCU,
 * doc 8108). Only a word of exactly the letters of "account" or "accounts" is read so.
 */
const ACCOUNT_LETTERS = new Set(["account", "accounts"].map((word) => [...word].sort().join("")));
function withAccountSpelled(text: string): string {
  return text.replace(/\b[a-z]{7,8}\b/gi, (word) => (ACCOUNT_LETTERS.has([...word.toLowerCase()].sort().join("")) ? (word.length === 8 ? "accounts" : "account") : word));
}
/**
 * Knox v173: an audience label that opens its own clause ("Personal accounts: Internet Bill Pay Free
 * Business accounts: Internet Bill Pay $4.95 per month"). The price belongs to the last label before it.
 */
const AUDIENCE_LABEL = /\b(consumer|personal|business|commercial|corporate)\s+(?:clients?|customers?|accounts?|checking|savings)\s*:/gi;
const FREE_WORDS = /\b(?:free|no\s+charge|none|n\/c|waived)\b/i;
/**
 * The audience of the one price in a list of audience-labelled clauses, each priced: the price's own
 * clause opens with the last label before it and names the fee, and every earlier label's clause is
 * priced by a free word of its own. Null otherwise.
 */
function labelledClauseAudience(feeName: string, evidence: string): "consumer" | "business" | null {
  const price = /\$\s*\d/.exec(evidence);
  if (!price) return null;
  const labels = [...evidence.matchAll(AUDIENCE_LABEL)].filter((label) => (label.index ?? 0) < price.index);
  if (labels.length < 2) return null;
  const last = labels.at(-1)!;
  const own = evidence.slice((last.index ?? 0) + last[0].length, price.index);
  if (FREE_WORDS.test(own) || !clean(own).toLowerCase().includes(clean(feeName).toLowerCase())) return null;
  for (let at = 0; at < labels.length - 1; at += 1) {
    const clause = evidence.slice((labels[at].index ?? 0) + labels[at][0].length, labels[at + 1].index);
    if (!FREE_WORDS.test(clause)) return null;
  }
  return audience(last[1]);
}

const statementCache = new Map<string, ScopedFeeStatement[]>();

/** The narrow mixed-audience construction that caused Pinnacle's two prices to collapse. */
export function scopedFeeStatements(text: string): ScopedFeeStatement[] {
  if (!/\beliminated\b/i.test(text)) return [];
  const cached = statementCache.get(text);
  if (cached) return cached;
  const result: ScopedFeeStatement[] = [];
  for (const original of text.split(/\n+/)) {
    const match = ELIMINATED.exec(clean(original));
    if (!match) continue;
    const [, label, firstScope, tail] = match;
    const first = audience(firstScope);
    const other = OTHER_PRICE.exec(tail);
    // A trailing qualification, date, other unknown clause, or same audience contradicting
    // itself is not safe to split. Preserve the source for review instead.
    if (!other && !/^\s*\.?$/.test(tail)) continue;
    if (other && audience(other[3]) === first) continue;
    const excerpt = original.trim();
    const name = label.replace(/^./, (letter) => letter.toUpperCase());
    result.push({ feeName: `${name} (${first})`, canonicalHint: "nsf", amount: 0,
      feeAudience: first, audienceEvidence: excerpt, feeTreatment: "eliminated", excerpt });
    if (other) {
      const second = audience(other[3]);
      const amount = Number(other[2]);
      result.push({ feeName: `${name} (${second})`, canonicalHint: "nsf", amount,
        feeAudience: second, audienceEvidence: excerpt,
        feeTreatment: amount === 0 ? "no_charge" : "charged", excerpt });
    }
  }
  if (statementCache.size >= 16) statementCache.delete(statementCache.keys().next().value!);
  statementCache.set(text, result);
  return result;
}

/** Evidence attached to the fee, not words elsewhere on a multi-product page or URL. */
export function feeApplicability(feeName: string, excerpt: string | null | undefined, amount?: number | null): FeeApplicability {
  const originalEvidence = excerpt?.trim() || feeName.trim();
  // "Credit Union Business Only" describes the service's purpose, not a business account.
  // Ignore this phrase for audience classification, but retain the original evidence.
  const name = withAccountSpelled(feeName.replace(/\bcredit union business only\b/gi, ""));
  const evidence = withAccountSpelled(originalEvidence.replace(/\bcredit union business only\b/gi, ""));
  const scoped = scopedFeeStatements(evidence).find((fee) =>
    clean(fee.feeName).toLowerCase() === clean(feeName).toLowerCase() && (amount == null || fee.amount === amount));
  if (scoped) return scoped;
  // A complete mixed statement is only usable through its independently scoped prices.
  if (scopedFeeStatements(evidence).length > 1) {
    return { feeAudience: "unknown", audienceEvidence: evidence, feeTreatment: "unknown" };
  }
  const nameConsumer = CONSUMER.test(name);
  const nameBusiness = BUSINESS.test(name);
  // Flattened schedules can attach the next row's audience to this row. A name's own
  // qualifier is usable; an excerpt with multiple dollar prices is not row-local evidence.
  const prices = [...evidence.matchAll(/\$\s*\d[\d,.]*/g)];
  const completedChange = /\b(?:lowered|reduced|decreased|raised|increased|changed)\b[^$]*\$[^$]+\bto\s*\$/i.test(evidence);
  const rowLocal = prices.length <= 1 || completedChange;
  const consumer = nameConsumer || (rowLocal && CONSUMER.test(evidence));
  const business = nameBusiness || (rowLocal && BUSINESS.test(evidence));
  const sameAudience = rowLocal && BOTH.test(clean(evidence)) && !/\b(?:except|only|whereas|but|eliminat\w*|waiv\w*)\b/i.test(evidence);
  // Knox v173: both audiences in one row-local excerpt, each in its own labelled clause: the price's own.
  const labelled = rowLocal && !nameConsumer && !nameBusiness && consumer && business ? labelledClauseAudience(feeName, evidence) : null;
  let feeAudience: FeeAudience = "unknown";
  if (/\b(?:except|whereas|but)\b/i.test(evidence)) feeAudience = "unknown";
  else if (sameAudience) feeAudience = "both";
  else if (labelled) feeAudience = labelled;
  else if (consumer && !business) feeAudience = "consumer";
  else if (business && !consumer) feeAudience = "business";
  return { feeAudience, audienceEvidence: feeAudience === "unknown" ? null : originalEvidence,
    feeTreatment: amount == null ? "unknown" : amount === 0 ? "no_charge" : "charged" };
}

/** A mixed elimination sentence cannot validate its old, unscoped extraction. */
export function conflictsWithAudienceStatement(feeName: string, amount: number, sourceLine: string): boolean {
  const statements = scopedFeeStatements(sourceLine);
  if (statements.length === 0) return false;
  return !statements.some((fee) => clean(fee.feeName).toLowerCase() === clean(feeName).toLowerCase() && fee.amount === amount);
}

export function isConsumerFee(audience: FeeAudience | null | undefined): boolean {
  return audience === "consumer" || audience === "both";
}

/**
 * Whether a fee enters personal (consumer) benchmarks: consumer, both, and unknown, which is
 * treated as personal and marked with an asterisk (James, 2026-10-12, #1058). Business never
 * does. Same audience rule as statsRowFilter (fee-stats.ts); the business-only address test
 * is applied separately. isConsumerFee stays strict for checks that need a stated audience.
 */
export function countsAsPersonal(audience: FeeAudience | null | undefined): boolean {
  return audience !== "business";
}

/** The fee's own schedule does not say who it applies to. */
export function isAudienceUnstated(audience: FeeAudience | null | undefined): boolean {
  return audience == null || audience === "unknown";
}

/** Footnote for the asterisk on any fee or benchmark an unknown-audience row contributes to. */
export const UNSTATED_AUDIENCE_FOOTNOTE =
  "Audience not stated on the bank\u2019s schedule; treated as personal. Fees may differ for business or commercial accounts.";
