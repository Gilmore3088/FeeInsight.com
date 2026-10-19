import { namesNoAccount } from "@/lib/account-name-exclusions";
import { productKey } from "@/lib/fee-product";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

/** Evidence format only: does not expand any extractor/rejudge queue. */
export const ANCILLARY_PRODUCT_VERSION = 1;
export const ANCILLARY_PRODUCT_FLAG = "ancillary_product:v1";
export interface AncillaryProduct {
  version: 1;
  productName: string;
  title: string;
  applicability: string | null;
  ownLine: string;
}
const TITLE = /^(.{3,80}?)\s+(?:Pricing\s+and\s+Information|(?:Account\s+)?Fee\s+Schedule|Schedule\s+of\s+Fees)\s*$/i;
const KIND = /\b(?:checking|savings|debit|deposit|share|account)\b/i;
const GENERIC = /^(?:(?:consumer|personal|business|commercial|retail|deposit|checking|savings|debit|share|bank)\s+)*(?:accounts?|checking|savings|deposits?)$/i;
const NON_DEPOSIT = /\b(?:loans?|mortgage|lending|credit\s+card|ira|hsa|certificates?|retirement)\b/i;
const HEADING = /^(?:ACCOUNT\s+FEATURES|OTHER\s+(?:ACCOUNT\s+)?PRODUCTS|TERMS\s+AND\s+CONDITIONS|DISCLOSURES?|IMPORTANT\s+INFORMATION)\s*$/i;
const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const MONEY = /\$\s*\d+(?:,\d{3})*(?:\.\d{1,2})?|\b\d+\.\d{2}\b/g;
const explicitNoFee = (line: string) => /^No\s+[A-Za-z][A-Za-z' -]{0,100}\s+fees?(?:\s*\([^)]{1,80}\))?$/i
  .test(line.replace(/^[•●▪◦*\-–]\s*/, ""));

/** Unknown column labels never inherit the primary title. Only an unambiguous block qualifies. */
function unambiguousFeeBlock(lines: string[]): boolean {
  let exceptionContinuation = false;
  for (const physical of lines) {
    const line = compact(physical);
    if (!line) continue;
    const plain = line.replace(/^[•●▪◦*\-–]\s*/, "");
    if (exceptionContinuation) {
      // The supported wrapped applicability clause ends explicitly; arbitrary intervening
      // labels/columns are not silently absorbed as prose.
      if (!/^exceptions\s*:\s*$/i.test(plain)) return false;
      exceptionContinuation = false;
      continue;
    }
    if (/^Subject to miscellaneous fees\b/i.test(plain)) {
      if (line.includes("|") || line.length > 300 || [...line.matchAll(MONEY)].length > 0) return false;
      if (!/exceptions\s*:\s*$/i.test(plain)) {
        if (!/following\s*$/i.test(plain)) return false;
        exceptionContinuation = true;
      }
      continue;
    }
    // More than one price can be different products' columns, even at the same amount.
    // Conditional/tiered or otherwise ambiguous blocks remain unassigned in this first phase.
    const prices = [...line.matchAll(MONEY)];
    if (prices.length > 1) return false;
    if (line.includes("|")) {
      const cells = line.split("|").map(compact);
      if (cells.length !== 2 || cells.some((cell) => !cell)) return false;
      if (prices.length === 0) {
        // The actual Safe Debit layout places two explicit no-fee statements side by side.
        if (!cells.every(explicitNoFee)) return false;
      } else {
        const priceCell = cells.findIndex((cell) => [...cell.matchAll(MONEY)].length > 0);
        // Ordinary label | price, or one complete priced fee beside an explicit no-fee line.
        if (!/^(?:\$|\d+\.\d{2})/.test(cells[priceCell]) && !explicitNoFee(cells[1 - priceCell])) return false;
      }
    } else if (prices.length === 0 && !explicitNoFee(plain)) {
      return false;
    }
  }
  return !exceptionContinuation;
}

/** One primary account document, not section/column inference within a multi-product guide. */
export function primaryAncillaryProduct(text: string, institutionName?: string | null): {
  productName: string; title: string; block: string; applicability: string | null;
} | null {
  if (!text || text.length > 200_000) return null;
  const lines = text.split(/\r?\n/);
  const titles = lines.flatMap((line, index) => {
    const title = compact(line), match = title.match(TITLE);
    return match && !title.includes("|") ? [{ index, title, name: compact(match[1]) }] : [];
  });
  if (titles.length !== 1 || titles[0].index > 12) return null;
  const own = titles[0];
  if (!KIND.test(own.name) || GENERIC.test(own.name) || NON_DEPOSIT.test(own.name)
    || namesNoAccount(own.name, institutionName) || /[$0-9|]/.test(own.name)) return null;
  // An independent account heading, including a table column, makes the entire input mixed.
  // Merely mentioning a product inside prose does not create or change ownership.
  for (const line of lines) for (const cell of line.split("|")) {
    const heading = compact(cell);
    // Physical bullet prose is not a heading, even when its final word is "account".
    // Standalone/column account labels must still fail closed as mixed ownership.
    if (/^[•●▪◦*\-–]/.test(heading) || heading.length > 80 || /[$.!?;:0-9]/.test(heading)
      || !/\b(?:Checking|Savings|Debit|Deposit|Account)s?$/i.test(heading)) continue;
    if (!GENERIC.test(heading) && productKey(heading) !== productKey(own.name) && heading !== own.title) return null;
  }
  const start = lines.findIndex((line, index) => index > own.index && /^ACCOUNT\s+TERMS\s+AND\s+FEES\s*$/i.test(compact(line)));
  if (start < 0 || start - own.index > 12) return null;
  let end = lines.findIndex((line, index) => index > start && HEADING.test(compact(line)));
  if (end < 0) end = lines.length;
  if (end - start > 48) return null;
  const block = lines.slice(start + 1, end).join("\n");
  if (block.length > 5_000 || !unambiguousFeeBlock(lines.slice(start + 1, end))) return null;
  const applicability = compact(block.match(/Subject to miscellaneous fees[^$]{0,300}?exceptions\s*:/i)?.[0] ?? "") || null;
  return { productName: own.name, title: own.title, block, applicability };
}

/** Own label/price must be witnessed inside the primary product's bounded fee block. */
export function withAncillaryProduct<T extends { feeName: string; canonicalHint: string; amount?: number | null }>(
  candidate: T, text: string, institutionName?: string | null,
): T & { ancillaryProduct?: AncillaryProduct } {
  if (["monthly_maintenance", "minimum_balance"].includes(candidate.canonicalHint) || candidate.amount == null || !(candidate.amount > 0)) return candidate;
  const owner = primaryAncillaryProduct(text, institutionName);
  if (!owner) return candidate;
  const witness = checkFeeAgainstSource(owner.block, candidate.feeName, candidate.amount, ".", candidate.canonicalHint);
  if (!witness.ok || !witness.sourceLine) return candidate;
  return { ...candidate, ancillaryProduct: { version: ANCILLARY_PRODUCT_VERSION, productName: owner.productName,
    title: owner.title, applicability: owner.applicability, ownLine: witness.sourceLine } };
}
