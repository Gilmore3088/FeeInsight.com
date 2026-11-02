import { SKIP_A_PAY } from "@/lib/fee-fold";

/**
 * v156 (#1092): names Knox held as unclassified, or did not read at all, although the taxonomy and
 * DECISIONS already say where they go (shadow lab on main eaf6bef: 34 answer-key rows across 19
 * documents held for want of a name rule). Tried after every other name rule, the held-name rules and
 * v101's vocabulary included, so a name another rule files keeps its category: these only classify a
 * name that classifies as nothing today.
 *
 * Left held on purpose (each listed in the PR):
 * - "Wire Transfer" with no direction: the taxonomy has no undirected wire, and about 1 in 5 such
 *   lines name incoming or international after the price (v75).
 * - A PIN on its own ("Pin Number", "PIN reminder/PIN change"): guard v80 refuses a lone PIN as card
 *   replacement (`NOT_A_LONE_PIN`).
 * - Printouts ("Account Activity Printout"): the keys file them as research at two banks and as
 *   copies at most others; DECISIONS says neither.
 * - UCC termination: DECISIONS v26 files UCC fees as loan origination, but a termination releases the
 *   lien, and a lien release stays other lending (Oct 8); the one key that prints it says other lending.
 * - A reopened account: the taxonomy's alias says early closure, Knox's rule says a reopening is not
 *   one, and the keys leave most unmapped.
 * - "Loan Extention": Knox files "loan extension" as other lending; the one key that prints this
 *   spelling files it as loan origination.
 * - Credit card, phone transfer and over-limit fees (DECISIONS, Oct 7: no right home).
 * - A plain amortization schedule: its category is a question for James (#1099, rules.test.ts).
 * - "Mortgage Modification": the fold would file it as other lending, as "Loan Modification" is, but
 *   the one key that prints it (State key 12030) keys a bare "$125.00" under the retired
 *   mortgage_modification type, which no gate can fold without the name, so the read would count as
 *   wrong in the seven-state gate and the golden set. Left for that key row to name its fee.
 */
export const V156_HELD_NAME_VOCABULARY: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  // Skipping a loan payment is other lending, not a late payment (#1335; James's Oct 17 call as
  // recorded in PR #1766, guard v70; and the
  // taxonomy's skip-a-pay aliases): "Skip-a-Loan payment" (tid 8034), "Year round skip-a-loan-payment"
  // (tid 7114), "Loan Skip Pay (restrictions apply)" (tid 11470). The shared `SKIP_A_PAY` already
  // leaves out an overdraft's skip, a free one and a "no fee" one; a late charge and a credit card's
  // skipped payment (DECISIONS, Oct 7: credit card fees stay held) stay held.
  { key: "other_lending_fee", pattern: new RegExp(String.raw`^(?![\s\S]*\b(?:late|credit|visa|master\s?card)\b)` + SKIP_A_PAY.source, "i") },
  // Re-amortizing a loan is a modification ("Reamortization schedule", tid 8085), which the fold
  // files as other lending (a percentage as no price). A plain amortization schedule stays held: its
  // category is a question for James (#1099).
  { key: "mortgage_modification", pattern: /\bre-?\s?amorti[sz]\w*/i },
  // Processing a payoff ("Mortgage Payoff Processing Fee", tid 8085): v75 files a payoff's demand,
  // request, statement or letter as other lending, the fold's home for mortgage_payoff.
  { key: "other_lending_fee", pattern: /\bpay-?offs?\s+processing\b/i },
  // Taking a foreign check (tid 7114): foreign checks are collection items (DECISIONS, 2026-10-08,
  // "Own type").
  // Cashing or returning one is not.
  {
    key: "collection_item",
    pattern: /^(?![\s\S]*\b(?:cash\w*|returns?|returned)\b)[\s\S]*\b(?:foreign|canadian|international)\s+(?:checks?|items?|drafts?)\s+(?:acceptance|accepted)\b/i,
  },
  // A letter or verification of what a member holds or owes: "Immigration letter" (tid 3515),
  // "Proof of Funds Letter (Verification of Funds)" (tid 12752), "Verification of mortgage" (tid 8034).
  { key: "account_verification", pattern: /\bproof of funds\b|\bverification of (?:funds|mortgages?)\b|\bimmigration letters?\b/i },
  // A bare title fee or title transfer is the vehicle title's ("Title Fee" $18, tid 3141; "Title
  // transfers", Texas tid 38), and a DMV filing is too ("DMV Documentation and Transfer", tid 8036;
  // the fold files dmv_filing as vehicle title). Title insurance, a title search or exam, a closing's
  // or recording's title charge and any real estate title stay held: they are a mortgage's.
  {
    key: "vehicle_title",
    pattern:
      /^(?![\s\S]*\b(?:insurance|search\w*|exam\w*|commitment|polic(?:y|ies)|closing|recording|real estate|mortgages?|deeds?|escrow|abstract|home|property|lien)\b)\W*(?:(?:vehicle|auto|car)\s+)?titles?\s+(?:fees?|transfers?)(?:\s*\([^)]*\))?\W*$/i,
  },
  { key: "vehicle_title", pattern: /^(?![\s\S]*\b(?:insurance|real estate|mortgages?|home)\b)[\s\S]*\bDMV\b/i },
];

/**
 * The switch for the five paths that change a fee already live: Knox's re-read of Darwin's requests
 * (`decideRereads`: a rename, or an `other_category` settlement), Darwin's re-read category check
 * (`reread-category-check.ts`: a re-file or a twin takedown), Darwin's overdraft-transfer and
 * protection-item re-files, the live name re-tidy (`planLiveRetidy`) and Hamilton's live name refresh
 * (`judgeLiveNameRefresh`). Off (the default), those paths read without the v156 vocabulary, exactly
 * as main reads, so the vocabulary itself re-files, renames and takes down no live fee. New reads
 * publish through Darwin, except onto a printed line a live fee already holds in any category
 * (`selectLiveFeeOnLine` in Hamilton's publish). Hamilton's rules re-check, its restores included,
 * reads with the vocabulary, so a fee it publishes stays reproduced and the re-check takes down no fee
 * it keeps today; a fee an earlier re-check took down that the vocabulary now reads can come back over
 * the restore bar. Turning the switch on lets those paths re-file or rename live fees by these names:
 * count them first (`npm run audit:switch-dry-runs`, section 5).
 */
export const HELD_VOCABULARY_RELABEL_LIVE = false;

let vocabularyOn = true;

/** Runs `read` with the v156 vocabulary on or off. Synchronous reads only. */
export function withHeldNameVocabulary<T>(on: boolean, read: () => T): T {
  const before = vocabularyOn;
  vocabularyOn = on;
  try {
    return read();
  } finally {
    vocabularyOn = before;
  }
}

/** Runs a live-fee correction's read under `HELD_VOCABULARY_RELABEL_LIVE`. Synchronous reads only. */
export function forLiveRelabel<T>(read: () => T, live: boolean = HELD_VOCABULARY_RELABEL_LIVE): T {
  return withHeldNameVocabulary(live, read);
}

/** Whether reads now take the v156 vocabulary (a cache of reads keys on it). */
export function heldNameVocabularyOn(): boolean {
  return vocabularyOn;
}

/** The v156 key a name no other rule files takes, or null (null too while the vocabulary is off). */
export function heldNameVocabularyKey(text: string): string | null {
  if (!vocabularyOn) return null;
  return V156_HELD_NAME_VOCABULARY.find((entry) => entry.pattern.test(text))?.key ?? null;
}
