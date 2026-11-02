import { createHash } from "node:crypto";
import { checkFeeAgainstSource, sourceLines } from "@/lib/custom-report/source-check";
import { checkFeeCategory, CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { SOURCE_CHECK_STRATEGY } from "@/lib/agents/hamilton/source-check";

/** A live-source support diagnostic. Never the weekly whole-institution launch measure. */
export const LIVE_SOURCE_AUDIT_PROTOCOL = 1;
/**
 * The draw's identity. Until 2026-11-02 it named the source-check, category, name and audit versions,
 * so every deploy that bumped one left the open draw unclaimable and admission redrew: on prod no
 * draw got past 48 of ~465 institutions (five draws on Nov 1-2, four of them restarted by a bump). The frame,
 * page and report protocol name the draw now; the checker versions are recorded on each verdict
 * (`LIVE_SOURCE_AUDIT_CHECKER`), so a bump mid-draw keeps the same dated draw going.
 */
export const LIVE_SOURCE_AUDIT_SERIES: string = "live-source@2:frame1:page1:report2";
/** The checks that judged one verdict, recorded per observation (never part of the draw's identity). */
export const LIVE_SOURCE_AUDIT_CHECKER = `source${SOURCE_CHECK_STRATEGY.version}:category${CATEGORY_GUARD_VERSION}`;
export const LIVE_SOURCE_AUDIT = {
  sample: 500, population: 250_000, rowBytes: 8 * 1024, policyBytes: 32 * 1024,
  policiesBytes: 2 * 1024 * 1024, drawBytes: 8 * 1024 * 1024, graphBytes: 32 * 1024,
  graphsBytes: 4 * 1024 * 1024, eventBytes: 512 * 1024, archiveBytes: 128 * 1024,
  urlBytes: 2048, pages: 6, links: 160, storedDocuments: 256,
  // A 150 s step never fit: the tick's 270 s budget had 30-149 s left (p50 68 s) when the run's
  // turn came, so 929 deferrals in 12 days and no chunk ever ran (#2061, 2026-11-01 finding).
  // Workers start no new institution after groupStartMs; groups already under way have the rest
  // of workMs. One still being read at workMs is not recorded and the next chunk reads it again.
  // The save had 10 s and 9 of 20 chunk steps ran out of it on Nov 1-2: it re-read and re-hashed
  // the 3.9 MB draw three times and sent every institution's policy. It has 20 s now, taken from
  // the work window, so the step still fits its 90 s.
  windowMs: 24 * 60 * 60 * 1000, workMs: 60_000, groupStartMs: 35_000, settleMs: 20_000, storedTextMs: 5_000, stepMs: 90_000,
  requestMs: 8_000, responseBytes: 8 * 1024 * 1024, textChars: 1_000_000,
  workers: 3, groupsPerChunk: 12, leaseMs: 90_000, examples: 10,
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
/**
 * The pages one institution's chunk fetched: each fee's own document address, fresh. `failed`
 * names each address whose fetch failed and why; a page that loaded is in `pages`.
 */
export interface LiveAuditGraph {
  entryUrl: string | null; pages: LiveAuditPage[]; candidateUrls: string[];
  complete: boolean; reason: string | null; failed?: Array<{ url: string; reason: string }>;
}
/**
 * `supported`: the bank's live page prints this fee at our amount (`checkFeeAgainstSource`).
 * `mismatch`: the page prints this fee's own row at another price (`amount`), or prints our price on
 * the fee's line without the category we file it under (`category`). `not_found`: the page loaded
 * and does not print this fee at our amount. `unknown`: only when the page did not load or gave no
 * text; `reason` says why.
 */
export type LiveAuditStatus = "supported" | "mismatch" | "not_found" | "unknown";
export interface LiveAuditObservation {
  feeId: number; fingerprint: string; status: LiveAuditStatus;
  reason: string; dimensions: string[]; observedAt: string; expiresAt: string;
  requestedUrl: string | null; finalUrl: string | null; contentHash: string | null;
  textHash: string | null; sourceLine: string | null; graphHash: string | null;
  /** `LIVE_SOURCE_AUDIT_CHECKER` when the verdict was made. */
  checker?: string;
}
/**
 * The fixed reasons of the page verdicts; a `not_found` reason carries the check's own after a colon.
 * A mismatch is either the fee's own row at another price (`mismatch`) or the category guard refusing
 * the fee's own name for the category we file it under (`categoryGuard`), which is not a price
 * contradiction and is counted apart. `applicability` and `shell` are unknowns from a page that did
 * load: the price is printed but its own terms are unproven, or the text is too thin to judge.
 */
export const LIVE_AUDIT_REASONS = { supported: "own_current_fee_supported", mismatch: "positive_current_contradiction",
  categoryGuard: "category_guard", notFound: "not_on_live_page", applicability: "own_applicability_unproven",
  shell: "live_text_shell" } as const;
/**
 * A page Magellan read with a browser comes back from a plain fetch as a near-empty script shell.
 * Its text is too thin to say a fee is absent: below the floor, or under this share of the stored
 * text, a fee the page does not print is unknown (`live_text_shell`) and asks for no capture.
 */
export const LIVE_TEXT_SHELL = { floorChars: 200, storedShare: 0.25, storedMinChars: 1000 } as const;
export function liveTextIsShell(liveChars: number, storedChars: number | null | undefined): boolean {
  if (liveChars < LIVE_TEXT_SHELL.floorChars) return true;
  return typeof storedChars === "number" && storedChars >= LIVE_TEXT_SHELL.storedMinChars && liveChars < storedChars * LIVE_TEXT_SHELL.storedShare;
}

export const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const auditHash = (value: unknown): string => createHash("sha256").update(boundedAuditJson(value, LIVE_SOURCE_AUDIT.drawBytes)).digest("hex");
/** Matches PostgreSQL encode(sha256(convert_to(domain||':'||seed||':'||id,'UTF8')),'hex'). */
export const liveAuditOrderKey = (domain: "selection" | "group-order", seed: string, id: number) => createHash("sha256").update(`${domain}:${seed}:${id}`).digest("hex");

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
  return { feeId: fee.id, fingerprint: fee.fingerprint, status: "unknown", reason: reason.slice(0, 100), dimensions: [], observedAt: at,
    expiresAt: new Date(Date.parse(at) + LIVE_SOURCE_AUDIT.windowMs).toISOString(), requestedUrl: null, finalUrl: null,
    contentHash: null, textHash: null, sourceLine: null, graphHash: null, checker: LIVE_SOURCE_AUDIT_CHECKER };
}

/** The graph is persisted once per institution, without bodies; exact byte/text digests remain. */
export function liveAuditGraphMetadata(graph: LiveAuditGraph): Record<string, unknown> {
  return { ...graph, pages: graph.pages.map(page=>Object.fromEntries(Object.entries(page).filter(([key])=>key!=="text"))) };
}

/** The address as fetched: http(s) only, no fragment. Null when it is not a web address. */
export const liveAuditUrlKey = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try { const url = new URL(value.trim()); if (!/^https?:$/.test(url.protocol)) return null; url.hash = ""; return url.href; } catch { return null; }
};

/** The page addresses a group's fees came from, in fee order, each once. */
export function liveAuditFeeUrls(fees: LiveAuditFee[]): string[] {
  return [...new Set(fees.flatMap((fee) => { const url = liveAuditUrlKey(fee.source.url); return url ? [url] : []; }))];
}

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const PRICE = /\$\s*(\d+(?:,\d{3})*)(?:\.(\d{1,2}))?(?!\d)/g;

/**
 * The fee's own row printed at another single price: a line that starts with the fee's name,
 * then a price, and holds exactly one price that `checkFeeAgainstSource` traces to this fee.
 * Null when there is no such line or more than one. No fuzzy reassignment to a neighbor's row.
 */
export function liveAuditContradiction(text: string, fee: Pick<LiveAuditCatalogRow, "fee_name" | "amount" | "canonical_fee_key">): { line: string; amount: number } | null {
  const name = compact(fee.fee_name).toLowerCase();
  if (!name) return null;
  const found = sourceLines(text).flatMap((candidate) => {
    const line = compact(candidate);
    if (!line.toLowerCase().startsWith(name)) return [];
    if (!/^[\s|:–—.-]*\$/.test(line.slice(name.length))) return [];
    const prices = [...candidate.matchAll(PRICE)];
    if (prices.length !== 1) return [];
    const price = Number(prices[0][1].replaceAll(",", "")) + Number(`0.${prices[0][2] ?? "0"}`);
    return price !== fee.amount && checkFeeAgainstSource(candidate, fee.fee_name, price, ".", fee.canonical_fee_key).ok ? [{ line: candidate, amount: price }] : [];
  });
  return found.length === 1 ? found[0] : null;
}

/**
 * The fee against the bank's live copy of its own document (2026-11-02). Until then the evaluator
 * walked the bank's homepage graph and needed a complete graph, a proven consumer heading and its
 * own frequency, conditions and basis, so all 122 observations on Nov 1-2 came out unknown (page
 * cap, graph cap, no schedule found from the homepage). Now the page the fee was read from is
 * fetched fresh; a page that loads gets a verdict with the shared match rule
 * (`checkFeeAgainstSource`), and only a page that does not load, or gives no text, is unknown.
 */
export function evaluateLiveAuditFee(fee: LiveAuditFee, _group: LiveAuditGroup, graph: LiveAuditGraph, at: string,
  stored: { chars?: number | null } = {}): LiveAuditObservation {
  const url = liveAuditUrlKey(fee.source.url);
  if (!url) return liveAuditUnknown(fee, at, "fee_document_url_missing");
  if (!Number.isFinite(fee.catalog.amount) || fee.catalog.amount < 0) return liveAuditUnknown(fee, at, "fee_amount_unreadable");
  const page = graph.pages.find((p) => liveAuditUrlKey(p.requestedUrl) === url);
  if (!page) {
    const failure = graph.failed?.find((f) => liveAuditUrlKey(f.url) === url);
    return liveAuditUnknown(fee, at, failure?.reason ?? graph.reason ?? "live_page_not_fetched");
  }
  if (page.status !== 200) return liveAuditUnknown(fee, at, `live_http_${page.status}`);
  if (!page.text.trim()) return liveAuditUnknown(fee, at, "live_page_no_text");
  const graphHash = auditHash(liveAuditGraphMetadata(graph));
  const seen = { requestedUrl: page.requestedUrl, finalUrl: page.finalUrl, contentHash: page.contentHash, textHash: page.textHash, graphHash };
  const verdict = (status: LiveAuditStatus, reason: string, dimensions: string[], line: string | null): LiveAuditObservation => ({
    ...liveAuditUnknown(fee, at, reason), ...seen, status, dimensions, sourceLine: line === null ? null : line.slice(0, 1000) });
  // The category guard reads the fee's own name: a name it refuses for our category is a category miss
  // even where the page prints the price (accuracy is amount and category, CLAUDE.md).
  const wrongCategory = !checkFeeCategory(fee.catalog.canonical_fee_key, fee.catalog.fee_name).ok;
  const check = checkFeeAgainstSource(page.text, fee.catalog.fee_name, fee.catalog.amount, ".", fee.catalog.canonical_fee_key);
  if (check.ok) {
    if (wrongCategory) return verdict("mismatch", LIVE_AUDIT_REASONS.categoryGuard, ["category"], check.sourceLine);
    // A cap-first witness or a row whose producer scope is unproven prices the fee, but does not prove
    // the price applies to this account: unknown, as before Nov 2, never supported.
    if (check.eligibilityContext || check.producerScopeUnknown) return liveAuditUnknown(fee, at, LIVE_AUDIT_REASONS.applicability);
    return verdict("supported", LIVE_AUDIT_REASONS.supported, [], check.sourceLine);
  }
  const contradiction = liveAuditContradiction(page.text, fee.catalog);
  if (contradiction) return verdict("mismatch", LIVE_AUDIT_REASONS.mismatch, wrongCategory ? ["amount", "category"] : ["amount"], contradiction.line);
  if (check.reason === "category_not_in_text" && wrongCategory) {
    // Our price is on the fee's own line, but the line never names the category we file it under.
    const uncategorized = checkFeeAgainstSource(page.text, fee.catalog.fee_name, fee.catalog.amount, ".", null);
    if (uncategorized.ok) return verdict("mismatch", LIVE_AUDIT_REASONS.categoryGuard, ["category"], uncategorized.sourceLine);
  }
  // A script shell is not the bank's page: too little text to say the fee is absent.
  if (liveTextIsShell(compact(page.text).length, stored.chars)) return liveAuditUnknown(fee, at, LIVE_AUDIT_REASONS.shell);
  return verdict("not_found", `${LIVE_AUDIT_REASONS.notFound}:${check.reason}`, [], null);
}
