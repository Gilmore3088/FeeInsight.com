/** Explicit single-column fee labels followed by their own price bullets. Pure. */
export interface StackedFeePrice {
  label: string;
  amount: number;
  priceLine: string;
  ownText: string;
  annualProgram: boolean;
  lineIndex: number;
}

const MAX_LABEL_CHARS = 160;
const MAX_LABEL_WORDS = 14;
const MAX_PRICE_CHARS = 240;
const MAX_PRICES = 4;
const PRICE = /^[•●▪‣*-]\s*(\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2}))(?![\d.])(?=\s|[(/]|$)/;
const MONEY = /\$\s*(?:\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/g;
const ANNUAL_UNIT = /^\s*\(?\s*(?:annual(?:ly| fee)?|yearly|per (?:calendar )?year|a year|\/\s*(?:yr|year))\s*\)?\s*\.?\s*$/i;
const PROGRAM = /\boverdraft\b/i;
const PROGRAM_KIND = /\b(?:protection|program|privilege|coverage)\b/i;
const CAP_FIRST_ITEM = /^[•●▪‣*-]\s*\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})\s+max(?:imum)?\.\s*\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})\s+(?:per\s+(?:item|presentment)|each\s+item|\/\s*item)\s*\.?$/i;
// A literal standard item-fee label, not an age, account, balance or product eligibility tier.
// The helper cannot establish eligibility from a longer label (#2246 / #2209).
const ITEM_FEE_NAME = /^(?:overdraft (?:fee|charge)(?: savings)?|(?:nsf|non[- ]sufficient funds|insufficient funds)(?: return(?:ed)? item)? (?:fee|charge))$/i;

export function stackedLabelKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().replace(/:\s*$/, "").toLowerCase();
}

function priceLine(line: string): { amount: number; after: string } | null {
  if (line.length > MAX_PRICE_CHARS || /[|\t%]/.test(line)) return null;
  const match = PRICE.exec(line);
  if (!match || [...line.matchAll(MONEY)].length !== 1) return null;
  return { amount: Number(match[2].replace(/,/g, "")), after: line.slice(match[0].length) };
}

/** A new explicitly priced service stops the previous heading, however many words its label has. */
export function isStackedFeeLabel(label: string, following: string | undefined): boolean {
  if (!following || !priceLine(following)) return false;
  return boundedLabel(label);
}

function boundedLabel(label: string): boolean {
  if (label.length > MAX_LABEL_CHARS || /[$%|\t]/.test(label) || !/^[A-Z]/.test(label)) return false;
  const words = label.trim().split(/\s+/);
  // Lowercase agreement prose and conditions do not establish a new physical fee owner.
  return words.length >= 2 && words.length <= MAX_LABEL_WORDS &&
    !/\b(?:you|your|we|will|must|shall|unless|waived)\b/i.test(label);
}

export interface CapFirstItemPrice {
  label: string;
  canonicalKey: "nsf" | "overdraft";
  maximum: number;
  amount: number;
  ownText: string;
  lineIndex: number;
  eligibilityContext?: string;
  producerScopeUnknown?: true;
}

const ELIGIBILITY_HEADING = /\b(?:ages?|youth|senior|junior|student|minor|teen|checking|(?:savings|business|commercial|club|reward|premier) accounts?)\b|\b(?:under|over)\s+\d/i;
const STANDARD_SECTION = /^(?:fees (?:and|&) charges|(?:standard|regular|general) (?:fees(?: (?:and|&) charges)?|services?))\s*:?$/i;

type EligibilityScope = { eligibilityContext?: string; producerScopeUnknown?: true };

function eligibilityScopes(lines: string[]): EligibilityScope[] {
  const result: EligibilityScope[] = [];
  let section: string | undefined;
  let unknown = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pricedLabel = boundedLabel(line) && (priceLine(lines[i + 1] ?? "") || CAP_FIRST_ITEM.test(lines[i + 1] ?? ""));
    if (STANDARD_SECTION.test(line)) {
      section = undefined;
      unknown = false;
    } else if (!line.includes("$") && line.length <= MAX_LABEL_CHARS && ELIGIBILITY_HEADING.test(line) && !pricedLabel) {
      section = line;
      unknown = false;
    } else if (section && !pricedLabel && !priceLine(line) && !CAP_FIRST_ITEM.test(line)) {
      // Unknown prose/new headings cannot silently end a restricted section and authorize
      // a standard price. Stop this producer path until an explicit section is established.
      unknown = true;
    }
    result.push(section ? unknown ? { producerScopeUnknown: true } : { eligibilityContext: section } : {});
  }
  return result;
}

/**
 * #2246: a maximum printed first never displaces the separately stated item price.
 * This is a positive own-price witness only: no daily unit, multiplication or price is inferred.
 */
export function capFirstItemPrices(text: string): CapFirstItemPrice[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const scopes = eligibilityScopes(lines);
  const rows: CapFirstItemPrice[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const label = lines[i];
    if (!boundedLabel(label) || !ITEM_FEE_NAME.test(label)) continue;
    if (lines[i + 1].length > MAX_PRICE_CHARS) continue;
    const match = CAP_FIRST_ITEM.exec(lines[i + 1]);
    if (!match) continue;
    const maximum = Number(match[1].replace(/,/g, ""));
    const amount = Number(match[2].replace(/,/g, ""));
    if (amount <= 0 || maximum < amount) continue;
    rows.push({ label, canonicalKey: /^overdraft\b/i.test(label) ? "overdraft" : "nsf",
      maximum, amount, ownText: `${label} | ${lines[i + 1]}`, lineIndex: i,
      ...scopes[i] });
  }
  return rows;
}

/**
 * Bind only an immediate price run ending at another explicitly priced label or the document's
 * end. Several prices under one label remain several own prices; unknown continuations and
 * exceeded budgets give no binding, so they cannot make a conflicting-price refusal.
 */
export function stackedFeePrices(text: string): StackedFeePrice[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const result: StackedFeePrice[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isStackedFeeLabel(lines[i], lines[i + 1])) continue;
    let end = i + 1;
    while (end < lines.length && priceLine(lines[end])) end++;
    if (end - i - 1 > MAX_PRICES || (end < lines.length && !isStackedFeeLabel(lines[end], lines[end + 1]))) continue;
    for (let at = i + 1; at < end; at++) {
      const price = priceLine(lines[at])!;
      result.push({
        label: lines[i],
        amount: price.amount,
        priceLine: lines[at],
        ownText: `${lines[i]} | ${lines[at]}`,
        annualProgram: PROGRAM.test(lines[i]) && PROGRAM_KIND.test(lines[i]) && ANNUAL_UNIT.test(price.after),
        lineIndex: i,
      });
    }
  }
  return result;
}

/** All literal prices assigned to this exact physical label, without borrowing similar names. */
export function pricesForStackedLabel(rows: readonly StackedFeePrice[], name: string): StackedFeePrice[] {
  const key = stackedLabelKey(name);
  return rows.filter(row => stackedLabelKey(row.label) === key);
}

/**
 * A stacked run is not exhaustive when the same literal name also occurs on a priced
 * physical row elsewhere (another audience, product or table tier). Leave that document
 * to the existing row witness instead of overriding its valid same-name price.
 */
export function exclusiveStackedPrices(
  text: string,
  rows: readonly StackedFeePrice[],
  name: string,
): StackedFeePrice[] {
  const key = stackedLabelKey(name);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.some(line => line.includes("$") && stackedLabelKey(line).includes(key))) return [];
  if (lines.some((line, index) => stackedLabelKey(line) === key &&
    !rows.some(row => row.lineIndex === index && stackedLabelKey(row.label) === key))) return [];
  return pricesForStackedLabel(rows, name);
}

/** The same bounded physical-ownership refusal used at admission and live two-look review. */
export function refusesStackedFeePrice(text: string, name: string, amount: number, canonicalKey?: string | null): boolean {
  const explicit = exclusiveStackedPrices(text, stackedFeePrices(text), name);
  if (explicit.length > 0) {
    const own = explicit.filter(row => row.amount === amount);
    if (own.length === 0 || (canonicalKey === "overdraft" && own.every(row => row.annualProgram))) return true;
  }
  if (canonicalKey != null && canonicalKey !== "nsf" && canonicalKey !== "overdraft") return false;
  const caps = capFirstItemPrices(text).filter(row => stackedLabelKey(row.label) === stackedLabelKey(name));
  const exclusive = exclusiveStackedPrices(text, caps.map(row => ({
    ...row, priceLine: row.ownText, annualProgram: false,
  })), name);
  return exclusive.length > 0 && caps.some(row => row.maximum === amount) && !caps.some(row => row.amount === amount);
}
