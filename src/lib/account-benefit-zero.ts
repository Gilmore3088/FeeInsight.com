/**
 * #1397: a $0 that is one named account's benefit, not the bank's price. Shared by Knox (its free-fee
 * read holds such a $0 for review instead of sending it to Darwin as a free fee, rules v157) and
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
 * The walk is a whitelist (reviews of #2894): every piece between the lead and the item must be an
 * entry of the account's own list (a free entry, one of the account's terms, a perk with a dollar
 * figure, an "unlimited" or "available" feature). Any other piece ends the walk and the $0 stays: a
 * heading ("Wire Transfers", "Wires", "Miscellaneous", "Fee Schedule", "Other Items"), a priced row
 * with or without a $ ("Stop Payment 30.00", "Wire out 25,00", "Stop payment USD 30"), or a bare label
 * ("Incoming domestic wire" over "No charge"). A priced piece is an entry only as a term or a perk, and
 * a Title Case entry ending in services, fees, charges or transactions is a heading ("Optional
 * Services", "Waived Fees"). A "Features" heading over the account's terms may sit
 * under a few short lines about whom the account is for; the account's name above them is the lead.
 * The walk reaches `ACCOUNT_BENEFIT_WALK_CHARS` (450) before the item, the window Darwin's re-check reads.
 * Also: "Here is what you get." after an account is opened counts as a lead.
 *
 * Knox v171 (backlog dry run 4, O'Bannon Banking Co, doc 42058):
 * - `account_waivers` also takes a lead that says "this account (also) includes:" (`ACCOUNT_INCLUDES`).
 *   It names no account, so the account is the nearest name on the few lines above it ("Regular
 *   Checking" / "$7.00 Monthly Service Charge" / ... / "This account also includes:"), or the lead itself
 *   when none is printed. Under that lead every short line is the account's own list ("Free Photocopies
 *   (limits may apply)", "You must be at least 55 Years of Age"), until a blank-line heading, a table cell
 *   or a priced row ends it.
 * - `account_column`: a perk an account's own cell names and prices free, in an account comparison table
 *   under a header row that names two accounts or more ("Regular Checking | Safeguard FREE Checking | Premiere Club | Money Market
 *   Deposit" over "Checks | 1st order of starter checks FREE (postage not included) (FREE Checking) |
 *   FREE Basic Checks"), is one account's term when the row's cells cannot be lined up with the accounts
 *   (fewer cells than accounts) or another account's cell prints something else. A row whose every
 *   account cell says the same free word ("Incoming Wire | Free | Free") stays, and so does a bare free
 *   word under an account ("Bill Payment fee | FREE", "Monthly Service Charge | No Charge"): that prices
 *   the row's own fee for the account, which the account lineup ties to its product.
 */

export type AccountBenefitKind = "holder_grant" | "account_waivers" | "feature_list" | "account_column";

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
/** How many short pieces above a "Features" heading may hold the account's name. */
const FEATURES_LOOKBACK = 6;
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
/** v171: "This account also includes:", "Your account comes with:", "Each account includes the following:". */
const ACCOUNT_INCLUDES = /^(?:this|the|your|each|every)\s+account\s+(?:also\s+)?(?:includes|comes with|offers|features|provides|has)(?:\s+the following)?\s*:?$/i;
/** v171: how many lines above an "account includes" lead may hold the account's name. */
const INCLUDES_NAME_LINES = 8;
/** v171: how far above an account table's row its header row may sit (lines, and characters). */
const ACCOUNT_COLUMN_LINES = 40;
export const ACCOUNT_COLUMN_LOOKBACK_CHARS = 1_500;
const ACCOUNT_TERMS = /\b(?:opening deposit|minimum (?:deposit )?to open|no minimum balance|minimum balance requirement|no (?:monthly )?minimum balance required|no monthly (?:(?:maintenance|service) )?(?:fees?|charges?)|monthly (?:maintenance|service) (?:fees?|charges?)|unlimited check writing|no per item charges?|earns? (?:dividends|interest))\b/i;
/** A perk with a dollar figure is no price: "$4.00 off each check order", "$15 discount on safe deposit boxes". */
const PERK_AMOUNT = /\b(?:off|discount(?:ed)?|rebates?|refunds?|cash back|bonus)\b/i;
/**
 * A list entry that is itself a free item: its free word first, or after a count or "optional" only
 * ("Free debit card", "optional free paper statements", "one (1) complimentary financial review"); a
 * free word after a noun is a schedule row ("Notary service free to members", "Incoming Wires FREE"); or an entry that says what the account does not charge ("No coin/currency charges",
 * "No service charges for this account", "No fee for prepaid gift card").
 */
const FREE_ENTRY = /^(?:[-*•·▪◦●]\s*)?(?:(?:(?:optional|one|two|three|four|five|\(\d+\)|\d+|and)\s+){0,3}(?:free|complimentary)\s+\S|no\s+\S+.*\b(?:fees?|charges?|cost)\b|no (?:fee|charge|cost)\b)/i;
/** What else an account's own list holds: unlimited use, an option, a waiver, a perk that is available. */
const FEATURE_ENTRY = /^(?:unlimited|optional|waived|reduced|discounted)\b|\bavailable\s*$|\b(?:image[ds]?|truncated|paper|monthly|quarterly)\s+(?:or\s+\w+\s+)?statements?\b|^(?:\S+\s+){2,}insurance$/i;
/**
 * A heading that reads as an entry: Title Case or all caps, ending in services, fees, charges or
 * transactions with nothing after ("Optional Services", "Waived Fees", "Unlimited Transactions", "No
 * Charge Services", "Free & Discounted Services", "Free Services"). An entry in sentence case ("No
 * coin/currency charges", "Unlimited transactions") is the account's.
 */
const ENTRY_HEADING_END = /\b(?:services|fees|charges|transactions)\s*:?$/i;
/** A line under "Features" that names the bank's schedule: a fee word, a wire, a payment. */
const SCHEDULE_WORD = /\b(?:fees?|charges?|services?|wires?|transfers?|payments?|schedule|rates?)\b/i;
/** An account's own heading over its list ("Features", "Key Features", "Product Features:"). */
const FEATURES_HEADING = /^(?:(?:key|account|product|checking|savings|special)\s+)?features\s*:?$/i;
/** A price, with or without a $ ("$30", "30.00", "25,00", "USD 30", "n/c", "Stop Payment 30"). */
const PRICED = /\$\s?\d|\b\d+[.,]\d{2}\b|\bUSD\s*\d|\bn\/c\b|\d\s*$/i;
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

/**
 * #1092 (`zero-waiver-row.ts`): whether one piece is the lead of one account's or package's own list,
 * read with this module's signals: it names one account (`accountIn`: "Cornerstone Checking:",
 * "Benefits of Premier Advantage"), or its holders are granted what follows (`HOLDER_GRANT`), or it
 * opens "the following" benefits, perks, features or waivers, "Benefits of ...", "Features & Benefits:"
 * or "Account benefits:" (`ACCOUNT_WAIVERS`, less its bank-wide "free services:" and "the following
 * services"). The account it names, or the lead itself. Pure; this module's own test is unchanged.
 */
export function accountListLead(piece: string): string | null {
  const text = squash(piece);
  if (!text) return null;
  const account = accountIn(text);
  if (account) return account;
  if (HOLDER_GRANT.test(text) && !WHOLE_BANK.test(text)) return text;
  const waivers = ACCOUNT_WAIVERS.exec(text)?.[0] ?? "";
  if (waivers && !/free services|following\s+(?:free\s+)?services/i.test(waivers) && !WHOLE_BANK.test(text)) return text;
  return null;
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

/**
 * A piece an account's own list may hold between its lead and the item: a free entry, one of the
 * account's terms ("$25 opening deposit", "No monthly fee", "Earns dividends", "Minimum to open 100.00"),
 * a perk with a dollar figure, or another feature. Anything else (a heading such as "Wire Transfers",
 * "Wires", "Miscellaneous" or "Other Items", a priced row with or without a $, a bare label such as
 * "Incoming domestic wire") is the bank's schedule, and the list, if any, ended before it.
 */
function listEntry(piece: string): boolean {
  if (ACCOUNT_TERMS.test(piece)) return true;
  if (PERK_AMOUNT.test(piece) && /\$\s?\d|\d%/.test(piece)) return true;
  // A priced row is the bank's schedule, whatever its first word ("Paper statements $3.00",
  // "Optional overdraft transfer $5.00").
  if (PRICED.test(piece)) return false;
  if (titleOrCaps(piece) && ENTRY_HEADING_END.test(piece)) return false;
  return FREE_ENTRY.test(piece) || FEATURE_ENTRY.test(piece);
}

/** Every word of three or more letters capitalised (or the whole piece in capitals): a heading's case. */
function titleOrCaps(piece: string): boolean {
  const words = piece.replace(/[:*†‡]+$/, "").match(/[A-Za-z][A-Za-z'’/-]*/g) ?? [];
  const long = words.filter((word) => word.length >= 3 && !/^(?:and|the|for|of|with)$/i.test(word));
  return long.length > 0 && long.every((word) => /^[A-Z]/.test(word));
}

/** A line between an account's name and its "Features" heading: short, no heading, no price, no fee word. */
function introLine(piece: string): boolean {
  return piece.length <= 80 && !PRICED.test(piece) && !SCHEDULE_WORD.test(piece) && !WHOLE_BANK.test(piece)
    && !(titleOrCaps(piece) && !accountIn(piece));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * v171: the lead of an "account includes" list above the item, walking up the lines of `before` (the text
 * right before the item): short lines of the account's own list, no blank-line heading, table cell or priced
 * row between. The account is the nearest name in the few lines over the lead, or the lead's own words.
 */
function includesListAt(before: string, item: string): AccountBenefitZero | null {
  const lines = before.replace(/\r/g, "").split("\n").map((line) => line.replace(/[ \t ]+/g, " ").trim());
  // The item's own line opens right after the last line break.
  if ((lines.at(-1) ?? "") !== "") return null;
  let i = lines.length - 2;
  for (let walked = 0; i >= 0 && walked <= WALK_ITEMS; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    if (ACCOUNT_INCLUDES.test(line)) break;
    walked += 1;
    if (line.length > ITEM_CHARS || line.includes(" | ") || /:\s*$/.test(line)) return null;
    if (PRICED.test(line) && !ACCOUNT_TERMS.test(line) && !(PERK_AMOUNT.test(line) && /\$\s?\d|\d%/.test(line))) return null;
  }
  if (i < 0 || !ACCOUNT_INCLUDES.test(lines[i] ?? "")) return null;
  const lead = lines[i];
  for (let j = i - 1, seen = 0; j >= 0 && seen < INCLUDES_NAME_LINES; j -= 1) {
    const above = lines[j];
    if (!above) continue;
    seen += 1;
    if (above.includes(" | ") || WHOLE_BANK.test(above)) break;
    const account = accountIn(above);
    if (account) return { kind: "account_waivers", account, evidence: evidenceFrom([above, lead], item) };
    if (/:\s*$/.test(above)) break;
  }
  return { kind: "account_waivers", account: lead.replace(/\s*:$/, ""), evidence: evidenceFrom([lead], item) };
}

/** The cells of a table line, trimmed, with the outer bars of a markdown row dropped. */
function cellsOf(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split(/\s\|\s|\s\||\|\s/).map((cell) => cell.trim());
}

const ZERO_IN_CELL = /\b(?:free|no charge|n\/c|none|waived)\b/i;

/**
 * v171: a $0 read from a cell of an account comparison table (see the module note), or null. `line` is
 * Knox's excerpt ("Checks | 1st order of starter checks FREE"); the row is the text's line that holds it.
 */
export function accountColumnZeroOf(input: AccountBenefitZeroInput): AccountBenefitZero | null {
  const excerpt = squash(input.line ?? "");
  const text = input.documentText ?? "";
  if (!excerpt.includes("|") || !text || !ZERO_IN_CELL.test(excerpt)) return null;
  const lines = text.replace(/\r/g, "").split("\n");
  const probe = excerpt.toLowerCase();
  let found: AccountBenefitZero | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (!squash(lines[index]).toLowerCase().includes(probe)) continue;
    const column = accountColumnAt(lines, index, excerpt);
    // Every place the row is printed must be such a cell.
    if (!column) return null;
    found ??= column;
  }
  return found;
}

function accountColumnAt(lines: string[], index: number, excerpt: string): AccountBenefitZero | null {
  const cells = cellsOf(lines[index]);
  if (cells.length < 2) return null;
  // The $0's own cell: the first after the row's label that the excerpt reaches and that says it is free.
  const reached = cellsOf(excerpt);
  const at = cells.findIndex((cell, position) => position > 0 && position < reached.length && ZERO_IN_CELL.test(cell)
    && squash(cell).toLowerCase().startsWith(squash(reached[position]).toLowerCase().slice(0, 12)));
  // The row opens with a bare label ("Checks"), not another column's own priced row ("Monthly maintenance
  // fee ........ $0 | Monthly maintenance fee ........ FREE": two account pages side by side).
  if (at < 1 || ZERO_IN_CELL.test(cells[0]) || PRICED.test(cells[0]) || cells[0].length > 40) return null;
  // The cell names its own perk ("1st order of starter checks FREE (postage not included)"): a bare free
  // word under an account ("Bill Payment fee | FREE", "Monthly Service Charge | No Charge") prices the
  // row's own fee for that account, which the account lineup ties to its product.
  const own = squash(cells[at].replace(/\([^()]*\)/g, " ").replace(new RegExp(ZERO_IN_CELL.source, "gi"), " "));
  if ((own.match(/[A-Za-z]{3,}/g) ?? []).length < 2) return null;
  let chars = 0;
  for (let up = index - 1; up >= Math.max(0, index - ACCOUNT_COLUMN_LINES); up -= 1) {
    chars += lines[up].length + 1;
    if (chars > ACCOUNT_COLUMN_LOOKBACK_CHARS) break;
    if (!lines[up].includes("|")) continue;
    const header = cellsOf(lines[up]).filter(Boolean);
    // A header row of accounts: every cell but one row-label cell names a different account, and no cell
    // carries a price ("Christmas Club Early Withdrawal | A fee for withdrawing from a Christmas Club
    // account ... | $10 per withdrawal" is a fee row, "CHECKING | Live Free Checking | Begin Banking | FREE
    // Member Services" a heading over services).
    if (header.some((cell) => /\$\s?\d|^(?:free|no charge|none|n\/c)$|\bpage\s+\d/i.test(cell))) continue;
    const accounts = [...new Set(header.map((cell) => accountIn(cell)).filter((name): name is string => Boolean(name)))];
    if (accounts.length < 2 || accounts.length < header.length - 1) continue;
    const values = cells.slice(1);
    // The header may carry the row labels' column or not: either way each account has a cell.
    const columns = header.length - (accountIn(header[0]) ? 0 : 1);
    const lined = values.length === columns;
    const zero = squash(cells[at]).toLowerCase();
    if (lined && values.every((value) => squash(value).toLowerCase() === zero)) return null;
    const accountAt = lined ? header[header.length - columns + at - 1] : null;
    const account = accountAt && accountIn(accountAt) ? accountIn(accountAt)! : accounts.join(" / ");
    return { kind: "account_column", account, evidence: `${squash(lines[up])} / ${squash(lines[index])}`.slice(0, 360) };
  }
  return null;
}

/** True when the $0 is one named account's benefit, with the kind, the account and the evidence. */
export function accountBenefitZeroOf(input: AccountBenefitZeroInput): AccountBenefitZero | null {
  const column = accountColumnZeroOf(input);
  if (column) return column;
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
  const includes = at > 0 ? includesListAt(text.slice(Math.max(0, at - WALK_CHARS), at), item) : null;
  if (includes) return includes;
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
    const account = accountIn(piece);
    if (account) {
      if (!terms && !ACCOUNT_TERMS.test(piece)) return null;
      return { kind: "feature_list", account, evidence: evidenceFrom(pieces.slice(i), item) };
    }
    // "Features" over the account's terms: the account's name sits a few short pieces above it, under
    // the page's own lines about who the account is for ("A great fit if:", "Anyone 50 and older").
    if (FEATURES_HEADING.test(piece)) {
      if (!terms) return null;
      for (let j = i - 1; j >= Math.max(0, i - FEATURES_LOOKBACK); j -= 1) {
        const above = pieces[j];
        const named = accountIn(above);
        if (named && !SCHEDULE_WORD.test(above)) return { kind: "feature_list", account: named, evidence: evidenceFrom(pieces.slice(j), item) };
        // Anything but a short line about whom the account is for ("A great fit if:", "Anyone 50 and
        // older") ends the look-back: a heading ("Wire Transfers", "Other Services") or a row.
        if (!introLine(above)) return null;
      }
      return null;
    }
    // Whitelist: every piece between the lead and the item is an entry of the account's own list. Prose
    // (a long piece, or one with a verb) and anything else end the walk, and the $0 stays.
    if (piece.length > ITEM_CHARS || SENTENCE_VERB.test(piece) || !listEntry(piece)) return null;
    if (ACCOUNT_TERMS.test(piece)) terms = true;
  }
  return null;
}

function evidenceFrom(pieces: string[], item: string): string {
  const text = `${pieces.join(", ")}, ${item}`;
  return text.length > 360 ? `...${text.slice(-357)}` : text;
}
