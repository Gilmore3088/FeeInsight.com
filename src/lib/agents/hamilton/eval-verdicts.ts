import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { reconstructFirstLooks, secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Darwin's complete-record eval (James, Oct 8 2026): 211 live fees were scored against a
 * labelled answer key (name, amount, frequency, payer, category); 11 were critical (the amount
 * or the payer wrong, or not a fee at all). James read the list and said to resolve every one,
 * so each comes down on the first run that sees it, with the label as its audit record, as long
 * as the live record still reads the way it did when it was labelled. A row that has changed
 * since (renamed, re-priced, re-filed) is left for the next eval.
 *
 * The two shapes the criticals taught that a rule can read from the name alone are checked on
 * every live fee, with the usual 12-hour second look (`second-look.ts`):
 *   - a surcharge rebate or reimbursement published as an ATM fee ("ATM Fee Reimbursement $10":
 *     the bank gives it, it does not charge it): 20 live fees on Oct 8;
 *   - a product-feature sentence ("No fee for cashier's checks or money orders") published as a
 *     $0 fee: 4 live fees on Oct 8. A table row priced "No Charge" is a fee and stays;
 *   - a waiver or threshold sentence published as a $0 fee ("Monthly Service Fee when you have any
 *     ONE of the following during each monthly", "Minimum Balance Required to avoid service
 *     charge"): the bank's monthly fee is another row, this one is its condition (Accuracy's
 *     Chase row 75915, Oct 9; 13 live). A $0 fee named "... - Waived" is a fee and stays.
 *   - a fee the merchant or payee pays ("Merchant presenting NSF check from member"), published
 *     as the member's fee (v3);
 *   - two fees on one line published as one ("Wire Domestic In/Out $10/$20"): the name pairs two
 *     directions or scopes and the line Knox read carries two prices, so the one published is at
 *     best half right (v3; 3 live on Oct 9).
 *   - a price inside the name that is not the published amount ("Courtesy Pay (Paid Overdraft)
 *     Fee .. . . .$35.005" at $50: the $50 was the next cell's box rent; UAT, Oct 9). The name
 *     says what the fee costs, so the amount is in doubt (v4, `price_in_name`; narrowed in v5 to a
 *     price the name presents as the fee's own, see `priceInName`). The same shape at
 *     publish is `publish_hold:price_in_name`; this is the live-row twin, because a hold acts
 *     only on a row not yet live.
 *
 * Three shapes are flagged, never taken down (v3): each writes one `pipeline_feedback` row per
 * fee (weight 0.5, a judgement, not proof) that a report or a later rule can read:
 *   - `non_customer_price`: a price for non-customers or non-members published beside the bank's
 *     own customer price (1,244 live on Oct 9). Whether to show it flagged or hide it is James's
 *     open call (confirm list, row 16); the default is Flag.
 *   - `wire_shared_line`: a wire fee read from a line that names both scopes (domestic and
 *     international, or incoming and outgoing) and carries two prices (173 live on Oct 9): the
 *     column read needs a second look, as in Skyline's and WNB's eval rows.
 * A name that joins a heading to another category's fee ("Accounts closed within 90 days:
 * International Wire" under early closure, Koin's eval row) is the category guard's
 * `name_contradicts` (v49) and is not repeated here: of 201 such live names on Oct 9, none needed
 * a second flag.
 *
 * Archived, never deleted: `rolled_back_reason = 'eval_critical:<verdict>'` or
 * `'not_a_fee:<rule>'`, the verified row rejected with the same flag so it is not republished,
 * and one lesson per fee in `pipeline_feedback` (stage extract, the verdict as its kind), so
 * Knox's learning reads what was wrong.
 *
 * v6: a rename is not a fix. Rows Knox's name retidy renamed are judged under the name before the
 * retidy too, so "Monthly Service Charge if any of the following qualifications are met" at $0
 * stays a waiver as "Monthly Service Charge", and a labelled row matches under either name.
 */
export const EVAL_VERDICT_CHECK = "hamilton.eval_verdict";
export const EVAL_VERDICT_VERSION = 7;
/** Why v5 cleared v4's price_in_name flags; written on the rule_revised lesson and each reconstructed first look. */
const RULE_REVISED_VERSION = 5;
export const RULE_REVISED_WHY = "A dollar figure in a fee's name is a threshold, floor, cap, balance or range more often than the fee's price; price_in_name now fires only on a price the name presents as the fee's own";
const EVAL_REASON_PREFIX = "eval_critical";
const RULE_REASON_PREFIX = "not_a_fee";
const ROLLBACK_LIMIT = 500;

export type Verdict = "not_a_fee" | "wrong_amount" | "wrong_payer" | "wrong_category";

export interface EvalVerdict {
  feePublishedId: number;
  institution: string;
  /** The live record as it read when labelled; all three must still match. */
  feeName: string;
  amount: number;
  canonicalFeeKey: string;
  verdict: Verdict;
  why: string;
}

/**
 * The 11 critical rows of the Oct 8 eval (labels in the project's darwin/eval folder,
 * confirm list rows 1-11). Add a later eval's criticals below, never edit a past one.
 */
export const EVAL_CRITICAL_VERDICTS: readonly EvalVerdict[] = [
  {
    feePublishedId: 95816, institution: "Rockland Trust Company",
    feeName: "Non Rockland Trust ATM AccessNo fee from Rockland Trust", amount: 10, canonicalFeeKey: "atm_non_network",
    verdict: "not_a_fee", why: "The $10 is a surcharge rebate the bank gives per statement period, not a fee it charges",
  },
  {
    feePublishedId: 96294, institution: "State Police Credit Union",
    feeName: "Corporate Check", amount: 20, canonicalFeeKey: "cashiers_check",
    verdict: "wrong_category", why: "The line sits under the Stop Payments heading: a $20 stop payment, not a cashier's check",
  },
  {
    feePublishedId: 95762, institution: "Southern First Bank",
    feeName: "Official Bank Check (Non-Customers)", amount: 20, canonicalFeeKey: "cashiers_check",
    verdict: "wrong_payer", why: "Non-customers pay $20; the customer price is $7 and sits in the same category",
  },
  {
    feePublishedId: 95951, institution: "Metrum Community FCU",
    feeName: "Merchant presenting NSF check from member", amount: 5, canonicalFeeKey: "nsf",
    verdict: "wrong_payer", why: "The schedule says \"Merchant pays\": the member is not charged",
  },
  {
    feePublishedId: 96379, institution: "Skyline Financial FCU",
    feeName: "Incoming Wire Fee", amount: 35, canonicalFeeKey: "wire_domestic_incoming",
    verdict: "wrong_amount", why: "$35 is the international incoming line; domestic incoming is $20",
  },
  {
    feePublishedId: 93480, institution: "WNB Financial, N.A.",
    feeName: "Cash Management International Wire Origination", amount: 10, canonicalFeeKey: "wire_intl_outgoing",
    verdict: "wrong_amount", why: "Three names over three prices ($10/$20/$40); the international wire is the third, $40",
  },
  {
    feePublishedId: 95801, institution: "Northwest Plus FCU",
    feeName: "Wire International In/Out", amount: 10, canonicalFeeKey: "wire_intl_outgoing",
    verdict: "wrong_amount", why: "The line reads \"$10/$35\": $10 is incoming, the outgoing wire is $35",
  },
  {
    feePublishedId: 57064, institution: "Koin FCU",
    feeName: "Accounts closed within 90 days: International Wire", amount: 45, canonicalFeeKey: "early_closure",
    verdict: "wrong_amount", why: "Two rows joined: early closure is $30, $45 is the international wire",
  },
  {
    feePublishedId: 69839, institution: "Trax FCU",
    feeName: "Foreign ATM transactions at Trax Machines", amount: 3.5, canonicalFeeKey: "atm_non_network",
    verdict: "wrong_payer", why: "The surcharge non-members pay at Trax ATMs; the member's foreign-ATM fee is $1.50",
  },
  {
    feePublishedId: 47309, institution: "BankWest",
    feeName: "Money Orders (Non-Customer)", amount: 3, canonicalFeeKey: "money_order",
    verdict: "wrong_payer", why: "Non-customers pay $3; customers pay $2 and sit in the same category",
  },
  {
    feePublishedId: 96172, institution: "Madison County Bank",
    feeName: "No fee for cashier’s checks or money orders No minimum balance requirement No monthly service charge or membership fee A",
    amount: 0, canonicalFeeKey: "money_order",
    verdict: "not_a_fee", why: "A product-feature bullet list, not a fee line",
  },
];

/**
 * Rows a person checked against the bank's own schedule and found wrong. Unlike the Oct 8 eval
 * rows these take the usual 12-hour second look before they come down, and like them only while
 * the live record still reads as labelled. `pattern` names the extraction shape, for Knox's
 * lesson. Add later checks below, never edit a past one.
 *
 * City National Bank of Florida (76), Oct 9: the 2026 personal disclosure (doc 23020) is a
 * two-column page, and the text joins a left-column line to a right-column line ("Rate
 * Information ... (APY) are available at any of ... banking | Cashier's Checks ... $0.00").
 * Knox read fees from footnote prose and from one account's column. Six more rows there have a
 * glued name but the right amount and category (100136, 100137, 100138, 100143, 100144, 100145);
 * they stay live for the name pass. 100160 ($0 "to Avoid Monthly Maintenance Fee") is already
 * flagged by `waiver_sentence`.
 */
export const HAND_CHECKED_VERDICTS: readonly (EvalVerdict & { pattern: string })[] = [
  {
    feePublishedId: 100157, institution: "City National Bank of Florida",
    feeName: "sufficient to cover both the full overdraft", amount: 10, canonicalFeeKey: "overdraft",
    verdict: "wrong_category", pattern: "two_column_glue",
    why: "Prose about overdraft protection (\"the full overdraft amount and the $10.00 Overdraft Protection Transfer Fee\"): the $10 is the transfer fee, already live as 100151, not an overdraft fee",
  },
  {
    feePublishedId: 100158, institution: "City National Bank of Florida",
    feeName: "Item Fees and the Paid Item Fee for the check/item in the amount of", amount: 17, canonicalFeeKey: "overdraft",
    verdict: "not_a_fee", pattern: "two_column_glue",
    why: "Footnote 9's worked example: $17 is a check amount whose Paid Item Fee would be waived; the overdraft fee is $18.50 (100148)",
  },
  {
    feePublishedId: 100161, institution: "City National Bank of Florida",
    feeName: "(APY) are available at any of City National Bank of Florida (CNB) banking: Cashier\u2019s Checks", amount: 0, canonicalFeeKey: "cashiers_check",
    verdict: "wrong_amount", pattern: "two_column_glue",
    why: "$0 is one account's perk (CNB @ School Checking, offered to staff and students of commercial customers); the schedule's cashier's check fee is $30.00",
  },
  {
    feePublishedId: 100162, institution: "City National Bank of Florida",
    feeName: "11 - Wire Transfers Fee: Incoming will be", amount: 0, canonicalFeeKey: "wire_domestic_incoming",
    verdict: "wrong_amount", pattern: "two_column_glue",
    why: "Footnote 11: incoming is $0 only from a CNB account to a CNB personal account; the schedule's incoming wire fee is $15.00",
  },
  // Keys FCU (4838), Oct 9, doc 2628: a three-column page joins Keys Premier Checking's "(balance
  // falls below $1,000) $15.00" to the next column's "Copy of Check $3.00 (in house)". Publish now
  // holds a name that is only a condition (`condition_only_name`).
  {
    feePublishedId: 106318, institution: "Keys Federal Credit Union",
    feeName: "(balance falls below $1,000)", amount: 15, canonicalFeeKey: "check_image",
    verdict: "wrong_category", pattern: "column_glue",
    why: "$15 is Keys Premier Checking's low balance fee (below $1,000), filed as a check copy; the check copy fee on that line is $3.00",
  },
  // Data inventory's live "to avoid" names (audits/to-avoid-names-for-accuracy.md), Oct 9: each
  // read against its stored text. Two with the right price under the wrong type are re-filed
  // instead (taxonomy-fold HAND_REFILES: 56804, 79217); the other priced rows there carry the
  // right price and type under a sentence for a name, or already hold a pending flag. 36498's
  // line is an outgoing international wire, but no name that traces on its two-column page says
  // "wire", so Darwin's wire check would refuse a re-file.
  {
    feePublishedId: 36498, institution: "Mission Federal Credit Union",
    feeName: "in online or mobile banking to avoid a monthly maintenance fee. | International U.S. Currency", amount: 45, canonicalFeeKey: "monthly_maintenance",
    verdict: "wrong_category", pattern: "two_column_glue",
    why: "Doc 6201: $45 is the next column's outgoing \"International U.S. Currency\" wire line, not a monthly maintenance fee",
  },
  {
    feePublishedId: 90839, institution: "1st Security Bank of Washington",
    feeName: "To avoid the monthly service charge, the customer must have a related 1st Gold Student Checking Account and a one-time m", amount: 25, canonicalFeeKey: "monthly_maintenance",
    verdict: "not_a_fee", pattern: "fee_in_sentence",
    why: "Doc 21939: $25 is the monthly transfer from the student checking account that waives the service charge, not a charge",
  },
  // Live names that start mid-sentence (Agentic OS's adversarial sample, Oct 9), read against
  // their stored text. Those with the right price under the wrong type are re-filed instead
  // (taxonomy-fold HAND_REFILES: 28554, 37068, 44516, 91458).
  {
    feePublishedId: 15199, institution: "Arbor Bank",
    feeName: "credit toward closing costs (for example, appraisal or title insurance fees) on a secondary market mortgage loan, which", amount: 100, canonicalFeeKey: "appraisal_fee",
    verdict: "not_a_fee", pattern: "fee_in_sentence",
    why: "Doc 14467: \"$100 credit toward closing costs\" is a credit the bank gives, not a fee it charges",
  },
  {
    feePublishedId: 17477, institution: "Industrial Federal Credit Union",
    feeName: "if closed within two years. Minimum balance is", amount: 500, canonicalFeeKey: "early_closure",
    verdict: "wrong_amount", pattern: "fee_in_sentence",
    why: "Doc 15565: \"IRA Closing Fee | $50.00 if closed within two years. Minimum balance is $500.00\": $500 is the minimum balance, the closing fee is $50",
  },
  {
    feePublishedId: 76242, institution: "Oklahoma Educators Federal Credit Union",
    feeName: "or 2.00% of the amount of each cash advance, whichever is greater, however, the fee will never exceed", amount: 2, canonicalFeeKey: "cash_advance",
    verdict: "wrong_amount", pattern: "rate_bound",
    why: "Doc 20697: \"$2.00 or 2.00% of the amount of each cash advance, whichever is greater ... never exceed $10.00\": $2 is the rate fee's floor",
  },
  {
    feePublishedId: 104697, institution: "Peoples Bank of Alabama",
    feeName: "consecutively overdrawn (OD). Maximum Overdraft Continuation Fee", amount: 30, canonicalFeeKey: "continuous_od",
    verdict: "wrong_amount", pattern: "fee_in_sentence",
    why: "Doc 24024: \"Maximum Overdraft Continuation Fee is $30.00 during each consecutive OD period\": $30 caps the continuation fees, it is not the fee",
  },
];

/** A surcharge rebate, reimbursement or refund published as the ATM fee itself. */
const REBATE_WORDING = /\b(rebate|reimburse|refund)/i;
const NON_REFUNDABLE = /non[- ]?refundable/i;
const ATM_KEYS = new Set(["atm_non_network", "atm_international"]);
/** A sentence about what is free ("No fee for stop payments"), not a priced row. */
const NO_FEE_SENTENCE = /^\s*(no|without)\s+(fee|charge)s?\s+(for|to|on|when|if)\b/i;

/** The condition under which a fee is waived, or the balance that avoids it, as a $0 "fee". */
const WAIVER_SENTENCE = /\b(if|when|unless)\s+you\b|\bof\s+the\s+following\b|\bqualifications?\s+(are|is)\s+met\b|^\s*to\s+avoid\b|\bto\s+avoid\s+(a\s+|an\s+|the\s+)?(monthly\s+|maintenance\s+)?(service\s+charge|monthly\s+fee|maintenance\s+fee|fee)/i;

/**
 * v7: the balance that avoids a fee, published at any amount: a label row ("Minimum balance
 * required to avoid service charge" at $50, "Average Balance Required to Avoid Monthly Fee" at
 * $10) whose amount is the threshold or a neighbouring cell, not a fee (15/15 such live names on
 * Oct 9 were not fees against the source). A name that goes on to state the fee ("...service
 * charge fee of", "Otherwise, a fee of") is the fee's own row and is left alone, and so is a
 * glued line whose next cell is another fee ("... to avoid maintenance | Bill Pay Return Item",
 * 37067's name before its retidy).
 */
const BALANCE_THRESHOLD = /^\s*(minimum|average|min\.?)\b[a-z ]{0,30}?\bbalance\s+(required\s+|requirement\s+)?to\s+avoid\b/i;
const STATES_FEE = /\bof\s*[-–:]?\s*$|\botherwise\b|\|/i;

/** A fee the merchant or payee pays, not the account holder. */
const MERCHANT_PAYER = /\b(merchant|payee)\s+(pays|presenting|presented)\b|\bpaid\s+by\s+(the\s+)?(merchant|payee)\b/i;
/** A name that pairs two directions or scopes of one service: two fees, one row. */
const TWO_FEES_NAME = /\bin\s*\/\s*out\b|\bout\s*\/\s*in\b|incoming\s*\/\s*outgoing|outgoing\s*\/\s*incoming|domestic\s*\/\s*international|international\s*\/\s*domestic/i;
/** A price for people who are not the bank's customers. */
const NON_CUSTOMER = /non[- ]?(customer|member|account ?holder)s?\b|\bnot\s+a\s+(customer|member)\b|\bfor\s+non-?(members|customers)\b|non-?clients?\b/i;
const WIRE_KEYS = new Set(["wire_domestic_incoming", "wire_domestic_outgoing", "wire_intl_incoming", "wire_intl_outgoing"]);
const WIRE_SCOPE_A = /\b(domestic|incoming|in)\b/i;
const WIRE_SCOPE_B = /\b(international|foreign|outgoing|out)\b/i;
const PRICE = /\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/g;
/** Every dollar price printed in a name; a footnote digit glued to the cents ("$35.005") is dropped. */
const PRICE_IN_NAME = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)(\d)?(?![\d.])/g;
/** Leaders a schedule prints between a fee's name and its price: dots, a colon, a dash. */
const PRICE_LEADER = /(?:\s|\.|…|:|-|–|—)+$/;
/** A fee noun right before the price ("Fee $35", "Fee of $35", "per copy $2"), or a closed parenthetical ("(per item) $30"). */
const PRICE_LEAD = /\b(fee|fees|charge|charges|cost|price|each|item|copy|page|transfer|transaction)$|\)$/i;
/** A word before the fee noun that makes the price a floor, a cap or another price, not the fee ("minimum charge $10"). */
const PRICE_LEAD_QUALIFIER = /\b(minimum|min|maximum|max|limit|additional|extra|plus|rush|late|discount|per)\.?$/i;
/** Words after the price that make it a threshold, a cap or a range ("$500 or less", "$10 - $500", "$25.00 minimum"). */
/** Words in the three before the price that make it a threshold or a range, whatever follows. */
const PRICE_THRESHOLD_WORDS = /\b(over|under|below|above|than|minimum|min|max|maximum|limit|balance|balances|of|from|between|to|if|with|for|or|up|exceeding|least)\b|[=+<>≥≤]/i;
/** The next item of a schedule glued onto the line after the price: a capitalised fee name ("$29.00 Inactivity Fee"). */
const GLUED_FEE_AFTER_PRICE = /^(?:[A-Z][\w'’-]*\s+){0,3}(?:Fee|Fees|Charge|Charges)\b/;
const PRICE_TAIL_QUALIFIER = /^(?:minimum|min\b|min\.|maximum|max\b|max\.|limit|discount|deductible|increments?|or\s+(?:more|less|greater|under|over|above|below)|and\s+(?:under|over|above|up|below|less|more)|[+\-–—]|to\s+\$|through\b|up\s+to\b)/i;

/**
 * The price a fee's name states as the fee's own price, or null. v5: the first run of v4
 * (02:58 Oct 9) flagged 389 live fees and about nine in ten were right: the dollar figure in
 * their names is a threshold ("Overdraft Fee – Each overdraft paid over $5"), a floor or cap
 * ("Account Research per hour ($20.00 minimum)", "Money Orders ($1,000 maximum)"), a balance
 * ("Service charge (balance falls below $1,000)"), a range ("Visa Gift Cards $10.00-$500.00")
 * or another price ("Stop Payment ($15.00 if initiated through on-line banking)"). So a price
 * counts only when the name presents it as the fee's price: the name carries one price, a fee
 * noun or a closed parenthetical sits right before it (dots, a colon or a dash between are a
 * printed leader), no floor/cap word qualifies that noun, and no threshold or range word
 * follows the price. A glued line, where the next item's capitalised fee name follows the price
 * and no threshold word precedes it, counts too. Pure.
 */
export function priceInName(feeName: string | null | undefined): number | null {
  if (!feeName) return null;
  const matches = Array.from(feeName.matchAll(PRICE_IN_NAME));
  if (matches.length !== 1) return null;
  const [match] = matches;
  const before = feeName.slice(0, match.index).replace(PRICE_LEADER, "").replace(/\s+of$/i, "");
  const after = feeName.slice(match.index + match[0].length).trimStart();
  if (PRICE_TAIL_QUALIFIER.test(after)) return null;
  const lead = PRICE_LEAD.exec(before);
  if (lead) {
    if (lead[1] && PRICE_LEAD_QUALIFIER.test(before.slice(0, lead.index).trim())) return null;
  } else {
    // A glued line: the price ends this fee's text and the next item's name follows it
    // ("Courtesy Pay per debit as applicable $29.00 Inactivity Fee", run 3232 row 58437), with
    // no threshold word in the three words before the price ("overdrawn more than $5.00 Fees").
    const leadWords = before.split(/\s+/).slice(-3).join(" ");
    if (!GLUED_FEE_AFTER_PRICE.test(after) || PRICE_THRESHOLD_WORDS.test(leadWords)) return null;
  }
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** How many distinct dollar prices a schedule line carries. Pure. */
export function distinctPrices(text: string | null | undefined): number {
  if (!text) return 0;
  return new Set(Array.from(text.matchAll(PRICE), (match) => Number(match[1].replace(/,/g, "")))).size;
}

/**
 * A rate fee's floor or cap published as the fee ("Signature Authorization Cash Advance Fee: 4% of
 * transaction amount. Minimum" at $4, UAT 07:50 Oct 9): the name states the percent and ends on
 * the word that makes the dollar figure a minimum or maximum. The rate is its own row.
 */
const RATE_BOUND_NAME = /\d\s*%.*\b(minimum|maximum|min|max)\.?:?\s*$/i;

export type NameRule = "rebate" | "no_fee_sentence" | "waiver_sentence" | "merchant_payer" | "two_fees_one_line" | "price_in_name" | "rate_bound" | "balance_threshold";
export const RULE_VERDICTS: Readonly<Record<NameRule, Verdict>> = {
  rebate: "not_a_fee",
  no_fee_sentence: "not_a_fee",
  waiver_sentence: "not_a_fee",
  merchant_payer: "wrong_payer",
  two_fees_one_line: "wrong_amount",
  price_in_name: "wrong_amount",
  rate_bound: "wrong_amount",
  balance_threshold: "not_a_fee",
};
export const RULE_WHY: Readonly<Record<NameRule, string>> = {
  rebate: "A surcharge rebate or reimbursement the bank gives, published as the ATM fee it charges",
  no_fee_sentence: "A sentence about what is free, not a priced fee line",
  waiver_sentence: "The condition that waives a fee, or the balance that avoids it, published as a $0 fee",
  merchant_payer: "A fee the merchant or payee pays, published as the account holder's fee",
  two_fees_one_line: "Two fees on one line (two directions or scopes, two prices) published as one price",
  price_in_name: "The name states a price that is not the published amount, so the amount came from another cell",
  rate_bound: "The name states a percent and ends on minimum or maximum: the amount is the rate fee's floor or cap, not the fee",
  balance_threshold: "The balance that avoids a fee, published as a fee: the amount is the threshold or another cell, not a charge",
};

/** Which name rule, if any, takes a live fee down. `excerpt` is the schedule line Knox read. Pure. */
export function ruleFor(canonicalFeeKey: string, feeName: string | null | undefined, amount?: number | null, excerpt?: string | null): NameRule | null {
  const name = feeName ?? "";
  if (ATM_KEYS.has(canonicalFeeKey) && REBATE_WORDING.test(name) && !NON_REFUNDABLE.test(name)) return "rebate";
  if (NO_FEE_SENTENCE.test(name)) return "no_fee_sentence";
  if (amount != null && Math.abs(amount) < 0.005 && WAIVER_SENTENCE.test(name)) return "waiver_sentence";
  if (BALANCE_THRESHOLD.test(name) && !STATES_FEE.test(name)) return "balance_threshold";
  if (MERCHANT_PAYER.test(name)) return "merchant_payer";
  if (TWO_FEES_NAME.test(name) && distinctPrices(excerpt) >= 2) return "two_fees_one_line";
  if (amount != null && amount > 0 && RATE_BOUND_NAME.test(name)) return "rate_bound";
  if (amount != null) {
    const stated = priceInName(name);
    if (stated != null && Math.abs(stated - amount) > 0.005) return "price_in_name";
  }
  return null;
}

export type FlagRule = "non_customer_price" | "wire_shared_line";
export const FLAG_RULES: readonly FlagRule[] = ["non_customer_price", "wire_shared_line"];
const FLAG_WHY: Readonly<Record<FlagRule, string>> = {
  non_customer_price: "A price for non-customers, published beside the bank's own customer price (Flag until James decides Flag or Hide)",
  wire_shared_line: "A wire fee read from a line that names both scopes and carries two prices; the column read needs a second look",
};

/** Which flag, if any, a live fee gets (never a takedown). Pure. */
export function flagFor(canonicalFeeKey: string, feeName: string | null | undefined, excerpt?: string | null): FlagRule | null {
  const name = feeName ?? "";
  if (NON_CUSTOMER.test(name)) return "non_customer_price";
  if (WIRE_KEYS.has(canonicalFeeKey) && distinctPrices(excerpt) >= 2 && WIRE_SCOPE_A.test(excerpt ?? "") && WIRE_SCOPE_B.test(excerpt ?? "")) return "wire_shared_line";
  return null;
}

/** Every labelled row, eval or hand check: these are read whatever their name. */
const LABELLED_IDS = new Set([...EVAL_CRITICAL_VERDICTS, ...HAND_CHECKED_VERDICTS].map((entry) => entry.feePublishedId));

/** The eval verdict a live record still matches, or null when none or the record has changed. Pure. */
export function verdictFor(
  row: { feePublishedId: number; feeName: string; amount: number | null; canonicalFeeKey: string; originalFeeName?: string | null },
  verdicts: readonly EvalVerdict[] = EVAL_CRITICAL_VERDICTS,
): EvalVerdict | null {
  const verdict = verdicts.find((entry) => entry.feePublishedId === row.feePublishedId);
  if (!verdict) return null;
  // v6: a logged retidy keeps the labelled name as the row's original name; a rename alone
  // ("... banking: Cashier's Checks" -> "Cashier's Checks", 100161) does not fix the record.
  const sameName = verdict.feeName.trim() === row.feeName.trim() || verdict.feeName.trim() === (row.originalFeeName ?? "").trim();
  const sameAmount = row.amount != null && Math.abs(row.amount - verdict.amount) < 0.005;
  return sameName && sameAmount && verdict.canonicalFeeKey === row.canonicalFeeKey ? verdict : null;
}

interface LiveRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string | null;
  /** The name before Knox's first logged retidy, when it renamed the row. */
  original_fee_name?: string | null;
  amount: number | string | null;
  conditions: string | null;
}

export interface EvalTakedown {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number | null;
  feeName: string;
  /** The verdict kind the lesson carries. */
  kind: Verdict;
  reason: string;
  why: string;
  /** An eval row (down now), a name rule or a hand check (second look). */
  source: "eval" | "rule" | "hand";
  /** The extraction shape a hand check names, for Knox's lesson. */
  pattern?: string;
}

export interface EvalVerdictResult {
  /** Eval rows still live and unchanged. */
  evalMatched: number;
  /** Eval rows still live whose record has changed since labelling (left alone). */
  evalChanged: number;
  /** Hand-checked rows still live and unchanged (second look). */
  handMatched: number;
  /** Live fees a name rule fails. */
  ruleFailing: number;
  flagged: number;
  waiting: number;
  /** Pending flags cleared because the current rule no longer fails the fee. */
  cleared: number;
  /** First-look audit rows rebuilt for clears made before the audit trail existed. */
  reconstructed: number;
  rolledBack: EvalTakedown[];
  /** Live fees flagged, never taken down, by flag. */
  flags: Record<FlagRule, number>;
  flagSamples: Array<{ feePublishedId: number; flag: FlagRule; feeName: string; canonicalFeeKey: string; amount: number | null }>;
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The live-fee read: the eval's rows, every live fee a name rule might match, and every live fee
 * holding a pending flag from this check, so the current rule re-judges it and clears the flag
 * when it no longer fails (v5).
 */
export function evalVerdictFeesSql(byInstitution: boolean): string {
  return `
    SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id,
           fp.canonical_fee_key, fp.fee_name, retidy.old_name AS original_fee_name, fp.amount, fr.conditions
      FROM published_fee_records fp
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN LATERAL (
        SELECT pf.evidence->>'old_name' AS old_name
          FROM pipeline_feedback pf
         WHERE pf.check_name = 'knox.name_retidy' AND pf.kind = 'name_retidied'
           AND pf.fee_published_id = fp.fee_published_id
         ORDER BY pf.created_at, pf.id
         LIMIT 1
      ) retidy ON TRUE
     WHERE fp.rolled_back_at IS NULL
       ${byInstitution ? "AND fp.institution_id = $2" : ""}
       AND (fp.fee_published_id = ANY($1::bigint[])
            OR retidy.old_name IS NOT NULL
            OR fp.fee_published_id IN (SELECT pf.fee_published_id FROM pipeline_feedback pf
                                        WHERE pf.check_name = '${EVAL_VERDICT_CHECK}' AND pf.kind = 'takedown_pending')
            OR (fp.canonical_fee_key IN ('atm_non_network', 'atm_international') AND fp.fee_name ~* '(rebate|reimburse|refund)')
            OR fp.fee_name ~* '^\\s*(no|without)\\s+(fee|charge)s?\\s+(for|to|on|when|if)\\y'
            OR (fp.amount = 0 AND fp.fee_name ~* '\\y(if|when|unless)\\s+you\\y|\\yof\\s+the\\s+following\\y|\\yqualifications?\\s+(are|is)\\s+met\\y|\\yto\\s+avoid\\y')
            OR fp.fee_name ~* '^\\s*(minimum|average|min\\.?)\\y[a-z ]{0,30}?\\ybalance\\s+(required\\s+|requirement\\s+)?to\\s+avoid\\y'
            OR fp.fee_name ~* '\\y(merchant|payee)\\s+(pays|presenting|presented)\\y|\\ypaid\\s+by\\s+(the\\s+)?(merchant|payee)\\y'
            OR fp.fee_name ~ '\\$\\s?[0-9]'
            OR (fp.fee_name ~ '[0-9]\\s*%' AND fp.fee_name ~* '\\y(minimum|maximum|min|max)\\.?:?\\s*$')
            OR fp.fee_name ~* '\\yin\\s*/\\s*out\\y|\\yout\\s*/\\s*in\\y|incoming\\s*/\\s*outgoing|outgoing\\s*/\\s*incoming|domestic\\s*/\\s*international|international\\s*/\\s*domestic'
            OR fp.fee_name ~* 'non[- ]?(customer|member|account ?holder)s?\\y|\\ynot\\s+a\\s+(customer|member)\\y|\\yfor\\s+non-?(members|customers)\\y|non-?clients?\\y'
            OR (fp.canonical_fee_key LIKE 'wire\\_%' AND fr.conditions ~ '\\$.*\\$'))
     ORDER BY fp.fee_published_id`;
}

/**
 * Runs the eval-verdict check for one publish step. Eval rows come down on the first run;
 * name-rule rows after their second look. A dry run reports and writes nothing. Never blocks
 * the step it runs in.
 */
export async function retireEvalVerdictFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<EvalVerdictResult> {
  const limit = Math.max(1, Math.min(options.limit ?? ROLLBACK_LIMIT, 2_000));
  const result: EvalVerdictResult = {
    evalMatched: 0, evalChanged: 0, handMatched: 0, ruleFailing: 0, flagged: 0, waiting: 0, cleared: 0, reconstructed: 0, rolledBack: [],
    flags: { non_customer_price: 0, wire_shared_line: 0 }, flagSamples: [], dryRun: options.dryRun,
  };
  let rows: LiveRow[];
  try {
    const ids = Array.from(LABELLED_IDS);
    rows = await inSavepoint(db, (scope) =>
      scope.unsafe<LiveRow[]>(
        evalVerdictFeesSql(Boolean(options.institutionId)),
        options.institutionId ? [ids, options.institutionId] : [ids],
      ),
    );
  } catch (error) {
    console.error("retireEvalVerdictFees read failed:", error);
    return result;
  }

  const evalRows: EvalTakedown[] = [];
  const ruleRows: EvalTakedown[] = [];
  const handRows: EvalTakedown[] = [];
  const flagRows: FeedbackRow[] = [];
  for (const row of rows) {
    const base = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount: num(row.amount),
      feeName: row.fee_name ?? "",
    };
    const originalFeeName = row.original_fee_name && row.original_fee_name !== base.feeName ? row.original_fee_name : null;
    const verdict = verdictFor({ ...base, originalFeeName });
    if (verdict) {
      evalRows.push({ ...base, kind: verdict.verdict, reason: `${EVAL_REASON_PREFIX}:${verdict.verdict}`, why: verdict.why, source: "eval" });
      continue;
    }
    const handVerdict = verdictFor({ ...base, originalFeeName }, HAND_CHECKED_VERDICTS);
    if (handVerdict) {
      const pattern = HAND_CHECKED_VERDICTS.find((entry) => entry.feePublishedId === base.feePublishedId)?.pattern;
      const prefix = handVerdict.verdict === "not_a_fee" ? RULE_REASON_PREFIX : handVerdict.verdict;
      handRows.push({ ...base, kind: handVerdict.verdict, reason: `${prefix}:${pattern ?? "hand_check"}`, why: handVerdict.why, source: "hand", pattern });
      continue;
    }
    if (LABELLED_IDS.has(base.feePublishedId)) {
      result.evalChanged += 1;
      continue;
    }
    const excerpt = excerptOf(row.conditions);
    // v6: a rename keeps what the fee is: "Monthly Service Charge if any of the following
    // qualifications are met" at $0 is a waiver after its retidy to "Monthly Service Charge" too.
    const rule = ruleFor(base.canonicalFeeKey, base.feeName, base.amount, excerpt)
      ?? (originalFeeName ? ruleFor(base.canonicalFeeKey, originalFeeName, base.amount, excerpt) : null);
    if (rule) {
      const kind = RULE_VERDICTS[rule];
      const prefix = kind === "not_a_fee" ? RULE_REASON_PREFIX : kind;
      ruleRows.push({ ...base, kind, reason: `${prefix}:${rule}`, why: RULE_WHY[rule], source: "rule" });
      continue;
    }
    const flag = flagFor(base.canonicalFeeKey, base.feeName, excerpt);
    if (!flag) continue;
    result.flags[flag] += 1;
    if (result.flagSamples.length < 30) {
      result.flagSamples.push({ feePublishedId: base.feePublishedId, flag, feeName: base.feeName, canonicalFeeKey: base.canonicalFeeKey, amount: base.amount });
    }
    flagRows.push({
      aboutStage: "extract",
      signal: "wrong",
      kind: flag,
      reportedBy: "hamilton",
      checkName: EVAL_VERDICT_CHECK,
      institutionId: base.institutionId,
      sourceDocumentId: base.sourceDocumentId,
      feeVerifiedId: base.feeVerifiedId,
      feePublishedId: base.feePublishedId,
      canonicalFeeKey: base.canonicalFeeKey,
      amount: base.amount,
      weight: 0.5,
      runId: options.runId,
      dedupeKey: `${EVAL_VERDICT_CHECK}:flag:${flag}:pub:${base.feePublishedId}`,
      evidence: { reason: `flag:${flag}`, why: FLAG_WHY[flag], fee_name: base.feeName, excerpt: excerpt ? excerpt.slice(0, 300) : null, version: EVAL_VERDICT_VERSION },
    });
  }
  result.evalMatched = evalRows.length;
  result.handMatched = handRows.length;
  result.ruleFailing = ruleRows.length;
  if (flagRows.length > 0 && !options.dryRun) {
    // A flag is a judgement on the record, not a takedown: the fee stays live and the row is
    // re-judged (same dedupe key) on every step while the shape holds.
    try {
      await inSavepoint(db, (scope) => recordFeedback(scope, flagRows));
    } catch (error) {
      console.error("eval verdict flags failed:", error);
    }
  }
  // Every takedown is logged; the eval rows come down now (James, Oct 8), the rule rows after
  // the usual second look. Every row read that no rule fails today passes: a pending flag it
  // holds from an earlier rule is cleared (`takedown_cleared`), never confirmed, so a narrowed
  // rule (v5) lets the fees its predecessor flagged stay live through the normal path.
  // The first looks the v5 clear rewrote in place (378 rows, 04:21 Oct 9) get their audit row
  // back, once; later runs find none missing.
  result.reconstructed = await reconstructFirstLooks(db, { check: EVAL_VERDICT_CHECK, runId: options.runId, clearedWhy: RULE_REVISED_WHY, dryRun: options.dryRun });
  const lookRows = [...ruleRows, ...handRows];
  const failingIds = new Set([...evalRows, ...lookRows].map((fee) => fee.feePublishedId));
  const passing = rows.map((row) => Number(row.fee_published_id)).filter((id) => !failingIds.has(id));
  const look = await secondLook(db, { check: EVAL_VERDICT_CHECK, runId: options.runId, failing: [...evalRows, ...lookRows], passing, dryRun: options.dryRun });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  result.cleared = look.cleared;
  if (look.cleared > 0 && !options.dryRun) {
    // The lesson, in the shared learning store: a rule that flagged fees it no longer fails
    // overfired, and the count says by how much. One row per rule version (dedupe key).
    try {
      await inSavepoint(db, (scope) => recordFeedback(scope, [{
        aboutStage: "publish",
        aboutStrategy: EVAL_VERDICT_CHECK,
        aboutVersion: RULE_REVISED_VERSION,
        signal: "right",
        kind: "rule_revised",
        reportedBy: "hamilton",
        checkName: EVAL_VERDICT_CHECK,
        weight: 0,
        runId: options.runId,
        dedupeKey: `${EVAL_VERDICT_CHECK}:rule_revised:v${RULE_REVISED_VERSION}`,
        evidence: {
          version: RULE_REVISED_VERSION,
          cleared: look.cleared,
          why: RULE_REVISED_WHY,
        },
      }]));
    } catch (error) {
      console.error("eval verdict rule lesson failed:", error);
    }
  }
  if (evalRows.length === 0 && lookRows.length === 0) return result;
  const confirmedLooks = new Set(look.confirmed.filter((fee) => fee.source !== "eval").map((fee) => fee.feePublishedId));
  const confirmed = [...evalRows, ...lookRows.filter((fee) => confirmedLooks.has(fee.feePublishedId))].slice(0, limit);
  if (options.dryRun) {
    result.rolledBack = confirmed;
    return result;
  }
  if (confirmed.length === 0) return result;

  try {
    result.rolledBack = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${options.batchId},
               rolled_back_reason = v.reason
          FROM unnest(${confirmed.map((fee) => fee.feePublishedId)}::bigint[], ${confirmed.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const closed = confirmed.filter((fee) => ids.has(fee.feePublishedId));
      const verified = closed.filter((fee) => fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag)
                 END
            FROM unnest(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${verified.map((fee) => fee.reason)}::text[])
                 AS v(fee_verified_id, flag)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return closed;
    });
  } catch (error) {
    console.error("eval verdict rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  const lessons: FeedbackRow[] = result.rolledBack.map((fee) => ({
    aboutStage: "extract",
    signal: "wrong",
    kind: fee.kind,
    reportedBy: "hamilton",
    checkName: EVAL_VERDICT_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    feeVerifiedId: fee.feeVerifiedId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: fee.amount,
    runId: options.runId,
    dedupeKey: `${EVAL_VERDICT_CHECK}:pub:${fee.feePublishedId}`,
    evidence: {
      reason: fee.reason,
      why: fee.why,
      fee_name: fee.feeName,
      source: fee.source === "eval"
        ? "complete-record eval, Oct 8 2026 (confirm list rows 1-11)"
        : fee.source === "hand" ? "hand check against the bank's schedule" : `name rule ${fee.reason}`,
      ...(fee.pattern ? { pattern: fee.pattern } : {}),
      version: EVAL_VERDICT_VERSION,
    },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.eval_verdict_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} fee(s) the complete-record eval or a name rule found wrong`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            eval_rows: result.rolledBack.filter((fee) => fee.source === "eval").length,
            rule_rows: result.rolledBack.filter((fee) => fee.source === "rule").length,
            hand_rows: result.rolledBack.filter((fee) => fee.source === "hand").length,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
              reason: fee.reason,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("eval verdict lesson/event failed:", error);
  }
  return result;
}
