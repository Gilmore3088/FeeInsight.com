import type { sql } from "@/lib/data-store/connection";
import { feeApplicability } from "@/lib/fee-audience";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { BUSINESS_DOC_SQL, BUSINESS_SCHEDULE_CHECK, BUSINESS_SCHEDULE_REASON } from "@/lib/agents/hamilton/business-schedule";
import { CONFIRMED_KIND } from "@/lib/agents/hamilton/second-look";
import { businessSectionPlacement, pricedSectionAudiences } from "./audience-context";
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
 * - name: the document's fee of that exact name (`lessonName`) and amount is business. Covers a
 *   business-named fee on a mixed schedule ("Business ATM/Debit Transactions") and a business-only
 *   footnote's fee. A mixed schedule can print the same name at a consumer price on another line, so
 *   a same-name read at another amount is not taught; a new business price on a new copy waits for
 *   its own takedown.
 * - document: the document's address names a business-only schedule (`BUSINESS_DOC_SQL`, the check's
 *   own rule), so each of its fees is business, as the check already judges them. v2 (#2072): the
 *   address alone is not trusted for every fee. The document's stored text (`agent_source_texts`) is
 *   read first: a text that holds a priced personal section (a tabbed page whose address names its
 *   business tab, as Portland FCU's `Fee-Schedule?panel=Business-Fees` holds the whole page: Personal
 *   Fees, then Business Fees, then Safe Deposit Boxes for all members) teaches only the fees whose
 *   own line sits under a business heading (`businessSectionPlacement`); a fee under a personal or
 *   general heading, or one whose line cannot be placed, stays unknown. No stored text, no document
 *   lesson. Sampled before v2 at 27/47 correct, all 20 errors on that one document.
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
export const KNOX_AUDIENCE_LESSONS_VERSION = 2;
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
  /** `<source_document_id>|<name key>|<amount>` -> the takedown that teaches it. */
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

/** Cents, so 2 and "2.00" are one amount; null for no usable amount. */
const cents = (amount: unknown): number | null => {
  const value = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() ? Number(amount) : NaN;
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};
const nameKey = (sourceDocumentId: number, feeName: string, amountCents: number) => `${sourceDocumentId}|${lessonName(feeName)}|${amountCents}`;

export interface AudienceLessonRow {
  feedback_id: number | string;
  source_document_id: number | string;
  fee_name: string | null;
  /** The raw read's amount: a name lesson teaches only that price. */
  amount: number | string | null;
  business_document: boolean | null;
}

/** Pure: the lessons a set of confirmed takedown rows teach. */
export function audienceLessonsFrom(rows: readonly AudienceLessonRow[]): AudienceLessons {
  const lessons = emptyAudienceLessons();
  for (const row of rows) {
    const documentId = Number(row.source_document_id), feedbackId = Number(row.feedback_id);
    if (!Number.isSafeInteger(documentId) || documentId <= 0 || !Number.isSafeInteger(feedbackId)) continue;
    lessons.loaded += 1;
    const amount = cents(row.amount);
    if (row.fee_name && lessonName(row.fee_name) && amount != null) {
      const key = nameKey(documentId, row.fee_name, amount);
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
        SELECT f.id AS feedback_id, fr.source_document_id, fr.fee_name, fr.amount,
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
           AND fr.source = 'knox'
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

/**
 * Pure (#2072): whether a business-only document's lesson holds for this fee, judged from the
 * document's stored text. A text with a priced personal section holds more than the business
 * schedule its address names, so the fee's own line must sit under a business heading.
 */
export function documentLessonHolds(candidate: Pick<ExtractedFeeCandidate, "feeName" | "amount">, documentText: string | null): boolean {
  if (!documentText?.trim()) return false;
  const lines = documentText.split("\n");
  if (!pricedSectionAudiences(lines).has("consumer")) return true;
  return businessSectionPlacement(lines, candidate.feeName, candidate.amount).placed === "business";
}

/**
 * Pure: the lesson for a read from this document, when Knox's own read of the line gives no audience.
 * `documentText` is the document's stored text the read came from; a document lesson needs it.
 */
export function audienceLessonFor(
  candidate: ExtractedFeeCandidate,
  lessons: AudienceLessons,
  sourceDocumentId: number,
  documentText: string | null,
): AudienceLessonMatch | null {
  if (lessons.loaded === 0 || !Number.isSafeInteger(sourceDocumentId)) return null;
  if (feeApplicability(candidate.feeName, candidate.excerpt, candidate.amount).feeAudience !== "unknown") return null;
  const amount = cents(candidate.amount);
  const named = amount == null ? undefined : lessons.names.get(nameKey(sourceDocumentId, candidate.feeName, amount));
  if (named != null) return { scope: "name", feedbackId: named };
  const document = lessons.documents.get(sourceDocumentId);
  return document != null && documentLessonHolds(candidate, documentText) ? { scope: "document", feedbackId: document } : null;
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
