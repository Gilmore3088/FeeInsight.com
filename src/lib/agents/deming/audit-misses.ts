import { sql } from "@/lib/data-store/connection";
import { recordFeedback, type FeedbackRow, type FeedbackStage } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { ARTICLE_PAGE_CHECK } from "@/lib/agents/hamilton/article-page";
import { PRODUCT_PAGE_CHECK } from "@/lib/agents/hamilton/product-page";
import { OTHER_BANK_DOCUMENT_CHECK, UNCONFIRMED_HOST_CHECK } from "@/lib/agents/hamilton/other-bank-document";
import { FRESH_AUDIT_VERSION, type FreshAuditMiss, type FreshAuditResult } from "./fresh-audit";

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
 *    a document that is another bank's, on an unconfirmed host, an article or a product page
 *    goes to Magellan (stage discover); an amount the schedule does not support, a category it
 *    does not support, a perk read as a fee and a bad name go to Knox (stage extract).
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

export interface AuditMissWrites {
  cases: number;
  feedback: number;
  /** Why a write did not happen (the migration is not applied yet, or a dry run). */
  skipped: string[];
}

/** Saves the audit's new misses as candidate test cases and routes them. Never throws. */
export async function recordAuditMisses(
  db: SqlTag,
  result: FreshAuditResult,
  options: { runId: number | null; dryRun?: boolean },
): Promise<AuditMissWrites> {
  const writes: AuditMissWrites = { cases: 0, feedback: 0, skipped: [] };
  if (!result.readable || result.misses.length === 0) return writes;
  const auditedOn = result.seed;
  const cases = auditCases(result.misses, auditedOn);
  const feedback = auditFeedback(result.misses, auditedOn, options.runId);
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
  return writes;
}
