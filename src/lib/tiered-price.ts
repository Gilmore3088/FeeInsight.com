/**
 * #1092, #1110, #1026 (Nov 3): one fee priced in tiers by a threshold, kept as one fee per tier.
 * Shared by Knox (each tier's read keeps its own condition in its name; a group Knox cannot read in
 * full is held as `tier_incomplete`), Darwin's verify (a read of one tier whose name lost its condition
 * is held as `tier_unscoped`), the category guard (a name's own tier scope is no reason to refuse it)
 * and Darwin's live re-check (`darwin/tier-completeness-check.ts`). Pure: no database, no agent imports.
 *
 * First National Bank of Moose Lake (institution 3457, document 35684, Rosetta artifact 33778) prints:
 *
 *   If your check/item is returned for insufficient funds (NSF) and overdraft balance at the end of business day is:
 *   $30.00 or less – Overdraft fee per item per presentment. | $15.00 per item
 *   More than $30.00 – Overdraft fee per item per presentment. | $30.00 per item
 *
 * Knox's name builders drop every figure as a price, so the $15 tier was named "or less – Overdraft fee
 * per item per presentment" (raw 760358) and the $30 tier lost its condition altogether ("Overdraft fee
 * per item per presentment", raw 760359). The category guard refuses an overdraft name saying "or less" (a
 * waiver threshold: "unless the total overdraft is $50 or less"), so the $15 tier never went live, and
 * the $30 tier went live as the bank's only overdraft price, with no condition (live 116685).
 *
 * A tier is a price whose own words state a threshold it applies under:
 * - a dollar threshold: "$30.00 or less", "More than $30.00", "over $1,000", "$5.01 to $20.00",
 *   "between $5 and $20", "up to $1,000";
 * - a count: "1-3 items", "4+ items", "6th or more items", "more than 10 transactions".
 * A tier group is two or more such prices of one fee: adjacent lines (blank lines between are skipped)
 * whose words without the condition are the same, or the clauses of one line, each with its own condition
 * and price, with at least two different prices. Not a tier: a cap ("maximum $150 per day"), a waiver
 * threshold ("waived with $500 balance", "no fee if $5 or less"), a rate's minimum ("over $1,000 0.25% with a
 * $50.00 minimum"), one price under every condition, and two different fees on one line, each clause naming
 * its own fee ("Cashier's check over $1,000 $10.00; Money order up to $1,000 $5.00").
 */

// A dollar figure: "$30", "$1,000.00", "$.50", "$50K". A comma that starts no thousands group ends it ("under $50, ...").
const FIG = String.raw`\$\s?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|\.\d{1,2})(?:\s?[kKmM]\b)?(?![\d])`;
const UNIT = String.raw`(?:items?|checks?|drafts?|transactions?|withdrawals?|deposits?|debits?|payments?|bills?|transfers?|presentments?|occurrences?|orders?)`;
const DOLLAR_CONDITION = new RegExp(
  [
    String.raw`\bbetween\s+${FIG}\s+and\s+${FIG}`,
    String.raw`${FIG}\s*(?:-|–|—|\bto\b)\s*${FIG}`,
    String.raw`(?:\b(?:more|less|greater|fewer)\s+than|\bover|\bunder|\babove|\bbelow|\bexceeding|\bin\s+excess\s+of|\bup\s+to)\s+${FIG}`,
    String.raw`${FIG}\s+(?:or|and)\s+(?:less|more|greater|over|under|above|below|up)\b(?:\s+than\b)?`,
    String.raw`[≤≥<>]=?\s*${FIG}`,
  ].join("|"),
  "gi",
);
const COUNT_CONDITION = new RegExp(
  [
    String.raw`\b\d{1,3}\s*(?:-|–|—|\bto\b)\s*\d{1,3}\s+${UNIT}\b`,
    String.raw`\b${UNIT}\s+\d{1,3}\s*(?:-|–|—|\bto\b)\s*\d{1,3}\b`,
    // Never a dollar figure's digits ("$1 + 3%").
    String.raw`(?<![$.\d])(?<!\$\s)\b\d{1,3}(?:st|nd|rd|th)?\s*(?:\+|\bor\s+more\b|\band\s+(?:over|up|above)\b)(?:\s+${UNIT}\b)?`,
    String.raw`\b${UNIT}\s+\d{1,3}\s*(?:\+|\band\s+(?:over|up|above)\b|\bor\s+more\b)`,
    String.raw`\b(?:more|fewer|less)\s+than\s+\d{1,3}\s+${UNIT}\b`,
    String.raw`\b(?:over|up\s+to)\s+\d{1,3}\s+${UNIT}\b`,
  ].join("|"),
  "gi",
);
/** Words that make a threshold a waiver, a cap or a limit, never a tier's own condition. */
const NOT_A_TIER = /\b(?:waive[ds]?|waiver|no\s+(?:fee|charge)|free|n\/c|avoid(?:ed)?|unless|maintain(?:ed|s)?|keep|maximum|max\b|min(?:imum)?\b|cap(?:ped)?\b|limit(?:ed)?\b|not\s+(?:be\s+)?(?:charged|assessed)|will\s+not|otherwise|regardless)\b/i;
/**
 * A rate on the line ("0.25% with a $50.00 minimum", "5% ($10.00 min)"): its dollar figure is the rate's
 * floor or cap, never a tier's flat price (review of #2981), so a line that prints a percentage is no tier.
 */
const PERCENT = /\d\s*%|\bpercent\b/i;
const notATier = (text: string) => NOT_A_TIER.test(text) || PERCENT.test(text);
const MONEY = new RegExp(FIG, "gi");
/**
 * Categories whose balance conditions name an account's waiver or minimum, priced per account by its own
 * row (`lineup.ts`), never one fee's tiers: "Platinum Checking ... below $4000 | $20" beside "Bonus Checking
 * ... below $500 | $5" are two accounts' fees. The tier reader leaves them alone.
 */
export const TIERLESS_CATEGORIES: ReadonlySet<string> = new Set(["monthly_maintenance", "minimum_balance"]);
const HAS_MONEY = new RegExp(FIG, "i");
/** The words a balance or amount threshold is stated about, from the lead-in line above a tier group. */
const LEAD_NOUN_SOURCE = String.raw`(?:overdraft|overdrawn|negative|available|ledger|account|collected|ending|daily|current|average(?:\s+daily)?)\s+balance|(?:item|check|transaction|overdraft)\s+amount`;
const LEAD_NOUN = new RegExp(String.raw`\b(${LEAD_NOUN_SOURCE})\b`, "gi");
/** The only words a name's own tier bracket may print before its condition (`withoutTierScope`). */
const SCOPE_NOUN = new RegExp(String.raw`^(?:${LEAD_NOUN_SOURCE}|balance|amount)$`, "i");
const CLAUSE_BREAK = /\s*(?:;|\s\|\s|,\s|\.\s)\s*/g;

export type TierKind = "dollar" | "count";

export interface TierCondition {
  text: string;
  kind: TierKind;
  start: number;
  end: number;
}

export interface PriceTier {
  /** The condition as the line prints it ("$30.00 or less", "More than $30.00", "4+ items"). */
  condition: string;
  kind: TierKind;
  price: number;
  /** The line's index in the text's lines. */
  line: number;
}

export interface TierGroup {
  tiers: PriceTier[];
  /** The fee's own words, without the condition, as the first tier's line prints them (may be empty). */
  base: string;
  /** The words the threshold is about, from the lead-in line above or the line's own words ("overdraft balance"), or null. */
  leadNoun: string | null;
  /** Every tier is a clause of one line ("1-3 items $1.00, 4+ items $2.00"). */
  sameLine: boolean;
}

interface Token {
  value: number;
  start: number;
  end: number;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function money(token: string): number {
  const scale = /k$/i.test(token.trim()) ? 1_000 : /m$/i.test(token.trim()) ? 1_000_000 : 1;
  return Number(token.replace(/[$,\s]|[kKmM]$/g, "")) * scale;
}

/** Every tier condition a text states, in order; a dollar condition wins over a count one where they overlap. */
export function tierConditionsIn(text: string): TierCondition[] {
  const found: TierCondition[] = [];
  const take = (pattern: RegExp, kind: TierKind) => {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (found.some((other) => start < other.end && end > other.start)) continue;
      found.push({ text: match[0].trim(), kind, start, end });
    }
  };
  take(DOLLAR_CONDITION, "dollar");
  take(COUNT_CONDITION, "count");
  return found.sort((a, b) => a.start - b.start);
}

/** Dollar figures outside every condition: the prices a line or clause prints. */
function pricesOutside(text: string, conditions: TierCondition[]): Token[] {
  const prices: Token[] = [];
  for (const match of text.matchAll(MONEY)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (conditions.some((condition) => start >= condition.start && end <= condition.end)) continue;
    const value = money(match[0]);
    if (Number.isFinite(value)) prices.push({ value, start, end });
  }
  return prices;
}

/** The fee's own words: the text without its condition, figures, units and punctuation. */
function baseWords(text: string, condition: TierCondition, price: Token): string {
  const without = `${text.slice(0, condition.start)} ${text.slice(condition.end, price.start)} ${text.slice(price.end)}`;
  return collapse(
    without
      .toLowerCase()
      .replace(MONEY, " ")
      .replace(/\b(?:per|each|ea|item|items|fee|fees|charge|if|is|the|of|for|when)\b/g, " ")
      .replace(/[^a-z]+/g, " "),
  );
}

/** One line read as one tier: one condition and one price outside it, no waiver, cap or limit words. */
function tierOfLine(line: string): { condition: TierCondition; price: Token; base: string; label: string } | null {
  if (notATier(line)) return null;
  const conditions = tierConditionsIn(line);
  if (conditions.length !== 1) return null;
  const prices = pricesOutside(line, conditions);
  if (prices.length !== 1) return null;
  const [condition] = conditions;
  const [price] = prices;
  // A $0 band is the fee waived below a threshold, never a priced tier (`@/lib/banded-zero`).
  if (!(price.value > 0)) return null;
  // The price after its condition ("$30.00 or less – ... | $15.00"), or a price-first line whose condition follows it.
  const label = price.start > condition.end ? line.slice(0, price.start) : line.slice(price.end);
  return { condition, price, base: baseWords(line, condition, price), label };
}

/** A group prints at least two different prices: one price under every condition is no tier (review of #2981). */
function distinctPrices(prices: number[]): boolean {
  return new Set(prices.map((price) => price.toFixed(2))).size >= 2;
}

const CLAUSE_STOP = new RegExp(
  String.raw`\b(?:${UNIT.slice(3, -1)}|per|each|ea|fee|fees|charge|charges|if|is|are|the|of|for|when|a|an|and|or|to|by|on|in|at|with|than|more|less|over|under|above|below|up|between|exceeding|excess|balance|amount|overdraft|overdrawn|negative|available|ledger|account|collected|ending|daily|current|average)\b`,
  "gi",
);

/** A clause's own fee words, without its condition, its price and the words any tier clause uses. */
function feeWords(clause: string, condition: TierCondition, price: Token, offset: number): Set<string> {
  const shift = (at: number) => at - offset;
  let text = clause;
  for (const [start, end] of [[condition.start, condition.end], [price.start, price.end]].sort((x, y) => y[0] - x[0])) {
    const [from, to] = [shift(start), shift(end)];
    if (from >= 0 && to <= clause.length + 1) text = `${text.slice(0, from)} ${text.slice(to)}`;
  }
  const words = collapse(text.toLowerCase().replace(MONEY, " ").replace(CLAUSE_STOP, " ").replace(/[^a-z]+/g, " ")).split(" ");
  return new Set(words.filter((word) => word.length > 2));
}

/** The clauses of one line that each print one condition and one price ("1-3 items $1.00, 4+ items $2.00"). */
function tiersOnOneLine(line: string): Array<{ condition: TierCondition; price: Token }> {
  if (notATier(line)) return [];
  const conditions = tierConditionsIn(line);
  const prices = pricesOutside(line, conditions);
  if (conditions.length < 2 || prices.length < 2) return [];
  const breaks = [0, ...[...line.matchAll(CLAUSE_BREAK)].map((match) => (match.index ?? 0) + 1), line.length + 1];
  const tiers: Array<{ condition: TierCondition; price: Token }> = [];
  const clauseWords: Array<Set<string>> = [];
  for (let at = 0; at < breaks.length - 1; at++) {
    const [from, to] = [breaks[at], breaks[at + 1]];
    const inClause = <T extends { start: number }>(rows: T[]) => rows.filter((row) => row.start >= from && row.start < to);
    const clauseConditions = inClause(conditions);
    const clausePrices = inClause(prices);
    if (clauseConditions.length === 0 && clausePrices.length === 0) continue;
    if (clauseConditions.length !== 1 || clausePrices.length !== 1) return [];
    // A $0 band is the fee waived below a threshold, never a priced tier.
    if (!(clausePrices[0].value > 0)) continue;
    tiers.push({ condition: clauseConditions[0], price: clausePrices[0] });
    // The first clause's label before a colon ("Official checks:") heads every clause, so it is no clause's own fee.
    const colon = line.indexOf(":");
    const start = at === 0 && colon >= 0 && colon < Math.min(clauseConditions[0].start, clausePrices[0].start) ? colon + 1 : from;
    clauseWords.push(feeWords(line.slice(start, to), clauseConditions[0], clausePrices[0], start));
  }
  if (tiers.length < 2) return [];
  // Two fees on one line ("Cashier's check over $1,000 $10.00; Money order up to $1,000 $5.00"): clauses
  // that each name a fee of their own, with no word in common, are two fees, never one fee's tiers.
  const named = clauseWords.filter((words) => words.size > 0);
  for (let a = 0; a < named.length; a++) {
    for (let b = a + 1; b < named.length; b++) if (![...named[a]].some((word) => named[b].has(word))) return [];
  }
  if (!distinctPrices(tiers.map((tier) => tier.price.value))) return [];
  if (new Set(tiers.map((tier) => tier.condition.kind)).size !== 1) return [];
  if (new Set(tiers.map((tier) => collapse(tier.condition.text.toLowerCase()))).size !== tiers.length) return [];
  return tiers;
}

function leadNounAbove(lines: readonly string[], index: number): string | null {
  for (let at = index - 1; at >= 0 && at >= index - 3; at--) {
    const line = lines[at].trim();
    if (!line) continue;
    if (HAS_MONEY.test(line) || !/:\s*$/.test(line)) return null;
    const nouns = [...line.matchAll(LEAD_NOUN)];
    return nouns.length > 0 ? nouns[nouns.length - 1][1].toLowerCase() : null;
  }
  return null;
}

function nextFilled(lines: readonly string[], from: number, step: 1 | -1): number {
  for (let at = from + step; at >= 0 && at < lines.length; at += step) {
    if (lines[at].trim()) return at;
  }
  return -1;
}

/** The tier group the line at `index` belongs to, or null. */
export function tierGroupAt(lines: readonly string[], index: number): TierGroup | null {
  const line = lines[index];
  if (line == null) return null;
  const sameLine = tiersOnOneLine(line);
  if (sameLine.length >= 2) {
    const first = sameLine[0];
    const firstAt = Math.min(first.condition.start, first.price.start);
    const ownNouns = [...line.slice(0, Math.min(...sameLine.map((tier) => tier.condition.start))).matchAll(LEAD_NOUN)];
    const ownNoun = ownNouns.length > 0 ? ownNouns[ownNouns.length - 1][1].toLowerCase() : null;
    return {
      tiers: sameLine.map((tier) => ({ condition: tier.condition.text, kind: tier.condition.kind, price: tier.price.value, line: index })),
      base: collapse(line.slice(0, firstAt).replace(/[:–—-]\s*$/, "")),
      leadNoun: sameLine[0].condition.kind === "dollar" ? ownNoun ?? leadNounAbove(lines, index) : null,
      sameLine: true,
    };
  }
  const own = tierOfLine(line);
  if (!own) return null;
  const member = (at: number) => {
    const tier = at >= 0 ? tierOfLine(lines[at]) : null;
    return tier && tier.condition.kind === own.condition.kind && tier.base === own.base ? tier : null;
  };
  let first = index;
  for (let at = nextFilled(lines, index, -1); member(at); at = nextFilled(lines, at, -1)) first = at;
  const rows: number[] = [];
  for (let at = first; at >= 0 && member(at); at = nextFilled(lines, at, 1)) rows.push(at);
  if (rows.length < 2) return null;
  const tiers = rows.map((at) => {
    const tier = member(at)!;
    return { condition: tier.condition.text, kind: tier.condition.kind, price: tier.price.value, line: at };
  });
  if (new Set(tiers.map((tier) => collapse(tier.condition.toLowerCase()))).size !== tiers.length) return null;
  if (!distinctPrices(tiers.map((tier) => tier.price))) return null;
  const firstTier = tierOfLine(lines[rows[0]])!;
  const base = collapse(
    `${firstTier.label.slice(0, firstTier.condition.start)} ${firstTier.label.slice(firstTier.condition.end)}`
      .replace(/^[\s|:–—-]+|[\s|:–—.-]+$/g, ""),
  );
  return { tiers, base, leadNoun: own.condition.kind === "dollar" ? leadNounAbove(lines, rows[0]) : null, sameLine: false };
}

/** The text's lines as the tier reader reads them. */
export function tierLines(text: string): string[] {
  return text.split("\n");
}

/** The index of the line a read's excerpt came from: the line itself, or the line that holds it. */
export function excerptLineIndex(lines: readonly string[], excerpt: string | null | undefined): number {
  const wanted = collapse(excerpt ?? "");
  if (!wanted) return -1;
  const exact = lines.findIndex((line) => collapse(line) === wanted);
  if (exact >= 0) return exact;
  return lines.findIndex((line) => collapse(line).includes(wanted));
}

/** The tier a read of `amount` from its excerpt's line is, with its group, or null when the line is no tier. */
export function tierOfRead(
  lines: readonly string[],
  excerpt: string | null | undefined,
  amount: number | null | undefined,
): { group: TierGroup; tier: PriceTier } | null {
  if (amount == null || amount <= 0) return null;
  const index = excerptLineIndex(lines, excerpt);
  if (index < 0) return null;
  const group = tierGroupAt(lines, index);
  if (!group) return null;
  const tier = group.tiers.find((candidate) => candidate.line === index && Math.abs(candidate.price - amount) < 0.005);
  return tier ? { group, tier } : null;
}

function numbersOf(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => {
    const plain = match[0].replace(/,/g, "");
    return plain.includes(".") ? String(Number(plain)) : plain;
  });
}

/** True when the name states its tier's condition: every figure of the condition is in the name. */
export function namesTier(name: string, tier: Pick<PriceTier, "condition">): boolean {
  const own = new Set(numbersOf(name));
  const wanted = numbersOf(tier.condition);
  return wanted.length > 0 && wanted.every((value) => own.has(value));
}

const COMPARISON_REMNANT = String.raw`(?:(?:or|and)\s+(?:less|more|greater|over|under|above|below|up)(?:\s+than)?|(?:more|less|greater|fewer)\s+than|over|under|above|below|exceeding|up\s+to|between)`;
const LEADING_REMNANT = new RegExp(String.raw`^\s*${COMPARISON_REMNANT}\b\s*[-–—:|]*\s*`, "i");
const TRAILING_REMNANT = new RegExp(String.raw`\s*[-–—:|]?\s*\b${COMPARISON_REMNANT}\s*$`, "i");

const includesText = (haystack: string, needle: string) => collapse(haystack).toLowerCase().includes(collapse(needle).toLowerCase());
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The read's name scoped to its tier: the fee's own words (a one-line group's words before its first
 * condition, else the read's name) without any condition of the group or a cut-off piece of one ("or less
 * –"), then the tier's condition in brackets, after the noun it is about when the text names one:
 * "Overdraft fee per item per presentment (overdraft balance $30.00 or less)". A name that states its own
 * tier and no other tier's condition is kept. Returns null when nothing of the fee's own name is left.
 */
export function scopedTierName(
  name: string,
  tier: Pick<PriceTier, "condition">,
  group: Pick<TierGroup, "tiers" | "leadNoun" | "base" | "sameLine">,
): string | null {
  const others = group.tiers.filter((other) => collapse(other.condition).toLowerCase() !== collapse(tier.condition).toLowerCase());
  if (namesTier(name, tier) && !others.some((other) => includesText(name, other.condition))) return name;
  let base = group.sameLine && /[a-z]{3}/i.test(group.base) ? group.base : name;
  for (const condition of [tier.condition, ...others.map((other) => other.condition)]) {
    base = base.replace(new RegExp(escapeRegExp(collapse(condition)).replace(/\\? /g, "\\s+"), "gi"), " ");
  }
  base = collapse(base);
  for (let pass = 0; pass < 2; pass++) base = base.replace(LEADING_REMNANT, "").replace(TRAILING_REMNANT, "").trim();
  base = base.replace(/^[\s|:–—.,;-]+|[\s|:–—,;-]+$/g, "").replace(/\(\s*\)/g, "").trim();
  if (!/[a-z]{3}/i.test(base)) return null;
  const condition = tier.condition.replace(/^[A-Z][a-z]+\b/, (word) => word.toLowerCase());
  const leadNoun = group.leadNoun;
  const noun = leadNoun && !new RegExp(String.raw`\b${leadNoun.split(" ").pop()}\b`, "i").test(`${base} ${condition}`) ? `${leadNoun} ` : "";
  return `${base} (${noun}${condition})`;
}

/**
 * The read's name with its tier's figure put back where the name still prints the condition's words with
 * no figure after them, after some of the fee's own words: "Cashier's checks over per item" becomes
 * "Cashier's checks over $1,000.00 per item", and "Wire Transfer (Incoming) - up" (cut from "up to
 * $100,000") becomes "Wire Transfer (Incoming) - up to $100,000". Null when the name holds no such slot
 * once, so the caller brackets the condition instead (`scopedTierName`).
 */
export function inPlaceTierName(name: string, tier: Pick<PriceTier, "condition">): string | null {
  if (namesTier(name, tier)) return null;
  const words = collapse(tier.condition.replace(MONEY, " ").replace(/[-–—]/g, " "));
  if (!/[a-z]{2}/i.test(words) || /\bbetween\b|\bto\b.*\bto\b/i.test(words)) return null;
  const variants = /^up to$/i.test(words) ? [words, "up"] : [words];
  for (const variant of variants) {
    const slot = new RegExp(String.raw`(?<=\S\s+)\b${escapeRegExp(variant).replace(/\\? /g, "\\s+")}\b(?!\s*\$)`, "gi");
    const found = [...name.matchAll(slot)];
    if (found.length !== 1) continue;
    const at = found[0].index ?? 0;
    const renamed = `${name.slice(0, at)}${tier.condition}${name.slice(at + found[0][0].length)}`;
    if (namesTier(renamed, tier)) return collapse(renamed);
  }
  return null;
}

const TIER_SCOPE = /\s\(([^()]*)\)\s*$/;

/**
 * For the category guard: the name without its own tier scope, so the scope's words ("or less") are
 * never read as a waiver threshold. Only a priced fee (above $0) whose name ends in a bracket that is a
 * tier condition with nothing before it but the threshold's own noun ("overdraft balance", "item amount",
 * "balance"), and no waiver, cap, minimum, limit or rate words anywhere in the name. Every other name is
 * returned unchanged (review of #2981: "Outgoing wire (international over $1,000)" keeps "international").
 */
export function withoutTierScope(name: string, amount: number | string | null | undefined): string {
  const price = amount == null || amount === "" ? null : Number(amount);
  if (price == null || !Number.isFinite(price) || price <= 0 || notATier(name)) return name;
  const scope = name.match(TIER_SCOPE);
  if (!scope) return name;
  const conditions = tierConditionsIn(scope[1]);
  if (conditions.length !== 1) return name;
  const before = scope[1].slice(0, conditions[0].start).trim();
  const after = scope[1].slice(conditions[0].end).trim();
  // Only the threshold's own noun may come before the condition ("overdraft balance $30.00 or less"); any
  // other word ("international over $1,000", "continuous over $5") is the fee's and stays for the guard.
  if (after || (before && !SCOPE_NOUN.test(collapse(before)))) return name;
  return name.slice(0, scope.index).trimEnd();
}
