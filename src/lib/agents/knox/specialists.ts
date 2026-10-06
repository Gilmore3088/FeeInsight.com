import {
  extractCandidatesFromText,
  MAX_FEES_PER_DOCUMENT,
  type ExtractedFeeCandidate,
  type ExtractionRulesResult,
  type HeldFeeCandidate,
} from "@/lib/agents/knox/rules";
import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "@/lib/agents/knox/families";
import { extractTableCandidates, KNOX_TABLE_STRATEGY } from "@/lib/agents/knox/table-rows";

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
 */

/** The pass 1 strategy; its version gates re-extraction of a text. */
export const KNOX_RULES_STRATEGY = { strategy: "extract.rules", version: 8 } as const;

export interface SpecialistRun {
  strategy: string;
  version: number;
  pass: 1 | 2;
  /** Fees this specialist found on its own. */
  found: number;
  /** Fees it added that no earlier specialist had. */
  added: number;
  heldFound: number;
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
  let unclassified = 0;
  const runs: SpecialistRun[] = [];

  for (const specialist of specialists) {
    const found = specialist.run();
    let added = 0;
    for (const candidate of found.candidates) {
      if (candidates.length >= MAX_FEES_PER_DOCUMENT) break;
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
    for (const row of found.held) {
      if (held.length >= MAX_HELD_PER_DOCUMENT) break;
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
      candidates: found.candidates,
    });
  }

  // A priced line a specialist has since classified is no longer unrecognized.
  const kept = held.filter(
    (row) =>
      row.shape !== "unclassified" ||
      !candidates.some((candidate) => candidate.amount === row.amount && candidate.excerpt.includes(row.feeName)),
  );
  return { candidates, held: kept, runs };
}
