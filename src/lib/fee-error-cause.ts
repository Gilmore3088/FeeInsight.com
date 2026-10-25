/**
 * What caused a live fee to be wrong, as the operator who holds or corrects it judges (#2057).
 * Shared by the admin forms and the server services (no database imports).
 *
 * The answer sets the `about_stage` of the operator's `pipeline_feedback` row, so the row is filed
 * against the step that made the mistake instead of always against publishing. Today only a wrong
 * document has an agent reader: Magellan's stale-link search reads it (stage discover) and searches
 * the bank's link again (`magellan/discovery.ts`), as it does for Deming's audit misses. The other
 * stages are filed for the readers still to come (#2057).
 */

import type { FeedbackStage } from "@/lib/agents/learning/feedback";

export const FEE_ERROR_CAUSES = [
  "wrong_document",
  "text_lost",
  "wrong_amount",
  "wrong_category",
  "verify_missed",
  "not_sure",
] as const;
export type FeeErrorCause = (typeof FEE_ERROR_CAUSES)[number];

/** The words the forms show for each cause. */
export const FEE_ERROR_CAUSE_LABELS: Record<FeeErrorCause, string> = {
  wrong_document: "Wrong document (another bank's, a retired page, or not a fee schedule)",
  text_lost: "Text lost or garbled when the document was read",
  wrong_amount: "Amount read wrong from the right line",
  wrong_category: "Filed under the wrong fee type",
  verify_missed: "Read right, but verification should have stopped it",
  not_sure: "Not sure yet",
};

/** The pipeline stage each cause is filed against: the step that made the mistake. */
export const FEE_ERROR_CAUSE_STAGES: Record<FeeErrorCause, FeedbackStage> = {
  wrong_document: "discover",
  text_lost: "read",
  wrong_amount: "extract",
  wrong_category: "extract",
  verify_missed: "verify",
  not_sure: "publish",
};

export function isFeeErrorCause(value: unknown): value is FeeErrorCause {
  return typeof value === "string" && (FEE_ERROR_CAUSES as readonly string[]).includes(value);
}

/** The stage a cause files the operator's row against. Pure. */
export function feeErrorStage(cause: FeeErrorCause): FeedbackStage {
  return FEE_ERROR_CAUSE_STAGES[cause];
}

/**
 * A document's address for comparing two stored copies: host without "www.", path without a
 * trailing slash, query kept, fragment dropped. Two copies of one page share it. Pure.
 */
export function documentAddress(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

/**
 * The cause a correction most likely has, from what it changes, used as the form's starting
 * choice and when none is sent. Pure. The value read from a document at another address than the
 * live fee's points to the wrong document; a newer copy of the same page is the same document
 * (the fee was read from an old copy, not from the wrong page). Otherwise a new fee type points to
 * the category, a new amount to the amount; anything else (a name, frequency or conditions only)
 * is left as not sure.
 */
export function suggestCorrectionCause(input: {
  liveDocumentUrl: string | null;
  sourceDocumentUrl: string | null;
  beforeCategory: string | null;
  afterCategory: string | null;
  beforeAmount: number | null;
  afterAmount: number | null;
}): FeeErrorCause {
  if (input.liveDocumentUrl && input.sourceDocumentUrl && documentAddress(input.liveDocumentUrl) !== documentAddress(input.sourceDocumentUrl)) {
    return "wrong_document";
  }
  if (input.afterCategory && input.beforeCategory !== input.afterCategory) return "wrong_category";
  if (input.afterAmount != null && (input.beforeAmount == null || Math.abs(input.beforeAmount - input.afterAmount) >= 0.005)) {
    return "wrong_amount";
  }
  return "not_sure";
}

/**
 * The evidence a wrong-document finding carries: the document the fee was read from (its id and
 * stored address), so Magellan's search can tell the page's current copy from an old or side copy
 * and match the link as Deming's audit misses do. Empty when the document is unknown. Pure.
 */
export function wrongDocument(documentId: number | string | null, documentUrl: string | null): { wrong_document_id?: number; wrong_document_url?: string } {
  return documentId != null && documentUrl ? { wrong_document_id: Number(documentId), wrong_document_url: documentUrl } : {};
}
