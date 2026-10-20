/** Bounded single-column returned/paid-item policy paragraphs. Pure own-price evidence. */
export interface NsfPolicyPrice {
  feeName: string;
  amount: number;
  sourceLine: string;
  linkedConditions: string;
  eligibilityRestricted: boolean;
}
const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/g;
const HEADING = /^(?:(?:non[- ]?sufficient|insufficient) funds?(?:\s*\(NSF\))?|NSF)\s+(?:fees?|charges?)\s*:?$/i;
const PRICE_FIRST = /^\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s+for\s+(?:each|every)\s+(?:presentment\s+of\s+an?\s+)?(?:item|check|transaction)\b/i;
const RETURNED = /\b(?:we\s+)?return(?:ed)?\b[^.;|]{0,100}\binsufficient funds\b/i;
const PAID = /\boverdraft\s+(?:item|check|transaction)s?\s+(?:we\s+)?pay\b/i;
const EXEMPTION = /\b(?:NSF|non[- ]sufficient funds)\s+fees?\s+will\s+not\s+be\s+charged\s+to\b[^.\n]{1,160}\./i;
const TOTAL_BEFORE = /\b(?:already\s+been\s+)?charged\s+(?:a\s+)?total\s+of\s+(?:[1-9]\d?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:NSF|OD|overdraft|non[- ]sufficient funds)\s+)?fees?\s*\(\s*$/i;
const TOTAL_AFTER = /^\s*\)\s+for\b[^$.;|]{0,100}\bon\s+(?:that|the|each|a)\s+(?:business\s+)?day\b/i;
const MAX_LINES = 20;
const MAX_CHARS = 4_000;
const MAX_EVIDENCE_CHARS = 2_000;
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** The parenthesized dollar sum of a count of fees is not an individual fee's price. */
export function chargedFeeCountTotal(row: string, amount: number): boolean {
  for (const token of row.matchAll(MONEY)) {
    if (Number(token[1].replace(/,/g, "")) !== amount) continue;
    if (TOTAL_BEFORE.test(row.slice(0, token.index)) && TOTAL_AFTER.test(row.slice(token.index! + token[0].length))) return true;
  }
  return false;
}
function nextHeading(line: string): boolean {
  return line.length < 80 && !/[.$:;|]/.test(line) && line.split(/\s+/).length <= 7
    && line.split(/\s+/).every(word => word.length < 4 || /^[A-Z(]/.test(word));
}
function ownPrice(line: string): number | null {
  if (/[|\t]/.test(line) || line.length > 900) return null;
  const price = PRICE_FIRST.exec(line);
  if (!price || [...line.matchAll(MONEY)].length !== 1 || !RETURNED.test(line) || !PAID.test(line)) return null;
  return Number(price[1].replace(/,/g, ""));
}

/**
 * Own only complete price-first paragraphs under a literal NSF fee heading. A PDF's interleaved
 * cells are not assembled here. Both returned and paid events must be stated in the price line;
 * the existing NSF/OD twin mechanism may then represent both. Prices are never calculated.
 */
export function nsfPolicyPrices(text: string): NsfPolicyPrice[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const found: NsfPolicyPrice[] = [];
  for (let h = 0; h < lines.length; h++) {
    if (!HEADING.test(lines[h])) continue;
    const section: string[] = [];
    let overBudget = false;
    for (let i = h + 1; i < lines.length; i++) {
      const line = lines[i];
      if (nextHeading(line) || HEADING.test(line)) break;
      if (section.length >= MAX_LINES || section.join(" ").length + line.length > MAX_CHARS) { overBudget = true; break; }
      section.push(line);
    }
    if (overBudget || section.some(line => /[|\t]/.test(line))) continue;
    const exemptions = lines.slice(Math.max(0, h - 6), h).flatMap(line => {
      const match = EXEMPTION.exec(line);
      return match ? [match[0]] : [];
    });
    const prices: Array<{ amount: number; priceLine: string; conditions: string[] }> = [];
    let unresolved = false;
    for (let at = 0; at < section.length; at++) {
      const amount = ownPrice(section[at]);
      if (amount == null) {
        if (PRICE_FIRST.test(section[at])) unresolved = true;
        continue;
      }
      let end = at + 1;
      while (end < section.length && !PRICE_FIRST.test(section[end])) end++;
      const conditions = section.slice(at + 1, end);
      // An explicitly announced exception list must be complete, not a default flat price.
      const balanceException = (line: string) => /^(?:[-*]\s*)?The amount of the overdrawn balance\b.*\bless than\s+\$[^|]+;?$/i.test(line);
      const countException = (line: string) => [...line.matchAll(MONEY)].some(token => chargedFeeCountTotal(line, Number(token[1].replace(/,/g, ""))));
      if (!/\bunless\b[^.]{0,80}\bexceptions?\s+appl(?:y|ies)\s*:\s*$/i.test(section[at])
        || conditions.length === 0
        || !conditions.some(balanceException) || !conditions.some(countException)
        || conditions.some(line => !balanceException(line) && !countException(line))) {
        unresolved = true;
        continue;
      }
      prices.push({ amount, priceLine: section[at], conditions: conditions.map(clean) });
    }
    // An incomplete alternate paragraph cannot disappear and leave a universal-looking default.
    if (unresolved) continue;
    for (const price of prices) {
      // The raw key cannot distinguish two equal-priced policy variants with this shared name.
      // Keep that ambiguity out of the exact-price path instead of merging their scopes.
      if (prices.filter(other => other.amount === price.amount).length > 1) continue;
      const alternate = prices.filter(other => other !== price && /\bon accounts? for\b/i.test(other.priceLine));
      const sourceLine = clean(lines[h] + " | " + price.priceLine);
      const linkedConditions = [...price.conditions,
        ...alternate.map(other => "Other stated price tier: " + clean(other.priceLine) + " " + other.conditions.join(" ")),
        ...exemptions].join(" ");
      // Never retain a price after truncating its eligibility or exceptions away.
      if (sourceLine.length + linkedConditions.length > MAX_EVIDENCE_CHARS) continue;
      found.push({
        feeName: "NSF/Overdraft Fee",
        amount: price.amount,
        sourceLine,
        linkedConditions,
        eligibilityRestricted: /\bon accounts? for\b/i.test(price.priceLine),
      });
    }
  }
  return found;
}
