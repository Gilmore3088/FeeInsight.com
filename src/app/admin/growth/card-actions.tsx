"use client";

import { useState } from "react";
import type { ContentDraftStatus } from "@/lib/data-store/content-drafts";
import { saveDraftTextAction, setDraftStatusAction } from "../customers/content/actions";

const BUTTON = "inline-flex min-h-9 items-center rounded-md px-3 py-1.5 text-sm font-medium";
const PRIMARY = `${BUTTON} bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900`;
const SECONDARY = `${BUTTON} border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300`;
const TOGGLED = `${BUTTON} border border-gray-900 bg-gray-100 text-gray-900 dark:border-gray-100 dark:bg-white/[0.1] dark:text-gray-100`;
const FIELD =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

function StatusButton({ id, status, text, primary }: { id: number; status: ContentDraftStatus; text: string; primary?: boolean }) {
  return (
    <form action={setDraftStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={primary ? PRIMARY : SECONDARY}>
        {text}
      </button>
    </form>
  );
}

type Panel = "skip" | "edit" | null;

/**
 * A queue card's buttons. The primary action is one tap; "Skip" and "Edit" open their
 * fields underneath the row (one at a time), so no field or textarea shows on load.
 */
export function CardActions({ id, status, title, caption }: { id: number; status: ContentDraftStatus; title: string; caption: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const toggle = (next: Exclude<Panel, null>) => setPanel((open) => (open === next ? null : next));
  const canSkip = status === "draft" || status === "approved";
  const canEdit = status === "draft";

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" ? <StatusButton id={id} status="approved" text="Approve" primary /> : null}
        {status === "approved" ? <StatusButton id={id} status="posted" text="Mark done" primary /> : null}
        {canSkip ? (
          <button type="button" aria-expanded={panel === "skip"} aria-controls={`skip-${id}`} onClick={() => toggle("skip")} className={panel === "skip" ? TOGGLED : SECONDARY}>
            Skip
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" aria-expanded={panel === "edit"} aria-controls={`edit-${id}`} onClick={() => toggle("edit")} className={panel === "edit" ? TOGGLED : SECONDARY}>
            Edit
          </button>
        ) : null}
        {status === "skipped" ? <StatusButton id={id} status="draft" text="Back to review" /> : null}
      </div>

      {canSkip && panel === "skip" ? (
        <form id={`skip-${id}`} action={setDraftStatusAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value="skipped" />
          <input
            type="text"
            name="reason"
            maxLength={500}
            placeholder="Reason (optional)"
            aria-label="Reason for skipping (optional)"
            autoFocus
            className={`${FIELD} min-w-0 flex-1`}
          />
          <button type="submit" className={SECONDARY}>
            Confirm skip
          </button>
        </form>
      ) : null}

      {canEdit && panel === "edit" ? (
        <form id={`edit-${id}`} action={saveDraftTextAction} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <label className="block text-xs text-gray-500">
            Title
            <input type="text" name="title" defaultValue={title} maxLength={200} required className={`${FIELD} mt-1 font-semibold`} />
          </label>
          <label className="block text-xs text-gray-500">
            Text
            <textarea name="body" defaultValue={caption} rows={8} required className={`${FIELD} mt-1`} />
          </label>
          <button type="submit" className={SECONDARY}>
            Save edits
          </button>
        </form>
      ) : null}
    </div>
  );
}
