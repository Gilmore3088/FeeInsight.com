/**
 * #1397: a $0 that is one named account's benefit, not the bank's price. Shared by Knox (its free-fee
 * read holds such a $0 for review instead of sending it to Darwin as a free fee, rules v156) and
 * Darwin (verify refuses it, and the live re-check `darwin/account-benefit-zero-check.ts` reads what
 * is already live). Pure: no database and no agent imports.
 *
 * Darwin's tier-perk rule (`darwin/tier-perk.ts`) refuses a $0 from one tier's own schedule or named
 * for a tier's account. This is the same error inside a general page: a list of what one account
 * gives its holders, where one item is a free fee. Read as a fee, the item went live as the bank's
 * price for everyone:
 * - "(6) PremiumSpend Checking Account owners are provided the following free services: free check
 *   writing, free incoming domestic wire transfers, ..." (live 152991, institution 8495).
 * - "Fee Waivers: As long as you have an active Relationship Rewards Checking account, the following
 *   fee waivers will be offered: Free Money Orders and Cashier's checks; No fee for incoming wires; ..."
 *   (live 159066, institution 550, whose schedule prices incoming wires).
 * - "Benefits of Business Solution Banking:" over one item per line, "No fee for cashier's checks".
 * - "Checking Accounts: Business Basic Checking, $25 opening deposit, No minimum balance requirement,
 *   ..., Free incoming wires, ..." (live 100941, institution 6914): an account's feature list.
 *
 * The test: the $0's own words are a list item ("free ...", "no fee for ...", "no charge for ...",
 * "complimentary ...") set off from what precedes it by a comma, semicolon, colon, line break, bullet or
 * full stop. Walking back over the list's earlier items (each short), the walk must reach the list's
 * lead, and the lead (with the two pieces before it) must name one account:
 * - `holder_grant`: its owners, holders, members or customers are provided, receive, get or enjoy what
 *   follows ("PremiumSpend Checking Account owners are provided the following free services:").
 * - `account_waivers`: "the following" fee waivers, benefits, perks, services or features, or a heading
 *   "Benefits of ...:", "Features & Benefits:", "Free Services:", "Perks:".
 * - `feature_list`: the walk reaches the account's name first, and the items between list the
 *   account's terms ("$25 opening deposit", "no minimum balance", "no monthly maintenance fee").
 *
 * A $0 stays when the grant is the bank's to everyone ("All members receive ...", "A benefit to banking
 * with Example FCU!", "Free for customers; non-customers, $20.00"), when the item is a sentence or a
 * heading ("Free Bill Payer is a benefit for ...", "Free Services: ..."), when the walk meets prose (a
 * long piece or one with a verb) or a table cell (" | ") before a lead, when no account is named, and
 * when the text also prints the item outside such a list (a schedule row is the bank's price).
 * The walk also ends, keeping the $0, at the bank's own schedule (review of #2894): a section heading
 * ("General Fees", "MISCELLANEOUS FEES", "OTHER SERVICES", "Additional Services"), a priced row that is
 * not one of the account's terms or a perk ("Stop payment $30", "Outgoing $25", "Incoming Wires FREE",
 * "n/c"; "$25 opening deposit" and "$4.00 off each check order" do not end it),
 * or a label on the item's own row ("Incoming Wires: No charge for incoming domestic wires").
 * The walk reaches `ACCOUNT_BENEFIT_WALK_CHARS` (450) before the item, the window Darwin's re-check reads.
 * Also: "Here is what you get." after an account is opened counts as a lead.
 */

export type AccountBenefitKind = "holder_grant" | "account_waivers" | "feature_list";

export interface AccountBenefitZero {
  kind: AccountBenefitKind;
  /** The account the lead names. */
  account: string;
  /** The lead through the item, as printed. */
  evidence: string;
}

export interface AccountBenefitZeroInput {
  /** The $0's own line or excerpt, as Knox read it. */
  line: string | null | undefined;
  /** The text the line was read from (or windows of it, each ending with the line). */
  documentText?: string | null;
  /** The fee's name, to find its item when the line is the whole list. */
  feeName?: string | null;
}

/**
 * How far before the item the walk may go. Darwin's live re-check reads the same reach of stored text
 * before each place the line is printed (`ACCOUNT_BENEFIT_WALK_CHARS` in its SQL window), so both read alike.
 */
export const ACCOUNT_BENEFIT_WALK_CHARS = 450;
const WALK_CHARS = ACCOUNT_BENEFIT_WALK_CHARS;
/** The most list items the walk passes over. */
const WALK_ITEMS = 30;
/** A list item is short; a longer piece without a lead is prose, and ends the walk. */
const ITEM_CHARS = 120;

/** What may follow an entry: footnote marks, then a separator, a bracket, a line break or the end. */
const ITEM_END = /^[*†‡\d]*(?:\s*[,;.)(\r\n|•·▪◦●]|\s*$)/;

const SENTENCE_VERB = /\b(?:is|are|was|will|may|must|can|applies|apply)\b/i;

/** The item's own words: a free fee as a list item. */
const FREE_ITEM = /^\s*(?:[-*•·▪◦●]\s*)?(?:free|no (?:fee|charge|cost)(?: for)?|complimentary)\b/i;

/**
 * An account's name: one to four capitalised words before Checking, Savings, Banking, Account, Club or
 * Package ("PremiumSpend Checking Account", "Relationship Rewards Checking", "Business e-Checking",
 * "Business Solution Banking").
 */
const ACCOUNT_NAME = /\b((?:[A-Z][\w'’&+-]*\s+){1,4}(?:[a-z]-)?(?:Checking|Savings|Share Draft|Money Market|Banking)(?:\s+Account)?|(?:[A-Z][\w'’&+-]*\s+){1,4}(?:Account|Club|Package))\b/g;
/** Words that open the piece but are not part of the name ("Fee Waivers: As long as you have an active ..."). */
const NAME_LEAD_WORDS = /^(?:(?:Fee|Waivers?|Benefits?|Features?|Of|As|Long|If|When|While|You|Have|An|A|The|With|For|Active|Open|Your|Our|Checking Accounts?|Plus|All)\b[:\s,&]*)+/;
/** A name that is the bank's whole range, or a service, not one account. */
const NOT_ONE_ACCOUNT = /^(?:(?:All|Every|Any|Each|Our|Your|The|Business|Personal|Consumer|Member|Membership|New|Online|Mobile|Digital|Internet|Home|Telephone|Phone|Text)\s+)*(?:Checking|Savings|Banking|Account|Accounts|Club|Package)(?:\s+Account)?$/;

const HOLDER_GRANT = /\b(?:owners?|holders?|members?|customers?|clients?)\b[^.;]{0,40}?\b(?:are provided|are given|receive|get|enjoy|are eligible for|qualify for|are entitled to)\b/i;
/** A service, not an account: "Free Online Banking", "24-hour Telephone Banking". */
const SERVICE_BANKING = /\b(?:Online|Mobile|Digital|Internet|Telephone|Phone|Home|Text|Electronic|E-?)\s+Banking\b/i;
/** "Benefits of Premier Advantage", "all of the benefits of Basic Checking": the package's name. */
const BENEFITS_OF = /\bbenefits? of\s+((?:[A-Z][\w'’&+-]*\s*){1,4})/;
const ACCOUNT_WAIVERS = /\bthe following\s+(?:free\s+)?(?:fee waivers|waivers|benefits|perks|services|features|privileges|discounts)\b|\bbenefits? of\s+[A-Z]|\bhere(?:'s| is) what you get\b|\b(?:features\s*(?:&|and)\s*benefits|free services|perks|account benefits)\s*:/i;
const ACCOUNT_TERMS = /\b(?:opening deposit|minimum (?:deposit )?to open|no minimum balance|minimum balance requirement|no monthly (?:(?:maintenance|service) )?(?:fee|charge)|monthly (?:maintenance|service) (?:fee|charge)|unlimited check writing|no per item charges?|earns? (?:dividends|interest))\b/i;
/**
 * A priced schedule row ("Stop payment $30", "n/c", "Incoming Wires FREE"): the bank's own price list,
 * which ends an account's feature list. A list item that opens with its free word is not a price.
 */
const PRICED = /\$\s?\d|\bn\/c\b/i;
const PRICE_WORD_AFTER = /\S[\s:–-]+(?:free|no charge|none)\s*$/i;
/** A perk with a dollar figure is no price: "$4.00 off each check order", "$15 discount on safe deposit boxes". */
const PERK_AMOUNT = /\b(?:off|discount(?:ed)?|rebates?|refunds?|cash back|bonus)\b/i;
/** A section heading: fees, charges or services as its last word ("General Fees", "Additional Services"). */
const HEADING_WORD = /\b(?:fees|charges|services)$/i;
/** A list item's own opening word, never a heading's ("No per item charges", "No coin/currency charges"). */
const ITEM_OPENING = /^(?:no|unlimited|low|reduced|waived|discounted)\b/i;
/** A grant to the bank's whole membership, not one account. */
const WHOLE_BANK = /\b(?:all|every)\s+(?:members?|customers?|clients?|account ?holders?|accounts?)\b|\bbenefit (?:to|of) banking with\b|\bnon-?(?:members?|customers?)\b/i;

/** Spaces squashed, line breaks and bullets kept as line breaks. */
function tidy(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*[•·▪◦●]\s*/g, "\n")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** `tidy` without the trim, for the text right before an item, whose last line break counts. */
function tidyWindow(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*[•·▪◦●]\s*/g, "\n")
    .replace(/ *\n */g, "\n");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The account a piece names, the last one in it. */
function accountIn(piece: string): string | null {
  let found: string | null = null;
  for (const match of piece.matchAll(ACCOUNT_NAME)) {
    const name = match[1].replace(NAME_LEAD_WORDS, "").trim();
    if (!name || NOT_ONE_ACCOUNT.test(name) || SERVICE_BANKING.test(name) || !/\s/.test(name)) continue;
    found = name;
  }
  // "Benefits of Premier Advantage:" names a package by whatever it is called.
  const benefitsOf = BENEFITS_OF.exec(piece)?.[1]?.trim();
  if (!found && benefitsOf && !NOT_ONE_ACCOUNT.test(benefitsOf) && !SERVICE_BANKING.test(benefitsOf)) found = benefitsOf;
  return found;
}

const NAME_FILLER = new Set(["fee", "fees", "the", "for", "each", "per", "item", "items", "and", "charge", "charges", "service", "free", "transfer", "transfers"]);

/**
 * The $0's own item. The line itself when it is one ("free incoming domestic wire transfers"); when the
 * line is the whole list, the list item that is a free item and carries a word of the fee's name.
 */
function itemOf(line: string, feeName: string): string | null {
  // A sentence ("Free Bill Payer is a benefit for active Bill Payer users") or a heading ("Free
  // Services: ...") is not a list entry.
  if (FREE_ITEM.test(line) && (SENTENCE_VERB.test(line) || /^[^,;]{0,40}:/.test(line))) return null;
  if (FREE_ITEM.test(line)) return line.replace(/^\s*[-*•·▪◦●]\s*/, "").replace(/[\s,;.]+$/, "");
  const words = (feeName.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !NAME_FILLER.has(word));
  if (words.length === 0) return null;
  for (const part of line.split(/[,;:\n•·]/)) {
    const item = part.trim().replace(/[\s.]+$/, "");
    if (FREE_ITEM.test(item) && words.some((word) => item.toLowerCase().includes(word.replace(/s$/, "")))) return item;
  }
  return null;
}

/** A priced row that is not one of the account's own terms ("$25 opening deposit") or a perk ("$4.00 off"). */
function pricedRow(piece: string): boolean {
  if (ACCOUNT_TERMS.test(piece) || PERK_AMOUNT.test(piece)) return false;
  return PRICED.test(piece) || (!FREE_ITEM.test(piece) && PRICE_WORD_AFTER.test(piece));
}

/**
 * A section heading of the bank's schedule ("General Fees", "MISCELLANEOUS FEES", "OTHER SERVICES",
 * "Additional Services"). The leads `ACCOUNT_WAIVERS` accepts ("Free Services:", "Perks:") are read
 * before this, so they never count as one.
 */
function headingPiece(piece: string): boolean {
  const bare = piece.replace(/[\s:*†‡]+$/, "").trim();
  if (!bare || FREE_ITEM.test(bare) || ITEM_OPENING.test(bare) || ACCOUNT_TERMS.test(bare)) return false;
  if (/[A-Z]{2}/.test(bare) && !/[a-z]/.test(bare)) return true;
  return bare.split(/\s+/).length <= 5 && HEADING_WORD.test(bare);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the $0 is one named account's benefit, with the kind, the account and the evidence. */
export function accountBenefitZeroOf(input: AccountBenefitZeroInput): AccountBenefitZero | null {
  const whole = tidy(input.line ?? "");
  const item = whole ? itemOf(squash(whole), input.feeName ?? "") : null;
  if (!item) return null;
  const pattern = new RegExp(item.split(" ").map(escapeRegExp).join("\\s+"), "gi");
  // The document is searched as stored; only the window before each place the item is printed is
  // tidied (a whole schedule tidied per $0 read is slow on a long PDF).
  const given = input.documentText ?? "";
  const text = pattern.test(given) ? given : whole;
  pattern.lastIndex = 0;
  // Every place the text prints the item must be an account's benefit: one that stands on its own
  // (a schedule row, "Free incoming wires" under the bank's own heading) is the bank's price.
  let found: AccountBenefitZero | null = null;
  let seen = 0;
  for (const match of text.matchAll(pattern)) {
    seen += 1;
    const end = (match.index ?? 0) + match[0].length;
    // The item ends where its list entry ends ("Free debit card**", "free Zelle,"): one that runs on
    // into a sentence ("Free Bill Payer is a benefit for active Bill Payer users") is not an entry.
    if (!ITEM_END.test(text.slice(end, end + 12))) return null;
    const benefit = benefitAt(text, match.index ?? 0, match[0]);
    if (!benefit) return null;
    found ??= benefit;
  }
  return seen > 0 ? found : null;
}

function benefitAt(text: string, at: number, item: string): AccountBenefitZero | null {
  const before = tidyWindow(text.slice(Math.max(0, at - WALK_CHARS), at));
  // The item is a list entry: set off by a separator, a line break or a full stop.
  if (!/(?:[,;:.\n]|^)\s*$/.test(before) || at === 0) return null;
  // A table cell ends the list. A blank line does not: a web page sets each item on its own paragraph.
  const block = before.split(/\s\|\s/).pop() ?? "";
  // A comma or full stop inside a number ("$4.00 off", "$15,000.00") does not split it.
  const pieces = block.split(/[,.](?!\d)|(?<!\d)[,.]|[;!?\n]/).map((piece) => piece.trim()).filter(Boolean);
  let terms = false;
  for (let i = pieces.length - 1, walked = 0; i >= 0 && walked <= WALK_ITEMS; i -= 1, walked += 1) {
    const piece = pieces[i];
    const context = pieces.slice(Math.max(0, i - 2), i + 1).join(", ");
    if (WHOLE_BANK.test(piece)) return null;
    const kind: AccountBenefitKind | null = HOLDER_GRANT.test(piece) ? "holder_grant" : ACCOUNT_WAIVERS.test(piece) ? "account_waivers" : null;
    if (kind) {
      if (WHOLE_BANK.test(context)) return null;
      const account = accountIn(context);
      return account ? { kind, account, evidence: evidenceFrom(pieces.slice(Math.max(0, i - 2)), item) } : null;
    }
    // The item labelled on its own row ("Incoming Wires: No charge for incoming domestic wires",
    // "Wire Transfers: No fee for incoming wires"): a schedule row, the bank's price.
    if (walked === 0 && /:\s*$/.test(piece) && !accountIn(piece)) return null;
    // A section heading or a priced row is the bank's schedule: the list, if any, ended before it.
    if (headingPiece(piece) || pricedRow(piece)) return null;
    const account = accountIn(piece);
    if (account) {
      if (!terms && !ACCOUNT_TERMS.test(piece)) return null;
      return { kind: "feature_list", account, evidence: evidenceFrom(pieces.slice(i), item) };
    }
    // Prose (a long piece, or one with a verb: "The Bank may change the terms") ends the walk.
    if (piece.length > ITEM_CHARS || SENTENCE_VERB.test(piece)) return null;
    if (ACCOUNT_TERMS.test(piece)) terms = true;
  }
  return null;
}

function evidenceFrom(pieces: string[], item: string): string {
  const text = `${pieces.join(", ")}, ${item}`;
  return text.length > 360 ? `...${text.slice(-357)}` : text;
}
