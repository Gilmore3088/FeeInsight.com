import { readerFeeConditions } from "@/lib/fee-conditions";
import type { AnalyzeResponse } from "./types";
import type { FeeResearch, OwnFeeRow, PeerFeeRecordRef, PeerValue } from "./workspace/types";

export const HAMILTON_EVIDENCE_CONTRACT_VERSION = 1 as const;

export const CLAIM_BINDING_LIMITATION =
  "Structured evidence preserves record identity and derivations, but it does not by itself verify every sentence in a narrative.";

/** Saved evidence matches the stored source at answer time; nothing here re-checks the live source. */
export const STORED_SNAPSHOT_LIMITATION =
  "Evidence snapshot reflects stored records at answer time; it is not a live-source recheck.";
export const OWN_AGGREGATE_LIMITATION =
  "Own category aggregate has incompatible, incomplete or untraceable product/frequency/source rows; it is not a claim-bound individual fee.";
export const PEER_AGGREGATE_LIMITATION =
  "Peer category aggregates lack contributing published fee-row IDs; figures are directional and omitted from claim-bound evidence.";
/** The peer median names its records (#981, H06-T04); the quartiles and wider markets still do not. */
export const PEER_MEDIAN_RECORDS_LIMITATION =
  "Peer median is recomputed from each peer's contributing published fee-row ID; peer quartiles and wider-market medians lack contributing row IDs and stay directional.";

/** The most peer records a saved answer carries for its median; a larger group stays directional. */
export const MAX_PEER_MEDIAN_RECORDS = 50;
export const PEER_MEDIAN_FORMULA = "median of published peer amounts";

/** The median of values, interpolated between the middle two when the count is even. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const lower = Math.floor(middle);
  return sorted[lower] + (sorted[Math.ceil(middle)] - sorted[lower]) * (middle - lower);
}

export type HamiltonFactUnit = "usd" | "percent" | "count" | "ratio" | "text";
export type HamiltonEvidenceStatus =
  | "published"
  | "verified"
  | "provisional"
  | "user_provided"
  | "inferred"
  | "derived";

export type HamiltonAccountApplicability = "consumer" | "business" | "both" | "unknown";

export interface HamiltonFactScope {
  institutionId: number | null;
  feeCategory: string | null;
  product: string | null;
  reportingDate: string | null;
  effectiveDate: string | null;
  accountApplicability: HamiltonAccountApplicability;
  /**
   * "discontinued" marks a fee from a table for accounts the bank no longer offers (#1880: Texas
   * Capital's closed-account table published as live). Such a fee never supports a claim about
   * the current fee and is never compared. Absent means current, as every fee was read before.
   */
  productStatus?: HamiltonProductStatus;
}

export type HamiltonProductStatus = "current" | "discontinued";

export interface HamiltonFactSource {
  label: string | null;
  table: string | null;
  recordId: number | string | null;
  sourceDocumentIds: number[];
  urls: string[];
  asOf: string | null;
  /** Content fingerprint, not an effective or filing date. */
  documentContentHash?: string | null;
  retrievedAt?: string | null;
  lastCheckedAt?: string | null;
  location?: string | null;
  verificationEventId: string | null;
}

export interface HamiltonEvidenceFact {
  id: string;
  kind: "observed";
  scope: HamiltonFactScope;
  value: number | string | null;
  unit: HamiltonFactUnit;
  currency: "USD" | null;
  frequency: string | null;
  conditions: string | null;
  audienceEvidence?: string | null;
  status: Exclude<HamiltonEvidenceStatus, "derived">;
  source: HamiltonFactSource;
}

export type HamiltonDerivationKind =
  | "difference"
  | "percent_change"
  | "institution_value"
  | "peer_median";

export interface HamiltonDerivedFact {
  id: string;
  kind: "derived";
  scope: HamiltonFactScope;
  value: number | null;
  unit: HamiltonFactUnit;
  currency: "USD" | null;
  status: "derived";
  derivation: {
    kind: HamiltonDerivationKind;
    inputFactIds: string[];
    denominatorFactId: string | null;
    formula: string;
    rounding: string;
  };
}

export interface HamiltonEvidenceBundle {
  version: typeof HAMILTON_EVIDENCE_CONTRACT_VERSION;
  generatedAt: string;
  facts: HamiltonEvidenceFact[];
  derivations: HamiltonDerivedFact[];
  limitations: string[];
  /** Peers whose fee record could not be used, by reason (#1717); absent when none was left out. */
  peerCoverage?: PeerCoverage;
}

/** Why a peer's fee was left out of a comparison or of the record check behind a peer median. */
export type PeerLeftOutReason = "not_verified" | "audience_unknown" | "frequency_unknown" | "not_comparable";

/** How many peers were left out of how many, and why; each left-out peer counts under one reason. */
export interface PeerCoverage {
  context: "peer_comparison" | "peer_median";
  total: number;
  leftOut: number;
  byReason: Partial<Record<PeerLeftOutReason, number>>;
}

const LEFT_OUT_WORDS: Record<PeerLeftOutReason, string> = {
  not_verified: "not yet verified",
  audience_unknown: "audience unknown",
  frequency_unknown: "no stated frequency",
  not_comparable: "not the same fee, unit or date",
};
const LEFT_OUT_ORDER: readonly PeerLeftOutReason[] = ["not_verified", "audience_unknown", "frequency_unknown", "not_comparable"];

/**
 * The reader's line for left-out peers (#1717): "3 of 14 peers left out: 2 not yet verified,
 * 1 audience unknown". One reason reads without its count ("3 of 14 peers left out: not yet
 * verified"). Null when no peer was left out, so "0 of 14 left out" is never shown.
 */
export function readPeerCoverage(coverage: PeerCoverage | null | undefined): string | null {
  if (!coverage || coverage.leftOut <= 0 || coverage.total <= 0) return null;
  const reasons = LEFT_OUT_ORDER
    .map((reason) => [reason, coverage.byReason[reason] ?? 0] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (reasons.length === 0) return null;
  const why = reasons.length === 1
    ? LEFT_OUT_WORDS[reasons[0][0]]
    : reasons.map(([reason, n]) => `${n} ${LEFT_OUT_WORDS[reason]}`).join(", ");
  const peers = coverage.total === 1 ? "peer" : "peers";
  return coverage.context === "peer_median"
    ? `${coverage.leftOut} of ${coverage.total} ${peers} left out of the record check: ${why}.`
    : `${coverage.leftOut} of ${coverage.total} ${peers} left out: ${why}.`;
}

function coverageOf(context: PeerCoverage["context"], total: number, reasons: readonly (PeerLeftOutReason | null)[]): PeerCoverage | null {
  const byReason: Partial<Record<PeerLeftOutReason, number>> = {};
  for (const reason of reasons) if (reason) byReason[reason] = (byReason[reason] ?? 0) + 1;
  const leftOut = reasons.filter(Boolean).length;
  return leftOut > 0 ? { context, total, leftOut, byReason } : null;
}

export interface HamiltonClaimBinding {
  institutionId?: number | null;
  feeCategory?: string | null;
  unit?: HamiltonFactUnit;
  reportingDate?: string | null;
  /** The figure the claim states; the record must hold that value, not merely share its scope. */
  value?: number;
  /** A consumer claim binds a consumer or both-audience record; unknown audience binds nothing. */
  accountApplicability?: Exclude<HamiltonAccountApplicability, "unknown" | "both">;
  /** A claim is about the current fee unless it says otherwise; a discontinued fee binds only a claim that says "discontinued". */
  productStatus?: HamiltonProductStatus;
}

/**
 * Fee categories charged each time the event happens (#1717, James, 2026-10-18): a fee here with
 * no stated frequency counts as per item, so it is still compared. Recurring categories (monthly
 * maintenance and other period-based fees) and any category not listed keep the strict rule: no
 * stated frequency, no comparison. A category is listed only when every fee in it is per event;
 * continuous overdraft (per day), safe deposit box (per year), check printing (per order or box),
 * bill pay and coin counting are left out on purpose.
 */
export const EVENT_FEE_CATEGORIES: ReadonlySet<string> = new Set([
  "overdraft",
  "nsf",
  "od_protection_transfer",
  "stop_payment",
  "deposited_item_return",
  "ach_return",
  "wire_domestic_outgoing",
  "wire_domestic_incoming",
  "wire_intl_outgoing",
  "wire_intl_incoming",
  "atm_non_network",
  "atm_international",
  "cashiers_check",
  "money_order",
  "counter_check",
  "card_replacement",
  "rush_card",
]);

/** Stated frequencies that already mean "each time"; a blank event fee matches only these. */
const PER_EVENT_FREQUENCIES: ReadonlySet<string> = new Set([
  "per item", "per_item", "per transaction", "per_transaction", "per occurrence", "per_occurrence", "each",
]);

/** True when a fee in this category is charged each time it happens, so a blank frequency means per item. */
export function chargedPerEvent(feeCategory: string | null | undefined): boolean {
  return typeof feeCategory === "string" && EVENT_FEE_CATEGORIES.has(feeCategory);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function urls(...values: Array<string | null | undefined>): string[] {
  return unique(values.filter((value): value is string => typeof value === "string" && value.length > 0));
}

function ownFeeFact(institutionId: number, feeCategory: string, row: OwnFeeRow): HamiltonEvidenceFact | null {
  if (row.amount === null || !Number.isFinite(row.amount) || row.amount < 0) return null;
  return {
    id: `fee:published:${row.id}`,
    kind: "observed",
    scope: {
      institutionId,
      feeCategory,
      product: row.feeName,
      reportingDate: null,
      effectiveDate: null,
      accountApplicability: row.feeAudience ?? "unknown",
    },
    value: row.amount,
    unit: "usd",
    currency: "USD",
    frequency: row.frequency ?? null,
    conditions: readerFeeConditions(row.conditions),
    audienceEvidence: row.audienceEvidence ?? null,
    status: "published",
    source: {
      label: "Published fee catalog",
      table: "published_fee_catalog",
      recordId: row.id,
      sourceDocumentIds: row.sourceDocumentId === null ? [] : [row.sourceDocumentId],
      urls: urls(row.documentUrl, row.sourceUrl),
      asOf: row.publishedAt,
      documentContentHash: row.sourceContentHash ?? null,
      retrievedAt: row.sourceCrawledAt ?? null,
      lastCheckedAt: row.sourceLastCheckedAt ?? null,
      location: null,
      verificationEventId: row.verifiedByEventId,
    },
  };
}

/**
 * Canonical arithmetic is not proof that a generic category median names a
 * particular product. Only allow a claim-bound aggregate when every sourced
 * input shares a product, frequency and one source document identity.
 * This does not assert that the document is current or verify narrative text.
 */
function supportedOwnAggregate(
  facts: HamiltonEvidenceFact[],
  current: number | null,
  feeCategory: string,
): boolean {
  if (current === null || !Number.isFinite(current) || current < 0 || facts.length === 0) return false;
  const first = facts[0];
  const product = first.scope.product?.trim().toLowerCase();
  const frequency = first.frequency?.trim().toLowerCase();
  const documentId = first.source.sourceDocumentIds[0];
  if (!product || !frequency || first.source.sourceDocumentIds.length !== 1
    || !Number.isSafeInteger(documentId) || documentId <= 0) return false;

  const amounts: number[] = [];
  for (const fact of facts) {
    if (typeof fact.value !== "number" || !Number.isFinite(fact.value) || fact.value < 0) return false;
    if (fact.scope.product?.trim().toLowerCase() !== product) return false;
    if (fact.frequency?.trim().toLowerCase() !== frequency) return false;
    if (fact.scope.accountApplicability !== "consumer" && fact.scope.accountApplicability !== "both") return false;
    if (!Number.isSafeInteger(Number(fact.source.recordId)) || Number(fact.source.recordId) <= 0) return false;
    if (fact.source.sourceDocumentIds.length !== 1 || fact.source.sourceDocumentIds[0] !== documentId) return false;
    amounts.push(fact.value);
  }
  amounts.sort((left, right) => left - right);
  const middle = (amounts.length - 1) / 2;
  const lower = Math.floor(middle);
  const expected = feeCategory === "overdraft"
    ? amounts[amounts.length - 1]
    : amounts[lower] + (amounts[Math.ceil(middle)] - amounts[lower]) * (middle - lower);
  return Math.abs(expected - current) <= 0.0000001;
}

function derivedFact(input: {
  id: string;
  scope: HamiltonFactScope;
  value: number | null;
  unit: HamiltonFactUnit;
  currency: "USD" | null;
  kind: HamiltonDerivationKind;
  inputFactIds: string[];
  denominatorFactId?: string | null;
  formula: string;
  rounding: string;
}): HamiltonDerivedFact {
  return {
    id: input.id,
    kind: "derived",
    scope: input.scope,
    value: input.value,
    unit: input.unit,
    currency: input.currency,
    status: "derived",
    derivation: {
      kind: input.kind,
      inputFactIds: unique(input.inputFactIds),
      denominatorFactId: input.denominatorFactId ?? null,
      formula: input.formula,
      rounding: input.rounding,
    },
  };
}

/**
 * Does this record support the claim (#981, H06-T04)? Subject, category, unit, period, audience and
 * the stated value must all be the record's own, so Bank B's $35 or a $25 gap never supports
 * "Bank A charges $35" or "Bank A charges $25", and an undated record never supports a dated claim.
 */
export function claimBindingMatches(
  fact: Pick<HamiltonEvidenceFact | HamiltonDerivedFact, "scope" | "unit" | "value">,
  claim: HamiltonClaimBinding,
): boolean {
  if (claim.institutionId !== undefined && fact.scope.institutionId !== claim.institutionId) return false;
  if (claim.feeCategory !== undefined && fact.scope.feeCategory !== claim.feeCategory) return false;
  if (claim.unit !== undefined && fact.unit !== claim.unit) return false;
  if (claim.reportingDate !== undefined && fact.scope.reportingDate !== claim.reportingDate) return false;
  if (claim.accountApplicability !== undefined && fact.scope.accountApplicability !== claim.accountApplicability
    && fact.scope.accountApplicability !== "both") return false;
  // Unknown is never a match for a stated figure; a genuine $0 is.
  if (claim.value !== undefined && (typeof fact.value !== "number" || !Number.isFinite(fact.value)
    || Math.abs(fact.value - claim.value) > 0.005)) return false;
  // A fee from a discontinued account's table is never the current fee (#1880).
  if ((fact.scope.productStatus ?? "current") !== (claim.productStatus ?? "current")) return false;
  return true;
}

/**
 * Reject arithmetic on incomparable or untraceable fee observations. This establishes
 * comparability of structured inputs, NOT verification of surrounding prose.
 */
function comparabilityProblems(
  left: HamiltonEvidenceFact | HamiltonDerivedFact,
  right: HamiltonEvidenceFact | HamiltonDerivedFact,
  periodRule: "same_period" | "chronological" = "same_period",
): string[] {
  const problems: string[] = [];
  if (typeof left.value !== "number" || typeof right.value !== "number"
    || !Number.isFinite(left.value) || !Number.isFinite(right.value)) problems.push("non_numeric_value");
  if (left.unit !== right.unit) problems.push("unit_mismatch");
  if (left.scope.productStatus === "discontinued" || right.scope.productStatus === "discontinued") {
    problems.push("product_discontinued");
  }
  if (left.currency !== right.currency) problems.push("currency_mismatch");
  if (left.scope.feeCategory !== right.scope.feeCategory) problems.push("fee_category_mismatch");
  const leftProduct = left.scope.product?.trim().toLowerCase();
  const rightProduct = right.scope.product?.trim().toLowerCase();
  if (!leftProduct || !rightProduct) problems.push("product_unknown");
  else if (leftProduct !== rightProduct) problems.push("product_mismatch");

  if (left.kind !== "observed" || right.kind !== "observed") {
    problems.push("untraceable_derivation_input");
  } else {
    const trustedSource = (fact: HamiltonEvidenceFact) => {
      const rowId = Number(fact.source.recordId);
      const documents = fact.source.sourceDocumentIds;
      return (fact.status === "published" || fact.status === "verified")
        && Number.isSafeInteger(rowId) && rowId > 0
        && documents.length === 1 && Number.isSafeInteger(documents[0]) && documents[0] > 0;
    };
    if (!trustedSource(left) || !trustedSource(right)) problems.push("source_record_unverified");
    const leftFrequency = left.frequency?.trim().toLowerCase();
    const rightFrequency = right.frequency?.trim().toLowerCase();
    if (!leftFrequency || !rightFrequency) {
      // An event fee charged each time counts as per item when the schedule doesn't say (#1717);
      // a recurring or unlisted category keeps the strict rule.
      const event = chargedPerEvent(left.scope.feeCategory) && left.scope.feeCategory === right.scope.feeCategory;
      const stated = leftFrequency || rightFrequency;
      if (!event) problems.push("fee_frequency_unknown");
      else if (stated && !PER_EVENT_FREQUENCIES.has(stated)) problems.push("fee_frequency_mismatch");
    } else if (leftFrequency !== rightFrequency) problems.push("fee_frequency_mismatch");
    const consumer = (audience: HamiltonAccountApplicability) =>
      audience === "consumer" || audience === "both";
    if (!consumer(left.scope.accountApplicability) || !consumer(right.scope.accountApplicability)) {
      problems.push("consumer_audience_unverified");
    }
    if ((typeof left.value === "number" && left.value < 0)
      || (typeof right.value === "number" && right.value < 0)) problems.push("invalid_fee_amount");
  }

  if (!left.scope.reportingDate || !right.scope.reportingDate) problems.push("reporting_period_unknown");
  else if (periodRule === "same_period" && left.scope.reportingDate !== right.scope.reportingDate) {
    problems.push("reporting_period_mismatch");
  } else if (periodRule === "chronological") {
    if (left.scope.institutionId === null || left.scope.institutionId !== right.scope.institutionId) {
      problems.push("institution_mismatch");
    }
    if (left.scope.reportingDate <= right.scope.reportingDate) problems.push("reporting_period_order_invalid");
  }
  return unique(problems);
}

export function deriveDifference(
  id: string,
  left: HamiltonEvidenceFact | HamiltonDerivedFact,
  right: HamiltonEvidenceFact | HamiltonDerivedFact,
): { fact: HamiltonDerivedFact | null; problems: string[] } {
  const problems = comparabilityProblems(left, right);
  if (problems.length > 0 || typeof left.value !== "number" || typeof right.value !== "number") {
    return { fact: null, problems };
  }
  return {
    fact: derivedFact({
      id,
      scope: {
        institutionId: null,
        feeCategory: left.scope.feeCategory,
        product: null,
        reportingDate: left.scope.reportingDate,
        effectiveDate: null,
        accountApplicability: "unknown",
      },
      value: Math.round((left.value - right.value) * 100) / 100,
      unit: left.unit,
      currency: left.currency,
      kind: "difference",
      inputFactIds: [left.id, right.id],
      formula: "left - right",
      rounding: "nearest cent for USD; otherwise two decimals",
    }),
    problems: [],
  };
}

export function derivePercentChange(
  id: string,
  current: HamiltonEvidenceFact | HamiltonDerivedFact,
  prior: HamiltonEvidenceFact | HamiltonDerivedFact,
): { fact: HamiltonDerivedFact | null; problems: string[] } {
  const problems = comparabilityProblems(current, prior, "chronological");
  if (typeof prior.value === "number" && prior.value === 0) problems.push("zero_denominator");
  if (
    problems.length > 0
    || typeof current.value !== "number"
    || typeof prior.value !== "number"
  ) {
    return { fact: null, problems: unique(problems) };
  }
  return {
    fact: derivedFact({
      id,
      scope: {
        institutionId: current.scope.institutionId === prior.scope.institutionId ? current.scope.institutionId : null,
        feeCategory: current.scope.feeCategory,
        product: null,
        reportingDate: current.scope.reportingDate,
        effectiveDate: null,
        accountApplicability: "unknown",
      },
      value: Math.round((((current.value - prior.value) / prior.value) * 100) * 10) / 10,
      unit: "percent",
      currency: null,
      kind: "percent_change",
      inputFactIds: [current.id, prior.id],
      denominatorFactId: prior.id,
      formula: "(current - prior) / prior * 100",
      rounding: "one decimal percentage point",
    }),
    problems: [],
  };
}

/** The one reason a peer's comparison problems leave it out, most basic first. */
function leftOutReason(problems: readonly string[]): PeerLeftOutReason | null {
  if (problems.length === 0) return null;
  if (problems.includes("source_record_unverified")) return "not_verified";
  if (problems.includes("consumer_audience_unverified")) return "audience_unknown";
  if (problems.includes("fee_frequency_unknown")) return "frequency_unknown";
  return "not_comparable";
}

/**
 * Which peers a comparison with the bank's own fee leaves out, and why (#1717). Each peer is
 * compared with `deriveDifference`'s own rules; a peer with any problem is left out under one
 * reason. Null when no peer is left out, or when the bank's own fee is not comparable itself
 * (then every peer would fail for the bank's reason, not its own).
 */
export function peerComparisonCoverage(
  own: HamiltonEvidenceFact,
  peers: readonly HamiltonEvidenceFact[],
): PeerCoverage | null {
  if (peers.length === 0 || comparabilityProblems(own, own).length > 0) return null;
  return coverageOf("peer_comparison", peers.length, peers.map((peer) => leftOutReason(comparabilityProblems(own, peer))));
}

export function structuredEvidenceConfidence(bundle: HamiltonEvidenceBundle | null | undefined): {
  level: "medium";
  basis: string[];
} {
  const count = (bundle?.facts.length ?? 0) + (bundle?.derivations.length ?? 0);
  return {
    level: "medium",
    basis: [
      count > 0
        ? `${count} structured evidence record${count === 1 ? "" : "s"} saved with explicit identity/source context.`
        : "Deterministic storyline saved without claim-level structured evidence records.",
      CLAIM_BINDING_LIMITATION,
    ],
  };
}

/** The catalog row whose amount is the peer's value (its highest tier, or its middle row), lowest ID first. */
function peerValueRecord(peer: PeerValue): PeerFeeRecordRef | null {
  return (peer.feeRecords ?? []).find((record) =>
    Math.abs(record.amount - peer.amount) <= 0.0000001
    && Number.isSafeInteger(record.id) && record.id > 0
    && record.sourceDocumentId !== null && Number.isSafeInteger(record.sourceDocumentId) && record.sourceDocumentId > 0) ?? null;
}

/**
 * The peers left out of the peer median's record check (#1717): a peer with no published row of its
 * value from one stored schedule is not yet verified. Null when every peer has one, and when the
 * group can't take the record check at all (no band, a size that differs from the band's, more than
 * MAX_PEER_MEDIAN_RECORDS peers, or a repeated peer), so the line never names a check that didn't run.
 */
export function peerMedianCoverage(research: Pick<FeeResearch, "peers" | "band">): PeerCoverage | null {
  const { band, peers } = research;
  if (!band || peers.length === 0 || peers.length !== band.n || peers.length > MAX_PEER_MEDIAN_RECORDS) return null;
  if (new Set(peers.map((peer) => peer.institutionId)).size !== peers.length) return null;
  return coverageOf("peer_median", peers.length, peers.map((peer) => (peerValueRecord(peer) ? null : "not_verified")));
}

/**
 * The peer median with its records (#981, H06-T04): one published row per peer, the row whose amount
 * is that peer's value, and a `peer_median` derivation over them that recomputes to the band's median.
 * Null when any peer has no such row, the rows' frequencies differ, the group is larger than
 * MAX_PEER_MEDIAN_RECORDS, or the rows do not reproduce the median: the median then stays directional.
 */

export function peerMedianEvidence(research: Pick<FeeResearch, "institutionId" | "feeCategory" | "peers" | "band">): { facts: HamiltonEvidenceFact[]; derivation: HamiltonDerivedFact } | null {
  const band = research.band;
  const peers = research.peers;
  if (!band || peers.length === 0 || peers.length !== band.n || peers.length > MAX_PEER_MEDIAN_RECORDS) return null;
  if (new Set(peers.map((peer) => peer.institutionId)).size !== peers.length) return null;
  const records = peers.map(peerValueRecord);
  if (records.some((record) => record === null)) return null;
  const frequencies = new Set(records.map((record) => record!.frequency?.trim().toLowerCase() ?? null));
  if (frequencies.size !== 1) return null;
  const facts: HamiltonEvidenceFact[] = peers.map((peer, i) => {
    const record = records[i]!;
    return {
      id: `fee:published:${record.id}`,
      kind: "observed",
      scope: {
        institutionId: peer.institutionId,
        feeCategory: research.feeCategory,
        product: record.feeName,
        reportingDate: null,
        effectiveDate: null,
        accountApplicability: record.feeAudience,
      },
      value: record.amount,
      unit: "usd",
      currency: "USD",
      frequency: record.frequency,
      conditions: null,
      status: "published",
      source: {
        label: "Published fee catalog",
        table: "published_fee_catalog",
        recordId: record.id,
        sourceDocumentIds: [record.sourceDocumentId!],
        urls: urls(record.documentUrl, ...(record.documentUrl ? [] : peer.documentUrls.slice(0, 1))),
        asOf: peer.publishedAt,
        verificationEventId: null,
      },
    };
  });
  const median = medianOf(facts.map((fact) => fact.value as number));
  // The band is rounded to the cent; the records must give that median.
  if (median === null || Math.abs(median - band.median) > 0.005) return null;
  return {
    facts,
    derivation: derivedFact({
      id: `derived:peer_median:${research.institutionId}:${research.feeCategory}`,
      scope: { institutionId: null, feeCategory: research.feeCategory, product: null, reportingDate: null, effectiveDate: null, accountApplicability: "consumer" },
      value: median,
      unit: "usd",
      currency: "USD",
      kind: "peer_median",
      inputFactIds: facts.map((fact) => fact.id),
      formula: PEER_MEDIAN_FORMULA,
      rounding: "the nearest cent",
    }),
  };
}

export function buildFeeResearchEvidence(research: FeeResearch): HamiltonEvidenceBundle {
  const ownFacts = research.ownRows
    .map((row) => ownFeeFact(research.institutionId, research.feeCategory, row))
    .filter((fact): fact is HamiltonEvidenceFact => fact !== null);
  // Source-document IDs alone do not identify the fee rows behind each peer's value; only the
  // rows the read names (peerMedianEvidence) are saved as observations.
  const currentEvidenceSupported = supportedOwnAggregate(ownFacts, research.current, research.feeCategory);
  const derivations: HamiltonDerivedFact[] = [];

  if (currentEvidenceSupported) {
    derivations.push(derivedFact({
      id: `derived:current:${research.institutionId}:${research.feeCategory}`,
      scope: {
        institutionId: research.institutionId,
        feeCategory: research.feeCategory,
        product: ownFacts[0].scope.product,
        reportingDate: null,
        effectiveDate: null,
        accountApplicability: "consumer",
      },
      value: research.current,
      unit: "usd",
      currency: "USD",
      kind: "institution_value",
      inputFactIds: ownFacts.map((fact) => fact.id),
      formula: research.feeCategory === "overdraft"
        ? "highest published tier for the institution"
        : "median of published institution amounts",
      rounding: "stored published amount precision",
    }));
  }


  const peerMedian = peerMedianEvidence(research);
  if (peerMedian) derivations.push(peerMedian.derivation);
  const peerCoverage = peerMedian ? null : peerMedianCoverage(research);
  const peerCoverageLine = readPeerCoverage(peerCoverage);

  return {
    version: HAMILTON_EVIDENCE_CONTRACT_VERSION,
    generatedAt: research.provenance.generatedAt,
    facts: [...ownFacts, ...(peerMedian?.facts ?? [])],
    derivations,
    limitations: [
      STORED_SNAPSHOT_LIMITATION,
      ...(research.current !== null && !currentEvidenceSupported ? [OWN_AGGREGATE_LIMITATION] : []),
      ...(research.peers.length > 0 ? [peerMedian ? PEER_MEDIAN_RECORDS_LIMITATION : PEER_AGGREGATE_LIMITATION] : []),
      ...(peerCoverageLine ? [peerCoverageLine] : []),
      CLAIM_BINDING_LIMITATION,
    ],
    ...(peerCoverage ? { peerCoverage } : {}),
  };
}


export const LEGACY_HIGH_CONFIDENCE_LIMITATION =
  "Legacy high confidence predates record-bound Hamilton evidence and is shown as medium until the artifact is regenerated or separately verified.";

export type EvidenceBoundAnalyzeResponse = AnalyzeResponse & {
  factEvidence?: HamiltonEvidenceBundle;
};

/**
 * Compatibility view only: never rewrite stored history. A structured evidence
 * snapshot is NOT evidence that all of the saved narrative was claim-verified.
 * The current contract has no semantic-proof field that could justify "high".
 */
export function normalizeLegacyAnalyzeConfidence(
  response: EvidenceBoundAnalyzeResponse,
): EvidenceBoundAnalyzeResponse {
  if (response.confidence?.level !== "high") return response;
  const limitation = response.factEvidence
    ? CLAIM_BINDING_LIMITATION
    : LEGACY_HIGH_CONFIDENCE_LIMITATION;
  return {
    ...response,
    confidence: {
      level: "medium",
      basis: unique([...response.confidence.basis, limitation]),
    },
  };
}
