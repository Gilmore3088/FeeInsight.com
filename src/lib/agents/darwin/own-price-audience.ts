import type { FeeAudience } from "@/lib/fee-audience";

type ExclusiveAudience = Extract<FeeAudience, "consumer" | "business">;

/** This is applicability metadata, never evidence that a price or category is valid. */
export type OwnPriceAudience =
  | { kind: "none" }
  | { kind: "qualified"; audience: ExclusiveAudience; evidence: string }
  | { kind: "ambiguous"; evidence: string[] };

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.,])/g;
const PRICE_START = /^(?:[•●▪‣*-]\s*)?\$/;
const EXCLUSIVE = /\(\s*(consumer|personal|business|commercial)(?:\s+(?:accounts?|clients?|customers?))?\s+only\s*\)|\b(?:for\s+)?(consumer|personal|business|commercial)\s+(?:(?:accounts?|clients?|customers?)\s+)?only\b/gi;
const PREFIX_EXCLUSIVE = /\s*(\(\s*(?:consumer|personal|business|commercial)(?:\s+(?:accounts?|clients?|customers?))?\s+only\s*\))\s*$/i;
const UNIT = String.raw`(?:items?|presentments?|transactions?|requests?|checks?|wires?|notices?|statements?|images?|pages?|documents?|hours?|days?|months?|years?)`;
const BASIS = String.raw`(?:(?:per|each)\s+${UNIT}|/\s*${UNIT}|monthly|annually|yearly|daily|one[- ]time)`;
const NEUTRAL = new RegExp(String.raw`^\s*(?:${BASIS}|\(\s*${BASIS}\s*\))?\s*\.?\s*$`, "i");
const MAX_LABEL_CHARS = 160;
const MAX_ROW_CHARS = 320;

function key(text: string): string {
  return text.replace(/[A-Z]/g, letter => letter.toLowerCase()).replace(/\s+/g, " ").trim();
}

function label(text: string): { name: string; qualifier: string } {
  const cleaned = text.trim().replace(/^[•●▪‣*-]\s*/, "").replace(/[.…]{2,}/g, " ")
    .replace(/\s*[:|]\s*$/, "").trim();
  const qualifier = PREFIX_EXCLUSIVE.exec(cleaned);
  return { name: qualifier ? cleaned.slice(0, qualifier.index).trim() : cleaned, qualifier: qualifier?.[1] ?? "" };
}

function exclusive(text: string): { present: boolean; audience: ExclusiveAudience | null; remainder: string } {
  // The credit union's business is the service's purpose, not a business-account audience.
  const neutral = text.replace(/\bcredit\s+union\s+business\s+only\b(?!\s+(?:accounts?|checking|savings|banking|membership|services|loans?|cards?)\b)/gi, " ");
  const matches = [...neutral.matchAll(EXCLUSIVE)];
  if (matches.length === 0) return { present: false, audience: null, remainder: text };
  const word = matches[0][1] ?? matches[0][2];
  return {
    present: true,
    audience: matches.length === 1 ? /^(?:consumer|personal)$/i.test(word) ? "consumer" : "business" : null,
    remainder: neutral.replace(EXCLUSIVE, " "),
  };
}

interface OwnRow {
  amounts: number[];
  exclusive: boolean;
  audience: ExclusiveAudience | null;
  evidence: string;
}

/**
 * Exact physical label + requested dollar price + exclusive audience, on one row or its
 * immediate price continuation. Unsupported or conflicting own occurrences block defaults;
 * a qualifier on another fee never becomes evidence. Ordinary/paired audience prices are
 * left to the existing context reader. No section, URL, model condition or fuzzy name is used.
 */
export function ownPriceAudience(text: string, feeName: string, amount: number | null): OwnPriceAudience {
  if (!text || !feeName || feeName.length > MAX_LABEL_CHARS || amount == null || !Number.isFinite(amount)) return { kind: "none" };
  const wanted = key(feeName);
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const rows: OwnRow[] = [];
  let incompleteOwner = false;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const prices = [...line.matchAll(MONEY)];
    const first = prices[0];
    let owner: ReturnType<typeof label>;
    let priceText: string;
    let physical: string;
    if (first) {
      const before = line.slice(0, first.index);
      owner = label(before);
      if (key(owner.name) !== wanted) {
        // An exact label inside unsupported physical columns cannot gain an audience from
        // the other cell, nor can its apparent restriction be treated as unqualified.
        if (before.split(/[|\t]/).some(cell => key(label(cell).name) === wanted) && exclusive(line).present) {
          rows.push({ amounts: prices.map(read => Number(read[1].replace(/,/g, ""))),
            exclusive: true, audience: null, evidence: line });
        }
        continue;
      }
      priceText = line.slice(first.index);
      physical = line;
    } else {
      owner = label(line);
      if (key(owner.name) !== wanted) continue;
      const next = lines[at + 1] ?? "";
      if (!PRICE_START.test(next)) {
        incompleteOwner = true;
        if (owner.qualifier) rows.push({ amounts: [], exclusive: true, audience: null, evidence: line });
        continue;
      }
      priceText = next.replace(/^[•●▪‣*-]\s*/, "");
      physical = `${line} | ${next}`;
    }
    const ownPrices = [...priceText.matchAll(MONEY)];
    const price = ownPrices[0];
    const after = price ? priceText.slice((price.index ?? 0) + price[0].length) : priceText;
    const qualifier = exclusive(`${owner.qualifier} ${after}`);
    const supported = physical.length <= MAX_ROW_CHARS && owner.name.length <= MAX_LABEL_CHARS &&
      !/[|\t]/.test(owner.name) && !/[|\t%]/.test(priceText) && ownPrices.length === 1 &&
      price?.index === 0 && qualifier.audience != null && NEUTRAL.test(qualifier.remainder);
    rows.push({ amounts: ownPrices.map(read => Number(read[1].replace(/,/g, ""))),
      exclusive: qualifier.present, audience: supported ? qualifier.audience : null, evidence: physical });
  }
  const own = rows.filter(row => row.amounts.includes(amount) || (row.amounts.length === 0 && row.exclusive));
  if (!own.some(row => row.exclusive)) return { kind: "none" };
  if (incompleteOwner || own.length !== 1 || own[0].audience == null) {
    return { kind: "ambiguous", evidence: own.slice(0, 3).map(row => row.evidence.slice(0, MAX_ROW_CHARS)) };
  }
  return { kind: "qualified", audience: own[0].audience, evidence: own[0].evidence };
}
