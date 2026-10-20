import { createHash } from "node:crypto";

/** Source proof only. This version does not select or reopen historical rows. */
export const PAID_RETURNED_EVENT_VERSION = 1;
export const PAID_RETURNED_EVENT_FLAG = "knox_owned_event:v1";
export const PAID_RETURNED_ELIGIBILITY_FLAG = "knox_eligibility:paid_returned";
/** The categories a pair publishes under: the paid event as overdraft, the returned event as nsf. */
export const PAID_RETURNED_EVENT_KEYS: readonly string[] = ["overdraft", "nsf"];
const KEY_PREFIX = "paired_event:v1:";
const MAX_TEXT_BYTES = 1_000_000;
const MAX_UNIT_CHARS = 1_200;
const MAX_SECTION_LINES = 512;
const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/g;
const BASE = String.raw`(?:NSF|non[-\s]?sufficient funds?|insufficient funds?)`;
const ACTIONS = String.raw`(?:paid\s*(?:\/|\bor\b|\band\b|&)\s*return(?:ed)?|return(?:ed)?\s*(?:\/|\bor\b|\band\b|&)\s*paid)`;
const LABEL = new RegExp(String.raw`^(${BASE})\s+${ACTIONS}(?:\s+items?(?:\s+fees?)?)?$`, "i");
const START = new RegExp(String.raw`^\s*(?:[•●▪‣*-]\s*)?${BASE}\s+(?:paid|return(?:ed)?)\b`, "i");
const PROJECTED = new RegExp(String.raw`^${BASE}\s+-\s+(?:paid|returned)$`, "i");
const COMPRESSED_TEXT = new RegExp(String.raw`^\s*(?:[•●▪‣*-]\s*)?${BASE}\s+${ACTIONS}`, "im");
const TAIL = /^\s*(?:(?:per\s+(?:presentment|item)|each)\s*)?[.|\s]*$/i;
const SCOPE = /\b(?:accounts?|checking|savings|fees?|schedule)\b/i;
// A consumer prefix cannot establish general applicability for a named or qualified account.
const CONSUMER = /^(?:consumer|personal)(?:\s+(?:checking|savings)(?:\s+accounts?)?|\s+accounts?)\s+(?:fees?|fee schedule)\s*:?$/i;
const SEPARATE_EVENT = new RegExp(String.raw`^(?:${BASE}(?:\s+(?:paid|returned?|return)(?:\s+items?)?)?(?:\s+(?:fees?|charges?))?|overdraft(?:\s+(?:item|fee|charge))?|courtesy pay|paid item fee|returned? item fee)$`, "i");
/**
 * A priced label naming an overdraft, paid-item or returned-item charge in any wording ("Overdraft
 * Item Fee", "Return Item Fee", "Courtesy Pay Fee", "OD Fee") is a separate event price, not only
 * the exact names above.
 */
// An overdraft protection transfer, sweep or line is another service, not an overdraft item charge.
const SEPARATE_TOKEN = new RegExp(String.raw`\b(?:(?:overdrafts?|o\/?d)\b(?!\s+(?:protection|transfers?|sweeps?|lines?\b|limits?))`
  + String.raw`|courtesy\s+pay\b|paid\s+items?\b|return(?:ed)?\s+(?:items?|checks?)\b|items?\s+returned\b`
  + String.raw`|nsf\b|non[-\s]?sufficient\s+funds?\b|insufficient\s+funds?\b|bounced?\s+checks?\b`
  + String.raw`|overdrawn\s+items?\b|(?:unavailable|uncollected)\s+funds?\b|re-?present(?:ed|ment)\b|return(?:ed)?\s+payments?\b`
  + String.raw`|bounce\b|privilege\s+pay\b|items?\s+paid\b)`, "i");
/**
 * Another service only when the service word is part of the charge's own name: a returned
 * deposited item, a daily, continuous, sustained or extended overdraft charge, an overdraft
 * transfer or sweep, an ACH origination. A qualifier on an item price ("(deposit accounts)",
 * "max 5 per day", "checks, ACH, transfers") does not make it another service.
 */
/**
 * The charge's own name: the label before its first qualifier ("(", " - ", ","). A bare
 * "(deposited)" names the item itself ("Returned Item (Deposited)") and stays part of it.
 */
const chargeName = (label: string) => label.replace(/\(\s*deposited\s*\)/gi, "deposited").split(/\s*\(|\s+-\s+|,/)[0];

const OTHER_SERVICE = new RegExp([
  String.raw`\bdeposited\b`,
  String.raw`\b(?:daily|continuous|sustained|extended)\s+(?:overdraft|o\/?d|nsf)\b`,
  String.raw`\b(?:overdraft|o\/?d)\s+(?:(?:protection|from\s+\w+)\s+)?(?:transfers?|sweeps?)\b`,
  String.raw`\bach\s+origination\b`,
].join("|"), "i");
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const cleanLabel = (text: string) => flat(text.replace(/^\s*[•●▪‣*-]\s*/, "").replace(/[.…]{2,}/g, " ").replace(/\|\s*$/, ""));

/** A separate label | price cell is a structural boundary, not a list of qualifier keywords. */
function nextPricedRow(line: string): boolean {
  return /^[•●▪‣*-]?\s*[A-Za-z][^$|]{1,119}\|\s*\$\s*\d/.test(line)
    && [...line.matchAll(MONEY)].length === 1;
}

export interface PaidReturnedUnit {
  originalLabel: string;
  ownText: string;
  /** Literal following physical context; its relation to the price is unresolved and held. */
  followingContext: string | null;
  heading: string | null;
  amount: number;
  frequency: "per_item" | null;
  lineStart: number;
  lineEnd: number;
  unitKey: string;
  audience: "consumer" | "business" | "unknown";
  eligibility: "admit" | "hold";
  events: Array<{ action: "paid" | "returned"; canonicalKey: "overdraft" | "nsf"; name: string; lineShare: string }>;
}

function scopeHeader(line: string): boolean {
  return line.length <= 160 && SCOPE.test(line) && !/\$|\d\s*%|\b(?:no charge|free)\b/i.test(line)
    && !START.test(line) && !SEPARATE_EVENT.test(cleanLabel(line))
    && !/\b(?:stop payment|deposited item|origination|transfer)\b/i.test(line);
}

function headerAt(lines: string[], at: number): { text: string | null; index: number } {
  for (let i = at - 1; i >= 0; i--) {
    const line = flat(lines[i]);
    if (scopeHeader(line)) return { text: line, index: i };
  }
  return { text: null, index: -1 };
}

type HeadingAudience = "consumer" | "business" | null;

/**
 * Only a heading that opens with one audience names that audience. A mixed heading ("Personal and
 * Business Checking Fees") or one that only mentions the word ("Fees are assessed each business
 * day", "Business Day Account Fees") is not another audience's section.
 */
function headingAudience(line: string | null): HeadingAudience {
  if (!line) return null;
  const business = /\b(?:business|commercial)\b/i.test(line), consumer = /\b(?:consumer|personal)\b/i.test(line);
  if (business && consumer) return null;
  if (/^(?:business|commercial)\b/i.test(line) && !/^business\s+days?\b/i.test(line)) return "business";
  return /^(?:consumer|personal)\b/i.test(line) ? "consumer" : null;
}

/**
 * A heading that keeps the audience ("Service Fees", "Other Fees") does not end the reach of a
 * separate overdraft or item price: it can still price the same accounts. Only a heading for
 * another audience bounds the contradiction scan.
 */
function audienceBoundary(line: string, audience: HeadingAudience): boolean {
  if (!scopeHeader(line)) return false;
  const other = headingAudience(line);
  return other !== null && other !== audience;
}

/** No bounded prefix can certify the absence of another price farther down the same audience. */
function sectionEnd(lines: string[], end: number, heading: number, audience: HeadingAudience): number | null {
  for (let i = end + 1; i < lines.length; i++) {
    if (i - heading > MAX_SECTION_LINES) return null;
    if (audienceBoundary(flat(lines[i]), audience)) return i;
  }
  return lines.length - heading <= MAX_SECTION_LINES ? lines.length : null;
}

/** The same audience reaches back past headings that keep it, within the same budget. */
function sectionStart(lines: string[], at: number, audience: HeadingAudience): number | null {
  for (let i = at - 1; i >= 0; i--) {
    if (at - i > MAX_SECTION_LINES) return null;
    if (audienceBoundary(flat(lines[i]), audience)) return i;
  }
  return at <= MAX_SECTION_LINES ? -1 : null;
}

/** Another separately priced event is contradictory ownership, even at the same dollar value. */
function separateEvent(lines: string[], start: number, end: number, from: number, boundary: number): boolean {
  for (let i = from + 1; i < boundary; i++) {
    if (i >= start && i <= end) continue;
    for (let last = i; last <= Math.min(i + 2, boundary - 1); last++) {
      if (last >= start && last <= end) break;
      if (last > i && (!lines[last].trim() || scopeHeader(flat(lines[last])))) break;
      const row = flat(lines.slice(i, last + 1).join(" "));
      const price = /\$\s*\d/.exec(row);
      if (!price) continue;
      const label = cleanLabel(row.slice(0, price.index));
      // Another compressed paid/returned row is a repeated owner, held by the unit count, not here.
      if (SEPARATE_EVENT.test(label)
        || (!lines.slice(i, last + 1).some(line => START.test(line))
          && SEPARATE_TOKEN.test(label) && !OTHER_SERVICE.test(chargeName(label)))) return true;
      break;
    }
  }
  return false;
}

/**
 * Only a complete literal own row supplies two events. Unknown applicability remains held;
 * another row/column, a repeated owner or a different event price cannot supply the proof.
 */
export function paidReturnedUnits(text: string): PaidReturnedUnit[] {
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES || !COMPRESSED_TEXT.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const units: PaidReturnedUnit[] = [];
  for (let at = 0; at < lines.length; at++) {
    if (!START.test(lines[at])) continue;
    for (let end = at; end <= Math.min(at + 2, lines.length - 1); end++) {
      if (end > at && (!lines[end].trim() || /^[•●▪‣*-]\s/.test(lines[end].trim()) || scopeHeader(flat(lines[end])))) break;
      const ownText = flat(lines.slice(at, end + 1).join(" "));
      if (ownText.length > MAX_UNIT_CHARS) break;
      const prices = [...ownText.matchAll(MONEY)];
      if (prices.length === 0) continue;
      if (prices.length !== 1) break;
      const price = prices[0];
      const label = cleanLabel(ownText.slice(0, price.index));
      const labelMatch = LABEL.exec(label);
      const tail = ownText.slice(price.index! + price[0].length);
      if (!labelMatch || !TAIL.test(tail)) break;
      const continuation = lines[end + 1]?.trim() ?? "";
      if (/^(?:per\s+(?:presentment|item)|each)\s*[.]?$/i.test(continuation)) {
        // An explicit wrapped charging unit belongs to the price, without borrowing a cap.
        if (end < at + 2) continue;
        break;
      }
      let ownedEnd = end, uncertainContinuation = false, incomplete = false;
      while (ownedEnd + 1 < lines.length && lines[ownedEnd + 1].trim()
        && !nextPricedRow(lines[ownedEnd + 1].trim())) {
        // An arbitrary following line may qualify the charge. Preserve the whole bounded
        // physical context and hold it; headings, bullets and numeric caps are not silently
        // treated as permission to drop that context. Over-budget context is unavailable.
        if (ownedEnd + 1 > at + 2) { incomplete = true; break; }
        ownedEnd++;
        if (flat(lines.slice(at, ownedEnd + 1).join(" ")).length > MAX_UNIT_CHARS) { incomplete = true; break; }
        uncertainContinuation = true;
      }
      if (incomplete) break;
      const followingContext = uncertainContinuation ? lines.slice(end + 1, ownedEnd + 1).join("\n") : null;
      const amount = Number(price[1].replace(/,/g, ""));
      if (!(amount > 0) || !Number.isFinite(amount)) break;
      const heading = headerAt(lines, at);
      const ownAudience = headingAudience(heading.text);
      const from = sectionStart(lines, at, ownAudience);
      const boundary = sectionEnd(lines, ownedEnd, heading.index, ownAudience);
      if (from === null || boundary === null || separateEvent(lines, at, end, from, boundary)) break;
      const interveningOwner = lines.slice(heading.index + 1, at).some(line => {
        const text = flat(line);
        return text && !/\$|\b(?:free|no charge)\b/i.test(text);
      });
      const audience = heading.text && CONSUMER.test(heading.text) && !interveningOwner
        ? "consumer" : heading.text && /^business\b/i.test(heading.text) ? "business" : "unknown";
      const unitKey = createHash("sha256").update(JSON.stringify([label, ownText, followingContext, heading.text, at, ownedEnd])).digest("hex").slice(0, 24);
      const base = labelMatch[1];
      units.push({ originalLabel: label, ownText, followingContext, heading: heading.text, amount,
        frequency: /\b(?:per\s+(?:presentment|item)|each)\b/i.test(tail) ? "per_item" : null,
        lineStart: at, lineEnd: ownedEnd, unitKey, audience,
        eligibility: audience === "consumer" && !uncertainContinuation ? "admit" : "hold",
        events: [
          { action: "paid", canonicalKey: "overdraft", name: `${base} - Paid`, lineShare: `${KEY_PREFIX}${unitKey}:paid` },
          { action: "returned", canonicalKey: "nsf", name: `${base} - Returned`, lineShare: `${KEY_PREFIX}${unitKey}:returned` },
        ] });
      at = ownedEnd;
      break;
    }
  }
  // This proof format has no multi-owner table contract. Repeated event units, including
  // unequal prices or reversed action order, cannot establish a single applicable price.
  if (units.length > 1) for (const unit of units) unit.eligibility = "hold";
  return units;
}

export function isPaidReturnedCandidate(name: string, lineShare?: string | null): boolean {
  return PROJECTED.test(flat(name)) || LABEL.test(cleanLabel(name)) || Boolean(lineShare?.startsWith(KEY_PREFIX));
}

export const hasCompressedPaidReturnedText = (text: string): boolean => COMPRESSED_TEXT.test(text);

/** A caller claim identifies a candidate only; the complete source is recomputed before any write. */
export function paidReturnedCandidateProof(text: string, name: string, amount: number, canonicalKey: string, lineShare?: string | null) {
  const units = paidReturnedUnits(text);
  const matches = units.flatMap(unit => unit.events.filter(event => event.name.toLowerCase() === flat(name).toLowerCase()
    && event.canonicalKey === canonicalKey && unit.amount === amount && (!lineShare || event.lineShare === lineShare))
    .map(event => ({ unit, event })));
  return matches.length === 1 ? matches[0] : null;
}

export function belongsToPaidReturnedUnit(unit: PaidReturnedUnit, name: string, amount: number, excerpt: string): boolean {
  return amount === unit.amount && (flat(name).toLowerCase() === unit.originalLabel.toLowerCase()
    || (flat(excerpt) === unit.ownText && unit.ownText.toLowerCase().includes(flat(name).toLowerCase())));
}
