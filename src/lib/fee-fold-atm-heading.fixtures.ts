/**
 * #1092: near-miss schedule texts for the fold's ATM heading read (`ownAtmSection`, `fee-fold.ts`),
 * each with the one balance inquiry it must place and where it must go with
 * `FOOTNOTED_ATM_HEADING_LIVE` on. `changed` marks the cases main places wrong (they read
 * differently with the switch off); every other case must fold the same either way.
 *
 * Built from Texas key 2416 (Texas Bank and Trust: "TBT or Allpoint ATM: no fee" then "Non-TBT or
 * Non-Allpoint ATM1:" over "Balance inquiry: $0.75") and the heading shapes around it. The other
 * banks' texts are made up for the shape; they are not real banks' schedules.
 *
 * The fold rules this follows (fee-fold.ts, James, Oct 8 and the Oct 9 Regions review): an inquiry
 * at another bank's or network's ATM is a non-network ATM fee; one at the bank's own ATM, or at a
 * partner network the bank names as its own ("Allpoint ATM:", "MoneyPass ATM:"), has no home; one by
 * phone, at a teller or online has no home whatever heading it sits under.
 */

export const lines = (...rows: string[]) => rows.join("\n");

export interface AtmHeadingCase {
  name: string;
  text: string;
  fee: { name: string; amount: number };
  /** Where the fold files it with the switch on (null: no home among the 50). */
  to: "atm_non_network" | null;
  /** True when main folds it elsewhere. */
  changed: boolean;
}

const OWN_THEN = (heading: string, ...rest: string[]) =>
  lines("ATM Fees", "Regions ATM:", "Withdrawal $0.00", "Balance Inquiry $0.00", heading, "Withdrawal $3.00", ...rest, "Balance Inquiry $3.00");

/** Another bank's or network's ATM, its heading carrying a note mark, under the bank's own heading. */
const MARKED_NON_NETWORK: readonly AtmHeadingCase[] = [
  {
    name: "Texas 2416: Non-TBT or Non-Allpoint ATM1: under TBT or Allpoint ATM:",
    text: lines(
      "TBT Debit Card Fees",
      "Replacement card:  $5",
      "Foreign Transaction Fee:  1.0% of transaction amount",
      "TBT or Allpoint ATM:  no fee",
      "Non-TBT or Non-Allpoint ATM1:",
      "Balance inquiry:  $0.75",
      "Transfer:  no fee",
      "Withdrawal (per transaction):  $2",
      "1Foreign ATM terminals may impose an additional surcharge",
    ),
    fee: { name: "Balance inquiry", amount: 0.75 },
    to: "atm_non_network",
    changed: true,
  },
  { name: "footnote digit: Non-Regions ATM1:", text: OWN_THEN("Non-Regions ATM1:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "footnote digit 2: Non-Regions ATM2:", text: OWN_THEN("Non-Regions ATM2:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "plural with footnote digit: Non-Regions ATMs1:", text: OWN_THEN("Non-Regions ATMs1:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "superscript one: Non-Regions ATM¹:", text: OWN_THEN("Non-Regions ATM¹:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "superscript two: Non-Regions ATMs²:", text: OWN_THEN("Non-Regions ATMs²:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "superscript three: Non-Regions ATM³:", text: OWN_THEN("Non-Regions ATM³:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "two superscripts: Non-Regions ATM¹²:", text: OWN_THEN("Non-Regions ATM¹²:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "asterisk: Non-Regions ATM*:", text: OWN_THEN("Non-Regions ATM*:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "two asterisks: Non-Regions ATMs**:", text: OWN_THEN("Non-Regions ATMs**:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "dagger: Non-Regions ATM†:", text: OWN_THEN("Non-Regions ATM†:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "double dagger: Non-Regions ATM‡:", text: OWN_THEN("Non-Regions ATM‡:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "bracketed footnote: Non-Regions ATM (1):", text: OWN_THEN("Non-Regions ATM (1):"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "bracketed footnote, no space: Non-Regions ATMs(2):", text: OWN_THEN("Non-Regions ATMs(2):"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "bracketed letter note: Non-Regions ATM (a):", text: OWN_THEN("Non-Regions ATM (a):"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "bracketed asterisk: Non-Regions ATM (*):", text: OWN_THEN("Non-Regions ATM (*):"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "Foreign ATM1:", text: OWN_THEN("Foreign ATM1:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "Other ATMs*:", text: OWN_THEN("Other ATMs*:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "Out-of-Network ATMs²:", text: OWN_THEN("Out-of-Network ATMs²:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "Non-network machines1:", text: OWN_THEN("Non-network machines1:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
  { name: "Shared ATM†:", text: OWN_THEN("Shared ATM†:"), fee: { name: "Balance Inquiry", amount: 3 }, to: "atm_non_network", changed: true },
];

/** Partner networks (Allpoint, MoneyPass): the bank's own when it names them so, another network's after "Non-". */
const PARTNER_NETWORKS: readonly AtmHeadingCase[] = [
  {
    name: "Allpoint partner then Non-Allpoint ATM¹:",
    text: lines("ATM Fees", "Allpoint ATM:", "Balance Inquiry $0.00", "Non-Allpoint ATM¹:", "Balance Inquiry $1.50"),
    fee: { name: "Balance Inquiry", amount: 1.5 },
    to: "atm_non_network",
    changed: true,
  },
  {
    name: "Allpoint partner then Non-Allpoint ATMs (1):",
    text: lines("ATM Fees", "Allpoint ATM:", "Balance Inquiry $0.00", "Non-Allpoint ATMs (1):", "Balance Inquiry $1.50"),
    fee: { name: "Balance Inquiry", amount: 1.5 },
    to: "atm_non_network",
    changed: true,
  },
  {
    name: "MoneyPass partner then Non-MoneyPass ATM*:",
    text: lines("ATM Fees", "MoneyPass ATM:", "Balance Inquiry $0.00", "Non-MoneyPass ATM*:", "Balance Inquiry $2.00"),
    fee: { name: "Balance Inquiry", amount: 2 },
    to: "atm_non_network",
    changed: true,
  },
  {
    name: "own heading then Allpoint and other network ATMs1:",
    text: OWN_THEN("Allpoint and other network ATMs1:"),
    fee: { name: "Balance Inquiry", amount: 3 },
    to: "atm_non_network",
    changed: true,
  },
  {
    name: "own partner with a footnote: Allpoint ATM¹: after a foreign ATM heading",
    text: lines("ATM Fees", "Foreign ATM:", "Balance Inquiry $2.00", "Allpoint ATM¹:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own partner with a bracketed footnote: MoneyPass ATM (1):",
    text: lines("ATM Fees", "Non-MoneyPass ATM:", "Balance Inquiry $2.00", "MoneyPass ATM (1):", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own partner with a registered mark: MoneyPass® ATM:",
    text: lines("ATM Fees", "MoneyPass® ATM:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own partner, unmarked: Allpoint ATM: stays own (main's rule)",
    text: lines("ATM Fees", "Allpoint ATM:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "another network, unmarked: Non-Allpoint ATM: stays non-network (main's rule)",
    text: lines("ATM Fees", "Allpoint ATM:", "Balance Inquiry $0.00", "Non-Allpoint ATM:", "Balance Inquiry $1.50"),
    fee: { name: "Balance Inquiry", amount: 1.5 },
    to: "atm_non_network",
    changed: false,
  },
];

/** The bank's own ATM with a note mark: no home, where main took the mark for no heading at all. */
const MARKED_OWN: readonly AtmHeadingCase[] = [
  { name: "own: Regions ATM1:", text: lines("ATM Fees", "Regions ATM1:", "Balance Inquiry $0.00"), fee: { name: "Balance Inquiry", amount: 0 }, to: null, changed: true },
  { name: "own plural: Regions ATMs²:", text: lines("ATM Fees", "Regions ATMs²:", "Balance Inquiry $0.00"), fee: { name: "Balance Inquiry", amount: 0 }, to: null, changed: true },
  { name: "own: Our ATM*:", text: lines("ATM Fees", "Our ATM*:", "Balance Inquiry $0.00"), fee: { name: "Balance Inquiry", amount: 0 }, to: null, changed: true },
  {
    name: "own after another bank's heading: Regions ATM†:",
    text: lines("ATM Fees", "Non-Regions ATM:", "Balance Inquiry $3.00", "Regions ATM†:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own after a foreign heading: Proprietary ATM1:",
    text: lines("ATM Fees", "Foreign ATM:", "Balance Inquiry $2.00", "Proprietary ATM1:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own after a non-bank heading: TBT ATM¹:",
    text: lines("ATM Fees", "Non-TBT ATM:", "Balance Inquiry $2.00", "TBT ATM¹:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own network: In-Network ATMs*:",
    text: lines("ATM Fees", "Foreign ATMs:", "Balance Inquiry $2.00", "In-Network ATMs*:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own network in two words: In Network ATM:",
    text: lines("ATM Fees", "Foreign ATM:", "Balance Inquiry $2.00", "In Network ATM:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own, the mark on the bank's name: Regions¹ ATM:",
    text: lines("ATM Fees", "Regions¹ ATM:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
  {
    name: "own, a bank name of several words: Texas Bank and Trust ATMs‡:",
    text: lines("ATM Fees", "Texas Bank and Trust ATMs‡:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: true,
  },
];

/** Another bank named in more than one word, or a generic other bank: main read its last word as the bank's own. */
const NAMED_NON_NETWORK: readonly AtmHeadingCase[] = [
  { name: "Non TBT ATM: (space, no hyphen)", text: lines("ATM Fees", "Non TBT ATM:", "Balance Inquiry $2.00"), fee: { name: "Balance Inquiry", amount: 2 }, to: "atm_non_network", changed: true },
  { name: "Non-Austin Bank ATM:", text: lines("ATM Fees", "Non-Austin Bank ATM:", "Balance Inquiry $2.00"), fee: { name: "Balance Inquiry", amount: 2 }, to: "atm_non_network", changed: true },
  { name: "Non First Federal ATM:", text: lines("ATM Fees", "Non First Federal ATM:", "Balance Inquiry $2.00"), fee: { name: "Balance Inquiry", amount: 2 }, to: "atm_non_network", changed: true },
  { name: "Other Bank ATM:", text: lines("ATM Fees", "Other Bank ATM:", "Balance Inquiry $2.00"), fee: { name: "Balance Inquiry", amount: 2 }, to: "atm_non_network", changed: true },
  { name: "Other Banks' ATMs:", text: lines("ATM Fees", "Other Banks' ATMs:", "Balance Inquiry $2.00"), fee: { name: "Balance Inquiry", amount: 2 }, to: "atm_non_network", changed: true },
  { name: "Another Bank's ATM:", text: lines("ATM Fees", "Another Bank's ATM:", "Balance Inquiry $2.00"), fee: { name: "Balance Inquiry", amount: 2 }, to: "atm_non_network", changed: true },
  {
    name: "Other Financial Institution ATMs:",
    text: lines("ATM Fees", "Other Financial Institution ATMs:", "Balance Inquiry $2.00"),
    fee: { name: "Balance Inquiry", amount: 2 },
    to: "atm_non_network",
    changed: true,
  },
  { name: "Other Credit Union ATMs:", text: lines("ATM Fees", "Other Credit Union ATMs:", "Balance Inquiry $2.00"), fee: { name: "Balance Inquiry", amount: 2 }, to: "atm_non_network", changed: true },
  { name: "Out of Area ATM:", text: lines("ATM Fees", "Out of Area ATM:", "Balance Inquiry $2.00"), fee: { name: "Balance Inquiry", amount: 2 }, to: "atm_non_network", changed: true },
  {
    name: "own heading then Non-Austin Bank ATM1:",
    text: lines("ATM Fees", "Austin Bank ATM:", "Balance Inquiry $0.00", "Non-Austin Bank ATM1:", "Balance Inquiry $2.00"),
    fee: { name: "Balance Inquiry", amount: 2 },
    to: "atm_non_network",
    changed: true,
  },
];

/** Shapes the fix must leave as main reads them. */
const UNCHANGED: readonly AtmHeadingCase[] = [
  {
    name: "ATM in a sentence with no colon: the own heading above still decides",
    text: lines("ATM Fees", "Regions ATM:", "Withdrawal $0.00", "The owner of any ATM1 you use may charge a fee.", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "ATM in a sentence with a marked colon: \"when you use an ATM*:\" is no heading",
    text: lines("ATM Fees", "Regions ATM:", "Withdrawal $0.00", "Charges that apply when you use an ATM*:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "a footnote mark in prose: \"see note 1\" after an own heading",
    text: lines("ATM Fees", "Regions ATM:", "Withdrawal $0.00 (see note 1)", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "product code ATM10: is no footnote",
    text: lines("ATM Fees", "Regions ATM:", "Withdrawal $0.00", "Card Plan ATM10:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "product code ATM1 Card: is no heading",
    text: lines("ATM Fees", "Regions ATM:", "Withdrawal $0.00", "Foreign ATM1 Card: $5.00", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "product code ATM-1: is no footnote",
    text: lines("ATM Fees", "Regions ATM:", "Withdrawal $0.00", "Foreign ATM-1:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "product code ATM1A: is no footnote",
    text: lines("ATM Fees", "Regions ATM:", "Withdrawal $0.00", "Foreign ATM1A:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "a general heading over the own one: Other Services then Regions ATM:",
    text: lines("Other Services", "Regions ATM:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "a non-customer heading is no other bank: Non-Customer Regions ATM:",
    text: lines("ATM Fees", "Non-Customer Regions ATM:", "Balance Inquiry $3.00"),
    fee: { name: "Balance Inquiry", amount: 3 },
    to: null,
    changed: false,
  },
  {
    name: "no ATM heading at all: an ATM fee section",
    text: lines("ATM Fees", "Withdrawal $2.00", "Balance Inquiry $1.00"),
    fee: { name: "Balance Inquiry", amount: 1 },
    to: "atm_non_network",
    changed: false,
  },
  {
    name: "teller inquiry under a footnoted other-bank heading keeps no home",
    text: OWN_THEN("Non-Regions ATM1:", "Teller Balance Inquiry $1.00"),
    fee: { name: "Teller Balance Inquiry", amount: 1 },
    to: null,
    changed: false,
  },
  {
    name: "phone inquiry under a footnoted other-bank heading keeps no home",
    text: OWN_THEN("Non-Regions ATM¹:", "Telephone Balance Inquiry $1.00"),
    fee: { name: "Telephone Balance Inquiry", amount: 1 },
    to: null,
    changed: false,
  },
  {
    name: "inquiry by phone under Non TBT ATM: keeps no home",
    text: lines("ATM Fees", "Non TBT ATM:", "Balance Inquiry by Phone $1.00"),
    fee: { name: "Balance Inquiry by Phone", amount: 1 },
    to: null,
    changed: false,
  },
  {
    name: "inquiry in person under Other Bank ATM: keeps no home",
    text: lines("ATM Fees", "Other Bank ATM:", "Balance Inquiry (in person) $1.00"),
    fee: { name: "Balance Inquiry (in person)", amount: 1 },
    to: null,
    changed: false,
  },
  {
    name: "a named non-network inquiry under a footnoted own heading stays non-network",
    text: lines("ATM Fees", "Regions ATM1:", "Balance Inquiry at a non-Regions ATM $3.00"),
    fee: { name: "Balance Inquiry at a non-Regions ATM", amount: 3 },
    to: "atm_non_network",
    changed: false,
  },
];

const OWN_ABOVE = (...rest: string[]) => lines("ATM Fees", "Regions ATM:", "Balance Inquiry $0.00", ...rest);

/** Review of 634ce2e (#2892): negated headings, a lead on the line above, a generic word, "Non In-Network". */
const REVIEW: readonly AtmHeadingCase[] = [
  { name: "review blocker: Not In Network ATM: is another network", text: OWN_ABOVE("Not In Network ATM:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: false },
  { name: "review blocker: NOT IN NETWORK ATM: is another network", text: OWN_ABOVE("NOT IN NETWORK ATM:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: false },
  { name: "review blocker: ATMs not in network ATM: is another network", text: OWN_ABOVE("ATMs not in network ATM:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: false },
  { name: "review blocker: Not In Network ATM1: (marked) is another network", text: OWN_ABOVE("Not In Network ATM1:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: true },
  { name: "review: Non In-Network ATM: is another network", text: OWN_ABOVE("Non In-Network ATM:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: true },
  { name: "review: Non-In-Network ATMs: is another network", text: OWN_ABOVE("Non-In-Network ATMs:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: false },
  { name: "review: Not In-Network ATM*: is another network", text: OWN_ABOVE("Not In-Network ATM*:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: true },
  { name: "review: Not Our ATM: is another network", text: OWN_ABOVE("Not Our ATM:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: true },
  { name: "review: Outside Network ATM: is another network", text: OWN_ABOVE("Outside Network ATM:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: false },
  { name: "review: Out of Network ATM¹: is another network", text: OWN_ABOVE("Out of Network ATM¹:", "Balance Inquiry $1.50"), fee: { name: "Balance Inquiry", amount: 1.5 }, to: "atm_non_network", changed: true },
  {
    name: "review note 1: a non-Regions sentence on the line above does not lead Regions ATM:",
    text: lines("ATM Fees", "Withdrawals at non-Regions ATMs", "Regions ATM:", "Balance Inquiry $1.00"),
    fee: { name: "Balance Inquiry", amount: 1 },
    to: null,
    changed: false,
  },
  {
    name: "review note 1: Other Banks on the line above does not lead Bank ATM:",
    text: lines("ATM Fees", "Other Banks", "Austin Bank ATM:", "Balance Inquiry $0.00"),
    fee: { name: "Balance Inquiry", amount: 0 },
    to: null,
    changed: false,
  },
  {
    name: "review note 2: Debit Card ATM1: under Non-Regions ATM: stays non-network",
    text: lines("ATM Fees", "Non-Regions ATM:", "Withdrawal $3.00", "Debit Card ATM1:", "Balance Inquiry $2.00"),
    fee: { name: "Balance Inquiry", amount: 2 },
    to: "atm_non_network",
    changed: false,
  },
  {
    name: "review note 2: Foreign Transaction Fees ATM*: under Non-Regions ATM: stays non-network",
    text: lines("ATM Fees", "Non-Regions ATM:", "Withdrawal $3.00", "Foreign Transaction Fees ATM*:", "Balance Inquiry $2.00"),
    fee: { name: "Balance Inquiry", amount: 2 },
    to: "atm_non_network",
    changed: false,
  },
];

export const ATM_HEADING_CASES: readonly AtmHeadingCase[] = [
  ...MARKED_NON_NETWORK,
  ...PARTNER_NETWORKS,
  ...MARKED_OWN,
  ...NAMED_NON_NETWORK,
  ...UNCHANGED,
  ...REVIEW,
];
