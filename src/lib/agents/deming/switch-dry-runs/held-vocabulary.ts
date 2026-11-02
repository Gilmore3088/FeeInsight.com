import { withHeldNameVocabulary } from "@/lib/agents/knox/held-name-vocabulary";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import type { DocumentRow, LiveFeeRow } from "./types";

/**
 * `HELD_VOCABULARY_RELABEL_LIVE` (v155): what the held-name vocabulary could change for fees already
 * live once the paths that correct live fees read with it (Knox's re-read of Darwin's requests,
 * Darwin's re-read category check and its two re-file checks, the live name re-tidy). Each document's
 * newest stored text is read by today's free team twice, vocabulary off and on; the vocabulary only
 * adds reads, so the count is of reads it adds:
 * - a live dollar fee of the document with an added read at its price is one those paths could
 *   re-file (the added read's category is another) or rename (the same category);
 * - an added read at a category and price no live fee of the document has is a new fee, which the
 *   extract step publishes through Darwin whatever the switch says (counted for scale, not moved).
 * The paths themselves ask more (a re-read request, a fragment name, one proper read on the line), so
 * this is an upper bound on what they move. A rate or no-amount fee is not read. Pure.
 */

export interface HeldVocabularyRead {
  canonicalFeeKey: string;
  feeName: string;
  amount: number;
}

export interface HeldVocabularyCandidate {
  feePublishedId: number;
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number;
  /** `refile`: an added read at the fee's price in another category; `rename`: in its own. */
  shape: "refile" | "rename";
  added: HeldVocabularyRead;
}

export interface HeldVocabularyDocumentResult {
  feesRead: number;
  candidates: HeldVocabularyCandidate[];
  newReads: HeldVocabularyRead[];
}

export interface HeldVocabularySummary {
  documents: number;
  documentsChanged: number;
  feesRead: number;
  refiles: number;
  renames: number;
  /** Candidates by live category, then the added read's ("late_payment->other_lending_fee"). */
  byChange: Record<string, number>;
  newReads: number;
  newReadsByCategory: Record<string, number>;
  candidateSamples: HeldVocabularyCandidate[];
  newReadSamples: Array<HeldVocabularyRead & { sourceDocumentId: number; institutionName: string | null }>;
}

export function emptyHeldVocabularySummary(): HeldVocabularySummary {
  return { documents: 0, documentsChanged: 0, feesRead: 0, refiles: 0, renames: 0, byChange: {}, newReads: 0, newReadsByCategory: {}, candidateSamples: [], newReadSamples: [] };
}

const cents = (amount: number) => Math.round(amount * 100);
const readKey = (read: HeldVocabularyRead) => `${read.canonicalFeeKey}|${cents(read.amount)}|${read.feeName.toLowerCase()}`;

function reads(text: string, on: boolean): HeldVocabularyRead[] {
  return withHeldNameVocabulary(on, () => runFreeSpecialists(text).candidates).map((candidate) => ({
    canonicalFeeKey: candidate.canonicalHint,
    feeName: candidate.feeName,
    amount: candidate.amount,
  }));
}

/** The reads the vocabulary adds to a text: in the switch-on read and not in the switch-off read. */
export function addedReads(text: string): HeldVocabularyRead[] {
  const off = new Set(reads(text, false).map(readKey));
  const seen = new Set<string>();
  return reads(text, true).filter((read) => {
    const key = readKey(read);
    if (off.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One document's live fees against the reads the vocabulary adds to its text. */
export function replayHeldVocabularyDocument(doc: DocumentRow, text: string, live: readonly LiveFeeRow[]): HeldVocabularyDocumentResult {
  const added = addedReads(text);
  const result: HeldVocabularyDocumentResult = { feesRead: 0, candidates: [], newReads: [] };
  const liveAt = new Set<string>();
  for (const fee of live) {
    const amount = fee.amount == null || fee.amount === "" ? null : Number(fee.amount);
    if (Number(fee.source_document_id) !== Number(doc.source_document_id) || amount == null || !Number.isFinite(amount) || fee.amount_kind === "percent") continue;
    result.feesRead += 1;
    liveAt.add(`${fee.canonical_fee_key}|${cents(amount)}`);
    for (const read of added) {
      if (cents(read.amount) !== cents(amount)) continue;
      result.candidates.push({
        feePublishedId: Number(fee.fee_published_id),
        institutionId: Number(fee.institution_id),
        institutionName: fee.institution_name,
        sourceDocumentId: Number(doc.source_document_id),
        canonicalFeeKey: fee.canonical_fee_key,
        feeName: fee.fee_name,
        amount,
        shape: read.canonicalFeeKey === fee.canonical_fee_key ? "rename" : "refile",
        added: read,
      });
    }
  }
  result.newReads = added.filter((read) => !liveAt.has(`${read.canonicalFeeKey}|${cents(read.amount)}`));
  return result;
}

export function addHeldVocabularyDocument(summary: HeldVocabularySummary, doc: DocumentRow, result: HeldVocabularyDocumentResult, sampleCap: number): void {
  summary.documents += 1;
  summary.feesRead += result.feesRead;
  if (result.candidates.length > 0 || result.newReads.length > 0) summary.documentsChanged += 1;
  for (const candidate of result.candidates) {
    if (candidate.shape === "refile") summary.refiles += 1;
    else summary.renames += 1;
    const change = `${candidate.canonicalFeeKey}->${candidate.added.canonicalFeeKey}`;
    summary.byChange[change] = (summary.byChange[change] ?? 0) + 1;
  }
  summary.candidateSamples.push(...result.candidates.slice(0, Math.max(0, sampleCap - summary.candidateSamples.length)));
  summary.newReads += result.newReads.length;
  for (const read of result.newReads) summary.newReadsByCategory[read.canonicalFeeKey] = (summary.newReadsByCategory[read.canonicalFeeKey] ?? 0) + 1;
  const room = Math.max(0, sampleCap - summary.newReadSamples.length);
  summary.newReadSamples.push(
    ...result.newReads.slice(0, room).map((read) => ({ ...read, sourceDocumentId: Number(doc.source_document_id), institutionName: doc.institution_name })),
  );
}
