/**
 * #1092 (shadow lab, Nov 2): a $0 whose own line is a "No fee for X" sentence or the balance row that
 * avoids a fee, not a priced fee row. Shared by Knox (its free read holds such a $0 for review instead
 * of sending it to Darwin as a free fee, rules v163) and Darwin (verify refuses it, and the live
 * re-check `darwin/zero-waiver-row-check.ts` reads what is already live). Pure: no database and no
 * agent imports.
 *
 * Hamilton's name rules already call such a line no fee (`no_fee_sentence`, "A sentence about what is
 * free, not a priced fee line"; `waiver_sentence`, "The condition that waives a fee, or the balance
 * that avoids it, published as a $0 fee"; `eval-verdicts.ts`), but they read the fee's name, and Knox's
 * name tidy keeps only the fee the line names: "No Fee for Cashier's Checks" is read as "Cashier's
 * Checks" at $0, and "Minimum Balance required to avoid a Service Charge / FREE" (the next line's
 * "FREE REWARD Checking:" heading glued on as its value) as "Service Charge" at $0. Both passed every
 * stage and went live (live fees 56853, 64330, 64331 and 102158; the shadow lab's `not_a_fee` cases).
 *
 * The test reads the line, not the name, and is structural:
 * - `no_fee_sentence`: the whole line is one short sentence that opens "No fee for ...", "No charge
 *   on ...", "Without charge for ..." and carries no figure and no second cell, and every place the
 *   text prints it is one item of one account's or package's list of free items (`inFreeItemList`: the
 *   nearest line above or below is another free item, and the line above the run is a lead the
 *   account-benefit test reads as naming an account, a package or its benefits: "Cornerstone
 *   Checking:" / "2 Boxes Personal Checks Free per Year" / "No Fee for Cashier's Checks"). Adjacency
 *   alone is never enough: a run under "Fee Schedule" or "Miscellaneous Services:" is the bank's own. The same sentence under its fee's own
 *   heading ("Notary Service" / "No charge for notarization of Bank documents." / "$10 per signature
 *   for notarization of non-Bank documents") is that row's price and stays: a pinned answer key reads
 *   it as the bank's $0 notary fee. A priced row whose price cell says it is free ("Notary | No
 *   charge", "Stop Payment | $0.00") is a row: its label is the fee's name, so it is never one. A line
 *   that prints a figure ("No fee for the first 2; $2 each after") is left to the rules that read it.
 * - `waiver_requirement`: the line's label (its first cell, before " | " or " / ") is the balance,
 *   deposit or requirement that avoids or waives a fee ("Minimum Balance required to avoid a Service
 *   Charge", "Average daily balance to avoid monthly service charge", "Minimum Balance Requirement To
 *   Avoid Monthly Maintenance Fee"). That row's value is the threshold, never the fee's price. The
 *   fee's own row ("Monthly Service Charge | $0.00", "Service Charge | None") is not one, and neither
 *   is a label whose own line, later cell or next stacked lines name a fee or charge ("Minimum daily
 *   balance to avoid monthly fee: None Monthly maintenance fee: $0"): refuse rather than match.
 *
 * Only a $0 is tested. A condition inside the price cell ("Monthly fee $0 with e-statements",
 * "Cashier's check | Free for Premier members") is the fee's own row and is not this rule's: the
 * conditional-$0, tier-perk and audience rules read those.
 */

import { accountListLead } from "@/lib/account-benefit-zero";

export type ZeroWaiverRowKind = "no_fee_sentence" | "waiver_requirement";

export interface ZeroWaiverRow {
  kind: ZeroWaiverRowKind;
  /** The row's label (the whole sentence for `no_fee_sentence`). */
  label: string;
}

/** The longest line read as one short no-fee sentence; a longer one is prose about the account. */
export const NO_FEE_SENTENCE_MAX_CHARS = 80;

/** A cell break as Knox writes a table row (" | ") or a stacked label and value (" / "). */
const CELL_BREAK = /\s+[|/]\s+/;
/** A list mark before the line's words. */
const LIST_MARK = /^[-*•·▪◦●]\s*/;
/** "No fee for ...", "No charge on ...", "Without charge for ...": the opening of a sentence about what is free. */
const NO_FEE_OPENING = /^(?:no|without)[\s-]+(?:fee|charge|cost)s?\s+(?:for|on)\s+\S/i;
/** Any figure: a price, a count or a limit is read by the rules that read figures. */
const ANY_FIGURE = /\d/;
/**
 * The balance, deposit or requirement that avoids or waives a fee, as a row's label: up to four
 * qualifiers ("Minimum", "Average daily", "Combined"), the balance, deposit or requirement, an
 * optional "requirement" and bracket, then "(required/needed) to avoid" or "to waive".
 */
const WAIVER_REQUIREMENT_LABEL = new RegExp(
  String.raw`^(?:(?:minimum|min\.?|average|avg\.?|daily|monthly|combined|total|ledger|collected|statement|required)\s+){0,4}` +
    String.raw`(?:balance|deposits?|direct\s+deposits?|requirements?|qualifications?)` +
    String.raw`(?:\s+requirements?)?(?:\s*\([^)]*\))?\s+(?:(?:is\s+)?(?:required|needed|necessary)\s+)?(?:in\s+order\s+)?to\s+(?:avoid|waive)\b`,
  "i",
);

/** A fee or charge named after the waiver label: the account's own row, which refuses the match. */
const FEE_WORD = /\b(?:fees?|charges?)\b/i;
/** How many printed lines after a stacked waiver label are read for the account's own fee row. */
const STACKED_LOOKAHEAD = 3;
/** A heading of the bank's own schedule: a list under it is the bank's prices, whoever is named above. */
const SCHEDULE_HEADING = /\b(?:fee schedule|schedule of (?:fees|charges)|services|fees|charges|miscellaneous)\b/i;

/** A free item of a list: "Free ...", "... Free per Year", "No fee for ...", "Complimentary ...". */
const FREE_WORD = /\b(?:free|complimentary)\b|^(?:no|without)[\s-]+(?:fee|charge|cost)s?\b/i;
/** A price: a dollar sign or a figure with cents. A count ("2 Boxes") is no price. */
const PRICE = /\$|\b\d+[.,]\d{2}\b/;

function tidyLine(line: string): string {
  return line.replace(/\s+/g, " ").trim().replace(LIST_MARK, "").trim();
}

/** Pure: whether a line is a no-fee sentence or a fee's waiver requirement row, by its own words alone. */
export function zeroWaiverRowLine(line: string | null | undefined): ZeroWaiverRow | null {
  const tidy = tidyLine(line ?? "");
  if (!tidy) return null;
  const cells = tidy.split(CELL_BREAK).map((cell) => cell.trim()).filter(Boolean);
  const first = cells[0] ?? "";
  // Review of #2938: a flattened line ("Minimum daily balance to avoid monthly fee: None Monthly
  // maintenance fee: $0") or a later cell that names a fee or charge is the account's own row too.
  const colon = first.indexOf(":");
  const label = colon >= 0 ? first.slice(0, colon).trim() : first;
  if (WAIVER_REQUIREMENT_LABEL.test(label)) {
    const rest = [colon >= 0 ? first.slice(colon + 1) : "", ...cells.slice(1)].join(" ");
    return FEE_WORD.test(rest) ? null : { kind: "waiver_requirement", label };
  }
  if (cells.length === 1 && tidy.length <= NO_FEE_SENTENCE_MAX_CHARS && NO_FEE_OPENING.test(tidy) && !ANY_FIGURE.test(tidy)) {
    return { kind: "no_fee_sentence", label: tidy };
  }
  return null;
}

/** A line that is itself one free item of a list: one cell, short, no price, not a heading. */
function freeItemLine(line: string): boolean {
  const tidy = tidyLine(line);
  return tidy.length > 0 && tidy.length <= NO_FEE_SENTENCE_MAX_CHARS && !CELL_BREAK.test(tidy) && !tidy.endsWith(":")
    && !PRICE.test(tidy) && FREE_WORD.test(tidy);
}

/**
 * Whether every place the text prints the sentence is one item of one account's or package's list of
 * free items: the nearest printed line above or below it is another free item, and the first line above
 * the run of free items is that list's lead, read with the account-benefit test's signals
 * (`accountListLead`: "Cornerstone Checking:" over "2 Boxes Personal Checks Free per Year" over "No Fee
 * for Cashier's Checks"). Adjacency alone is never enough (review of #2938): "Fee Schedule" /
 * "Miscellaneous Services:" over "No charge for notary service" / "No charge for coin counting" is the
 * bank's own schedule, and so is a list under any schedule, services, fees or charges heading. A
 * sentence that is the value of its fee's own heading ("Notary Service" over "No charge for
 * notarization of Bank documents.", a Pennsylvania answer key's $0 notary fee) is never one. No text,
 * or a text that does not print the sentence on its own line, is never one.
 */
export function inFreeItemList(sentence: string, documentText: string | null | undefined): boolean {
  const wanted = tidyLine(sentence).toLowerCase();
  if (!wanted || !documentText) return false;
  const lines = documentText.split(/\r?\n/).map(tidyLine);
  const printed = lines.map((line, index) => (line.toLowerCase() === wanted ? index : -1)).filter((index) => index >= 0);
  if (printed.length === 0) return false;
  const neighbour = (from: number, step: number): string | null => {
    for (let index = from + step; index >= 0 && index < lines.length; index += step) if (lines[index]) return lines[index];
    return null;
  };
  const leadAbove = (index: number): boolean => {
    let at = index - 1;
    for (; at >= 0; at -= 1) if (lines[at] && !freeItemLine(lines[at])) break;
    const lead = at >= 0 ? lines[at] : "";
    return Boolean(lead) && !SCHEDULE_HEADING.test(lead) && accountListLead(lead) != null;
  };
  return printed.every((index) => [neighbour(index, -1), neighbour(index, 1)].some((line) => line != null && freeItemLine(line)) && leadAbove(index));
}

/**
 * Whether the text prints the waiver label with the account's own fee after it: on the label's own
 * line, or on the next printed lines of a stacked row ("Minimum balance to avoid service charge" /
 * "None" / "Monthly service charge" / "$0"). Review of #2938: refuse rather than match.
 */
function feeAfterLabel(label: string, documentText: string | null | undefined): boolean {
  const wanted = tidyLine(label).toLowerCase();
  if (!wanted || !documentText) return false;
  const lines = documentText.split(/\r?\n/).map(tidyLine);
  return lines.some((line, index) => {
    if (!line.toLowerCase().startsWith(wanted)) return false;
    const after = [line.slice(wanted.length)];
    for (let at = index + 1; at < lines.length && after.length <= STACKED_LOOKAHEAD; at += 1) if (lines[at]) after.push(lines[at]);
    return after.some((piece) => FEE_WORD.test(piece));
  });
}

export interface ZeroWaiverRowInput {
  /** The line the $0 was read from (Knox's excerpt, or the line the shared check traces it to). */
  line: string | null | undefined;
  amount: number | null | undefined;
  /** The text the line was read from (or windows of it around the line), for the no-fee sentence's list. */
  documentText: string | null | undefined;
}

/** Pure: a $0 read from such a line (see the module note). Any other amount, or no line, is never one. */
export function zeroWaiverRowOf(input: ZeroWaiverRowInput): ZeroWaiverRow | null {
  if (input.amount == null || Math.abs(input.amount) >= 0.005) return null;
  const row = zeroWaiverRowLine(input.line);
  if (row?.kind === "no_fee_sentence" && !inFreeItemList(row.label, input.documentText)) return null;
  if (row?.kind === "waiver_requirement" && feeAfterLabel(row.label, input.documentText)) return null;
  return row;
}

/**
 * Pure: Darwin's reading of a $0 Knox read (verify and the live re-check). Knox's own line must be
 * such a row, and so must the line `checkFeeAgainstSource` traces the fee to, when it traces one.
 * The shared check traces a name to the first line that prints it at its price, so a fee read from
 * its own row ("Monthly Service Charge | $0.00") can trace to the balance row above it ("Average daily
 * balance to avoid monthly service charge | $0.00"); Knox's line keeps that fee. A fee with no line
 * of Knox's is never one.
 */
export function zeroWaiverRowRead(input: {
  excerpt: string | null | undefined;
  tracedLine: string | null | undefined;
  amount: number | null | undefined;
  documentText: string | null | undefined;
}): ZeroWaiverRow | null {
  const own = zeroWaiverRowOf({ line: input.excerpt, amount: input.amount, documentText: input.documentText });
  if (!own) return null;
  if (input.tracedLine && !zeroWaiverRowOf({ line: input.tracedLine, amount: input.amount, documentText: input.documentText })) return null;
  return own;
}
