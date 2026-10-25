import { createHash } from "node:crypto";
import { checkFeeAgainstSource, sourceLines } from "@/lib/custom-report/source-check";
import { LEGACY_SCOPE } from "@/lib/custom-report/discontinued-rows";
import { checkFeeCategory, CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { frequencyFromLine, frequencyFamily } from "@/lib/fee-frequency";
import { productKey } from "@/lib/fee-product";
import { audienceHeading } from "@/lib/data-store/answer-key-eligibility";
import { primaryAncillaryProduct } from "@/lib/agents/knox/ancillary-product";
import { documentKind } from "@/lib/agents/learning/document-kind";
import { effectiveDate } from "@/lib/agents/hamilton/schedule-edition";
import { isBusinessOnlyLink, isBusinessOnlyText } from "@/lib/agents/magellan/link-coverage";
import { unconfirmedDocumentHost } from "@/lib/agents/magellan/other-bank-host";
import { SOURCE_CHECK_STRATEGY } from "@/lib/agents/hamilton/source-check";
import { NAME_RETIDY_STRATEGY } from "@/lib/agents/knox/name-retidy";
import { nameQuality,FRESH_AUDIT_VERSION } from "./fresh-audit";

/** A live-source support diagnostic. Never the weekly whole-institution launch measure. */
export const LIVE_SOURCE_AUDIT_PROTOCOL = 1;
export const LIVE_SOURCE_AUDIT_SERIES = `live-source@1:frame1:authority1:report1:source${SOURCE_CHECK_STRATEGY.version}:category${CATEGORY_GUARD_VERSION}:name${NAME_RETIDY_STRATEGY.version}:audit${FRESH_AUDIT_VERSION}`;
export const LIVE_SOURCE_AUDIT = {
  sample: 500, population: 250_000, rowBytes: 8 * 1024, policyBytes: 32 * 1024,
  policiesBytes: 2 * 1024 * 1024, drawBytes: 8 * 1024 * 1024, graphBytes: 32 * 1024,
  graphsBytes: 4 * 1024 * 1024, eventBytes: 512 * 1024, archiveBytes: 128 * 1024,
  urlBytes: 2048, pages: 6, links: 160, storedDocuments: 256,
  windowMs: 24 * 60 * 60 * 1000, workMs: 110_000, settleMs: 10_000, stepMs: 150_000,
  requestMs: 8_000, responseBytes: 8 * 1024 * 1024, textChars: 1_000_000,
  workers: 3, groupsPerChunk: 12, leaseMs: 150_000,
  captureAttempts: 3, captureCooldownMs: 24 * 60 * 60 * 1000, captureEpisodesPerWeek: 3,
  retentionGraceMs: 7 * 24 * 60 * 60 * 1000,
} as const;
export const LIVE_AUDIT_EVENTS = {
  draw: "live_fee_audit.draw", claim: "live_fee_audit.claim", chunk: "live_fee_audit.chunk",
  final: "live_fee_audit.final", archived: "live_fee_audit.archived", unavailable: "live_fee_audit.provenance_unavailable",
  capture: "live_fee_audit.capture_requested", captureClaim: "live_fee_audit.capture_claim",
  disposition: "live_fee_audit.capture_disposition",
} as const;
export const LIVE_AUDIT_STEPS = { draw: "deming-live-source-draw", observe: "deming-live-source-audit", capture: "magellan-live-audit-capture", archive: "deming-live-source-archive" } as const;
export const LIVE_AUDIT_SOURCE = "deming.live_source_audit";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type LiveAuditCatalogRow = Record<string, Json> & {
  id: number; fee_published_id: number; fee_verified_id: number; fee_raw_id: number; institution_id: number;
  canonical_fee_key: string; fee_name: string; amount: number; amount_kind: string;
  account_product_type: string | null; frequency: string | null; conditions: string | null;
  fee_audience: string | null; waiver_text: string | null; rate_basis: string | null;
};
export interface LiveAuditSourceIdentity {
  id: number; institutionId:number; url: string | null; contentHash: string | null; r2Key: string | null;
  status: string; supersededById: number | null;
}
export interface LiveAuditFee {
  id: number; institutionId: number; catalog: LiveAuditCatalogRow;
  source: LiveAuditSourceIdentity; lineShare: string | null; fingerprint: string;
}
export interface LiveAuditPolicy {
  institutionId: number; websiteUrl: string | null; feeScheduleUrl: string | null;
  canonicalSourceUrl: string | null; sourceKind: string | null; readStrategy: string | null;
  correctionVersion: number | null; lockedByCorrection: boolean | null;
  lastSourceHash: string | null; lastSuccessfulSourceDocumentId: number | null;
  doNotRetry: Json; rejectedSourceUrls: Json;
}
export interface LiveAuditGroup {
  institutionId: number; policy: LiveAuditPolicy; policyFingerprint: string; feeIds: number[];
  sources: LiveAuditSourceIdentity[];
}
export interface LiveAuditDraw {
  protocol: number; series: string; day: string; seed: string; asOf: string; deadline: string;
  state: "ready" | "unavailable"; reason: string | null; populationCount: number | null;
  populationIds: number[]; frameFingerprint: string; rows: LiveAuditFee[]; groups: LiveAuditGroup[];
}
export interface LiveAuditLink { url: string; label: string }
export interface LiveAuditPage {
  requestedUrl: string; finalUrl: string; contentHash: string; textHash: string; checkedAt: string;
  contentType: string | null; etag: string | null; lastModified: string | null; status: number;
  effectiveDate: string | null; text: string; links: LiveAuditLink[];
}
export interface LiveAuditGraph {
  entryUrl: string | null; pages: LiveAuditPage[]; candidateUrls: string[];
  complete: boolean; reason: string | null;
}
export interface LiveAuditObservation {
  feeId: number; fingerprint: string; status: "supported" | "mismatch" | "unknown";
  reason: string; dimensions: string[]; observedAt: string; expiresAt: string;
  requestedUrl: string | null; finalUrl: string | null; contentHash: string | null;
  textHash: string | null; sourceLine: string | null; graphHash: string | null;
}

export const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const auditHash = (value: unknown): string => createHash("sha256").update(boundedAuditJson(value, LIVE_SOURCE_AUDIT.drawBytes)).digest("hex");
/** Matches PostgreSQL encode(sha256(convert_to(domain||':'||seed||':'||id,'UTF8')),'hex'). */
export const liveAuditOrderKey = (domain: "selection" | "group-order", seed: string, id: number) => createHash("sha256").update(`${domain}:${seed}:${id}`).digest("hex");
const compact = (value: string) => value.replace(/\s+/g, " ").trim();

/** Count escaped UTF-8 before allocating the final JSON string. No clipped trusted payloads. */
export function boundedAuditJson(value: unknown, limit: number): string {
  let size = 0;
  const add = (n: number) => { size += n; if (size > limit) throw new Error("live_audit_payload_limit"); };
  const string = (s: string) => {
    add(2);
    for (const char of s) add(char === '"' || char === "\\" ? 2 : char.charCodeAt(0) < 32
      || (char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff) ? 6 : Buffer.byteLength(char));
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 24) throw new Error("live_audit_payload_depth");
    if (v === null) { add(4); return null; }
    if (typeof v === "string") { string(v); return v; }
    if (typeof v === "number" && Number.isFinite(v)) { add(String(v).length); return v; }
    if (typeof v === "boolean") { add(v ? 4 : 5); return v; }
    if (Array.isArray(v)) { add(2 + Math.max(0, v.length - 1)); return v.map((item) => walk(item, depth + 1)); }
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      const keys = Object.keys(v).sort(); add(2 + Math.max(0, keys.length - 1));
      return Object.fromEntries(keys.map((key) => { string(key); add(1); return [key, walk((v as Record<string, unknown>)[key], depth + 1)]; }));
    }
    throw new Error("live_audit_payload_type");
  };
  const text = JSON.stringify(walk(value, 0));
  if (Buffer.byteLength(text) > limit) throw new Error("live_audit_payload_limit");
  return text;
}

export function freezeLiveAuditFee(catalog: LiveAuditCatalogRow, source: LiveAuditSourceIdentity, lineShare: string | null): LiveAuditFee {
  if (![catalog.id, catalog.fee_published_id, catalog.fee_verified_id, catalog.fee_raw_id, catalog.institution_id, source.id,source.institutionId].every(positiveId)
    ||source.institutionId!==catalog.institution_id||catalog.source_document_id!==source.id) throw new Error("live_audit_identity_missing");
  const payload = { catalog, source, lineShare };
  boundedAuditJson(payload, LIVE_SOURCE_AUDIT.rowBytes);
  return { id: catalog.id, institutionId: catalog.institution_id, ...payload, fingerprint: auditHash(payload) };
}

export function liveAuditPolicyFingerprint(policy: LiveAuditPolicy): string {
  boundedAuditJson(policy, LIVE_SOURCE_AUDIT.policyBytes);
  if (!positiveId(policy.institutionId)) throw new Error("live_audit_policy_identity");
  for (const url of [policy.websiteUrl, policy.feeScheduleUrl, policy.canonicalSourceUrl]) if (url && Buffer.byteLength(url) > LIVE_SOURCE_AUDIT.urlBytes) throw new Error("live_audit_url_limit");
  return auditHash(policy);
}

/** Producer supplies cryptographic randomness; domains separate row selection and group order. */
export function makeLiveAuditDraw(input: {
  day: string; asOf: string; seed: string; populationIds: number[];
  rows: LiveAuditFee[]; groups: LiveAuditGroup[]; unavailableReason?: string;
}): LiveAuditDraw {
  const { day, seed } = input;
  const asOf=Number.isFinite(Date.parse(input.asOf))?input.asOf:"1970-01-01T00:00:00.000Z";
  const unavailable = (reason: string): LiveAuditDraw => ({ protocol: 1, series: LIVE_SOURCE_AUDIT_SERIES, day, asOf, seed,
    deadline: new Date(Date.parse(asOf) + LIVE_SOURCE_AUDIT.windowMs).toISOString(), state: "unavailable", reason,
    populationCount: null, populationIds: [], frameFingerprint: auditHash([day, reason]), rows: [], groups: [] });
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(input.asOf)) || !/^[a-f0-9]{64}$/.test(seed)) throw new Error("live_audit_draw_identity");
    if (input.unavailableReason) return unavailable(input.unavailableReason);
    if (input.populationIds.length > LIVE_SOURCE_AUDIT.population) return unavailable("population_cap");
    if (!input.populationIds.every(positiveId) || new Set(input.populationIds).size !== input.populationIds.length) return unavailable("population_identity");
    const populationIds = [...input.populationIds].sort((a, b) => a - b);
    const selected = populationIds.map((id) => ({ id, key: liveAuditOrderKey("selection", seed, id) }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.id - b.id).slice(0, LIVE_SOURCE_AUDIT.sample).map((row) => row.id);
    if (input.rows.length !== selected.length || new Set(input.rows.map((r) => r.id)).size !== selected.length || selected.some((id) => !input.rows.some((r) => r.id === id))) return unavailable("sample_inventory_mismatch");
    const rows = selected.map((id) => input.rows.find((r) => r.id === id)!);
    for (const row of rows) if (freezeLiveAuditFee(row.catalog, row.source, row.lineShare).fingerprint !== row.fingerprint) return unavailable("row_fingerprint");
    if (new Set(input.groups.map((g) => g.institutionId)).size !== input.groups.length) return unavailable("group_identity");
    boundedAuditJson(input.groups.map((g) => g.policy), LIVE_SOURCE_AUDIT.policiesBytes);
    for (const group of input.groups) {
      if (group.policyFingerprint !== liveAuditPolicyFingerprint(group.policy) || group.policy.institutionId !== group.institutionId || group.sources.length > LIVE_SOURCE_AUDIT.storedDocuments) return unavailable("policy_identity_or_cap");
      const own = rows.filter((r) => r.institutionId === group.institutionId).map((r) => r.id).sort((a, b) => a - b);
      if (!own.length||JSON.stringify(own) !== JSON.stringify([...group.feeIds].sort((a, b) => a - b))) return unavailable("group_row_inventory");
    }
    if (rows.some((r) => !input.groups.some((g) => g.institutionId === r.institutionId))) return unavailable("group_missing");
    const groups = input.groups.map((group) => ({ group, key: liveAuditOrderKey("group-order", seed, group.institutionId) }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.group.institutionId - b.group.institutionId).map((row) => row.group);
    const draw: LiveAuditDraw = { protocol: 1, series: LIVE_SOURCE_AUDIT_SERIES, day, asOf, seed,
      deadline: new Date(Date.parse(asOf) + LIVE_SOURCE_AUDIT.windowMs).toISOString(), state: "ready", reason: null,
      populationCount: populationIds.length, populationIds, frameFingerprint: auditHash([LIVE_SOURCE_AUDIT_SERIES, populationIds]), rows, groups };
    boundedAuditJson(draw, LIVE_SOURCE_AUDIT.drawBytes);
    return draw;
  } catch (error) { return unavailable(error instanceof Error ? error.message : "draw_unavailable"); }
}

export function liveAuditUnknown(fee: LiveAuditFee, at: string, reason: string): LiveAuditObservation {
  return { feeId: fee.id, fingerprint: fee.fingerprint, status: "unknown", reason, dimensions: [], observedAt: at,
    expiresAt: new Date(Date.parse(at) + LIVE_SOURCE_AUDIT.windowMs).toISOString(), requestedUrl: null, finalUrl: null,
    contentHash: null, textHash: null, sourceLine: null, graphHash: null };
}

/** The graph is persisted once per institution, without bodies; exact byte/text digests remain. */
export function liveAuditGraphMetadata(graph: LiveAuditGraph): Record<string, unknown> {
  return { ...graph, pages: graph.pages.map(page=>Object.fromEntries(Object.entries(page).filter(([key])=>key!=="text"))) };
}

const urlKey = (value: string) => { try { const url = new URL(value); if (!/^https?:$/.test(url.protocol)) return null; url.hash = ""; return url.href; } catch { return null; } };
/** Actual observed edges only; old row URLs do not create official authority. */
export function liveAuditOfficialUrls(graph: LiveAuditGraph): Set<string> {
  const urls = new Set<string>(); const entry = graph.entryUrl && urlKey(graph.entryUrl); if (entry) urls.add(entry);
  for (let iteration = 0; iteration <= graph.pages.length; iteration += 1) {
    for (const page of graph.pages) if (urls.has(urlKey(page.requestedUrl) ?? "") && page.status === 200) {
      const final = urlKey(page.finalUrl); if (final) urls.add(final);
      for (const link of page.links) { const url = urlKey(link.url); if (url) urls.add(url); }
    }
  }
  return urls;
}

function consumerScope(page: LiveAuditPage, feeName: string, consumerDelegation: boolean): string | null {
  const lines = page.text.split(/\r?\n/); const hasConsumer = lines.some((s) => audienceHeading(s, "consumer"));
  const hasBusiness = lines.some((s) => audienceHeading(s, "business"));
  if (hasBusiness) {
    if (!hasConsumer) return null;
    let scope: "consumer" | "business" | null = null; const consumer: string[] = [], business: string[] = [];
    for (const line of lines) { if (audienceHeading(line, "consumer")) scope = "consumer"; else if (audienceHeading(line, "business")) scope = "business";
      if (scope === "consumer") consumer.push(line); if (scope === "business") business.push(line); }
    if (compact(business.join(" ")).toLowerCase().includes(compact(feeName).toLowerCase())) return null;
    return consumer.join("\n");
  }
  if (isBusinessOnlyLink(page.finalUrl) || isBusinessOnlyText(page.text)) return null;
  return hasConsumer || consumerDelegation ? page.text : null;
}

/** Conservative support: no absent line, changed bytes or shared category can become "wrong". */
export function evaluateLiveAuditFee(fee: LiveAuditFee, group: LiveAuditGroup, graph: LiveAuditGraph, at: string): LiveAuditObservation {
  let witness:LiveAuditPage|null=null;
  const unknown = (reason: string):LiveAuditObservation => ({...liveAuditUnknown(fee, at, reason),
    ...(witness?{requestedUrl:witness.requestedUrl,finalUrl:witness.finalUrl,contentHash:witness.contentHash,
      textHash:witness.textHash,graphHash:auditHash(liveAuditGraphMetadata(graph))}:{})});
  if (!graph.complete || graph.reason) return unknown(graph.reason ?? "official_discovery_incomplete");
  try{boundedAuditJson(liveAuditGraphMetadata(graph),LIVE_SOURCE_AUDIT.graphBytes);}catch{return unknown("graph_limit");}
  if(new Set(graph.pages.flatMap(p=>p.links.map(l=>l.url))).size>LIVE_SOURCE_AUDIT.links)return unknown("graph_limit");
  if (fee.source.institutionId!==fee.institutionId||group.institutionId!==fee.institutionId
    ||!/^[a-f0-9]{64}$/i.test(fee.source.contentHash ?? "") || !group.policy.websiteUrl || !Number.isFinite(fee.catalog.amount) || fee.catalog.amount < 0 || fee.catalog.amount_kind !== "flat") return unknown("identity_or_amount_unproven");
  if (urlKey(graph.entryUrl ?? "") !== urlKey(group.policy.websiteUrl)) return unknown("official_entry_identity_changed");
  if (graph.pages.length > LIVE_SOURCE_AUDIT.pages || graph.pages.some((p) => p.text.length > LIVE_SOURCE_AUDIT.textChars
    || p.links.length > LIVE_SOURCE_AUDIT.links || [p.requestedUrl, p.finalUrl, ...p.links.map((l) => l.url)].some((url) => Buffer.byteLength(url) > LIVE_SOURCE_AUDIT.urlBytes))) return unknown("graph_limit");
  if(graph.pages.some(p=>!Number.isFinite(Date.parse(p.checkedAt))||Date.parse(p.checkedAt)>Date.parse(at)+1000
    ||Date.parse(at)-Date.parse(p.checkedAt)>LIVE_SOURCE_AUDIT.windowMs))return unknown("live_observation_stale");
  if (group.policy.lockedByCorrection || /offline|manual/i.test(group.policy.readStrategy ?? "")) return unknown("source_policy_blocked");
  const official = liveAuditOfficialUrls(graph);
  const candidateUrls = new Set(graph.candidateUrls.map(urlKey));
  const candidates = graph.pages.filter((p) => candidateUrls.has(urlKey(p.requestedUrl)) && official.has(urlKey(p.requestedUrl) ?? ""));
  if (!candidates.length) return unknown("official_schedule_unproven");
  if (candidates.some((p) => p.status !== 200 || !p.text.trim())) return unknown("candidate_unreadable");
  const current: Array<{ page: LiveAuditPage; text: string }> = [];
  for (const page of candidates) {
    if(unconfirmedDocumentHost({url:page.finalUrl,websiteUrl:group.policy.websiteUrl,text:page.text}))return unknown("candidate_institution_unproven");
    if(LEGACY_SCOPE.test(page.text))return unknown("candidate_legacy_scope_unproven");
    if(Array.isArray(group.policy.rejectedSourceUrls)&&group.policy.rejectedSourceUrls.some(entry=>entry&&typeof entry==="object"&&!Array.isArray(entry)
      &&typeof entry.url==="string"&&[urlKey(page.requestedUrl),urlKey(page.finalUrl)].includes(urlKey(entry.url))))return unknown("candidate_source_policy_rejected");
    const date = effectiveDate(page.text); if (date && date > at.slice(0, 10)) continue;
    const owner = primaryAncillaryProduct(page.text);
    const delegated = candidates.some((from) => from !== page && from.status === 200 && from.text.split(/\r?\n/).some((line) => audienceHeading(line, "consumer"))
      && from.links.some((link) => urlKey(link.url) === urlKey(page.requestedUrl)
        && (audienceHeading(link.label, "consumer") || Boolean(owner && productKey(link.label).includes(productKey(owner.productName))))));
    const scope = consumerScope(page, fee.catalog.fee_name, delegated);
    if (!scope) { if (!isBusinessOnlyLink(page.finalUrl) && !isBusinessOnlyText(page.text)) return unknown("candidate_audience_unproven"); continue; }
    if (documentKind({ text: page.text, url: page.finalUrl, feeSchedule: true }).kind !== "fee_schedule" && !owner) return unknown("candidate_classification_unknown");
    const ownProduct = productKey(owner?.productName);
    if (ownProduct !== productKey(fee.catalog.account_product_type)) continue;
    // Failure to attest one primary product is not positive evidence of general scope.
    // A mixed account guide with unassigned catalog ownership stays unresolved.
    if (!ownProduct && scope.split(/[\r\n|]/).some((line) => {
      const title = compact(line).replace(/:$/u,"");
      return title.length <= 120 && !/[$.!?;]/.test(title) && !audienceHeading(title, "consumer")
        && /\b(?:checking|savings|debit|deposit|share|accounts?)(?:\s+accounts?)?\s*$/i.test(title);
    })) return unknown("unassigned_product_scope_unproven");
    if (owner && !compact(owner.block).includes(compact(fee.catalog.fee_name))) continue;
    current.push({ page, text: owner?.block ?? scope });
  }
  const unique = [...new Map(current.map((c) => [c.page.contentHash, c])).values()];
  if (unique.length !== 1) return unknown(unique.length ? "current_applicability_conflict" : "current_product_scope_unproven");
  const { page, text } = unique[0];
  witness=page;
  const categoryMismatch = !checkFeeCategory(fee.catalog.canonical_fee_key, fee.catalog.fee_name).ok;
  const categoryCheck = checkFeeAgainstSource(text, fee.catalog.fee_name, fee.catalog.amount, ".", fee.catalog.canonical_fee_key);
  const check = !categoryCheck.ok && categoryCheck.reason === "category_not_in_text" && categoryMismatch
    ? checkFeeAgainstSource(text, fee.catalog.fee_name, fee.catalog.amount, ".", null) : categoryCheck;
  if (check.ok && (check.eligibilityContext || check.producerScopeUnknown)) return unknown("own_applicability_unproven");
  const dimensions: string[] = []; let line: string | null = check.ok ? check.sourceLine : null;
  let witnessedAmount = fee.catalog.amount;
  if (!check.ok) {
    // A contradiction needs one exact named own row and its single actual price. No fuzzy reassignment.
    const name = compact(fee.catalog.fee_name).toLowerCase();
    const contradictions = sourceLines(text).flatMap((candidate) => {
      if (!compact(candidate).toLowerCase().startsWith(name)) return [];
      const suffix = compact(candidate).slice(name.length);
      if (!/^[\s|:–—.-]*\$/.test(suffix)) return [];
      const prices = [...candidate.matchAll(/\$\s*(\d+(?:,\d{3})*)(?:\.(\d{1,2}))?(?!\d)/g)];
      if (prices.length !== 1) return [];
      const price = Number(prices[0][1].replaceAll(",", "")) + Number(`0.${prices[0][2] ?? "0"}`);
      return price !== fee.catalog.amount && checkFeeAgainstSource(candidate, fee.catalog.fee_name, price, ".", fee.catalog.canonical_fee_key).ok ? [{ line: candidate, amount: price }] : [];
    });
    if (contradictions.length !== 1) return unknown(`own_line_unproven:${check.reason}`);
    line = contradictions[0].line; witnessedAmount = contradictions[0].amount; dimensions.push("amount");
  }
  if (!line) return unknown("own_line_unproven");
  if (line.length>1000) return unknown("own_line_payload_cap");
  if (nameQuality(fee.catalog.fee_name)) return unknown("name_unproven");
  if (fee.catalog.amount === 0 && !/\$\s*0(?:\.00)?(?![\d.])/.test(line)) {
    const labelAt = compact(line).toLowerCase().indexOf(compact(fee.catalog.fee_name).toLowerCase());
    const afterLabel = labelAt < 0 ? "" : compact(line).slice(labelAt + compact(fee.catalog.fee_name).length);
    if (!/^\s*[|:.–—-]?\s*(?:free|no charge|no fees?|none|waived|n\/c)\b/i.test(afterLabel)) return unknown("zero_price_unproven");
  }
  if (categoryMismatch) dimensions.push("category");
  const observedFrequency = frequencyFromLine(line, witnessedAmount);
  if(!fee.catalog.frequency)return unknown("frequency_not_recorded");
  if (fee.catalog.frequency && (!observedFrequency || frequencyFamily(fee.catalog.frequency) !== frequencyFamily(observedFrequency))) {
    if (observedFrequency) dimensions.push("frequency"); else return unknown("frequency_unproven");
  }
  for (const condition of [fee.catalog.conditions, fee.catalog.waiver_text]) if (condition && !compact(line).includes(compact(condition))) return unknown("own_conditions_unproven");
  const restrictions=compact(line).match(/\b(?:if|when|unless|only|waiv(?:ed|er)|except|subject\s+to)\b.*$/i)?.[0];
  if(restrictions&&!compact([fee.catalog.conditions,fee.catalog.waiver_text].filter(Boolean).join(" ")).includes(restrictions))return unknown("own_conditions_incomplete");
  if (!fee.catalog.conditions && !fee.catalog.waiver_text
    && /\b(?:if|when|unless|only|waiv(?:ed|er)|balances?|members?|customers?|non[- ]?members?|except|subject\s+to)\b/i.test(line)) return unknown("own_conditions_not_recorded");
  if (fee.catalog.rate_basis && !compact(line).toLowerCase().includes(compact(fee.catalog.rate_basis).toLowerCase())) return unknown("basis_unproven");
  if(!fee.catalog.rate_basis&&/\bper\s+(?:\$|\d|dollar|hundred|thousand)|\bpercent\b|%/i.test(line))return unknown("basis_not_recorded");
  if (fee.catalog.fee_audience !== "consumer") return unknown("audience_unproven");
  // Known contradictory stored authority is preserved, never erased by receipt renewal.
  if (fee.source.supersededById != null && page.contentHash === fee.source.contentHash) return unknown("stored_source_superseded");
  return { ...liveAuditUnknown(fee, at, ""), status: dimensions.length ? "mismatch" : "supported",
    reason: dimensions.length ? "positive_current_contradiction" : "own_current_fee_supported", dimensions,
    requestedUrl: page.requestedUrl, finalUrl: page.finalUrl, contentHash: page.contentHash, textHash: page.textHash,
    sourceLine: line.length<=1000?line:null, graphHash: auditHash(liveAuditGraphMetadata(graph)) };
}
