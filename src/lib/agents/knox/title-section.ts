import { withHeldNameVocabulary } from "@/lib/agents/knox/held-name-vocabulary";
import { classifyFeeText, type ExtractedFeeCandidate, type HeldFeeCandidate } from "@/lib/agents/knox/rules";

/**
 * v156 (review of #2888): a bare "Title Fee" or "Title transfers" is the vehicle title's only outside
 * a real estate section. Under "MORTGAGE LOAN FEES" (beside "Title Insurance $500.00") it is the
 * mortgage's title charge, a pass-through, and stays held. The vocabulary files the name; this reads
 * the section it sits in, which a name rule cannot see. Pure.
 */
export const BARE_TITLE_NAME = /^\W*(?:(?:vehicle|auto|car)\s+)?titles?\s+(?:fees?|transfers?)(?:\s*\([^)]*\))?\W*$/i;
/** A heading or cell naming a real estate loan, its closing or land. */
export const REAL_ESTATE_SECTION = /\b(?:mortgages?|real\s+estate|home\s+equity|heloc|closings?|land)\b/i;

const PRICE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
/** How far above the row a heading is looked for. */
const HEADING_LOOKBACK = 40;
const HEADING_MAX_LENGTH = 80;

/** A line that heads a section: words with no figure and no cell separator. */
function headingLike(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.length <= HEADING_MAX_LENGTH && /[a-z]/i.test(trimmed) && !/\d/.test(trimmed) && !trimmed.includes("|");
}

/** Whether the row named `feeName` sits in a real estate section of `text` (same-line cells first, then the heading above). */
export function inRealEstateSection(text: string, feeName: string, excerpt: string | null | undefined): boolean {
  const lines = text.split("\n");
  const probe = (excerpt ?? "").trim().slice(0, 60);
  let at = probe ? lines.findIndex((line) => line.includes(probe)) : -1;
  if (at < 0) at = lines.findIndex((line) => line.includes(feeName));
  if (at < 0) return false;
  const line = lines[at];
  const nameAt = line.indexOf(feeName);
  if (nameAt > 0) {
    // On a flattened line the words since the last price are the row's own cells ("MORTGAGE FEES | Title Fee").
    const before = line.slice(0, nameAt).split(PRICE).at(-1) ?? "";
    if (REAL_ESTATE_SECTION.test(before)) return true;
  }
  for (let above = at - 1; above >= Math.max(0, at - HEADING_LOOKBACK); above -= 1) {
    if (headingLike(lines[above])) return REAL_ESTATE_SECTION.test(lines[above]);
  }
  return false;
}

/** Only the vocabulary files this name: main reads it as nothing, so holding it changes no read main makes. */
function vocabularyOnlyTitle(name: string): boolean {
  // A heading the reader joined onto the name ("Mortgage Fees: Title Fee") leaves the bare name last.
  const own = (name.split(/[:|]/).at(-1) ?? name).trim();
  return BARE_TITLE_NAME.test(own) && withHeldNameVocabulary(false, () => classifyFeeText(name)) !== "vehicle_title";
}

/** Bare title reads in a real estate section move to held as unclassified; every other read is kept. */
export function withRealEstateTitlesHeld<T extends { candidates: ExtractedFeeCandidate[]; held: HeldFeeCandidate[] }>(result: T, text: string): T {
  const moved = result.candidates.filter(
    (candidate) => candidate.canonicalHint === "vehicle_title" && vocabularyOnlyTitle(candidate.feeName) &&
      (REAL_ESTATE_SECTION.test(candidate.feeName) || inRealEstateSection(text, candidate.feeName, candidate.excerpt)),
  );
  if (moved.length === 0) return result;
  const held: HeldFeeCandidate[] = moved.map((candidate) => ({
    shape: "unclassified",
    feeName: candidate.feeName,
    amount: candidate.amount,
    amountMax: null,
    percent: null,
    frequency: candidate.frequency,
    canonicalHint: null,
    excerpt: candidate.excerpt,
  }));
  return { ...result, candidates: result.candidates.filter((candidate) => !moved.includes(candidate)), held: [...result.held, ...held] };
}
