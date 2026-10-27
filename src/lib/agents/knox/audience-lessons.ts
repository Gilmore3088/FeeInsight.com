import type { sql } from "@/lib/data-store/connection";
import { feeApplicability } from "@/lib/fee-audience";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { BUSINESS_DOC_SQL, BUSINESS_SCHEDULE_CHECK, BUSINESS_SCHEDULE_REASON } from "@/lib/agents/hamilton/business-schedule";
import { CONFIRMED_KIND } from "@/lib/agents/hamilton/second-look";
import { lessonName } from "./lessons";
import type { ExtractedFeeCandidate } from "./rules";

type SqlTag = typeof sql;

/**
 * Knox's audience lessons (#2062, #2579): a business fee Knox read with no audience, which Hamilton's
 * business-schedule check took down as a business price on a consumer page and its second look
 * confirmed (`takedown_confirmed`, check `hamilton.business_schedule`), teaches Knox that the same
 * document's fee is a business fee. Before this, `takedown-lessons.ts` loaded these rows but acted only
 * on the limit guard's, so every re-read of the document read the fee as unknown again, the consumer
 * index counted it as personal until the check took it down once more, and nothing learned.
 *
 * A lesson is one of two, both scoped to the document the takedown read (a bank can print the same
 * name at a business price on one schedule and a consumer price on another, so a lesson never spans
 * the bank's other documents):
 * - name: the document's fee of that exact name (`lessonName`) is business. Covers a business-named fee
 *   on a mixed schedule ("Business ATM/Debit Transactions") and a business-only footnote's fee.
 * - document: the document's address names a business-only schedule (`BUSINESS_DOC_SQL`, the check's
 *   own rule), so each of its fees is business, as the check already judges them.
 * Only a takedown still down for its business-schedule reason counts: a restored fee, or one later
 * taken down for something else, teaches nothing. A lesson applies only when Knox's own read of the
 * line has no audience (`feeApplicability` says unknown): a line that states consumer stays consumer.
 *
 * The lesson labels the read `fee_audience = 'business'` with its evidence and the flag
 * `knox_lesson:business_audience:<scope>`; Darwin still checks the fee. It changes how a re-read fee
 * is judged, so it applies only with `KNOX_AUDIENCE_LESSONS_LIVE` on. Off, the extract step still
 * loads the lessons and counts the reads they would label (`audienceLessonMatches`), the live dry run.
 * Deterministic: no provider call.
 */
export const KNOX_AUDIENCE_LESSONS_VERSION = 1;
export const KNOX_AUDIENCE_LESSONS_SWITCH = "KNOX_AUDIENCE_LESSONS_LIVE";
/** Lessons read per extract step; 396 confirmed business-schedule takedowns were still down on 2026-10-27. */
const AUDIENCE_LESSON_LIMIT = 5000;

/** The switch reads on for "1" or "true", allowing for stray spaces, quotes and capitals. */
export function audienceLessonsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[KNOX_AUDIENCE_LESSONS_SWITCH];
  if (raw == null) return false;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export type AudienceLessonScope = "name" | "document";
export interface AudienceLessonMatch {
  scope: AudienceLessonScope;
  /** The confirmed takedown row the lesson comes from. */
  feedbackId: number;
}
export interface AudienceLessons {
  /** `<source_document_id>|<name key>` -> the takedown that teaches it. */
  names: Map<string, number>;
  /** Business-only documents -> the first takedown read from them. */
  documents: Map<number, number>;
  /** Takedown rows read. */
  loaded: number;
  readFailed?: boolean;
}

export function emptyAudienceLessons(): AudienceLessons {
  return { names: new Map(), documents: new Map(), loaded: 0 };
}

const nameKey = (sourceDocumentId: number, feeName: string) => `${sourceDocumentId}|${lessonName(feeName)}`;

export interface AudienceLessonRow {
  feedback_id: number | string;
  source_document_id: number | string;
  fee_name: string | null;
  business_document: boolean | null;
}

/** Pure: the lessons a set of confirmed takedown rows teach. */
export function audienceLessonsFrom(rows: readonly AudienceLessonRow[]): AudienceLessons {
  const lessons = emptyAudienceLessons();
  for (const row of rows) {
    const documentId = Number(row.source_document_id), feedbackId = Number(row.feedback_id);
    if (!Number.isSafeInteger(documentId) || documentId <= 0 || !Number.isSafeInteger(feedbackId)) continue;
    lessons.loaded += 1;
    if (row.fee_name && lessonName(row.fee_name)) {
      const key = nameKey(documentId, row.fee_name);
      if (!lessons.names.has(key)) lessons.names.set(key, feedbackId);
    }
    if (row.business_document === true && !lessons.documents.has(documentId)) lessons.documents.set(documentId, feedbackId);
  }
  return lessons;
}

/**
 * The confirmed business-schedule takedowns read from these documents that are still down for that
 * reason. Read-only; a failed read returns no lessons (`readFailed`), never blocks the step.
 */
export async function loadAudienceLessons(db: SqlTag, sourceDocumentIds: readonly number[]): Promise<AudienceLessons> {
  const ids = [...new Set(sourceDocumentIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return emptyAudienceLessons();
  try {
    return await inSavepoint(db, async (scope) => {
      if (!(await feedbackSchemaReady(scope))) return emptyAudienceLessons();
      const rows = await scope<AudienceLessonRow[]>`
        SELECT f.id AS feedback_id, fr.source_document_id, fr.fee_name,
               ${scope.unsafe(BUSINESS_DOC_SQL("sd.document_url"))} AS business_document
          FROM pipeline_feedback f
          JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          JOIN source_documents sd ON sd.id = fr.source_document_id
         WHERE f.kind = ${CONFIRMED_KIND}
           AND f.check_name = ${BUSINESS_SCHEDULE_CHECK}
           AND fp.rolled_back_at IS NOT NULL
           AND left(fp.rolled_back_reason, ${BUSINESS_SCHEDULE_REASON.length + 1}) = ${`${BUSINESS_SCHEDULE_REASON}:`}
           AND fr.source_document_id = ANY(${ids}::bigint[])
         ORDER BY f.id
         LIMIT ${AUDIENCE_LESSON_LIMIT}`;
      return audienceLessonsFrom(rows);
    });
  } catch (error) {
    console.error("loadAudienceLessons failed:", error);
    return { ...emptyAudienceLessons(), readFailed: true };
  }
}

/** Pure: the lesson for a read from this document, when Knox's own read of the line gives no audience. */
export function audienceLessonFor(candidate: ExtractedFeeCandidate, lessons: AudienceLessons, sourceDocumentId: number): AudienceLessonMatch | null {
  if (lessons.loaded === 0 || !Number.isSafeInteger(sourceDocumentId)) return null;
  if (feeApplicability(candidate.feeName, candidate.excerpt, candidate.amount).feeAudience !== "unknown") return null;
  const named = lessons.names.get(nameKey(sourceDocumentId, candidate.feeName));
  if (named != null) return { scope: "name", feedbackId: named };
  const document = lessons.documents.get(sourceDocumentId);
  return document != null ? { scope: "document", feedbackId: document } : null;
}

export function audienceLessonFlag(scope: AudienceLessonScope): string {
  return `knox_lesson:business_audience:${scope}`;
}

/** The read with the lesson's audience; `candidateWriteFacts` writes it while the line itself states none. */
export function withAudienceLesson(candidate: ExtractedFeeCandidate, match: AudienceLessonMatch): ExtractedFeeCandidate {
  return {
    ...candidate,
    audienceLesson: {
      audience: "business",
      evidence: `knox_lesson:${BUSINESS_SCHEDULE_CHECK}:${match.scope} (confirmed takedown feedback #${match.feedbackId})`,
    },
  };
}
