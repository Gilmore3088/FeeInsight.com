import { sql } from "@/lib/data-store/connection";
import { recordFeedback, type FeedbackRow, type FeedbackStage } from "@/lib/agents/learning/feedback";
import { LIVE_FRAGMENT_REREAD_KIND } from "@/lib/agents/darwin/live-fragment-check";
import { inSavepoint } from "@/lib/agents/savepoint";
import { ARTICLE_PAGE_CHECK } from "@/lib/agents/hamilton/article-page";
import { PRODUCT_PAGE_CHECK } from "@/lib/agents/hamilton/product-page";
import { OTHER_BANK_DOCUMENT_CHECK, UNCONFIRMED_HOST_CHECK } from "@/lib/agents/hamilton/other-bank-document";
import { FRESH_AUDIT_VERSION, NAME_QUALITY_CHECK, type FreshAuditMiss, type FreshAuditResult } from "./fresh-audit";

type SqlTag = typeof sql;

/**
 * Deming's fresh-audit misses, kept and routed (#1119, approved by James 2026-10-12).
 *
 * 1. Each miss becomes a `fresh_audit` test case with the label `deming_audit` and status
 *    `candidate`. An audit check alone never makes a confirmed label (the Deming guide): the case
 *    stays a candidate until a person or a take-down confirms it, and the regression replay never
 *    reads it (it replays `limit_guard` and `source_check` inputs only).
 * 2. Each miss goes to the agent that owns the mistake, in the shared learning store, as a
 *    `wrong` judgement of kind `audit_miss` with weight 0.5 (an audit is evidence, not proof):
 *    a document that is another bank's, on an unconfirmed host or an article (or a product page,
 *    a check the audit does not run today) goes to Magellan (stage discover); an amount the schedule does not support, a category it
 *    does not support, a perk read as a fee and a bad name go to Knox (stage extract).
 *
 * 3. Each miss reaches its owner's own queue, so it is acted on and not only stored (#2055). A
 *    bad-name miss (`NAME_QUALITY_CHECK`) is also a Knox re-read request (`LIVE_FRAGMENT_REREAD_KIND`,
 *    kept live, as Darwin's live fragment check writes it): Knox's re-read pass reads the fee's line
 *    again from its own document with today's rules and settles the request once per rules
 *    version with an outcome on its run step (`knox/reread-feedback.ts`); it renames the live fee
 *    only when the line reads a proper name that passes the category guard and the shared source
 *    check. Only name misses: that pass treats any other name on the line at the same price as the
 *    better one, so a request for a fee whose name is fine (an amount or category miss) could
 *    rename it sideways ("Stop payment fee" to "Stop payment fee renewal") and hide the miss.
 *    A miss Magellan owns (stage discover) is picked up by Magellan's stale-link search, which
 *    reads these rows when the miss's document came from the bank's link (or the address its last
 *    fetch landed on) and the fee is still live, and searches the link again once per finding
 *    (`magellan/discovery.ts`).
 *
 * A miss Hamilton's second look already holds (`pending`) is skipped: it is not a new finding.
 * Both writes need migration 20270110000045 (the `deming_audit` label and the `deming` reporter);
 * before it, each write fails on its own and is reported, never blocking the audit.
 */

export const AUDIT_LABEL = "deming_audit";
export const AUDIT_FEEDBACK_KIND = "audit_miss";
export const AUDIT_FEEDBACK_WEIGHT = 0.5;

const DOCUMENT_CHECKS = new Set<string>([OTHER_BANK_DOCUMENT_CHECK, UNCONFIRMED_HOST_CHECK, ARTICLE_PAGE_CHECK, PRODUCT_PAGE_CHECK]);

export interface MissOwner {
  agent: "magellan" | "knox";
  stage: FeedbackStage;
}

/** Who owns a miss: the wrong document is Magellan's, everything read from the right one is Knox's. */
export function missOwner(check: string): MissOwner {
  if (DOCUMENT_CHECKS.has(check)) return { agent: "magellan", stage: "discover" };
  return { agent: "knox", stage: "extract" };
}

export function auditCaseKey(miss: Pick<FreshAuditMiss, "feePublishedId" | "check">): string {
  return `fresh_audit:${miss.feePublishedId}:${miss.check}`;
}

export interface AuditCaseRow {
  case_key: string;
  agent: string;
  check_name: string;
  error_class: string;
  severity: string;
  institution_id: number;
  source_document_id: number | null;
  source_url: string | null;
  fee_published_id: number;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

/** Pure: the test case each new miss becomes. */
export function auditCases(misses: FreshAuditMiss[], auditedOn: string): AuditCaseRow[] {
  return misses
    .filter((miss) => !miss.pending)
    .map((miss) => ({
      case_key: auditCaseKey(miss),
      agent: missOwner(miss.check).agent,
      check_name: miss.check,
      error_class: miss.reason,
      severity: miss.severity,
      institution_id: miss.institutionId,
      source_document_id: miss.sourceDocumentId,
      source_url: miss.documentUrl,
      fee_published_id: miss.feePublishedId,
      input: {
        kind: "fresh_audit",
        audit_version: FRESH_AUDIT_VERSION,
        audited_on: auditedOn,
        fee_name: miss.feeName,
        amount: miss.amount,
        canonical_fee_key: miss.canonicalFeeKey,
        document_url: miss.documentUrl,
      },
      expected: { live: false, check: miss.check, reason: miss.reason },
    }));
}

/** Pure: the learning-store judgement each new miss becomes. */
export function auditFeedback(misses: FreshAuditMiss[], auditedOn: string, runId: number | null): FeedbackRow[] {
  return misses
    .filter((miss) => !miss.pending)
    .map((miss) => ({
      aboutStage: missOwner(miss.check).stage,
      signal: "wrong",
      kind: AUDIT_FEEDBACK_KIND,
      reportedBy: "deming",
      checkName: miss.check,
      institutionId: miss.institutionId,
      sourceDocumentId: miss.sourceDocumentId,
      sourceUrl: miss.documentUrl,
      feePublishedId: miss.feePublishedId,
      canonicalFeeKey: miss.canonicalFeeKey,
      amount: miss.amount,
      weight: AUDIT_FEEDBACK_WEIGHT,
      evidence: { audited_on: auditedOn, reason: miss.reason, severity: miss.severity, fee_name: miss.feeName, owner: missOwner(miss.check).agent },
      runId,
      dedupeKey: `deming.fresh_audit:${miss.feePublishedId}:${miss.check}`,
    }));
}

/** Pure: the Knox re-read request each new miss Knox owns becomes (#2055). */
export function auditRereadRequests(misses: FreshAuditMiss[], auditedOn: string, runId: number | null): FeedbackRow[] {
  return misses
    .filter((miss) => !miss.pending && miss.check === NAME_QUALITY_CHECK)
    .map((miss) => ({
      aboutStage: "extract",
      signal: "wrong",
      kind: LIVE_FRAGMENT_REREAD_KIND,
      reportedBy: "deming",
      checkName: miss.check,
      institutionId: miss.institutionId,
      sourceDocumentId: miss.sourceDocumentId,
      sourceUrl: miss.documentUrl,
      feePublishedId: miss.feePublishedId,
      canonicalFeeKey: miss.canonicalFeeKey,
      amount: miss.amount,
      // A request, not a judgement: it never counts toward a lesson.
      weight: 0,
      evidence: {
        request: "reread_source_line",
        fee_name: miss.feeName,
        kept_live: true,
        reason: `deming audit: ${miss.reason}`,
        audited_on: auditedOn,
        consumer: "knox.reread_feedback (#1511, #2055)",
      },
      runId,
      dedupeKey: `deming.fresh_audit:reread:${miss.feePublishedId}:${miss.check}`,
    }));
}

export interface AuditMissWrites {
  cases: number;
  feedback: number;
  /** Knox re-read requests written for the bad-name misses (#2055). */
  rereadRequests: number;
  /** Why a write did not happen (the migration is not applied yet, or a dry run). */
  skipped: string[];
}

/** Saves the audit's new misses as candidate test cases and routes them. Never throws. */
export async function recordAuditMisses(
  db: SqlTag,
  result: FreshAuditResult,
  options: { runId: number | null; dryRun?: boolean },
): Promise<AuditMissWrites> {
  const writes: AuditMissWrites = { cases: 0, feedback: 0, rereadRequests: 0, skipped: [] };
  if (!result.readable || result.misses.length === 0) return writes;
  const auditedOn = result.seed;
  const cases = auditCases(result.misses, auditedOn);
  const feedback = auditFeedback(result.misses, auditedOn, options.runId);
  const rereads = auditRereadRequests(result.misses, auditedOn, options.runId);
  if (options.dryRun) {
    writes.skipped.push("dry run");
    return writes;
  }
  try {
    const inserted = await inSavepoint(db, (scope) => scope<{ id: number }[]>`
      INSERT INTO eval_cases (
        case_key, dataset, status, agent, check_name, error_class, severity, institution_id,
        source_document_id, source_url, fee_published_id, input, expected, label_provenance, agent_run_id
      )
      SELECT case_key, 'fresh_audit', 'candidate', agent, check_name, error_class, severity, institution_id,
             source_document_id, source_url, fee_published_id, input, expected, ${AUDIT_LABEL}, ${options.runId}
        FROM jsonb_to_recordset(${JSON.stringify(cases)}::jsonb) AS c(
          case_key text, agent text, check_name text, error_class text, severity text, institution_id bigint,
          source_document_id bigint, source_url text, fee_published_id bigint, input jsonb, expected jsonb
        )
      ON CONFLICT (case_key) DO NOTHING
      RETURNING id
    `);
    writes.cases = inserted.length;
  } catch (error) {
    writes.skipped.push(`test cases: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
  }
  try {
    writes.feedback = await inSavepoint(db, (scope) => recordFeedback(scope, feedback));
  } catch (error) {
    writes.skipped.push(`owner feedback: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
  }
  if (rereads.length > 0) {
    try {
      writes.rereadRequests = await inSavepoint(db, (scope) => recordFeedback(scope, rereads));
    } catch (error) {
      writes.skipped.push(`knox re-read requests: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
    }
  }
  return writes;
}
