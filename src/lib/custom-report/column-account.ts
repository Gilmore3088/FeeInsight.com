/**
 * #1912: a price whose own table cell ends with a column's account name ("$50 fee to close prior to
 * maturity (ira)", the label Rosetta writes after a value an empty cell would have shifted) is that
 * account's price. A fee whose own name says a different account cannot trace to it: Capital City's
 * IRA closing fee was read as "Early closure of CD" from the CD column's words beside it. Pure.
 */

const CELL_SEPARATOR = " | ";

/** Account names fine enough to tell an IRA column from a CD column. Order decides. */
const FINE_KINDS: readonly { kind: string; words: RegExp }[] = [
  { kind: "money_market", words: /\bmoney\s*market\b|\bmmda\b/i },
  { kind: "ira", words: /\bira\b|\bretirement\b/i },
  { kind: "hsa", words: /\bhsa\b|\bhealth\s+savings\b/i },
  { kind: "cd", words: /\bcds?\b|\bcertificates?\b|\btime\s+deposits?\b/i },
  { kind: "checking", words: /checking\b|\bshare\s*drafts?\b/i },
  { kind: "club", words: /\b(?:christmas|holiday|vacation)\s+club\b|\bclub\b/i },
  { kind: "savings", words: /\b(?:savings?|share|passbook)\b/i },
];

function fineKind(text: string): string | null {
  for (const rule of FINE_KINDS) if (rule.words.test(text)) return rule.kind;
  return null;
}

/** Every account a fee name names: "Overdraft Transfer (Savings to Checking)" names two. */
function namedKinds(text: string): Set<string> {
  const kinds = new Set<string>();
  // "Share draft" is checking, not also a savings share.
  const rest = text.replace(/\bshare\s*drafts?\b/gi, "checking");
  for (const rule of FINE_KINDS) if (rule.words.test(rest)) kinds.add(rule.kind);
  return kinds;
}

/** The account a cell's closing parenthesis names when the cell prices something ("$5 (Savings)"). */
// A label carrying a figure is a condition ("(Share minimum of $25.00)"), not a column's name.
const LABELLED_PRICE_CELL = /\$\s?\d[\d,]*(?:\.\d{1,2})?[^()$]*\(([^()$\d]{1,40})\)\s*$/;

function amountIn(cell: string, amount: number): boolean {
  for (const match of cell.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) < 0.005) return true;
  }
  return false;
}

/**
 * True when every cell of `line` that prints `amount` closes with an account label, and each label
 * names an account other than the one `feeName` names. A fee name that names no account or two, or a
 * label that names none, decides nothing.
 */
export function pricedForOtherAccount(line: string, feeName: string, amount: number): boolean {
  // A name that names two accounts (a transfer between them) is priced in either one's column.
  const own = namedKinds(feeName);
  if (own.size !== 1) return false;
  const cells = line.split(CELL_SEPARATOR).filter((cell) => amountIn(cell, amount));
  if (cells.length === 0) return false;
  return cells.every((cell) => {
    const label = LABELLED_PRICE_CELL.exec(cell)?.[1];
    const kind = label ? fineKind(label) : null;
    return kind !== null && !own.has(kind);
  });
}
