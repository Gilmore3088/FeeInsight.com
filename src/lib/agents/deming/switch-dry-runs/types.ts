import type { FreshAuditResult } from "@/lib/agents/deming/fresh-audit";

/**
 * Types for the switch dry-run audit (#1092): one read-only pass that prints the production counts
 * each off-by-default switch waits on. The reader is the data-store boundary
 * (`src/lib/data-store/switch-dry-runs.ts`); every counting function here is pure.
 */

/** Where a daily cap row stands today. */
export type CapTier = "live" | "removed" | "rejected" | "held" | "verified_unpublished" | "unjudged";

/** One raw read filed as a daily cap, joined to its newest verified and published rows. */
export interface DailyCapRow {
  fee_raw_id: number | string;
  institution_id: number | string;
  institution_name: string | null;
  source_document_id: number | string | null;
  /** The raw read's link, which Darwin's recheck reads (`tierPerkZero`). */
  source_url: string | null;
  /** The document's page, which Hamilton keys copies by (`feePageKey`). */
  document_url: string | null;
  raw_name: string;
  raw_amount: number | string | null;
  /** The raw read's owning product, for Darwin's ancillary-product narrowing (`statedInOwnSource`). */
  product_name: string | null;
  outlier_flags: unknown;
  conditions: string | null;
  fee_verified_id: number | string | null;
  review_status: string | null;
  verified_key: string | null;
  verified_name: string | null;
  verified_amount: number | string | null;
  fee_published_id: number | string | null;
  published_key: string | null;
  published_name: string | null;
  published_amount: number | string | null;
  removed: boolean | null;
  rolled_back_reason: string | null;
  /** Darwin's newest `verify.rules` decision for the raw row ("rejected", "needs_review", ...). */
  verify_decision: string | null;
  verify_reason: string | null;
  verify_key: string | null;
}

/** A live published fee with its raw read's name and document, for matching against Knox reads. */
export interface LiveFeeRow {
  fee_published_id: number | string;
  institution_id: number | string;
  institution_name: string | null;
  canonical_fee_key: string;
  fee_name: string;
  raw_fee_name: string | null;
  amount: number | string | null;
  amount_kind: string | null;
  rate_percent: number | string | null;
  frequency: string | null;
  variant_type: string | null;
  /** Hamilton compares a new read only with live fees of its own audience (`selectLivePublishedFees`). */
  fee_audience: string | null;
  product_name: string | null;
  published_at: string | Date;
  source_url: string | null;
  source_document_id: number | string | null;
  document_crawled_at: string | Date | null;
  document_stream: string | null;
  document_url: string | null;
}

/** A stored document Knox would read, with what Hamilton's prior-fee decision needs about it. */
export interface DocumentRow {
  source_document_id: number | string;
  institution_id: number | string;
  institution_name: string | null;
  document_url: string | null;
  crawled_at: string | Date | null;
  document_stream: string | null;
}

/** A live fee as the publish-time limit guard would see it, with Knox's raw audit text. */
export interface LimitRow {
  fee_published_id: number | string;
  institution_id: number | string;
  institution_name: string | null;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  conditions: string | null;
}

/** A fee the live limit sweep took down, with the reason it recorded. */
export interface LimitTakedownRow {
  fee_published_id: number | string;
  institution_id: number | string;
  institution_name: string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  rolled_back_reason: string;
  /**
   * Names of the live rows of the same institution, category and amount. The fee is republished when
   * one of them is its name by Hamilton's `normalizedFeeName` (a rename keeps it the same fee).
   */
  live_names: string[] | null;
}

/** The data-store boundary. Every method reads only; the real one runs in a read-only transaction. */
export interface SwitchAuditReader {
  dailyCapRows(limit: number): Promise<DailyCapRow[]>;
  /** The newest completed stored text of each document (`loadSourceTexts`). */
  sourceTexts(documentIds: number[]): Promise<Map<number, string>>;
  /**
   * Documents Knox reads (current copies) or a live fee cites, institutions with live fees first:
   * `limit` of them from `offset` on are scanned (the bound applies before any text is read), and those
   * whose newest text may print a dash price-first list come back.
   */
  dashListDocuments(limit: number, offset: number): Promise<{ scanned: number; documents: DocumentRow[] }>;
  /** Every live fee at these institutions, dollar, rate or no amount, as Hamilton's prior read takes them. */
  liveFeesAt(institutionIds: number[]): Promise<LiveFeeRow[]>;
  /** Live dollar fees whose limit verdict Knox's excerpt could change (`LIMIT_GUARD_MIN_AMOUNT`, a transaction amount). */
  limitRows(limit: number): Promise<LimitRow[]>;
  /** Fees the live limit sweep took down with an excerpt-only reading. */
  excerptLimitTakedowns(limit: number): Promise<LimitTakedownRow[]>;
  /** Deming's fresh audit, as Atlas runs it daily, on a sample of this size. */
  freshAudit(sampleSize: number): Promise<FreshAuditResult>;
}

export interface SwitchAuditOptions {
  /** Rows printed per list; totals always count every row. */
  sampleCap: number;
  /** Most rows any one read returns; a read that returns this many says it may be cut short. */
  rowCap: number;
  /** Most candidate documents the dash list section scans and replays (the bound comes before the text scan). */
  maxDocuments: number;
  /** Candidates to skip first, in the section's order, to page through them in batches. */
  scanOffset: number;
  /** Documents whose texts are loaded at once. */
  chunkSize: number;
  /** Fees in the live accuracy sample. */
  accuracySample: number;
  /** Only these institutions (sections 1 to 3), or every institution when null. */
  institutionIds: number[] | null;
}

export const DEFAULT_SWITCH_AUDIT_OPTIONS: SwitchAuditOptions = {
  sampleCap: 20,
  rowCap: 50_000,
  maxDocuments: 3_000,
  scanOffset: 0,
  chunkSize: 200,
  accuracySample: 500,
  institutionIds: null,
};

/** A row count that may have stopped at its cap. */
export interface Bounded {
  read: number;
  cap: number;
  truncated: boolean;
}

export function bounded(read: number, cap: number): Bounded {
  return { read, cap, truncated: read >= cap };
}
