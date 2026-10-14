import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { BUSINESS_PATH_SQL, CONSUMER_PATH_SQL } from "@/lib/agents/magellan/link-coverage";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Business-schedule fees beside a consumer fee (coordinator, 7 Oct). A live fee read from a
 * business-only document (its address names business, commercial, corporate or treasury and
 * not personal or consumer: `isBusinessOnlyLink`) shows a business price on a consumer page
 * ("Monthly Service Charge" $20 from ServisFirst's commercial schedule, beside consumer $2-$8).
 * When the bank also has a live consumer fee in the same category, the business fee comes
 * down, but only on its second look (`second-look.ts`, check `hamilton.business_schedule`).
 * A business fee with no consumer fee beside it stays live until Magellan finds the consumer
 * schedule, so no bank is hidden wholesale.
 *
 * Archived, never deleted: `rolled_back_reason = 'business_schedule: consumer fee #<id>'` and
 * the verified row rejected with the `business_schedule` flag, so it is not republished. The
 * lesson goes to Magellan (a `wrong_document` judgement about the link, stage discover), not
 * to Knox or Darwin, who read the page correctly; the feedback sync skips these takedowns.
 * A takedown whose consumer fee is no longer live comes back.
 *
 * First dry run (7 Oct, prod, read-only): 1,028 live business-sourced fees at 91 banks; 61
 * have a consumer fee in the same category (27 at the same amount).
 */
export const BUSINESS_SCHEDULE_CHECK = "hamilton.business_schedule";
export const BUSINESS_SCHEDULE_REASON = "business_schedule";
export const BUSINESS_SCHEDULE_FLAG = "business_schedule";
/** A business-only footnote's takedown; it does not come back when the category has no consumer fee. */
export const BUSINESS_FOOTNOTE_REASON = "business_schedule: business-only footnote";
export const BUSINESS_SCHEDULE_ROLLBACK_LIMIT = 200;

/**
 * True for a fee whose own name says it is a business price ("Business ATM/Debit Transactions,
 * off premises", "Commercial NSF Fee per item"), read from a disclosure that lists consumer and
 * business fees together (Prosperity 61, live 101925, 9 Oct). "Corporate" is left out: a
 * corporate check is the official check a consumer buys. A name with "|" or ":" is left out
 * too: there "Business" is often a heading or column carried in ("BUSINESS CHECKING ACCOUNT
 * FEES | Skip-a-Pay", Apex's "Business Analysis Checking: replacement, and drilling"), 3 of a
 * 10-fee spot check on 9 Oct. 101 such live fees then, 51 beside a consumer fee.
 */
const BUSINESS_NAME_SQL = (column: string) =>
  `(${column} ~* '^\\s*(business|commercial)\\M[^|:]*$' AND ${column} !~* '^\\s*business\\s+days?\\M')`;

/** A footnote that limits its fee to business accounts ("Only applicable to business accounts."). */
const BUSINESS_ONLY_NOTE =
  /\b(?:only\s+(?:applicable|applies|available|charged)\s+(?:to|on|for)\s+(?:business|commercial)|(?:business|commercial)\s+(?:checking\s+)?accounts?\s+only)\b/i;
/** The same, in SQL, to find the documents worth reading. */
const BUSINESS_ONLY_NOTE_SQL =
  "(only (applicable|applies|available|charged)\\s+(to|on|for)\\s+(business|commercial)|(business|commercial)\\s+(checking\\s+)?accounts?\\s+only)";
/** A footnote mark: "2", "6a", "*", "**", "†". */
const NOTE_MARK = String.raw`(?:\d{1,2}[a-z]?|\*{1,3}|†|‡)`;
const NOTE_LINE = new RegExp(String.raw`^\s*(${NOTE_MARK})\s*([A-Z(].*)$`);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One footnote on a page: its mark, where it starts, and whether it limits its fee to business accounts. */
export interface PageFootnote {
  mark: string;
  offset: number;
  businessOnly: boolean;
}

/**
 * Pure: a page's footnotes. A footnote is its mark line and up to two lines after it that are not
 * another footnote (ConnectOne, doc 23733: "2 Created by check, in-person withdrawal, ATM
 * withdrawal, or other electronic / means. Only applicable to business accounts."). It limits its
 * fee to business accounts when it says so and does not also say the fee applies to everyone or
 * to consumers ("Charges apply to all checking and savings accounts ... Continuous overdraft
 * charge applies to commercial accounts only", doc 20317), and is not several notes run together
 * on one line ("1Call us ...; 2Subject to credit approval. 3Overdraft Protection Line of Credit is
 * only available to business account holders", doc 17748).
 */
export function pageFootnotes(text: string): PageFootnote[] {
  const lines = text.split("\n");
  const notes: PageFootnote[] = [];
  let offset = 0;
  lines.forEach((line, index) => {
    const lineOffset = offset;
    offset += line.length + 1;
    const note = NOTE_LINE.exec(line);
    if (!note) return;
    const block = [note[2]];
    for (const next of lines.slice(index + 1, index + 3)) {
      if (NOTE_LINE.test(next)) break;
      block.push(next);
    }
    const said = block.join(" ");
    const at = said.search(BUSINESS_ONLY_NOTE);
    const businessOnly =
      at >= 0 &&
      !/\b(?:not|except|excluding)\b[^.]*$/i.test(said.slice(0, at)) &&
      !/\b(?:apply|applies|available|charged)\s+to\s+all\b|\b(?:consumer|personal)\s+(?:checking\s+)?accounts?\s+only\b|\bapplies\s+to\s+(?:consumer|personal)\b/i.test(said) &&
      !/[;.]\s*\d{1,2}\s?[A-Z]/.test(said);
    notes.push({ mark: note[1].toLowerCase(), offset: lineOffset, businessOnly });
  });
  return notes;
}

/**
 * Pure: is this fee's line marked with a business-only footnote? The page prints the fee's name
 * with the mark right after it ("Overdraft - Insufficient Funds / Uncollected2 $40.00", or
 * "Non-Sufficient Funds Fee5,6,6a"), and the mark's footnote is business-only. One page can number
 * its footnotes again in each section (doc 9210 has two footnote 4s, one for consumer overdrafts,
 * one for business transfers), so a mark means the first footnote with that mark after the line.
 */
export function footnoteMarksBusiness(text: string, name: string, notes: PageFootnote[] = pageFootnotes(text)): boolean {
  if (!notes.some((note) => note.businessOnly)) return false;
  const bare = name.replace(/[\s.…_]+$/, "").trim();
  if (bare.length < 3) return false;
  const tagged = new RegExp(String.raw`${escapeRegExp(bare)}(${NOTE_MARK}(?:\s*,\s*${NOTE_MARK})*)(?![0-9A-Za-z]|\.\d)`, "gi");
  for (const match of text.matchAll(tagged)) {
    const at = match.index ?? 0;
    for (const mark of match[1].split(/\s*,\s*/)) {
      const note = notes.find((candidate) => candidate.mark === mark.toLowerCase() && candidate.offset > at);
      if (note?.businessOnly) return true;
    }
  }
  return false;
}

/** True for a document address whose path names a business-only schedule (SQL, host removed). */
const BUSINESS_DOC_SQL = (column: string) =>
  `(regexp_replace(${column}, '^https?://[^/]+', '') ~* '${BUSINESS_PATH_SQL}'
    AND regexp_replace(${column}, '^https?://[^/]+', '') !~* '${CONSUMER_PATH_SQL}')`;

interface BusinessFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  document_url: string;
  canonical_fee_key: string;
  amount: number | string | null;
  consumer_fee_id: number | string | null;
  business_document: boolean;
}

export interface BusinessScheduleTakedown {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  documentUrl: string;
  canonicalFeeKey: string;
  amount: number | null;
  /** Null for a business-only footnote, which comes down with or without a consumer fee beside it. */
  consumerFeeId: number | null;
  /** False when only the fee's own name says business: the document is a mixed schedule, not a wrong link. */
  businessDocument: boolean;
  reason: string;
}

export interface BusinessScheduleResult {
  businessFees: number;
  withConsumerFee: number;
  flagged: number;
  waiting: number;
  rolledBack: BusinessScheduleTakedown[];
  restored: number;
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Live fees whose line on their page carries a business-only footnote (`footnoteMarksBusiness`):
 * ConnectOne's "Overdraft - Insufficient Funds / Uncollected2 $40.00" (live 103490, doc 23733), 9 Oct.
 * Reads only documents whose current text has a business-only phrase (103 of 5,828 on 9 Oct).
 */
export async function selectFootnoteBusinessFeeIds(db: SqlTag, institutionId?: number): Promise<number[]> {
  const rows = await inSavepoint(db, (scope) => scope.unsafe<{ fee_published_id: number | string; fee_name: string; normalized_text: string }[]>(
    `WITH live AS (
       SELECT fp.fee_published_id, fr.fee_name, fr.source_document_id
         FROM published_fee_records fp
         JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        WHERE fp.rolled_back_at IS NULL
          AND fp.quarantined_at IS NULL
          AND fp.fee_audience = 'unknown'
          AND fr.source_document_id IS NOT NULL
          ${institutionId ? "AND fp.institution_id = $1" : ""}
     ),
     documents AS MATERIALIZED (
       SELECT doc.source_document_id, text.normalized_text
         FROM (SELECT DISTINCT source_document_id FROM live) doc
         CROSS JOIN LATERAL (
           SELECT st.normalized_text
             FROM agent_source_texts st
            WHERE st.source_document_id = doc.source_document_id
              AND st.normalized_text IS NOT NULL
            ORDER BY st.id DESC
            LIMIT 1
         ) text
        WHERE text.normalized_text ~* '${BUSINESS_ONLY_NOTE_SQL}'
     )
     SELECT live.fee_published_id, live.fee_name, documents.normalized_text
       FROM live
       JOIN documents ON documents.source_document_id = live.source_document_id`,
    institutionId ? [institutionId] : [],
  ));
  const notesByText = new Map<string, PageFootnote[]>();
  const ids: number[] = [];
  for (const row of rows) {
    let notes = notesByText.get(row.normalized_text);
    if (!notes) {
      notes = pageFootnotes(row.normalized_text);
      notesByText.set(row.normalized_text, notes);
    }
    if (footnoteMarksBusiness(row.normalized_text, row.fee_name ?? "", notes)) ids.push(Number(row.fee_published_id));
  }
  return ids;
}

/**
 * Runs the business-schedule check for one publish step. A dry run reports what it would
 * flag, take down and restore, and writes nothing. Never blocks the step it runs in.
 */
export async function retireBusinessScheduleFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<BusinessScheduleResult> {
  const limit = Math.max(1, Math.min(options.limit ?? BUSINESS_SCHEDULE_ROLLBACK_LIMIT, 2_000));
  const result: BusinessScheduleResult = {
    businessFees: 0,
    withConsumerFee: 0,
    flagged: 0,
    waiting: 0,
    rolledBack: [],
    restored: 0,
    dryRun: options.dryRun,
  };
  let footnoteIds: number[] = [];
  try {
    footnoteIds = await selectFootnoteBusinessFeeIds(db, options.institutionId);
  } catch (error) {
    console.error("selectFootnoteBusinessFeeIds failed:", error);
  }
  const footnoteParam = options.institutionId ? "$2" : "$1";
  let rows: BusinessFeeRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<BusinessFeeRow[]>(
      `WITH live AS (
         SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id,
                sd.document_url, fp.canonical_fee_key, fp.amount,
                ${BUSINESS_DOC_SQL("sd.document_url")} AS business_document,
                ${BUSINESS_DOC_SQL("sd.document_url")} OR ${BUSINESS_NAME_SQL("fp.fee_name")}
                  OR fp.fee_published_id = ANY(${footnoteParam}::bigint[]) AS business
           FROM published_fee_records fp
           JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
           JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
           JOIN source_documents sd ON sd.id = fr.source_document_id
          WHERE fp.rolled_back_at IS NULL
          AND fp.quarantined_at IS NULL
          AND fp.fee_audience = 'unknown'
            ${options.institutionId ? "AND fp.institution_id = $1" : ""}
       ),
       -- The first live consumer fee per bank and category, grouped once. A subquery per
       -- business fee rescanned the whole CTE each time: 12.5 s average on Oct 8.
       consumer AS (
         SELECT institution_id, canonical_fee_key, min(fee_published_id) AS consumer_fee_id
           FROM live
          WHERE NOT business
          GROUP BY institution_id, canonical_fee_key
       )
       SELECT b.fee_published_id, b.fee_verified_id, b.institution_id, b.source_document_id, b.document_url,
              b.canonical_fee_key, b.amount, c.consumer_fee_id, b.business_document
         FROM live b
         LEFT JOIN consumer c ON c.institution_id = b.institution_id AND c.canonical_fee_key = b.canonical_fee_key
        WHERE b.business
        ORDER BY b.fee_published_id`,
      options.institutionId ? [options.institutionId, footnoteIds] : [footnoteIds],
    ));
  } catch (error) {
    console.error("retireBusinessScheduleFees read failed:", error);
    return result;
  }
  result.businessFees = rows.length;
  const failing: BusinessScheduleTakedown[] = [];
  const passing: number[] = [];
  const footnoted = new Set(footnoteIds);
  for (const row of rows) {
    const consumerFeeId = num(row.consumer_fee_id);
    // The page says the fee is not a consumer's ("Only applicable to business accounts. This fee
    // is not charged to consumer accounts."), so no consumer page shows it, beside a consumer fee
    // or not.
    const footnote = footnoted.has(Number(row.fee_published_id));
    if (consumerFeeId == null && !footnote) {
      passing.push(Number(row.fee_published_id));
      continue;
    }
    failing.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      documentUrl: row.document_url,
      canonicalFeeKey: row.canonical_fee_key,
      amount: num(row.amount),
      consumerFeeId,
      businessDocument: row.business_document !== false,
      reason: consumerFeeId == null ? BUSINESS_FOOTNOTE_REASON : `${BUSINESS_SCHEDULE_REASON}: consumer fee #${consumerFeeId}`,
    });
  }
  result.withConsumerFee = failing.length;

  result.restored = await restoreBusinessScheduleTakedowns(db, options);
  const look = await secondLook(db, { check: BUSINESS_SCHEDULE_CHECK, runId: options.runId, failing, passing, dryRun: options.dryRun });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  const confirmed = look.confirmed.slice(0, limit);
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
                 WHEN fv.outlier_flags ? ${BUSINESS_SCHEDULE_FLAG} THEN fv.outlier_flags
                 ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${BUSINESS_SCHEDULE_FLAG}::text)
               END
         WHERE fv.fee_verified_id = ANY(${closed.map((fee) => fee.feeVerifiedId)}::bigint[])
           AND fv.review_status IN ('verified', 'approved')
      `;
      return closed;
    });
  } catch (error) {
    console.error("business schedule rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  // One lesson per business document, for Magellan: the link it holds is not the consumer schedule.
  // A business-named fee from a mixed schedule says nothing about the link; its second look
  // (takedown_confirmed) is the lesson, and Knox holds its re-read for review (takedown-lessons.ts).
  const documents = new Map<number, BusinessScheduleTakedown>();
  for (const fee of result.rolledBack) {
    if (fee.businessDocument && fee.sourceDocumentId != null && !documents.has(fee.sourceDocumentId)) documents.set(fee.sourceDocumentId, fee);
  }
  const lessons: FeedbackRow[] = [...documents.values()].map((fee) => ({
    aboutStage: "discover",
    signal: "wrong",
    kind: "wrong_document",
    reportedBy: "hamilton",
    checkName: BUSINESS_SCHEDULE_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    sourceUrl: fee.documentUrl,
    runId: options.runId,
    dedupeKey: `${BUSINESS_SCHEDULE_CHECK}:doc:${fee.sourceDocumentId}`,
    evidence: {
      reason: "business_only_schedule",
      document_url: fee.documentUrl,
      fees_taken_down: result.rolledBack.filter((other) => other.sourceDocumentId === fee.sourceDocumentId).length,
    },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.business_schedule_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} business-schedule fee(s) shown beside the bank's consumer fee`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            documents: documents.size,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              amount: fee.amount,
              consumer_fee_id: fee.consumerFeeId,
              document_url: fee.documentUrl,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("business schedule lesson/event failed:", error);
  }
  return result;
}

/**
 * Brings back business-schedule takedowns whose bank no longer has a live consumer fee in
 * that category, with the verified row. Returns the count (what would come back, in a dry run).
 */
export async function restoreBusinessScheduleTakedowns(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number },
): Promise<number> {
  try {
    return await inSavepoint(db, async (scope) => {
      const candidates = await scope<{ fee_published_id: number | string; lineage_ref: number | string }[]>`
        SELECT fp.fee_published_id, fp.lineage_ref
          FROM published_fee_records fp
         WHERE fp.rolled_back_at IS NOT NULL
           AND fp.quarantined_at IS NULL
           AND fp.rolled_back_reason LIKE ${`${BUSINESS_SCHEDULE_REASON}:%`}
           AND fp.rolled_back_reason <> ${BUSINESS_FOOTNOTE_REASON}
           ${options.institutionId ? scope`AND fp.institution_id = ${options.institutionId}` : scope``}
           AND NOT EXISTS (
             SELECT 1 FROM published_fee_records live
              WHERE live.rolled_back_at IS NULL
                AND live.institution_id = fp.institution_id
                AND live.canonical_fee_key = fp.canonical_fee_key
           )
         LIMIT ${BUSINESS_SCHEDULE_ROLLBACK_LIMIT}
      `;
      if (options.dryRun || candidates.length === 0) return candidates.length;
      const restored = await scope<{ lineage_ref: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NULL, rolled_back_by_batch_id = NULL, rolled_back_reason = NULL
         WHERE fp.fee_published_id = ANY(${candidates.map((row) => Number(row.fee_published_id))}::bigint[])
           AND fp.rolled_back_reason LIKE ${`${BUSINESS_SCHEDULE_REASON}:%`}
        RETURNING fp.lineage_ref
      `;
      if (restored.length === 0) return 0;
      await scope`
        UPDATE verified_fee_observations
           SET review_status = 'verified',
               outlier_flags = (outlier_flags - ${BUSINESS_SCHEDULE_FLAG}::text) || jsonb_build_array('business_schedule_restored:no_consumer_fee'::text)
         WHERE fee_verified_id = ANY(${restored.map((row) => Number(row.lineage_ref))}::bigint[])
           AND review_status = 'rejected'
      `;
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (${options.runId}, 'hamilton.business_schedule_restored', 'completed',
                ${`Restored ${restored.length} business-schedule fee(s) whose consumer fee is no longer live`},
                ${JSON.stringify({ restored: restored.length, reason: "no_consumer_fee" })}::jsonb)
      `;
      invalidatePublicReadCache();
      return restored.length;
    });
  } catch (error) {
    console.error("business schedule restore failed:", error);
    return 0;
  }
}
