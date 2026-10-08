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
  revalidateQueuePages();
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
