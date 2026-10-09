"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmRejection, overrideRejection } from "./actions";

interface Props {
  messageId: string;
  feeVerifiedId: number | null;
  disabled?: boolean;
}

function animateRowExit(btn: HTMLElement) {
  const row = btn.closest("tr");
  if (row) row.classList.add("row-exiting");
}

export function ConfirmButton({ messageId, disabled }: Props) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      start(async () => {
        animateRowExit(e.currentTarget);
        const res = await confirmRejection(messageId);
        if (!res.success) alert(res.error || "Failed to confirm");
        else router.refresh();
      });
    },
    [messageId, router]
  );

  return (
    <button
      data-action="confirm"
      disabled={pending || disabled}
      onClick={onClick}
      aria-label="Confirm Knox rejection"
      className="rounded px-2 py-1 text-xs font-medium bg-red-50 text-red-700
                 hover:bg-red-100 disabled:opacity-50
                 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors"
    >
      {pending ? "..." : "Confirm rejection"}
    </button>
  );
}

export function OverrideButton({ messageId, feeVerifiedId, disabled }: Props) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const open = useCallback(() => {
    setNote("");
    setError(null);
    dialogRef.current?.showModal();
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  const submit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = note.trim();
      if (trimmed.length < 3) {
        setError("Note must be at least 3 characters.");
        return;
      }
      start(async () => {
        const res = await overrideRejection(messageId, trimmed);
        if (!res.success) {
          setError(res.error || "Failed to override");
          return;
        }
        close();
        if (res.promoted_fee_published_id) {
          alert(
            `Override accepted. Fee promoted as published record #${res.promoted_fee_published_id}.`
          );
        } else {
          alert(
            "Override recorded. The fee was not published: that needs a Darwin accept from the last 30 days, and no later pass reads overrides."
          );
        }
        router.refresh();
      });
    },
    [note, messageId, router, close]
  );

  return (
    <>
      <button
        data-action="override"
        disabled={pending || disabled || !feeVerifiedId}
        onClick={open}
        aria-label="Override Knox rejection"
        className="rounded px-2 py-1 text-xs font-medium bg-emerald-50 text-emerald-700
                   hover:bg-emerald-100 disabled:opacity-50
                   dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30 transition-colors"
      >
        {pending ? "..." : "Override"}
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-md p-0 shadow-xl backdrop:bg-black/40
                   max-w-md w-[90vw] bg-white dark:bg-gray-900
                   text-gray-900 dark:text-gray-100"
        onClick={(e) => {
          // Backdrop click (native <dialog> reports target === the dialog).
          if (e.target === dialogRef.current) close();
        }}
      >
        <form method="dialog" onSubmit={submit} className="p-5 space-y-3">
          <h2 className="text-sm font-bold tracking-tight">
            Override Knox rejection
          </h2>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            Record your reasoning. Minimum 3 characters. The note is attached
            to <code>knox_overrides</code> and the override audit event.
          </p>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (error) setError(null);
            }}
            rows={4}
            maxLength={2000}
            placeholder="e.g., fee is legitimate; Knox pattern false-positive on $N/A language."
            className="w-full rounded border border-gray-300 dark:border-white/[0.1]
                       bg-white dark:bg-white/[0.04] px-2 py-1.5 text-[13px]
                       focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {error && (
            <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="rounded px-3 py-1.5 text-xs font-medium bg-gray-100
                         text-gray-700 hover:bg-gray-200 dark:bg-white/[0.08]
                         dark:text-gray-300 dark:hover:bg-white/[0.12]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || note.trim().length < 3}
              className="rounded px-3 py-1.5 text-xs font-semibold bg-emerald-600
                         text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Submitting..." : "Override"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function SkipButton({ messageId }: { messageId: string }) {
  // Skip is a no-op navigation hint; leaves the row in 'pending'.
  const router = useRouter();
  return (
    <button
      data-action="skip"
      onClick={() => router.refresh()}
      aria-label={`Skip rejection ${messageId}`}
      className="rounded px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600
                 hover:bg-gray-200 dark:bg-white/[0.08] dark:text-gray-400
                 dark:hover:bg-white/[0.12] transition-colors"
    >
      Skip
    </button>
  );
}
