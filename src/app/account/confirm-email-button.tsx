"use client";

import { useState, useTransition } from "react";
import { resendEmailConfirmation } from "./email-confirm-actions";

/** "Email me the link" for an unconfirmed account email. */
export function ConfirmEmailButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await resendEmailConfirmation();
            setMessage(result.ok ? { ok: true, text: "Sent. Check your inbox." } : { ok: false, text: result.error });
          })
        }
        className="min-h-11 text-[14px] font-medium text-[#A93D25] hover:underline disabled:opacity-50"
      >
        {pending ? "Sending…" : "Email me the link"}
      </button>
      {message && (
        <span role={message.ok ? "status" : "alert"} className={`text-[13px] ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}
