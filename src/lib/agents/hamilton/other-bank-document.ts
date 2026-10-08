import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { hostSql, OTHER_BANK_HOST_CODE } from "@/lib/agents/magellan/other-bank-host";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Another bank's fees (James, Oct 8). A live fee read from a document on another
 * institution's own website (`magellan/other-bank-host.ts`) is that bank's price: Peoples Bank
 * of Rock Valley, Iowa showed 22 fees read from Peoples Bank of Bellingham, Washington's PDF.
 * It comes down on the first run that sees it (James, Oct 8: "fix the problem immediately"),
 * unless the document's text names this bank's own website or city (a schedule a sister
 * charter or an acquirer hosts for it). The host match is a fact about the stored address, not
 * a reading a fixed rule could clear, so there is no 12-hour second look; the first look is
 * still logged (`second-look.ts`, check `hamilton.other_bank_document`).
 *
 * Archived, never deleted: `rolled_back_reason = 'other_bank_document: <host>'` and the
 * verified row rejected with the `other_bank_document` flag, so it is not republished. The
 * lesson goes to Magellan (a `wrong_document` judgement, stage discover). The link joins the
 * bank's rejected sources and leaves its fee link, so discovery searches again.
 *
 * Dry run on prod (Oct 8, read-only): 16 institutions had live fees from another
 * institution's host (321 fees); one (Hema FCU, whose document names its own city) passes.
 */
export const OTHER_BANK_DOCUMENT_CHECK = "hamilton.other_bank_document";
export const OTHER_BANK_DOCUMENT_REASON = "other_bank_document";
export const OTHER_BANK_DOCUMENT_FLAG = "other_bank_document";
export const OTHER_BANK_DOCUMENT_ROLLBACK_LIMIT = 500;

interface OtherBankFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  document_url: string;
  document_host: string;
  other_institution_id: number | string;
  other_institution_name: string;
  names_own_bank: boolean | string | null;
}

export interface OtherBankTakedown {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  documentUrl: string;
  documentHost: string;
  otherInstitutionId: number;
  otherInstitutionName: string;
  reason: string;
}

export interface OtherBankDocumentResult {
  otherBankFees: number;
  namesOwnBank: number;
  flagged: number;
  waiting: number;
  rolledBack: OtherBankTakedown[];
  linksCleared: number;
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function truthy(value: boolean | string | null | undefined): boolean {
  return value === true || String(value ?? "").toLowerCase() === "true" || value === "t";
}

/** The live-fee read: every fee whose document is on another institution's own website. */
export function otherBankFeesSql(byInstitution: boolean): string {
  // Hosts are worked out once per table (CTEs), then matched by equality: one host pattern per
  // row inside a join ran past a minute on prod.
  return `
    WITH live AS (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fr.source_document_id IS NOT NULL
         ${byInstitution ? "AND fp.institution_id = $1" : ""}
    ),
    docs AS (
      SELECT sd.id, sd.document_url, ${hostSql("sd.document_url")} AS host
        FROM source_documents sd
       WHERE sd.id IN (SELECT DISTINCT source_document_id FROM live)
         AND sd.document_url IS NOT NULL
    ),
    sites AS (
      SELECT i.id, i.institution_name, i.city, ${hostSql("i.website_url")} AS host
        FROM institution_sources i
       WHERE i.website_url IS NOT NULL
    ),
    matched AS (
      SELECT l.*, d.document_url, d.host AS document_host, own.host AS own_host, own.city AS own_city
        FROM live l
        JOIN docs d ON d.id = l.source_document_id
        JOIN sites own ON own.id = l.institution_id
       WHERE own.host IS DISTINCT FROM d.host
         AND EXISTS (SELECT 1 FROM sites o WHERE o.host = d.host AND o.id <> l.institution_id)
    )
    SELECT m.fee_published_id, m.fee_verified_id, m.institution_id, m.source_document_id,
           m.document_url, m.document_host,
           COALESCE(o.id, 0) AS other_institution_id, COALESCE(o.institution_name, m.document_host) AS other_institution_name,
           EXISTS (
             SELECT 1 FROM agent_source_texts t
              WHERE t.source_document_id = m.source_document_id
                AND (strpos(lower(t.normalized_text), m.own_host) > 0
                     OR (length(btrim(COALESCE(m.own_city, ''))) >= 3
                         AND strpos(lower(t.normalized_text), lower(btrim(m.own_city))) > 0))
           ) AS names_own_bank
      FROM matched m
      LEFT JOIN LATERAL (
        SELECT s.id, s.institution_name FROM sites s
         WHERE s.host = m.document_host AND s.id <> m.institution_id
         ORDER BY s.id LIMIT 1
      ) o ON true
     ORDER BY m.fee_published_id`;
}

/**
 * Runs the other-bank check for one publish step. A dry run reports what it would flag and
 * take down, and writes nothing. Never blocks the step it runs in.
 */
export async function retireOtherBankDocumentFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<OtherBankDocumentResult> {
  const limit = Math.max(1, Math.min(options.limit ?? OTHER_BANK_DOCUMENT_ROLLBACK_LIMIT, 2_000));
  const result: OtherBankDocumentResult = {
    otherBankFees: 0,
    namesOwnBank: 0,
    flagged: 0,
    waiting: 0,
    rolledBack: [],
    linksCleared: 0,
    dryRun: options.dryRun,
  };
  let rows: OtherBankFeeRow[];
  try {
    rows = await inSavepoint(db, (scope) =>
      scope.unsafe<OtherBankFeeRow[]>(
        otherBankFeesSql(Boolean(options.institutionId)),
        options.institutionId ? [options.institutionId] : [],
      ),
    );
  } catch (error) {
    console.error("retireOtherBankDocumentFees read failed:", error);
    return result;
  }
  result.otherBankFees = rows.length;
  const failing: OtherBankTakedown[] = [];
  const passing: number[] = [];
  for (const row of rows) {
    if (truthy(row.names_own_bank)) {
      passing.push(Number(row.fee_published_id));
      continue;
    }
    failing.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      documentUrl: row.document_url,
      documentHost: row.document_host,
      otherInstitutionId: Number(row.other_institution_id),
      otherInstitutionName: row.other_institution_name,
      reason: `${OTHER_BANK_DOCUMENT_REASON}: ${row.document_host}`,
    });
  }
  result.namesOwnBank = passing.length;

  // Logged like every takedown, then taken down now: no wait for a second look.
  const look = await secondLook(db, { check: OTHER_BANK_DOCUMENT_CHECK, runId: options.runId, failing, passing, dryRun: options.dryRun });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  const confirmed = failing.slice(0, limit);
  if (options.dryRun) {
    result.rolledBack = confirmed;
    return result;
  }
  if (confirmed.length === 0) return result;

  try {
    result.rolledBack = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${options.batchId},
               rolled_back_reason = v.reason
          FROM unnest(${confirmed.map((fee) => fee.feePublishedId)}::bigint[], ${confirmed.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const closed = confirmed.filter((fee) => ids.has(fee.feePublishedId));
      if (closed.length === 0) return closed;
      await scope`
        UPDATE verified_fee_observations fv
           SET review_status = 'rejected',
               outlier_flags = CASE
                 WHEN fv.outlier_flags ? ${OTHER_BANK_DOCUMENT_FLAG} THEN fv.outlier_flags
                 ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${OTHER_BANK_DOCUMENT_FLAG}::text)
               END
         WHERE fv.fee_verified_id = ANY(${closed.map((fee) => fee.feeVerifiedId)}::bigint[])
           AND fv.review_status IN ('verified', 'approved')
      `;
      return closed;
    });
  } catch (error) {
    console.error("other-bank document rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  const documents = new Map<number, OtherBankTakedown>();
  for (const fee of result.rolledBack) {
    if (fee.sourceDocumentId != null && !documents.has(fee.sourceDocumentId)) documents.set(fee.sourceDocumentId, fee);
  }

  // The link goes back to discovery: rejected for this bank, and off its fee link unless a
  // person's correction locked it.
  try {
    result.linksCleared = await inSavepoint(db, async (scope) => {
      let cleared = 0;
      for (const fee of documents.values()) {
        const rejected = JSON.stringify([{ url: fee.documentUrl, reason: OTHER_BANK_HOST_CODE, at: new Date().toISOString() }]);
        await scope`
          UPDATE institution_source_profiles
             SET rejected_source_urls = (
                   SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
                     FROM jsonb_array_elements(COALESCE(rejected_source_urls, '[]'::jsonb)) entry
                    WHERE entry->>'url' IS DISTINCT FROM ${fee.documentUrl}
                 ) || ${rejected}::jsonb,
                 canonical_source_url = CASE
                   WHEN locked_by_correction OR canonical_source_url IS DISTINCT FROM ${fee.documentUrl} THEN canonical_source_url
                   ELSE NULL
                 END,
                 updated_at = NOW()
           WHERE institution_id = ${fee.institutionId}
        `;
        const rows = await scope`
          UPDATE institution_sources inst
             SET fee_schedule_url = NULL,
                 rescue_status = 'pending',
                 failure_reason = 'magellan_other_bank_document',
                 failure_reason_note = ${`${fee.documentUrl} is ${fee.otherInstitutionName}'s schedule`},
                 failure_reason_updated_at = NOW()
           WHERE inst.id = ${fee.institutionId}
             AND btrim(COALESCE(inst.fee_schedule_url, '')) = ${fee.documentUrl.trim()}
             AND NOT EXISTS (
               SELECT 1 FROM institution_source_profiles profile
                WHERE profile.institution_id = inst.id AND profile.locked_by_correction IS TRUE
             )
          RETURNING inst.id
        `;
        cleared += rows.length;
      }
      return cleared;
    });
  } catch (error) {
    console.error("other-bank document link reset failed:", error);
  }

  const lessons: FeedbackRow[] = [...documents.values()].map((fee) => ({
    aboutStage: "discover",
    signal: "wrong",
    kind: "wrong_document",
    reportedBy: "hamilton",
    checkName: OTHER_BANK_DOCUMENT_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    sourceUrl: fee.documentUrl,
    runId: options.runId,
    dedupeKey: `${OTHER_BANK_DOCUMENT_CHECK}:doc:${fee.sourceDocumentId}`,
    evidence: {
      reason: OTHER_BANK_HOST_CODE,
      document_url: fee.documentUrl,
      document_host: fee.documentHost,
      other_institution_id: fee.otherInstitutionId,
      other_institution_name: fee.otherInstitutionName,
      fees_taken_down: result.rolledBack.filter((other) => other.sourceDocumentId === fee.sourceDocumentId).length,
    },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.other_bank_document_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} fee(s) read from another institution's website`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            documents: documents.size,
            links_cleared: result.linksCleared,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              document_url: fee.documentUrl,
              other_institution_id: fee.otherInstitutionId,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("other-bank document lesson/event failed:", error);
  }
  return result;
}
