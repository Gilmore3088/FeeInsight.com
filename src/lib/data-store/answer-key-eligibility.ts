import { createHash } from "node:crypto";
import { documentKind } from "@/lib/agents/learning/document-kind";
import { scoreFeePage } from "@/lib/agents/learning/fee-page";
import { isBusinessOnlyLink, isBusinessOnlyText } from "@/lib/agents/magellan/link-coverage";
import { effectiveDate, scheduleAudience } from "@/lib/agents/hamilton/schedule-edition";
import { LEGACY_SCOPE } from "@/lib/custom-report/discontinued-rows";

/** Reference-document eligibility is separate from both human confirmation and scorer v3. */
export const ANSWER_KEY_ELIGIBILITY_PROTOCOL = 1;
export const ANSWER_KEY_ELIGIBILITY_EVENT = "answer_key.eligibility";
export const ANSWER_KEY_ELIGIBILITY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export interface ReferenceFeeSnapshot {
  id: number;
  canonicalKey: string;
  amount: number | null;
  amountKind: string;
  frequency: string | null;
  conditions: string | null;
  sourceLine: string | null;
  uncertain: boolean;
  status: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface ReferenceKeySnapshot {
  answerKeyId: number;
  institutionId: number;
  institutionName: string;
  websiteUrl: string | null;
  institutionFeeScheduleUrl: string | null;
  documentUrl: string;
  documentType: string;
  contentHash: string | null;
  status: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Exact confirmed rows, including out-of-scope rows; the scorer separately skips unmapped. */
  fees: ReferenceFeeSnapshot[];
}

export interface ReferenceSourceIdentity {
  id: number;
  documentUrl: string | null;
  contentHash: string | null;
  status: string;
  supersededById: number | null;
  duplicateOfId: number | null;
  textId: number | null;
  textHash: string | null;
  textStatus: string | null;
  documentKind: string | null;
}

export type ReferenceEligibilityStatus = "eligible" | "rejected" | "unknown";
export interface ReferenceEligibilityFact {
  status: "pass" | "fail" | "unknown";
  reasons: string[];
}

export interface ReferencePageObservation {
  requestedUrl: string;
  finalUrl: string;
  contentHash: string;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  checkedAt: string;
  effectiveDate: string | null;
  sourceDocumentId: number | null;
  sourceTextId: number | null;
  textHash: string | null;
  status: number;
  /** Runtime-only classification input. Persist bounded facts, not whole fetched documents. */
  text: string;
  links: string[];
}

export interface ReferenceDiscoveryEvidence {
  entryUrls: string[];
  examinedUrls: string[];
  candidateUrls: string[];
  completeWithinProtocol: boolean;
  limitReason: string | null;
  /** Same-site hubs queued but not visited under the page cap; a receipt shows what went unseen. */
  skippedHubCount?: number;
  /** At least one followed path starts on the recorded official institution website. */
  linkedFromOfficialSite: boolean;
}

export interface ReferenceEligibilityReceipt {
  protocol: number;
  answerKeyId: number;
  institutionId: number;
  keyFingerprint: string;
  sourceInventoryFingerprint: string;
  checkedAt: string;
  expiresAt: string;
  status: ReferenceEligibilityStatus;
  facts: { consumer: ReferenceEligibilityFact; current: ReferenceEligibilityFact; priced: ReferenceEligibilityFact };
  reasons: string[];
  observations: Array<Omit<ReferencePageObservation, "text"> & { excerpt: string }>;
  discovery: ReferenceDiscoveryEvidence;
}

export interface ReferenceScoreCohort {
  readError: boolean;
  protocol: number;
  state: "measured" | "no_measurement";
  checkedAt: string;
  frameFingerprint: string;
  cohortFingerprint: string;
  confirmedBanks: number;
  eligibleBanks: number;
  excludedBanks: number;
  confirmedFees: number;
  eligibleFees: number;
  excludedFees: number;
  receiptIds: number[];
  byReason: Record<string, number>;
}

const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** No fuzzy matching or scorer amount tolerance at an authorization/measurement boundary. */
export function referenceKeyFingerprint(key: ReferenceKeySnapshot): string {
  return digest([
    `answer-key-reference@${ANSWER_KEY_ELIGIBILITY_PROTOCOL}`, key.answerKeyId, key.institutionId,
    key.institutionName, key.websiteUrl, key.institutionFeeScheduleUrl,
    key.documentUrl, key.documentType, key.contentHash, key.status, key.confirmedBy, key.confirmedAt,
    [...key.fees].sort((a, b) => a.id - b.id).map((fee) => [
      fee.id, fee.canonicalKey, fee.amount, fee.amountKind, fee.frequency, fee.conditions,
      fee.sourceLine, fee.uncertain, fee.status, fee.confirmedBy, fee.confirmedAt,
    ]),
  ]);
}

export function referenceSourceFingerprint(sources: ReferenceSourceIdentity[]): string {
  return digest([...sources].sort((a, b) => a.id - b.id).map((source) => [
    source.id, source.documentUrl, source.contentHash, source.status, source.supersededById,
    source.duplicateOfId, source.textId, source.textHash, source.textStatus, source.documentKind,
  ]));
}

const fact = (status: ReferenceEligibilityFact["status"], reason: string): ReferenceEligibilityFact => ({ status, reasons: [reason] });
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
  ndash: "-", mdash: "-", hellip: "...", middot: " ", bull: " ", reg: "®", trade: "™", copy: "©", dollar: "$", cent: "¢",
};
/**
 * Key lines and page text are compared as fee content only (#2466): HTML entities decoded, table
 * cell separators, dot leaders, bullets and all whitespace dropped, curly quotes and dashes unified.
 * A key line copied from a stored table ("NSF Fee | $25.00 per item") is the same words and prices
 * as the bank's own cells; nothing is fuzzy, every character of the content must still match, and
 * digits split by a break or separator never join into another number.
 */
const codePoint = (value: number, entity: string): string => (value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity);
const compact = (text: string): string => text
  .replace(/&#x([0-9a-f]{1,6});/gi, (entity, hex: string) => codePoint(Number.parseInt(hex, 16), entity))
  .replace(/&#(\d{1,7});/g, (entity, dec: string) => codePoint(Number(dec), entity))
  .replace(/&([a-z]+);/gi, (entity, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity)
  .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, "-")
  .replace(/\.(?:\s*\.){2,}|…/g, " ")
  .replace(/[|│┃•·▪◦]/g, " ")
  // A break between two digits stays a break, so "$2" then "5 or more" never reads as "$25".
  .replace(/(\d)\s+(?=\d)/g, "$1\u0000")
  .replace(/\s+/g, "");
const CONSUMER = /\b(?:consumer|personal|individual|retail)\b/i;
export function audienceHeading(line: string, audience: "consumer" | "business"): boolean {
  const title = line.trim().replace(/\s+/g, " ").replace(/:$/, "");
  if (title.length > 120 || /[.$!?;0-9]/.test(title)) return false;
  const words = audience === "consumer" ? "consumer|personal|individual|retail" : "business|commercial|corporate|treasury";
  // A heading starts with the audience and contains only document/section words.
  // Incidental service prose ("personal assistance with business account fees")
  // and navigation labels cannot become positive consumer attestations.
  return new RegExp(`^(?:${words})(?: (?:banking|deposit|account|accounts|service|services|fee|fees|schedule|of|and|&|charges|disclosure|disclosures|listing|for|members)){1,10}$`, "i").test(title)
    && /\b(?:fees?|schedule|charges|accounts?)\b/i.test(title);
}
/** A short line that opens with a business audience word ("Business Checking", "Commercial Accounts"). */
const BUSINESS_SECTION = /^(?:small business|business|commercial|corporate|treasury|cash management|account analysis|merchant services|non[- ]?personal|organi[sz]ation(?:al)?)\b(?! days?\b)[^$0-9.!?;]{0,60}$/i;
/** Leading bullets and markdown markers ("• Business Checking", "## Business") are not part of a label. */
const businessSectionLine = (line: string): boolean => BUSINESS_SECTION.test(line.trim().replace(/^(?:[-*•·▪◦#>]+\s*|\d+[.)]\s+)+/, ""));
// Shared with the source check's discontinued-row refusal (#2070).
const LEGACY = LEGACY_SCOPE;

/** A positive audience attestation requires the key's own lines in consumer scope. */
function consumerFact(key: ReferenceKeySnapshot, page: ReferencePageObservation): ReferenceEligibilityFact {
  if (!key.fees.some((fee) => fee.status === "confirmed" && fee.canonicalKey !== "unmapped")) {
    return fact("unknown", "reference_fees_missing");
  }
  const text = page.text;
  const lines = text.split(/\r?\n/);
  const consumerHeading = lines.some((line) => audienceHeading(line, "consumer"));
  const businessHeading = lines.some((line) => audienceHeading(line, "business"));
  if (!consumerHeading && (isBusinessOnlyLink(page.finalUrl) || isBusinessOnlyText(text)
    || /\bBusiness Account Disclosures\b/i.test(text) || businessHeading)) {
    return fact("fail", "business_document");
  }
  if (consumerHeading && isBusinessOnlyLink(page.finalUrl) && !businessHeading) return fact("unknown", "business_url_consumer_scope_conflict");
  if (key.fees.some((fee) => fee.status === "confirmed" && fee.canonicalKey !== "unmapped" && !compact(fee.sourceLine ?? ""))) {
    return fact("unknown", "key_line_scope_missing");
  }
  const observedText = compact(text);
  if (key.fees.some((fee) => fee.canonicalKey !== "unmapped" && !observedText.includes(compact(fee.sourceLine ?? "")))) {
    return fact("unknown", "key_line_not_in_reference");
  }
  // Only a combined schedule needs a consumer heading to separate its sections (#2466).
  // A schedule with no audience heading, no business evidence and every key line present
  // is the consumer reference; a bare business section label still leaves scope unproven.
  if (!consumerHeading) {
    return lines.some(businessSectionLine)
      ? fact("unknown", "consumer_scope_unproven")
      : fact("pass", "consumer_reference_lines_no_business_evidence");
  }
  // Combined schedules are eligible only for reference lines in their consumer section.
  // A business heading switches scope; navigation words do not attest either scope.
  if (businessHeading) {
    let audience: "consumer" | "business" | null = null;
    const consumer: string[] = [];
    const business: string[] = [];
    for (const line of lines) {
      if (audienceHeading(line, "consumer")) audience = "consumer";
      else if (audienceHeading(line, "business")) audience = "business";
      if (audience === "consumer") consumer.push(line);
      if (audience === "business") business.push(line);
    }
    const consumerText = compact(consumer.join(" "));
    const businessText = compact(business.join(" "));
    for (const fee of key.fees.filter((row) => row.canonicalKey !== "unmapped")) {
      const line = compact(fee.sourceLine ?? "");
      if (!line || !consumerText.includes(line)) return fact("unknown", "key_line_consumer_scope_unproven");
      if (businessText.includes(line)) return fact("unknown", "key_line_audience_ambiguous");
    }
  } else if (!CONSUMER.test(text.slice(0, 6_000))) {
    return fact("unknown", "consumer_scope_unproven");
  }
  return fact("pass", "consumer_reference_lines");
}

function pricedFact(page: ReferencePageObservation): ReferenceEligibilityFact {
  const score = scoreFeePage(page.text, page.finalUrl, { feeSchedule: true });
  const kind = documentKind({ text: page.text, url: page.finalUrl, feeSchedule: true });
  // A title, APY or balance amount cannot authorize a reference schedule on its own.
  if (score.feeLines === 0 || kind.kind === "account_agreement" || kind.kind === "product_page"
    || (score.verdict === "wrong_document" && kind.kind !== "fee_schedule")) {
    return fact("fail", "not_priced_schedule");
  }
  if (score.verdict !== "fee_page" || kind.kind !== "fee_schedule") return fact("unknown", "priced_schedule_unproven");
  return fact("pass", "priced_fee_schedule");
}

function urlKey(value: string): string | null {
  try { const url = new URL(value); url.hash = ""; return url.href; } catch { return null; }
}

/** HTML only when every signal agrees; PDFs and plain text stay byte-bound. */
function htmlReference(key: ReferenceKeySnapshot, page: ReferencePageObservation): boolean {
  return /html/i.test(page.contentType ?? "") && !/pdf/i.test(`${page.contentType} ${key.documentType}`)
    && !/\.pdf(?:[?#]|$)/i.test(page.finalUrl);
}

/**
 * An HTML page's bytes change on every fetch (scripts, tokens, timestamps), so it is bound to
 * its extracted main text instead (#2466): the key's hash names these bytes or this main text,
 * or every mapped confirmed key line is in the observed main text.
 */
function htmlReferenceBound(key: ReferenceKeySnapshot, keyHash: string | null, page: ReferencePageObservation,
  sources: ReferenceSourceIdentity[]): boolean {
  const textHash = page.textHash?.toLowerCase() ?? null;
  if (keyHash && (keyHash === page.contentHash.toLowerCase() || keyHash === textHash
    || (textHash && sources.some((source) => source.contentHash?.toLowerCase() === keyHash && source.textHash?.toLowerCase() === textHash)))) {
    return true;
  }
  const mapped = key.fees.filter((fee) => fee.status === "confirmed" && fee.canonicalKey !== "unmapped");
  const observedText = compact(page.text);
  if (!(mapped.length > 0 && mapped.every((fee) => !!compact(fee.sourceLine ?? "") && observedText.includes(compact(fee.sourceLine ?? ""))))) return false;
  // Key lines alone cannot pin an edition: a page dated after the key was confirmed may add
  // fees the key never saw, so it is not the confirmed reference.
  const edition = effectiveDate(page.text);
  if (!key.confirmedAt) return false;
  return !(edition && edition > key.confirmedAt.slice(0, 10));
}

function currentFact(key: ReferenceKeySnapshot, page: ReferencePageObservation | undefined,
  pages: ReferencePageObservation[], discovery: ReferenceDiscoveryEvidence, asOf: string, sources: ReferenceSourceIdentity[]): ReferenceEligibilityFact {
  if (!page || page.status !== 200 || !page.text.trim()) return fact("unknown", "reference_unreadable");
  if (LEGACY.test(page.text)) return fact("fail", "legacy_not_current");
  const keyHash = key.contentHash && /^[a-f0-9]{64}$/i.test(key.contentHash) ? key.contentHash.toLowerCase() : null;
  if (!htmlReference(key, page)) {
    if (!keyHash) return fact("unknown", "reference_hash_missing");
    if (keyHash !== page.contentHash.toLowerCase()) return fact("unknown", "reference_bytes_changed");
  } else if (!htmlReferenceBound(key, keyHash, page, sources)) {
    return fact("unknown", "reference_main_text_changed");
  }
  // A fresh bounded link observation cannot erase an explicit stored supersession
  // of these exact key bytes. Duplicate pointers or status alone do not prove it.
  if (keyHash && sources.some((source) => source.contentHash?.toLowerCase() === keyHash && source.supersededById != null)) {
    return fact("unknown", "reference_source_superseded");
  }
  const date = effectiveDate(page.text);
  const today = asOf.slice(0, 10);
  if (date && date > today) return fact("fail", "reference_not_yet_effective");
  for (const candidate of pages) {
    if (candidate === page || candidate.contentHash === page.contentHash) continue;
    if (!discovery.candidateUrls.some((url) => urlKey(url) === urlKey(candidate.requestedUrl))) continue;
    if (candidate.status !== 200 || !candidate.text.trim()) return fact("unknown", "candidate_unreadable");
    if (isBusinessOnlyLink(candidate.finalUrl) || isBusinessOnlyText(candidate.text)) continue;
    if (pricedFact(candidate).status !== "pass") return fact("unknown", "candidate_classification_unknown");
    const newer = effectiveDate(candidate.text);
    if (newer && newer <= today && date && newer > date) return fact("fail", "newer_consumer_schedule");
    if (newer && newer > today) continue;
    // Different same-audience schedules without ordering are an applicability conflict.
    if (scheduleAudience(candidate.finalUrl) !== "business" && !LEGACY.test(candidate.text)) {
      return fact("unknown", "current_schedule_conflict");
    }
  }
  if (!discovery.completeWithinProtocol || discovery.limitReason) return fact("unknown", "official_discovery_incomplete");
  if (!discovery.linkedFromOfficialSite) return fact("unknown", "official_current_link_unproven");
  if (discovery.candidateUrls.some((url) => !pages.some((candidate) => urlKey(candidate.requestedUrl) === urlKey(url)))) {
    return fact("unknown", "candidate_unreadable");
  }
  return fact("pass", "current_within_recorded_observation");
}

/** Pure decision. Its result is diagnostic until a real run persists and rereads it. */
export function evaluateReferenceEligibility(input: {
  key: ReferenceKeySnapshot;
  sources: ReferenceSourceIdentity[];
  pages: ReferencePageObservation[];
  discovery: ReferenceDiscoveryEvidence;
  asOf: string;
}): ReferenceEligibilityReceipt {
  const { key, sources, pages, discovery, asOf } = input;
  const page = pages.find((candidate) => urlKey(candidate.requestedUrl) === urlKey(key.documentUrl));
  const facts = {
    consumer: page?.status === 200 && page.text.trim() ? consumerFact(key, page) : fact("unknown", "reference_unreadable"),
    current: currentFact(key, page, pages, discovery, asOf, sources),
    priced: page?.status === 200 && page.text.trim() ? pricedFact(page) : fact("unknown", "reference_unreadable"),
  };
  const values = Object.values(facts);
  const status = key.status !== "confirmed" ? "unknown"
    : values.some((value) => value.status === "fail") ? "rejected"
      : values.every((value) => value.status === "pass") ? "eligible" : "unknown";
  return {
    protocol: ANSWER_KEY_ELIGIBILITY_PROTOCOL, answerKeyId: key.answerKeyId, institutionId: key.institutionId,
    keyFingerprint: referenceKeyFingerprint(key), sourceInventoryFingerprint: referenceSourceFingerprint(sources),
    checkedAt: asOf, expiresAt: new Date(Date.parse(asOf) + ANSWER_KEY_ELIGIBILITY_MAX_AGE_MS).toISOString(),
    status, facts, reasons: [...new Set(values.flatMap((value) => value.reasons))],
    observations: pages.map(({ text, ...observation }) => ({ ...observation, excerpt: text.slice(0, 500) })),
    discovery,
  };
}
