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
  if (block.length > 5_000) return null;
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
