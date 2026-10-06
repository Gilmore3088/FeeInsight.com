import {
  extractCandidatesFromText,
  MAX_FEES_PER_DOCUMENT,
  type ExtractedFeeCandidate,
  type ExtractionRulesResult,
  type HeldFeeCandidate,
} from "@/lib/agents/knox/rules";
import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "@/lib/agents/knox/families";
import { tidyFeeName } from "@/lib/agents/knox/layout";
import { extractTableCandidates, KNOX_TABLE_STRATEGY } from "@/lib/agents/knox/table-rows";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

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
export const KNOX_RULES_STRATEGY = { strategy: "extract.rules", version: 19 } as const;

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
}

const MAX_HELD_PER_DOCUMENT = 40;
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

export function runFreeSpecialists(text: string): FreeExtractionResult {
  const windows = priceWindows(text);
  const specialists: Array<{ strategy: string; version: number; pass: 1 | 2; run: () => ExtractionRulesResult }> = [
    { ...KNOX_RULES_STRATEGY, pass: 1, run: () => extractCandidatesFromText(text) },
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
  return { candidates, held: kept, runs };
}
