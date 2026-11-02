import { SKIP_A_PAY } from "@/lib/fee-fold";

/**
 * v161 (#1092): names Knox held as unclassified, or did not read at all, although the taxonomy and
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
 * - A bare "Title Fee" or "Title transfers": a mortgage's or a car's, which only its section can say,
 *   and Knox reads no section structure (#2872). Two rounds of heading rules on #2888 each let a
 *   mortgage section's title fee through, so 3141 and Texas 38 stay held.
 * - "Mortgage Modification": the fold would file it as other lending, as "Loan Modification" is, but
 *   the one key that prints it (State key 12030) keys a bare "$125.00" under the retired
 *   mortgage_modification type, which no gate can fold without the name, so the read would count as
 *   wrong in the seven-state gate and the golden set. Left for that key row to name its fee.
 */
export const V161_HELD_NAME_VOCABULARY: ReadonlyArray<{ key: string; pattern: RegExp }> = [
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
  // A title the name itself ties to a vehicle ("Auto Title Fee", "Car Title Transfer") and a DMV filing
  // ("DMV Documentation and Transfer", tid 8036; the fold files dmv_filing as vehicle title) are vehicle
  // title. A bare "Title Fee" or "Title transfers" stays held as on main: only the section it sits in can
  // say whose title it is (a mortgage's or a car's), and Knox has no section structure to read (#2872).
  {
    key: "vehicle_title",
    pattern:
      /^(?![\s\S]*\b(?:insurance|search\w*|exam\w*|commitment|polic(?:y|ies)|closing|recording|real estate|mortgages?|deeds?|escrow|abstract|home|property|lien)\b)\W*(?:auto|car)\s+titles?\s+(?:fees?|transfers?)(?:\s*\([^)]*\))?\W*$/i,
  },
  { key: "vehicle_title", pattern: /^(?![\s\S]*\b(?:insurance|real estate|mortgages?|home)\b)[\s\S]*\bDMV\b/i },
  ...v167HeldNameVocabulary(),
];

/**
 * v167 (K1, James's Nov 2 missing-fee review: River City Bank GA 2037, Special Metals FCU NY 5956,
 * Mountain Star FCU TX 4467): clean schedule rows whose name no rule filed, so Knox held them as
 * unclassified or never read them. Each files under a type the taxonomy already has.
 *
 * Left out on purpose (each listed in the PR):
 * - A late "card" payment: a card's late payment is a credit card fee (DECISIONS, Oct 7: credit card
 *   fees stay held), so only a loan, mortgage, lease, vehicle or installment payment is matched.
 * - A "CU Check" / "Credit Union Check" (cashier's or counter check) and a bare "Wire Transfers"
 *   (no direction): both need a decision.
 * - "Address Change - Failure to notify" and "Check Payable to 3rd Party": no type holds either.
 * - An instant-issue debit card (rush card or card replacement) and a protest fee (legal process): the
 *   hand-keyed answer keys leave both unfiled ("| INSTANT ISSUE DEBIT CARD | $7.00 |", Texas 2409;
 *   "Protest Fees (per request) ... $15", "Letter of Protest $10.00", NY 7114 and 8240) while one Texas
 *   key files "Debit Card – Instant Issue and Emboss" as a rush card, so each raised the gates' category
 *   errors (Texas 11 -> 12, NY 4 -> 6). Their home is a category question for James.
 */
function v167HeldNameVocabulary(): Array<{ key: string; pattern: RegExp }> {
  return [
    // "Late Loan Payment | $15.00" (Special Metals FCU): the late payment pattern only reads "late
    // payment", "late charge" or "late fee" with nothing between. A name that carries a cap word
    // ("Late Loan Payment max of $30", text 23093) states a ceiling, not the price, and stays held:
    // the limit guard reads only figures of $100 or more, so it never sees a $30 cap.
    {
      key: "late_payment",
      pattern: /^(?![\s\S]*\b(?:credit|visa|master\s?card|card|skip\w*|box|rent(?:al)?|max(?:imum)?|up\s+to|not\s+to\s+exceed|cap(?:s|ped)?)\b)[\s\S]*\blate\s+(?:(?:consumer|auto|vehicle|car|installment|personal|home equity)\s+)?(?:loan|mortgage|lease|auto|vehicle|installment)\s+payments?\b/i,
    },
    // "Charged Back Checks | $4.00 (returned deposit item – per item)" (River City Bank): a deposited
    // check charged back to the account. A card's or a loan's chargeback is not one.
    {
      key: "deposited_item_return",
      pattern: /^(?![\s\S]*\b(?:cards?|visa|master\s?card|debit|credit|loans?|disput\w*|ach)\b)[\s\S]*\bcharged[- ]back\s+(?:deposit(?:ed)?\s+)?(?:checks?|items?|drafts?)\b/i,
    },
    // "Image Statement Fee | $2.00 (check images with account statement ...)" (River City Bank): the
    // check images sent with the statement. An e-statement is not one, nor a non-image statement (the
    // paper statement with cancelled checks: INB's "Non-Image Statement Fee (includes cancelled checks)").
    { key: "check_image", pattern: /^(?![\s\S]*\be-?\s?statements?\b)(?![\s\S]*\bnon[-\s]?imaged?\b)[\s\S]*\b(?:image|imaged)\s+statements?\b/i },
    // "Coin Deposit 5% of total" (Mountain Star FCU): counting a coin deposit. A coin deposit bag or
    // wrapper is a supply.
    { key: "coin_counting", pattern: /\bcoin\s+deposits?\b(?!\s+(?:bags?|wrappers?|tubes?|slips?))/i },
    // "Daily Transaction Copies", "Reprint Monthly Statements" (Mountain Star FCU): a copy of a
    // transaction record or a reprinted statement is a document copy.
    { key: "document_reproduction", pattern: /\btransaction\s+cop(?:y|ies)\b|\bre-?print(?:ed|s)?\s+(?:of\s+)?(?:(?:monthly|account|bank|periodic|past|prior)\s+)?statements?\b/i },
    // "Savings Withdrawal Fee | $2.00 each after 4 withdrawals", "Money market excess check" (Mountain
    // Star FCU): a savings, share or money market account's fee per withdrawal or extra check is the
    // excess withdrawal fee. An ATM's, a club's or an IRA's is not.
    {
      key: "excess_withdrawal",
      pattern: /^(?![\s\S]*\b(?:atms?|clubs?|christmas|holiday|vacation|ira|early|penalt\w*|certificates?|cds?|teller)\b)(?:\W*(?:savings|share|money\s+market)\s+(?:accounts?\s+)?withdrawals?\s+(?:fees?|charges?)\b|[\s\S]*\b(?:savings|share|money\s+market)\b[\s\S]{0,25}\bexcess(?:ive)?\s+(?:checks?|drafts?)\b)/i,
    },
  ];
}

/**
 * The switch for the five paths that change a fee already live: Knox's re-read of Darwin's requests
 * (`decideRereads`: a rename, or an `other_category` settlement), Darwin's re-read category check
 * (`reread-category-check.ts`: a re-file or a twin takedown), Darwin's overdraft-transfer and
 * protection-item re-files, the live name re-tidy (`planLiveRetidy`) and Hamilton's live name refresh
 * (`judgeLiveNameRefresh`). Off (the default), those paths read without the v161 vocabulary, exactly
 * as main reads, so the vocabulary itself re-files, renames and takes down no live fee. New reads
 * publish through Darwin, except onto a printed line a live fee already holds in any category
 * (`selectLiveFeeOnLine` in Hamilton's publish). Hamilton's rules re-check, its restores included,
 * reads with the vocabulary, so a fee it publishes stays reproduced and the re-check takes down no fee
 * it keeps today; a fee an earlier re-check took down that the vocabulary now reads can come back over
 * the restore bar. Turning the switch on lets those paths re-file or rename live fees by these names:
 * count them first (`npm run audit:switch-dry-runs`, section 6).
 */
export const HELD_VOCABULARY_RELABEL_LIVE = false;

let vocabularyOn = true;

/** Runs `read` with the v161 vocabulary on or off. Synchronous reads only. */
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

/** Whether reads now take the v161 vocabulary (a cache of reads keys on it). */
export function heldNameVocabularyOn(): boolean {
  return vocabularyOn;
}

/** The v161 key a name no other rule files takes, or null (null too while the vocabulary is off). */
export function heldNameVocabularyKey(text: string): string | null {
  if (!vocabularyOn) return null;
  return V161_HELD_NAME_VOCABULARY.find((entry) => entry.pattern.test(text))?.key ?? null;
}
