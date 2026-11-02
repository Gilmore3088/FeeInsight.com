import { namesNoAccount } from "@/lib/account-name-exclusions";
import { ACCOUNT_PRICED_CATEGORIES, productKey } from "@/lib/fee-product";
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
  /** Which document form proved the account (#1911); absent on evidence written before it. */
  form?: AncillaryOwnerForm;
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

/**
 * How a document proved it serves one account: an "<Account> Pricing and Information" guide with its
 * own "Account terms and fees" block (U.S. Bank's Safe Debit, #2179), or a short single-account
 * disclosure that defers to the general fee schedule (#1911, `singleAccountDisclosure`).
 */
export type AncillaryOwnerForm = "pricing_guide" | "single_account_disclosure";
export interface AncillaryOwner {
  productName: string; title: string; block: string; applicability: string | null; form: AncillaryOwnerForm;
}

/**
 * One primary account document, not section/column inference within a multi-product guide. Every
 * reader of ownership (Knox's read and recovery, Darwin's re-witness, Hamilton's copy checks, Deming's
 * live audit) calls this one function, so the forms it accepts stay the same everywhere.
 */
export function primaryAncillaryProduct(text: string, institutionName?: string | null): AncillaryOwner | null {
  return pricingGuideProduct(text, institutionName) ?? singleAccountDisclosure(text, institutionName);
}

function pricingGuideProduct(text: string, institutionName?: string | null): AncillaryOwner | null {
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
  return { productName: own.name, title: own.title, block, applicability, form: "pricing_guide" };
}

/** A single-account disclosure is a short supplement; a longer text is an agreement or a full guide. */
export const SINGLE_ACCOUNT_DISCLOSURE_MAX_CHARS = 12_000;
/** The title must be among the first non-empty lines (a date or "Current Date:" line not counted). */
const SINGLE_ACCOUNT_HEAD_LINES = 6;
const ACCOUNT_KIND = /\b(?:checking|savings|share\s+drafts?|account)\)?$/i;
const NAME = String.raw`([A-Za-z][A-Za-z0-9&'’()./ -]{1,68}?)`;
const TIS = /^truth[\s-]+in[\s-]+savings(?:\s+account)?\s+disclosures?$/i;
const SINGLE_TITLES: ReadonlyArray<{ pattern: RegExp; next?: RegExp; besideTis?: true }> = [
  // Zing: "Information about your Second Chance Checking Account".
  { pattern: new RegExp(String.raw`^Information\s+about\s+your\s+${NAME}$`, "i") },
  // "First Fed Bank On Account Disclosure"; a generic "Checking Account Disclosures" fails GENERIC.
  { pattern: new RegExp(String.raw`^${NAME}\s+Disclosures?$`, "i") },
  // Bank of Hawaii: "BANKOHANA - LEVEL I CHECKING – Outline of Basic Terms & Conditions effective as of …".
  { pattern: new RegExp(String.raw`^${NAME}\s*[–—-]\s*Outline\s+of\s+Basic\s+Terms\b`, "i") },
  // UW Credit Union: "Launch Account" over "Basic Terms & Conditions".
  { pattern: new RegExp(String.raw`^${NAME}$`, "i"), next: /^(?:Outline\s+of\s+)?Basic\s+Terms\s*(?:&|and)\s*Conditions\b/i },
  // Albany Bank: "RELATIONSHIP INTEREST CHECKING | Account Number:".
  { pattern: new RegExp(String.raw`^${NAME}\s*\|\s*Account\s+Number:?$`, "i") },
  // "PERKS CHECKING" beside "TRUTH IN SAVINGS DISCLOSURE" (either order).
  { pattern: new RegExp(String.raw`^${NAME}$`, "i"), besideTis: true },
];
/** "Please refer to our Fee Schedule", "Please see … Consumer Checking and Savings Fee Schedule". */
const DEFERS_TO_GENERAL_SCHEDULE = /\b(?:refer\s+to|see)\b[^.]{0,250}?\b(?:fee\s+schedule|schedule\s+of\s+(?:fees|charges)|service\s+charge\s+schedule)\b/i;
/** Words that put a section's prices on every account, so the text is not one account's alone. */
const SHARED_SECTION = /\b(?:applicable|apply|applies)\s+to\s+all\b|\b(?:all|every)\s+(?:consumer\s+|personal\s+|deposit\s+|member\s+)?accounts?(?:\s+types?)?\b|\bevery\s+account\s+type\b/i;
/** The single-account disclosures seen on prod print 3 to 20 priced lines; a full schedule prints more. */
const SINGLE_ACCOUNT_MAX_PRICED_LINES = 30;
/** A heading with one of these words is prose ("Overdraft Protection from Savings"), not an account. */
const PROSE_WORDS = /\b(?:to|from|other|your|our|for|with|per|each|by|if|when|the|a|an|this|that|all|any|no|not|in|on|at|of)\b/i;

/**
 * A single-account title must name one real account. These name a class of accounts or none
 * ("New Account", "Joint Account", "Money Market Account", "Overdraft Protection Account"), so the
 * text is not one product's: unassigned. Kept apart from GENERIC, whose heading use must still
 * refuse a second named account column.
 */
const GENERIC_SINGLE = /^(?:(?:new|joint|individual|online|internet|electronic|e|consumer|personal|business|commercial|retail|deposit|overdraft|protection|escrow|money|market|checking|savings|share|draft|transaction|bank|member)\s+)*(?:accounts?|checking|savings|deposits?|shares?|share\s+drafts?|money\s+market)$/i;
/** "Checking and Savings Account", "Checking & Savings", "Checking/Savings": more than one account. */
const JOINS_ACCOUNTS = /\s(?:and|or|plus)\s|[&/+,]/i;

function singleAccountName(raw: string, institutionName?: string | null): string | null {
  const name = compact(raw.replace(/[®™]/g, ""));
  if (name.length < 3 || name.length > 70 || !ACCOUNT_KIND.test(name)) return null;
  if (JOINS_ACCOUNTS.test(name) || GENERIC_SINGLE.test(name)) return null;
  if (GENERIC.test(name) || NON_DEPOSIT.test(name) || namesNoAccount(name, institutionName) || /[$0-9|:]/.test(name)) return null;
  return name;
}

/** Every title-form line in the text, with the account it names. */
function singleAccountTitles(lines: string[], institutionName?: string | null): { index: number; title: string; name: string }[] {
  const nearest = (from: number, step: 1 | -1) => {
    for (let at = from + step; at >= 0 && at < lines.length; at += step) { const value = compact(lines[at]); if (value) return value; }
    return "";
  };
  const found: { index: number; title: string; name: string }[] = [];
  lines.forEach((physical, index) => {
    const line = compact(physical);
    if (!line || line.length > 160) return;
    for (const form of SINGLE_TITLES) {
      const match = line.match(form.pattern);
      if (!match) continue;
      if (form.next && !form.next.test(nearest(index, 1))) continue;
      if (form.besideTis && !TIS.test(nearest(index, 1)) && !TIS.test(nearest(index, -1))) continue;
      const name = singleAccountName(match[1], institutionName);
      if (name) { found.push({ index, title: line, name }); return; }
    }
  });
  return found;
}

/**
 * #1911 v2: a short disclosure for one named account ("First Fed Bank On Account Disclosure",
 * "Information about your Second Chance Checking Account", "BANKOHANA - LEVEL I CHECKING – Outline
 * of Basic Terms & Conditions", "PERKS CHECKING" over "Truth in Savings Disclosure") that sends the
 * reader to the general fee schedule for other fees. Its prices are that account's own, printed
 * beside the general schedule's. Fails closed: the title opens the text, every title line names the
 * same account, no other account stands alone as a heading or column, and the text defers to the
 * general schedule. The whole text is the account's block.
 */
export function singleAccountDisclosure(text: string, institutionName?: string | null): AncillaryOwner | null {
  if (!text || text.length > SINGLE_ACCOUNT_DISCLOSURE_MAX_CHARS) return null;
  const lines = text.split(/\r?\n/);
  const titles = singleAccountTitles(lines, institutionName);
  if (titles.length === 0) return null;
  const head = lines.map((line, index) => ({ index, line: compact(line) }))
    .filter((entry) => entry.line && !/^(?:current\s+date:?|effective(?:\s+date)?:?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|-{3,})$/i.test(entry.line))
    .slice(0, SINGLE_ACCOUNT_HEAD_LINES).map((entry) => entry.index);
  const own = titles[0];
  if (!head.includes(own.index)) return null;
  if (titles.some((title) => productKey(title.name) !== productKey(own.name))) return null;
  if (!DEFERS_TO_GENERAL_SCHEDULE.test(compact(text))) return null;
  // A disclosure that carries the general schedule too ("Other Service Fees (applicable to all
  // accounts)" under a Cash Back Share Draft disclosure, document 18704) prints general prices: unassigned.
  if (SHARED_SECTION.test(compact(text))) return null;
  if (lines.filter((line) => [...line.matchAll(MONEY)].length > 0).length > SINGLE_ACCOUNT_MAX_PRICED_LINES) return null;
  for (const line of lines) for (const cell of line.split("|")) {
    const heading = compact(cell.replace(/[®™]/g, ""));
    if (!heading || heading.length > 60 || /^[•●▪◦*\-–]/.test(heading) || /[$.!?;:0-9]/.test(heading)) continue;
    if (!/\b(?:Checking|Savings|Share\s+Drafts?|Money\s+Market|Accounts?)$/i.test(heading)) continue;
    if (!/^[A-Z]/.test(heading) || PROSE_WORDS.test(heading)) continue;
    if (GENERIC.test(heading) || namesNoAccount(heading, institutionName)) continue;
    const key = productKey(heading), ownKey = productKey(own.name);
    if (key !== ownKey && !ownKey.includes(key) && !key.includes(ownKey)) return null;
  }
  return { productName: own.name, title: own.title, block: text, applicability: null, form: "single_account_disclosure" };
}

/**
 * #1911: Knox gives a fee the account of a single-account disclosure (`singleAccountDisclosure`) only
 * while this switch is on. Off by default until a sampled dry run is approved; off, such a document's
 * fees stay unassigned as before, at read and in the recovery (`ancillary-owner-correct.ts`). The
 * switch reads on only for "1", "true" or "on".
 */
export const SINGLE_ACCOUNT_OWNER_SWITCH = "KNOX_SINGLE_ACCOUNT_OWNER_LIVE";
export function singleAccountOwnerLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[SINGLE_ACCOUNT_OWNER_SWITCH] ?? "").trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return ["1", "true", "on"].includes(value);
}

/** Own label/price must be witnessed inside the primary product's bounded fee block. */
export function withAncillaryProduct<T extends { feeName: string; canonicalHint: string; amount?: number | null }>(
  candidate: T, text: string, institutionName?: string | null,
  options: { singleAccount?: boolean } = {},
): T & { ancillaryProduct?: AncillaryProduct } {
  if (ACCOUNT_PRICED_CATEGORIES.has(candidate.canonicalHint) || candidate.amount == null || !(candidate.amount > 0)) return candidate;
  const owner = primaryAncillaryProduct(text, institutionName);
  if (!owner) return candidate;
  if (owner.form === "single_account_disclosure" && !(options.singleAccount ?? singleAccountOwnerLive())) return candidate;
  const witness = checkFeeAgainstSource(owner.block, candidate.feeName, candidate.amount, ".", candidate.canonicalHint);
  if (!witness.ok || !witness.sourceLine) return candidate;
  return { ...candidate, ancillaryProduct: { version: ANCILLARY_PRODUCT_VERSION, productName: owner.productName,
    title: owner.title, applicability: owner.applicability, ownLine: witness.sourceLine, form: owner.form } };
}
