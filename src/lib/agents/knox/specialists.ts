import { feeApplicability } from "@/lib/fee-audience";
import {
  billPayByHeading,
  extractCandidatesFromText,
  recognizedFeeBullets,
  isUnpricedHeldShape,
  MAX_FEES_PER_DOCUMENT,
  withBoxSizeCellsSplit,
  withSidewaysBoxTable,
  withoutBusinessOnlyFees,
  withoutLeadingFootnoteMark,
  type DroppedLineReason,
  type ExtractedFeeCandidate,
  type ExtractionRulesResult,
  type HeldFeeCandidate,
} from "@/lib/agents/knox/rules";
import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "@/lib/agents/knox/families";
import { newestColumnText } from "@/lib/fee-change-columns";
import { namesALimit, namesAWorkedExample, passesDarwinChecks, readsAMeasuredAmount, tidyFeeName } from "@/lib/agents/knox/layout";
import { extractTableCandidates, KNOX_TABLE_STRATEGY } from "@/lib/agents/knox/table-rows";
import { extractAccountTableCandidates, KNOX_ACCOUNT_TABLE_STRATEGY } from "@/lib/agents/knox/account-table";
import { checkFeeAgainstSource, joinLabeledFeeCardText } from "@/lib/custom-report/source-check";
import { rateFeeFromHeld, type RateFeeCandidate } from "@/lib/agents/knox/percent";
import { contextFees, NO_LONGER_CHARGED } from "@/lib/agents/knox/context-names";
import { frequencyFromLine, settledFrequency } from "@/lib/fee-frequency";
import { withoutFeeBullets } from "@/lib/custom-report/fee-bullets";
import { exclusiveStackedPrices, stackedFeePrices } from "@/lib/custom-report/stacked-fee-prices";
import { monthlyAccountOwnerReview } from "./monthly-account-owners";
import { withOwnFeeUnit } from "@/lib/custom-report/own-fee-unit";
import { mayHaveSymbolicLesserFee, symbolicLesserOfReview } from "./symbolic-lesser-of";
import { internationalWireEligibility } from "./international-wire-eligibility";
import { belongsToPaidReturnedUnit, paidReturnedUnits } from "@/lib/custom-report/paid-returned-events";

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
// v48: a fee-change notice's row ("Fee through | Fee as of") is read at its newest column.
// v49: a monthly fee with no account name takes it from its own name or the heading above it.
// v50: a personal per-item-paid row under an overdraft heading (context-names.ts).
// v51: a monthly fee also takes the balance that avoids it, its waiver and the opening deposit from its account's lines.
// v52: frequency settled by the fill's rule (`settledFrequency`), with fee-frequency v4 wording.
// v53: a fax service is document reproduction, the fold's home for it (`FAX_SERVICE`).
// v54: a copy charged by the page is document reproduction, even under research (`PER_PAGE_COPY`).
// v55: a monthly fee's lineup is never read from a neighbour: the next account's fee line, another
// account's clause of a one-line footnote, or a fee heading above "Money Market" (`lineup.ts`).
// v56: balancing or reconciling a checkbook is account research (`CHECKBOOK_RECONCILIATION`).
// v57: a long table row is traced by its short cells, and a name drops a details cell, an "N/A" cell
// and a leading "Otherwise,"; "to avoid $3 paper statement fee" is named after its price (Arvest, Old National).
// v59: a "Cross-Border Banking" bundle or package is an account, so its fee is the account's
// maintenance fee, not the card's currency fee (`CROSS_BORDER_BUNDLE`; RBC, TD, BMO).
// v60: a threshold parenthetical keeps its figure in the name ("Cashier's Checks ($10,000.01 and Over)"),
// a "Name" column label is dropped, and "In addition to the ... Fee" keeps its words (`nameFrom`, `tidyFeeName`).
// v61: adjusting an ATM deposit or dispute is account research, not a network ATM fee (`ATM_ADJUSTMENT`).
// v62: a dot-leader line's name wrapped over lines above it is read whole (`joinWrappedLeaderNames`),
// "Domestic Outgoing (client only) .... $25.00 per wire" is a wire, and one line read by two
// specialists is one fee (Northern Trust).
// v63: a box size glued after another fee's name starts its own line (doc 20570).
// v64: a box table printed sideways, sizes over prices, is read one box per line (SCCU 8109).
// v65: every read carries a customer audience (`fee_audience`, `audience_evidence`, `fee_treatment`).
// v66 was held for the dropped-lines fix and never shipped; v67 (#1334) took the next bump.
// v67 (#1334): no rule change; every current text is read once more so the dropped-decimal reads
// #1196/#1305 taught the rules pass ("$29. 95" is $29.95, "$1 50*" is $1.50) reach stored pages.
// v68 (#1102): fee-schedule labels with no "fee" or "charge" (research, notary acts, night drop,
// box keys and sizes, extra statements, copies), a "FREE" column beside priced columns, and
// label-and-price rows no rule names held in a fee schedule instead of dropped, with every
// dropped priced line counted by reason.
// v69 (#1102): a price line with no name of its own (a bare "$12", "Outgoing domestic $25") takes
// its name from a short fee heading up to four lines above it, unless a row under that heading
// already read another kind of fee.
// v70 (#1100): monthly maintenance and low-balance fees the account expert missed: a low-balance
// charge named without a fee word and charged by the period, one stated in a sentence ("a low
// balance fee of $6.95 will be imposed every statement cycle"), and a price after a balance word
// that belongs to the figure before it ("Below $500.00 minimum $5.00 per Month").
// v73 (#1100): every monthly maintenance and minimum balance read records the account it belongs
// to: the lineup's product, the account table's column header, the nearest account heading
// (one that names only the kind of account counts), then the fee's own name; null when none does.
// v74: a footnote number glued to the front of a name comes off when the page prints the footnote
// as its own line or cell ("1Monthly fee of $5.95 applies ..." is "Monthly fee";
// `withoutLeadingFootnoteMark`). 35 live fees and 51 raw reads in two days carried one on Oct 16.
// v75: the recurring name families the 62-bank answer key showed held or unread (`RECALL_FAMILY_PATTERNS`:
// rush shipping, mortgage payoff/satisfaction/reconveyance, mortgage processing, club withdrawals and
// short-window closures, wires "within the U.S.", IRA withdrawals and transfers, assisted loan
// payments, skip payments, mobile check deposit), and
// one price for a "debit or credit card" is the debit card's. Every current copy read before v75 is
// read once more (`KNOX_STALE_READ_BELOW_VERSION`).
// v76: the next three recall families on the 62-bank answer key (`rules.ts`): a row pricing each slash
// variant of its fee ("(Online/Manual) | $35/$60") or a box size in two price columns reads every price,
// and a "$ | 5.00" split cell is one price; a free schedule row the line rules never read (dot leader,
// markdown row, "No Cost to Members", "Notary Services: no fee", "No charge for notarization") is held
// at $0 unless it is an allowance; a price that varies ("Check printing prices vary") is held as
// `varies` with no amount. Every current copy read before v76 is read once more.
// v77 (#1398, with `RESEARCH_SPLIT_LIVE` on): returned mail and excess withdrawal lines file under
// their own types (`researchSplitTarget` in rules.ts), not account research.
// v78 (Knox recall round 3, Oct 17; #1304's Knox half): a bill pay read priced under an overdraft
// (courtesy pay) or NSF heading, on its own line or the heading line above, files under that fee
// (`billPayByHeading`), and no later specialist adds it back as bill pay; a bare late fee right after a
// safe deposit box read or under its heading is the box's (`boxLateFee`); a box size before its dot
// leader names the box;
// a checking account's own free row is its monthly fee at $0; and the next name families the 62-bank
// key held (`V78_RECALL_PATTERNS`; statement printouts fold to document reproduction). Every current
// copy read before v78 is read once more (`KNOX_STALE_READ_BELOW_VERSION`).
// v79 (#1827): a price-first row keeps its own price. A table row that opens with its price ("| **$20** |
// Key Deposit |", Valley Strong CU; "$10 | Replacement Debit Card") is the name after it, not the line
// above, so the rows no longer each take the next row's price; under a name that says its price varies
// ("Mortgage satisfaction fee (varies)", Citadel FCU) a price with a name after it is that name's. A
// bare price still goes to the name above, and so does any price under a name that runs on ("...
// Savings Account per"). The stale-read floor stays at v78: no page is read again for this alone.
// v81 (#1830): a later specialist's read of an earlier find's line at its price, named by a part of
// that find's name, is that fee read from its tail and is not kept (`tailOfEarlierRead`): "ACH or Bill
// Pay" from "Stop Payment (check, ACH or Bill Pay) | $25" is no bill pay fee. The stale-read floor
// stays at v78: no page is read again for this alone.
// v82 (round 2 live check, #2123): a combined NSF/overdraft line's twin is stored as its own raw row
// (`line_share`, migration 20270110000065); before, the raw key (document, name, price, audience)
// dropped it. The joined name also matches with the abbreviation in brackets ("Non-sufficient funds
// (NSF) or Overdraft (OD)") and with a returned item for NSF ("Overdraft/Return Item Fee"). The
// stale-read floor stays at v78; only pages with a combined row and no twin are read again
// (`KNOX_TWIN_READ_BELOW_VERSION`).
// v83 (#2151): explicitly labeled, bounded wrapped bullets keep their own terminal price and
// complete conditions. All readers and the source witness share physical ownership, so a
// neighboring paid/returned row cannot donate its price. Stale-read floor remains v78.
// v84 (#2209): bounded returned/paid-item policy paragraphs keep literal tier/exception scope;
// dollar totals of a fee count fail the shared source check. Existing re-read floors stay settled.
// v85 (#2240/#2241): explicit stacked fee labels own their prices; an own annual
// overdraft-program charge stays held instead of losing its period on the paid-item path.
// v86 (#2259): repeated monthly price prose without one literal account owner stays
// eligibility-held; paid and minimal-row callers share the source-bearing writer gate.
// v87 (#2248): new raw lineage keeps literal own charging units and full conditions;
// known special units leave mixed-unit comparisons. Historical raw metadata stays settled.
// v88 (#2021/#2284/#2286): explicit domestic post-price directions bind paired wire
// prices; the same bounded own-price refusal applies to free, paid and live rechecks.
// v89 (#1102): the held-name rules are on (stop pay, reconveyance, early closure, paper
// statements, box sizes, IRA close-outs); returned statements stay held (James's v26 call).
// v90: returned statements file as returned mail (James's decision card, Oct 20, "File them").
// v91 (#1829): a fax-led line ("Fax (Domestic & International)", "Faxes (Domestic only)") reads as
// document reproduction (`FAX_SERVICE`, fold v19); "domestic" there is where the fax goes, not a
// wire. The stale-read floor stays at v78; the fold moves the live ones.
// v93 (#1828): a dot-leader row priced in words ("Reconveyance………… Actual Cost", "Check Orders……
// Prices Vary", "Incoming Wire....... Free") closes its line. It is never a heading or a name for
// the row under it, in the rules or the family passes, and a name never runs on from it
// ("Reconveyance .. Actual Cost: Returned payment" was read at the next row's $4.95, Oregon
// Community FCU, doc 19849; Gunnison's "Wire Fee" $25 never borrows the free incoming wire's
// direction). Follows #2470's v91; #2465 is v94. The stale-read floor stays at v78; name re-tidy
// v24 renames the live names it left.
// v94 (#1827; numbered v92 until #2467 took v93): a cell-less price-first list ("$100.00 Safe
// Deposit Box Drilling/Per Box" / "$14.00 Safe Deposit Box 3”x5”x22”/Year") is read one fee per line when it runs two lines or more and no bare
// price closes it, a range row ("$5-$15 | Levy") never names the row under it, and a heading never
// takes the price of a price-first line that names its own fee. Before, each box took the next
// size's price (Colby, doc 37839) and the levy took the garnishment's $20 (doc 2491). The stale-read
// floor stays at v78; the shared source check (v19) takes the wrong live reads down.
// v95 (#1916; numbered v94 until #2465 took it): a fee never takes the other column's price on a
// two-column page. Advia FCU's "ATM Transactions" and "Garnishment/Tax Levy/Subpoena" took Money Market Checking's "$10.00 monthly for
// average" (the right column's price, flattened onto their name rows), and "Member-Requested ATM/
// Debit" took Account Reopen's $10. The self-check (`checkFeeAgainstSource`, `refusesOtherColumnPrice`)
// now refuses those reads, so they stay untraced holds. The stale-read floor stays at v78; source
// check v20 takes the live ones down.
// v96 (#1810): an account heading with a service mark glued to its last word ("Chase SavingsSM",
// "Chase Private Client CheckingSM 6") reads as the account above a monthly fee (`headingWithoutMark`).
// Before, Chase's $5 Chase Savings fee recorded no account, so the account-type hold never held it
// and it stayed live as checking's "Monthly Service Fee" beside the $25 one. A large bank's page is
// read again once per rules version, so Chase's re-read fills the empty product and the account-type
// hold is the live re-check. The stale-read floor stays at v78.
// v97: a schedule flattened to one long line is read to its end. A cents-only price and its unit
// ("$.40 each") close a dot-leader row, so the next row is not glued to it past the segment limit,
// and a document may hold 1,000 priced segments, not 150, so a schedule printed after a long account
// agreement is reached (Texas key 841: cashier's check, card replacement, early closure, excess
// withdrawal, maintenance and overdraft rows). In a long line, a price with a slash unit ("$35.00/Item")
// ends its row too (State key 60). Texas gate: all 578 -> 590 right, 11 wrong unchanged; held out
// 53 -> 60, 4 unchanged. Seven states: 870 -> 877 right; GA 172 -> 179 right and 9 -> 10 wrong, the new
// wrong read refused by Darwin's verify. The stale-read floor stays at v78.
// v98: the previous row's condition glued in front of a name in a long line ("If the balance falls
// below on any day of the cycle Excess withdrawal", "30 minute minimum Wire transfer outgoing", "and
// minimum Photocopies") is dropped (`withoutLeadingCondition` in `tidyFeeName`). Names only: the shadow
// lab's numbers and the Texas and state gates are unchanged. The stale-read floor stays at v97. Name
// re-tidy stays at v26 (no fleet-wide live rename without a dry-run count).
export const KNOX_RULES_STRATEGY = { strategy: "extract.rules", version: 98 } as const;

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
  /** v68: priced lines no rule names that were neither read nor held, by reason. */
  dropped: Partial<Record<DroppedLineReason, number>>;
}

const MAX_HELD_PER_DOCUMENT = 40;
/** v76: a $0 or "prices vary" hold, untraced $0 rows included, counts in the unpriced half of the held cap. */
const unpricedHalf = (row: HeldFeeCandidate): boolean => isUnpricedHeldShape(row.shape) || (row.shape === "untraced" && row.amount === 0);
/**
 * NSF and overdraft joined as one item's name: "NSFs/Overdrafts", "Overdraft or NSF Item".
 * v82: also with the abbreviation in brackets ("Non-sufficient funds (NSF) or Overdraft (OD) per
 * item") and a returned item for NSF ("Overdraft/Return Item Fee", "Returned Item/Overdraft fee").
 */
const NSF_TERM = String.raw`(?:(?:non[-\s]?sufficient|insufficient) funds?(?:\s*\(nsfs?\))?|nsfs?|return(?:ed)? items?)`;
const OD_TERM = String.raw`(?:overdrafts?(?:\s*\(od\))?|OD)`;
const NSF_AND_OVERDRAFT = new RegExp(
  String.raw`\b${NSF_TERM}\s*(?:\/|\bor\b|\band\b|&)\s*${OD_TERM}(?![\w-])|\b${OD_TERM}\s*(?:\/|\bor\b|\band\b|&)\s*${NSF_TERM}\b`,
  "i",
);
const MAX_UNCLASSIFIED_PER_DOCUMENT = 10;
/** v78: a read's category, and the categories the rules pass re-files it to by its heading (`billPayByHeading`, `boxLateFee`). */
const REFILED_BY_HEADING: Readonly<Record<string, readonly string[]>> = {
  bill_pay: ["overdraft", "nsf"],
  late_payment: ["safe_deposit_box"],
};

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
  if (a.canonicalHint !== b.canonicalHint || a.amount !== b.amount || a.feeAudience !== b.feeAudience) return false;
  // v62: one source line read by two specialists is one fee, whatever each named it
  // ("Domestic Incoming wire" and "Wire Transfers: Domestic Incoming", Northern Trust).
  if (a.excerpt.trim() === b.excerpt.trim()) return true;
  const nameA = words(a.feeName);
  const nameB = words(b.feeName);
  if (nameA === nameB || words(a.excerpt).includes(nameB) || words(b.excerpt).includes(nameA)) return true;
  return nameA.split(" ").slice(0, 2).join(" ") === nameB.split(" ").slice(0, 2).join(" ");
}

/**
 * v81 (#1830): one source line at one price read twice, the second time by its tail. A family
 * expert reads the words nearest a price, so "Stop Payment (check, ACH or Bill Pay) | $25" came back
 * as "ACH or Bill Pay" filed as bill pay, beside the rules pass's stop payment. On prod (Oct 19, read-only) 38
 * live fees at 35 banks were a later specialist's tail of another live fee read from the same line of
 * the same document at the same price, under another category: "Fax Fee" of "Verification of Deposit by Fax Fee", "Teller Check" of "Copy of a
 * draft or a Teller Check". The earlier find already names the whole row, so the tail adds nothing.
 * Only a strictly shorter name made of whole words of the earlier one counts. Two fees named
 * together at one price ("Returned Check & Stop Payment Fee $30") are both kept: a part the earlier
 * name joins with "&", "and", "or", "/" or "+" outside any parenthesis is a fee of its own
 * (`joinedFeeName`), while one inside a parenthesis or after "on" or "including" is not.
 */
export function tailOfEarlierRead(prior: ExtractedFeeCandidate, later: ExtractedFeeCandidate): boolean {
  if (prior.amount !== later.amount || prior.excerpt.trim() !== later.excerpt.trim()) return false;
  const whole = words(prior.feeName);
  const part = words(later.feeName);
  if (part === "" || part.length >= whole.length || !` ${whole} `.includes(` ${part} `)) return false;
  return !joinedFeeName(prior.feeName, part);
}

/** v81: the part (already in `words` form) follows a top-level "&", "and", "or", "/" or "+" in the name. */
export function joinedFeeName(rawName: string, part: string): boolean {
  const name = rawName.replace(/&amp;/gi, "&");
  for (let index = 0; index < name.length; index += 1) {
    if (index > 0 && /[a-z0-9]/i.test(name[index - 1]!)) continue;
    const rest = words(name.slice(index));
    if (rest !== part && !rest.startsWith(`${part} `)) continue;
    const before = name.slice(0, index);
    const depth = (before.match(/\(/g) ?? []).length - (before.match(/\)/g) ?? []).length;
    if (depth > 0) continue;
    if (/(?:[&/+]|\b(?:and|or))\s*$/i.test(before)) return true;
  }
  return false;
}

/** The shared accuracy check, as Darwin reads it: a tiered price is the bank's real price for its band. */
function tracesToSource(text: string, feeName: string, amount: number): boolean {
  const result = checkFeeAgainstSource(text, feeName, amount, ".");
  return result.ok || result.reason === "tiered_fee";
}

/** The self-check's verdict: whether the fee traces, and the row it traced to. */
function selfCheck(text: string, feeName: string, amount: number, canonicalHint?: string): { traces: boolean; row: string | null } {
  const result = checkFeeAgainstSource(text, feeName, amount, ".", canonicalHint);
  return { traces: result.ok || result.reason === "tiered_fee", row: result.ok ? result.sourceLine : null };
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
    candidates: [...contextFees(text), ...read.candidates.filter((fee) => fee.audienceEvidence != null || !NO_LONGER_CHARGED.test(fee.excerpt))],
    held: read.held.filter((row) => !NO_LONGER_CHARGED.test(row.excerpt)),
    dropped: read.dropped,
  };
}

/** v74: a read name without the footnote number the page glued to its front; the name as read otherwise. */
function unmarkedName(name: string, text: string, institutionName: string | null): string {
  return withoutLeadingFootnoteMark(name, [text], institutionName) ?? name;
}

/**
 * v74: the name tidied, with a leading footnote number cut before the tidy and again after it,
 * since the tidy can leave one at the front ("each | 8Legal Process Service" is "8Legal ..." once
 * its unit cell goes; doc 20097).
 */
function tidyUnmarkedName(name: string, text: string, institutionName: string | null): string {
  return unmarkedName(tidyFeeName(unmarkedName(name, text, institutionName)), text, institutionName);
}

export function runFreeSpecialists(sourceText: string, options: { institutionName?: string | null } = {}): FreeExtractionResult {
  const institutionName = options.institutionName ?? null;
  // Labeled fee cards ("Fee TypeX" / ... / "Fee$5.00") are read as one row, as the shared
  // check reads them; the self-check still runs against the stored text.
  // v62: a fee footnoted as business-only is no specialist's to read (`withoutBusinessOnlyFees`).
  // v63: a safe deposit box size glued after a fee's name starts its own line (`withBoxSizeCellsSplit`).
  // v64: a box table printed sideways, sizes over prices, becomes one line per box (`withSidewaysBoxTable`).
  const text = withSidewaysBoxTable(withBoxSizeCellsSplit(withoutBusinessOnlyFees(joinLabeledFeeCardText(sourceText))));
  const legacyText = withoutFeeBullets(text, recognizedFeeBullets(text));
  const windows = priceWindows(legacyText);
  const stackedPrices = stackedFeePrices(text);
  const specialists: Array<{ strategy: string; version: number; pass: 1 | 2; run: () => ExtractionRulesResult }> = [
    { ...KNOX_RULES_STRATEGY, pass: 1, run: () => withContextFees(legacyText, extractCandidatesFromText(text)) },
    // v62: the table pass reads a fee-change table at its newest column too, as the self-check does.
    { ...KNOX_TABLE_STRATEGY, pass: 2, run: () => extractTableCandidates(newestColumnText(legacyText)) },
    // #1100 gap 3: each product's monthly fee in an account comparison table, read by its column.
    { ...KNOX_ACCOUNT_TABLE_STRATEGY, pass: 2, run: () => extractAccountTableCandidates(newestColumnText(legacyText)) },
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
  const dropped: Partial<Record<DroppedLineReason, number>> = {};
  const countDropped = (reason: DroppedLineReason, count = 1) => {
    dropped[reason] = (dropped[reason] ?? 0) + count;
  };

  for (const specialist of specialists) {
    const run = specialist.run();
    // v78 (#1304): no specialist files a bill payment priced under an overdraft or NSF heading on
    // its own line as bill pay (`billPayByHeading`); the table pass named such a cell by its words.
    const found = { ...run, candidates: run.candidates.map((read) => billPayByHeading(read)).filter((read): read is ExtractedFeeCandidate => read != null) };
    for (const [reason, count] of Object.entries(found.dropped ?? {})) countDropped(reason as DroppedLineReason, count);
    let added = 0;
    let selfCheckFailed = 0;
    for (const read of found.candidates) {
      if (candidates.length >= MAX_FEES_PER_DOCUMENT) break;
      // v44: a fee with no frequency takes the one its own line states right after its price
      // ("$6.00 each", "| $28.00 | Per request"); Darwin's eval found 48% of live fees blank.
      // v47: the fee's own row wins over a frequency read anywhere on the line, and one read
      // from another fee's row is dropped ("... per year .. $10.00 | Reverse Stop Payment
      // .. $20.00" gave the $20 fee "annual"); 25 of 131 stated frequencies in the seven-state
      // keys were wrong this way.
      // v52: the same rule as Hamilton's frequency fill (`settledFrequency`), so a period the line
      // never states is dropped on a per-event fee and a per-item reading never lands on a period
      // category.
      // v57: a fee whose own row traces reads its frequency from that row, not from a window
      // that stops at the price ("... four (4) OD fees per day ... | $17.00 | per item" is per item).
      // v74: a footnote number glued to the front of the name comes off (`withoutLeadingFootnoteMark`).
      const feeName = tidyUnmarkedName(read.feeName, text, institutionName);
      const ownPrices = exclusiveStackedPrices(text, stackedPrices, feeName).filter(row => row.amount === read.amount);
      if (read.canonicalHint === "overdraft" && ownPrices.length > 0 && ownPrices.every(row => row.annualProgram)) {
        const row: HeldFeeCandidate = {
          shape: "periodic_program",
          feeName,
          amount: read.amount,
          amountMax: null,
          percent: null,
          frequency: "annual",
          canonicalHint: read.canonicalHint,
          excerpt: ownPrices[0].ownText,
          ownedPolicy: true,
        };
        const key = heldKey(row);
        if (!seenHeld.has(key) && held.filter(prior => !unpricedHalf(prior)).length < MAX_HELD_PER_DOCUMENT) {
          seenHeld.add(key);
          held.push(row);
        }
        continue;
      }
      const checked = selfCheck(text, feeName, read.amount, read.canonicalHint);
      const rowFrequency = checked.row ? frequencyFromLine(checked.row, read.amount) : null;
      const frequency = rowFrequency
        ? settledFrequency(checked.row, read.amount, rowFrequency, read.canonicalHint)
        : settledFrequency(read.excerpt, read.amount, read.frequency, read.canonicalHint);
      const candidate = { ...read, ...feeApplicability(feeName, read.excerpt, read.amount), feeName, frequency };
      // v28: a limit is not a price ("Zelle transfer limit | $1,000").
      if (namesALimit(candidate.feeName, candidate.canonicalHint)) continue;
      // v32: a name that closes a parenthesis it never opened ("SCCU for using a non-SCCU
      // ATM) | $60") is the end of the line above, and the price is another column's.
      if (closesUnopenedParen(candidate.feeName)) continue;
      // v32: a worked example's figure is not a price.
      if (namesAWorkedExample(candidate.feeName)) continue;
      // v32: the figure after "is at least" or "Fee on (the)" is a balance or a transaction.
      if (readsAMeasuredAmount(text, candidate.feeName, candidate.amount)) continue;
      if (!checked.traces) {
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
              prior.feeAudience === candidate.feeAudience &&
              prior.amount === candidate.amount &&
              prior.feeName.toLowerCase() === candidate.feeName.toLowerCase(),
          )
        : candidates.some((prior) => sameFee(prior, candidate));
      if (duplicate) continue;
      // v81 (#1830): a later specialist's read of an earlier find's own line at its price, named by
      // a part of that find's name, is that fee read from its tail, whatever category the tail names.
      if (specialist.pass === 2 && candidates.some((prior) => tailOfEarlierRead(prior, candidate))) continue;
      // v78 (#1304): a later specialist's read of a row the rules pass already filed by its heading
      // is that fee again: bill pay under an overdraft or NSF heading ("Courtesy Pay: Check/ACH/Bill
      // Pay Payment"), a bare late fee among a safe deposit box's lines ("Safe Deposit Box Late Payment").
      const refiledByHeading = REFILED_BY_HEADING[candidate.canonicalHint];
      if (
        refiledByHeading &&
        candidates.some(
          (prior) =>
            refiledByHeading.includes(prior.canonicalHint) &&
            prior.amount === candidate.amount &&
            prior.feeName.toLowerCase().endsWith(candidate.feeName.toLowerCase()),
        )
      ) {
        continue;
      }
      candidates.push({ ...candidate, strategy: specialist.strategy });
      added += 1;
    }
    for (const heldRow of found.held) {
      // v76: $0 and "prices vary" holds take their own half of the cap, so a schedule's free rows
      // never push out a priced hold (or the other way round).
      const unpricedHold = unpricedHalf(heldRow);
      if (held.filter((row) => unpricedHalf(row) === unpricedHold).length >= MAX_HELD_PER_DOCUMENT) {
        if (heldRow.shape === "unclassified") countDropped("unclassified_cap");
        continue;
      }
      const foundRow = { ...heldRow, feeName: tidyUnmarkedName(heldRow.feeName, text, institutionName) };
      if (foundRow.shape === "zero" && readsAMeasuredAmount(text, foundRow.feeName, 0)) continue;
      // A $0 row can go live through the rules re-check, so it passes the same self-check.
      const untracedZero = foundRow.shape === "zero" && !tracesToSource(text, foundRow.feeName, 0);
      if (untracedZero) selfCheckFailed += 1;
      const row: HeldFeeCandidate = untracedZero ? { ...foundRow, shape: "untraced" } : foundRow;
      const key = heldKey(row);
      if (seenHeld.has(key)) continue;
      if (row.shape === "unclassified" && unclassified >= MAX_UNCLASSIFIED_PER_DOCUMENT) {
        countDropped("unclassified_cap");
        continue;
      }
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

  // #1918: source-owned compressed actions are two observations, not one invented
  // category name. Keep the original complete row as evidence for unchanged guards.
  // Run this against physical source, before any normalized legacy fragment can own it.
  for (const unit of paidReturnedUnits(sourceText)) {
    if (unit.eligibility === "admit" ? candidates.length + 2 > MAX_FEES_PER_DOCUMENT
      : held.filter(row => !unpricedHalf(row)).length + 2 > MAX_HELD_PER_DOCUMENT) continue;
    for (let at = candidates.length - 1; at >= 0; at--) {
      const row = candidates[at];
      if (belongsToPaidReturnedUnit(unit, row.feeName, row.amount, row.excerpt)) candidates.splice(at, 1);
    }
    for (let at = held.length - 1; at >= 0; at--) {
      const row = held[at];
      if (row.amount !== null && belongsToPaidReturnedUnit(unit, row.feeName, row.amount, row.excerpt)) held.splice(at, 1);
    }
    for (const event of unit.events) {
      const facts = { feeName: event.name, amount: unit.amount, canonicalHint: event.canonicalKey,
        frequency: unit.frequency, excerpt: unit.ownText, ownedPolicy: true as const,
        lineShare: event.lineShare, linkedConditions: [unit.heading, unit.followingContext].filter(Boolean).join("\n") || undefined,
        feeAudience: unit.audience, audienceEvidence: unit.heading, feeTreatment: "charged" as const };
      if (unit.eligibility === "hold") held.push({ ...facts, shape: "eligibility", amountMax: null, percent: null });
      else candidates.push({ ...facts, confidence: .94, waivable: false, strategy: "extract.paid_returned" });
    }
  }

  // v27: one priced line that names both an NSF item and an overdraft ("Non-sufficient
  // funds item (NSFs/Overdrafts) | $33.00 per item") is the bank's price for both.
  for (const candidate of [...candidates]) {
    const twin = candidate.canonicalHint === "nsf" ? "overdraft" : candidate.canonicalHint === "overdraft" ? "nsf" : null;
    if (!twin || !NSF_AND_OVERDRAFT.test(candidate.feeName)) continue;
    if (candidates.some((prior) => prior.canonicalHint === twin && prior.feeAudience === candidate.feeAudience && prior.amount === candidate.amount)) continue;
    if (candidates.length >= MAX_FEES_PER_DOCUMENT || !passesDarwinChecks(twin, candidate.feeName, candidate.amount)) continue;
    // v82: the twin has the line's own name and price, so it needs its own raw key (`line_share`).
    candidates.push({ ...candidate, canonicalHint: twin, lineShare: `twin:${twin}` });
  }

  // #2278: source price support does not establish an international wire's direction.
  for (let at = candidates.length - 1; at >= 0; at--) {
    const read = candidates[at];
    if (!read.canonicalHint.startsWith("wire_")) continue;
    const scope = internationalWireEligibility(sourceText, read);
    if (scope.kind === "not_applicable" || scope.kind === "admit") continue;
    candidates.splice(at, 1);
    if (scope.kind === "hold") held.push({ shape: "eligibility", feeName: read.feeName, amount: read.amount, amountMax: null,
      percent: null, frequency: read.frequency, canonicalHint: read.canonicalHint,
      excerpt: scope.scope.ownText, ownedPolicy: true, lineShare: read.lineShare });
  }
  // #2335: the printed dollar remains supported, but a symbolic charge is not flat.
  for (let at = candidates.length - 1; at >= 0; at--) {
    const read = candidates[at];
    if (!mayHaveSymbolicLesserFee(read.feeName, read.canonicalHint)) continue;
    const formula = symbolicLesserOfReview(sourceText, read.feeName, read.amount);
    if (!formula) continue;
    candidates.splice(at, 1);
    held.push({ shape: "eligibility", feeName: read.feeName, amount: read.amount, amountMax: null,
      percent: null, frequency: read.frequency, canonicalHint: read.canonicalHint,
      excerpt: formula.ownText, ownedPolicy: true, lineShare: read.lineShare });
  }
  const monthlyOwnerReview = monthlyAccountOwnerReview(text, institutionName);
  for (const candidate of candidates) {
    const owners = monthlyOwnerReview(candidate);
    if (!owners) continue;
    candidate.eligibilityReview = true;
    candidate.linkedConditions = [candidate.linkedConditions, owners].filter(Boolean).join("\n\n");
  }
  // #2209/#2259: preserve literal product prices without pooling them into standard benchmarks.
  // This explicit shape is not one of the automatic range/name/source promoters' inputs.
  for (let at = candidates.length - 1; at >= 0; at--) {
    const read = candidates[at];
    if (!read.eligibilityReview) continue;
    candidates.splice(at, 1);
    held.push({ shape: "eligibility", feeName: read.feeName, amount: read.amount, amountMax: null,
      percent: null, frequency: read.frequency, canonicalHint: read.canonicalHint, excerpt: read.excerpt,
      ownedPolicy: true, linkedConditions: read.linkedConditions, lineShare: read.lineShare });
  }
  // An untraced read is held once, and only when no specialist read the same fee traceably.
  for (const row of untraced) {
    if (held.filter((prior) => !unpricedHalf(prior)).length >= MAX_HELD_PER_DOCUMENT) break;
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
  const unitHolds = stillHeld.map(row => row.shape === "zero" && row.canonicalHint && row.amount != null
    ? withOwnFeeUnit({ ...row, amount: row.amount, canonicalHint: row.canonicalHint }, sourceText) : row);
  return { candidates: candidates.map(candidate => withOwnFeeUnit(candidate, sourceText)), held: unitHolds, rates, runs, dropped };
}
