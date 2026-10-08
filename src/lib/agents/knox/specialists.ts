import {
  extractCandidatesFromText,
  MAX_FEES_PER_DOCUMENT,
  type ExtractedFeeCandidate,
  type ExtractionRulesResult,
  type HeldFeeCandidate,
} from "@/lib/agents/knox/rules";
import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "@/lib/agents/knox/families";
import { namesALimit, namesAWorkedExample, passesDarwinChecks, readsAMeasuredAmount, tidyFeeName } from "@/lib/agents/knox/layout";
import { extractTableCandidates, KNOX_TABLE_STRATEGY } from "@/lib/agents/knox/table-rows";
import { checkFeeAgainstSource, joinLabeledFeeCardText } from "@/lib/custom-report/source-check";
import { rateFeeFromHeld, type RateFeeCandidate } from "@/lib/agents/knox/percent";
import { contextFees, NO_LONGER_CHARGED } from "@/lib/agents/knox/context-names";

/**
 * Knox's free extraction team, run over one whole document. Pure.
 *
 *   pass 1  extract.rules            line rules (rules.ts)
 *   pass 2  extract.table            table rows: cells, stacked name/price lines (table-rows.ts)
 *   pass 2  extract.family.<family>  fee-family experts over price windows (families.ts)
 *
 * Specialists run in that order and their finds are merged: a later specialist's fee
 * is kept only when no earlier one already has the same category and amount, so a
 * fee read twice is stored once. Each specialist reports its own yield and how many of
 * its fees were new, for the attempt log.
 *
 * Names are tidied first (`tidyFeeName`): table separators, dot leaders, bullets and the
 * unit fragments of neighbouring cells are not part of the name a reader sees.
 *
 * Self-check: before a find is kept, Knox checks it against the line it came from with
 * the shared accuracy check (`checkFeeAgainstSource`, the rule Darwin and Hamilton apply
 * later). A find whose name and price don't trace to one row of the text is held for
 * review as `untraced` instead of going to Darwin, where it would be rejected as not in
 * the source. A later specialist that reads the same fee under a traceable name keeps it.
 */

/** The pass 1 strategy; its version gates re-extraction of a text. */
export const KNOX_RULES_STRATEGY = { strategy: "extract.rules", version: 35 } as const;

export interface SpecialistRun {
  strategy: string;
  version: number;
  pass: 1 | 2;
  /** Fees this specialist found on its own. */
  found: number;
  /** Fees it added that no earlier specialist had. */
  added: number;
  heldFound: number;
  /** Finds dropped by the self-check: name and price don't trace to one row of the text. */
  selfCheckFailed: number;
  candidates: ExtractedFeeCandidate[];
}

export interface FreeExtractionResult extends ExtractionRulesResult {
  runs: SpecialistRun[];
  /** Percentage fees that publish as rates and trace to the text (`percent.ts`); the rest stay held. */
  rates: RateFeeCandidate[];
}

const MAX_HELD_PER_DOCUMENT = 40;
/** NSF and overdraft joined as one item's name: "NSFs/Overdrafts", "Overdraft or NSF Item". */
const NSF_TERM = String.raw`(?:nsfs?|non[-\s]?sufficient funds?|insufficient funds?)`;
const NSF_AND_OVERDRAFT = new RegExp(
  String.raw`\b${NSF_TERM}\s*(?:\/|\bor\b|\band\b|&)\s*(?:overdrafts?|OD)\b|\b(?:overdrafts?|OD)\s*(?:\/|\bor\b|\band\b|&)\s*${NSF_TERM}`,
  "i",
);
const MAX_UNCLASSIFIED_PER_DOCUMENT = 10;

function words(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The same fee read by two specialists: same category and price, and the names agree
 * (equal, one quoted in the other's excerpt, or the same first two words). Two
 * different fees that share a category and price ("Paid overdraft item $35" and
 * "Overdraft fee, 2nd and subsequent items $35") are both kept.
 */
export function sameFee(a: ExtractedFeeCandidate, b: ExtractedFeeCandidate): boolean {
  if (a.canonicalHint !== b.canonicalHint || a.amount !== b.amount) return false;
  const nameA = words(a.feeName);
  const nameB = words(b.feeName);
  if (nameA === nameB || words(a.excerpt).includes(nameB) || words(b.excerpt).includes(nameA)) return true;
  return nameA.split(" ").slice(0, 2).join(" ") === nameB.split(" ").slice(0, 2).join(" ");
}

/** The shared accuracy check, as Darwin reads it: a tiered price is the bank's real price for its band. */
function tracesToSource(text: string, feeName: string, amount: number): boolean {
  const result = checkFeeAgainstSource(text, feeName, amount, ".");
  return result.ok || result.reason === "tiered_fee";
}

function heldKey(held: HeldFeeCandidate): string {
  return `${held.shape}:${held.canonicalHint}:${held.feeName.toLowerCase()}:${held.amount}:${held.percent}`;
}

/** True when a ")" comes before any "(": the name is the tail of a wrapped line. */
export function closesUnopenedParen(name: string): boolean {
  const close = name.indexOf(")");
  return close >= 0 && (name.indexOf("(") < 0 || name.indexOf("(") > close);
}

/**
 * v33: pass 1 adds fees named by their page context (`context-names.ts`), and a line saying
 * its fee is being eliminated or no longer charged holds no fee for review.
 */
function withContextFees(text: string, read: ExtractionRulesResult): ExtractionRulesResult {
  return {
    candidates: [...contextFees(text), ...read.candidates.filter((fee) => !NO_LONGER_CHARGED.test(fee.excerpt))],
    held: read.held.filter((row) => !NO_LONGER_CHARGED.test(row.excerpt)),
  };
}

export function runFreeSpecialists(sourceText: string): FreeExtractionResult {
  // Labeled fee cards ("Fee TypeX" / ... / "Fee$5.00") are read as one row, as the shared
  // check reads them; the self-check still runs against the stored text.
  const text = joinLabeledFeeCardText(sourceText);
  const windows = priceWindows(text);
  const specialists: Array<{ strategy: string; version: number; pass: 1 | 2; run: () => ExtractionRulesResult }> = [
    { ...KNOX_RULES_STRATEGY, pass: 1, run: () => withContextFees(text, extractCandidatesFromText(text)) },
    { ...KNOX_TABLE_STRATEGY, pass: 2, run: () => extractTableCandidates(text) },
    ...FAMILY_EXPERTS.map((expert) => ({
      strategy: expert.strategy,
      version: expert.version,
      pass: 2 as const,
      run: () => runFamilyExpert(expert, windows),
    })),
  ];

  const candidates: ExtractedFeeCandidate[] = [];
  const held: HeldFeeCandidate[] = [];
  const seenHeld = new Set<string>();
  const untraced: HeldFeeCandidate[] = [];
  let unclassified = 0;
  const runs: SpecialistRun[] = [];

  for (const specialist of specialists) {
    const found = specialist.run();
    let added = 0;
    let selfCheckFailed = 0;
    for (const read of found.candidates) {
      if (candidates.length >= MAX_FEES_PER_DOCUMENT) break;
      const candidate = { ...read, feeName: tidyFeeName(read.feeName) };
      // v28: a limit is not a price ("Zelle transfer limit | $1,000").
      if (namesALimit(candidate.feeName, candidate.canonicalHint)) continue;
      // v32: a name that closes a parenthesis it never opened ("SCCU for using a non-SCCU
      // ATM) | $60") is the end of the line above, and the price is another column's.
      if (closesUnopenedParen(candidate.feeName)) continue;
      // v32: a worked example's figure is not a price.
      if (namesAWorkedExample(candidate.feeName)) continue;
      // v32: the figure after "is at least" or "Fee on (the)" is a balance or a transaction.
      if (readsAMeasuredAmount(text, candidate.feeName, candidate.amount)) continue;
      if (!tracesToSource(text, candidate.feeName, candidate.amount)) {
        selfCheckFailed += 1;
        untraced.push({
          shape: "untraced",
          feeName: candidate.feeName,
          amount: candidate.amount,
          amountMax: null,
          percent: null,
          frequency: candidate.frequency,
          canonicalHint: candidate.canonicalHint,
          excerpt: candidate.excerpt,
        });
        continue;
      }
      // Pass 1 keeps distinct names at one price (its v3 behavior); a later specialist
      // adds a fee only when no earlier find is the same fee.
      const duplicate = specialist.pass === 1
        ? candidates.some(
            (prior) =>
              prior.canonicalHint === candidate.canonicalHint &&
              prior.amount === candidate.amount &&
              prior.feeName.toLowerCase() === candidate.feeName.toLowerCase(),
          )
        : candidates.some((prior) => sameFee(prior, candidate));
      if (duplicate) continue;
      candidates.push({ ...candidate, strategy: specialist.strategy });
      added += 1;
    }
    for (const heldRow of found.held) {
      if (held.length >= MAX_HELD_PER_DOCUMENT) break;
      const foundRow = { ...heldRow, feeName: tidyFeeName(heldRow.feeName) };
      if (foundRow.shape === "zero" && readsAMeasuredAmount(text, foundRow.feeName, 0)) continue;
      // A $0 row can go live through the rules re-check, so it passes the same self-check.
      const untracedZero = foundRow.shape === "zero" && !tracesToSource(text, foundRow.feeName, 0);
      if (untracedZero) selfCheckFailed += 1;
      const row: HeldFeeCandidate = untracedZero ? { ...foundRow, shape: "untraced" } : foundRow;
      const key = heldKey(row);
      if (seenHeld.has(key)) continue;
      if (row.shape === "unclassified" && unclassified >= MAX_UNCLASSIFIED_PER_DOCUMENT) continue;
      seenHeld.add(key);
      if (row.shape === "unclassified") unclassified += 1;
      held.push(row);
    }
    runs.push({
      strategy: specialist.strategy,
      version: specialist.version,
      pass: specialist.pass,
      found: found.candidates.length,
      added,
      heldFound: found.held.length,
      selfCheckFailed,
      candidates: found.candidates,
    });
  }

  // v27: one priced line that names both an NSF item and an overdraft ("Non-sufficient
  // funds item (NSFs/Overdrafts) | $33.00 per item") is the bank's price for both.
  for (const candidate of [...candidates]) {
    const twin = candidate.canonicalHint === "nsf" ? "overdraft" : candidate.canonicalHint === "overdraft" ? "nsf" : null;
    if (!twin || !NSF_AND_OVERDRAFT.test(candidate.feeName)) continue;
    if (candidates.some((prior) => prior.canonicalHint === twin && prior.amount === candidate.amount)) continue;
    if (candidates.length >= MAX_FEES_PER_DOCUMENT || !passesDarwinChecks(twin, candidate.feeName, candidate.amount)) continue;
    candidates.push({ ...candidate, canonicalHint: twin });
  }

  // An untraced read is held once, and only when no specialist read the same fee traceably.
  for (const row of untraced) {
    if (held.length >= MAX_HELD_PER_DOCUMENT) break;
    const key = heldKey(row);
    if (seenHeld.has(key)) continue;
    seenHeld.add(key);
    held.push(row);
  }
  // A priced line a specialist has since classified is no longer unrecognized.
  const kept = held.filter((row) => {
    if (row.shape === "untraced") {
      return !candidates.some((candidate) => candidate.canonicalHint === row.canonicalHint && candidate.amount === row.amount);
    }
    return (
      row.shape !== "unclassified" ||
      !candidates.some((candidate) => candidate.amount === row.amount && candidate.excerpt.includes(row.feeName))
    );
  });
  // A held percentage in a category that publishes rates, traced to the text, goes to
  // Darwin as a rate fee; the same rate read twice is one fee.
  const rates: RateFeeCandidate[] = [];
  const stillHeld = kept.filter((row) => {
    if (row.shape !== "percentage") return true;
    const rate = rateFeeFromHeld(row, text);
    if (typeof rate === "string") return true;
    const duplicate = rates.some(
      (prior) => prior.canonicalHint === rate.canonicalHint && prior.ratePercent === rate.ratePercent && prior.feeName.toLowerCase() === rate.feeName.toLowerCase(),
    );
    if (!duplicate) rates.push(rate);
    return false;
  });
  return { candidates, held: stillHeld, rates, runs };
}
