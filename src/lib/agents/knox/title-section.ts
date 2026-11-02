import { withHeldNameVocabulary } from "@/lib/agents/knox/held-name-vocabulary";
import { classifyFeeText, type ExtractedFeeCandidate, type HeldFeeCandidate } from "@/lib/agents/knox/rules";

/**
 * v157 (reviews of #2888): a bare "Title Fee" or "Title transfers" names no vehicle, and under a
 * mortgage, escrow, deed or home loan heading it is the loan's title charge. Guessing which headings
 * are real estate ones is the heading-inference trap #2872 gave up on, so the rule needs positive
 * evidence instead: the read files as vehicle title only when its own line or the nearest heading above
 * it names a vehicle (or a consumer or installment loan). Otherwise it stays held as unclassified, as on
 * main. Names that say vehicle themselves ("Vehicle Title Transfer", "DMV Documentation") are not
 * bare and are untouched. Pure.
 */
export const BARE_TITLE_NAME = /^\W*titles?\s+(?:fees?|transfers?)(?:\s*\([^)]*\))?\W*$/i;
/** Words that tie a title to a vehicle. */
export const VEHICLE_WORDS =
  /\b(?:auto(?:mobile)?s?|vehicles?|cars?|trucks?|motorcycles?|boats?|rvs?|recreational|dmv|consumer\s+loans?|installment\s+loans?)\b/i;

const PRICE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
/** How far above the row a heading is looked for. */
const HEADING_LOOKBACK = 40;
const HEADING_MAX_LENGTH = 80;

/** A line that heads a section: words with no figure and no cell separator. */
function headingLike(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.length <= HEADING_MAX_LENGTH && /[a-z]/i.test(trimmed) && !/\d/.test(trimmed) && !trimmed.includes("|");
}

/** Whether the row named `feeName` is tied to a vehicle by its own line or the nearest heading above it. */
export function namesVehicle(text: string, feeName: string, excerpt: string | null | undefined): boolean {
  if (VEHICLE_WORDS.test(feeName)) return true;
  const lines = text.split("\n");
  const probe = (excerpt ?? "").trim().slice(0, 60);
  let at = probe ? lines.findIndex((line) => line.includes(probe)) : -1;
  if (at < 0) at = lines.findIndex((line) => line.includes(feeName));
  if (at < 0) return false;
  const line = lines[at];
  const nameAt = Math.max(0, line.indexOf(feeName));
  // The row's own stretch of a (possibly flattened) line: from the price before it to the price after the next one.
  const before = line.slice(0, nameAt).split(PRICE).at(-1) ?? "";
  const after = line.slice(nameAt).split(PRICE).slice(0, 2).join(" ");
  if (VEHICLE_WORDS.test(before) || VEHICLE_WORDS.test(after)) return true;
  for (let above = at - 1; above >= Math.max(0, at - HEADING_LOOKBACK); above -= 1) {
    if (headingLike(lines[above])) return VEHICLE_WORDS.test(lines[above]);
  }
  return false;
}

/** Only the vocabulary files this name: main reads it as nothing, so holding it changes no read main makes. */
function vocabularyOnlyTitle(name: string): boolean {
  // A heading the reader joined onto the name ("Auto Loans: Title Fee") leaves the bare name last.
  const own = (name.split(/[:|]/).at(-1) ?? name).trim();
  return BARE_TITLE_NAME.test(own) && withHeldNameVocabulary(false, () => classifyFeeText(name)) !== "vehicle_title";
}

/** Bare title reads with no vehicle on their line or heading move to held as unclassified; every other read is kept. */
export function withUnplacedTitlesHeld<T extends { candidates: ExtractedFeeCandidate[]; held: HeldFeeCandidate[] }>(result: T, text: string): T {
  const moved = result.candidates.filter(
    (candidate) => candidate.canonicalHint === "vehicle_title" && vocabularyOnlyTitle(candidate.feeName) && !namesVehicle(text, candidate.feeName, candidate.excerpt),
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
