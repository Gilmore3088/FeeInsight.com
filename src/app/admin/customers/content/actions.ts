"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { CONTENT_DRAFT_STATUSES, setContentDraftStatus, updateContentDraftCaption, type ContentDraftStatus } from "@/lib/data-store/content-drafts";

const PAGE = "/admin/customers/content";

/** Approve, skip or mark a draft posted. Changes only the queue; nothing is posted from here. */
export async function setDraftStatusAction(form: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const id = Number(form.get("id"));
  const status = String(form.get("status")) as ContentDraftStatus;
  if (!Number.isInteger(id) || !CONTENT_DRAFT_STATUSES.includes(status)) return;
  await setContentDraftStatus(id, status, user.email ?? String(user.id));
  revalidatePath(PAGE);
}

export async function saveCaptionAction(form: FormData): Promise<void> {
  const user = await requireAuth("edit");
  const id = Number(form.get("id"));
  const caption = String(form.get("caption") ?? "").trim();
  if (!Number.isInteger(id) || !caption) return;
  await updateContentDraftCaption(id, caption, user.email ?? String(user.id));
  revalidatePath(PAGE);
}
