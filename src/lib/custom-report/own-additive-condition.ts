/** Source metadata only: existing admission must establish the fee name, category and price. */
const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/g;
const MAX_CHARS = 320;
const key = (value: string) => value.replace(/[.…]{2,}/g, " ").replace(/\s+/g, " ").trim().replace(/:\s*$/, "").toLowerCase();
const PRICE_BULLET = /^[•●▪‣*-]\s*\$/;
const ADDITIVE = /^\s*(?:(?:per|each)\s+[a-z][a-z -]{0,30}\s*)?\(Plus\s+[^()$%|"\t]{1,160}\b(?:fee|charge|cost)s?\b[^()$%|"\t]{0,100}\)\s*\.?$/i;

/**
 * Retain a complete own additive parenthetical that a legacy price window truncates.
 * Only one exact physical occurrence may supply it; no neighboring price or table cell can.
 * Unknown units remain literal conditions and never create a supported frequency code.
 */
export function ownAdditiveCondition(text: string, name: string, amount: number): string | null {
  if (!text || !name || !Number.isFinite(amount) || !/\(plus\s/i.test(text)) return null;
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const found: Array<string | null> = [];
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    let priceText: string;
    let label: string;
    let priceAt = at;
    const first = [...line.matchAll(MONEY)][0];
    if (first) {
      label = line.slice(0, first.index).replace(/\s*\|\s*$/, "").trim();
      if (key(label) !== key(name)) continue;
      priceText = line.slice(first.index);
      // One optional label/price separator is supported; physical columns are not.
      if (/[|\t]/.test(label) || /[|\t]/.test(priceText) || (line.match(/\|/g)?.length ?? 0) > 1) { found.push(null); continue; }
    } else {
      if (key(line) !== key(name)) continue;
      label = line;
      if (/[|\t]/.test(label)) { found.push(null); continue; }
      priceAt++;
      if (!PRICE_BULLET.test(lines[priceAt] ?? "")) { found.push(null); continue; }
      priceText = lines[priceAt].replace(/^[•●▪‣*-]\s*/, "");
    }
    // A single lowercase continuation can close an explicitly opened parenthetical.
    if (priceText.includes("(") && !priceText.includes(")")) {
      const next = lines[priceAt + 1] ?? "";
      if (/^[a-z]/.test(next) && !/[$%|\t]/.test(next)) priceText += ` ${next}`;
    }
    const prices = [...priceText.matchAll(MONEY)];
    const own = `${label} | ${priceText}`;
    const suffix = prices.length === 1 ? priceText.slice((prices[0].index ?? 0) + prices[0][0].length) : "";
    found.push(own.length <= MAX_CHARS && prices.length === 1 && Number(prices[0][1].replace(/,/g, "")) === amount &&
      !/[|\t]/.test(priceText) && ADDITIVE.test(suffix) ? own : null);
  }
  return found.length === 1 ? found[0] : null;
}
