"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import {
  CONTENT_DRAFT_STATUSES,
  getContentDraft,
  setContentDraftStatus,
  updateContentDraftCaption,
  updateContentDraftText,
  type ContentDraftStatus,
} from "@/lib/data-store/content-drafts";
import { recordSkipLesson, withdrawSkipLesson } from "@/lib/agents/growth/lessons";
import { recordOutreachOutcome } from "@/lib/data-store/outreach-journey";
import { OUTREACH_OUTCOMES, parseBuyerLog, type OutreachOutcome } from "@/lib/outreach-journey";

const OUTCOME_NOTE_MAX_LENGTH = 500;

/** Both pages read the same queue (`content_drafts`), so a change refreshes both. */
const PAGES = ["/admin/customers/content", "/admin/growth"];

function revalidateQueuePages(): void {
  for (const page of PAGES) revalidatePath(page);
}

/**
 * Approve, skip (with an optional reason) or mark a draft posted. Changes only the queue;
 * nothing is posted from here. A skip with a reason becomes a lesson for the agent that
 * drafted it (`pipeline_feedback`); sending a skipped draft back to review withdraws it.
 */
export async function setDraftStatusAction(form: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = Number(form.get("id"));
  const status = String(form.get("status")) as ContentDraftStatus;
  if (!Number.isInteger(id) || !CONTENT_DRAFT_STATUSES.includes(status)) return;
  const reason = form.get("reason");
  const reasonText = typeof reason === "string" ? reason : null;
  await setContentDraftStatus(id, status, user.email ?? String(user.id), undefined, reasonText);
  await syncSkipLesson(id, status, reasonText);
  if (status === "posted") await recordSent(id, user.email ?? String(user.id));
  revalidateQueuePages();
}

/** Marking an outreach email done means James sent it: the journey's first stage. Never fails the status change. */
async function recordSent(id: number, recordedBy: string): Promise<void> {
  try {
    const draft = await getContentDraft(id);
    const institutionId = draft ? outreachInstitution(draft) : null;
    if (institutionId) await recordOutreachOutcome({ draftId: id, institutionId, outcome: "sent", note: null, recordedBy });
  } catch (error) {
    console.error("[content] outreach sent not recorded", error instanceof Error ? error.message : error);
  }
}

/** The lesson side of a status change. Never fails the status change itself. */
async function syncSkipLesson(id: number, status: ContentDraftStatus, reason: string | null): Promise<void> {
  try {
    if (status === "skipped" && reason?.trim()) {
      const draft = await getContentDraft(id);
      if (draft) await recordSkipLesson(sql, draft, draft.skipReason ?? reason);
    } else if (status === "draft") {
      await withdrawSkipLesson(sql, id);
    }
  } catch (error) {
    console.error("[content] skip lesson not written", error instanceof Error ? error.message : error);
  }
}

export async function saveCaptionAction(form: FormData): Promise<void> {
  const user = await requireAuth("edit");
  const id = Number(form.get("id"));
  const caption = String(form.get("caption") ?? "").trim();
  if (!Number.isInteger(id) || !caption) return;
  await updateContentDraftCaption(id, caption, user.email ?? String(user.id));
  revalidateQueuePages();
}

/**
 * Edits an item's title and text from `/admin/growth`. Only items still waiting for review
 * change (the store's update is limited to `draft`); an empty title or text is ignored.
 */
export async function saveDraftTextAction(form: FormData): Promise<void> {
  const user = await requireAuth("edit");
  const id = Number(form.get("id"));
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!Number.isInteger(id) || !title || !body) return;
  await updateContentDraftText(id, title, body, user.email ?? String(user.id));
  revalidateQueuePages();
}

/** The draft's institution, for an outreach email; null for any other queue item. */
function outreachInstitution(draft: { kind: string; facts: Record<string, unknown> }): number | null {
  if (draft.kind !== "outreach_email") return null;
  const id = Number(draft.facts.institution_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Records what happened after an outreach email James sent (the journey's CRM side: replied,
 * conversation, report requested, proposal, bought, declined with a reason). Writes one
 * `outreach_outcomes` row; never sends anything.
 */
export async function recordOutcomeAction(form: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = Number(form.get("id"));
  const outcome = String(form.get("outcome")) as OutreachOutcome;
  if (!Number.isInteger(id) || !OUTREACH_OUTCOMES.includes(outcome)) return;
  const draft = await getContentDraft(id);
  const institutionId = draft ? outreachInstitution(draft) : null;
  if (!institutionId) return;
  const note = String(form.get("note") ?? "").trim().slice(0, OUTCOME_NOTE_MAX_LENGTH) || null;
  const answers = parseBuyerLog((key) => form.get(key));
  await recordOutreachOutcome({ draftId: id, institutionId, outcome, note, answers, recordedBy: user.email ?? String(user.id) });
  revalidateQueuePages();
}
