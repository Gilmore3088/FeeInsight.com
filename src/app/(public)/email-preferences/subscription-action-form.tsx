"use client";

import { useState } from "react";
import type { SubscriptionAction } from "@/lib/email/subscription-token";

const COPY: Record<SubscriptionAction, { prompt: string; button: string; done: string }> = {
  confirm: {
    prompt: "Confirm that you want fee updates sent to",
    button: "Confirm my email",
    done: "Confirmed. Updates will arrive at",
  },
  unsubscribe: {
    prompt: "Stop all fee update emails to",
    button: "Unsubscribe",
    done: "Unsubscribed. We won't send updates to",
  },
};

export function SubscriptionActionForm({
  action,
  email,
  token,
}: {
  action: SubscriptionAction;
  email: string;
  token: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const copy = COPY[action];

  async function submit() {
    setStatus("loading");
    try {
      const resp = await fetch("/api/leads/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email, token }),
      });
      if (resp.ok) {
        setStatus("done");
        return;
      }
      const body = (await resp.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Something went wrong — try again.");
      setStatus("error");
    } catch {
      setError("Something went wrong — try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <p className="mt-4 text-[15px] leading-relaxed text-[#1A1815]" role="status">
        {copy.done} <strong>{email}</strong>.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[15px] leading-relaxed text-[#5A5347]">
        {copy.prompt} <strong className="text-[#1A1815]">{email}</strong>?
      </p>
      <button
        type="button"
        onClick={submit}
        disabled={status === "loading"}
        className="rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25] disabled:opacity-50"
      >
        {status === "loading" ? "Saving…" : copy.button}
      </button>
      {status === "error" && (
        <p className="text-[13px] text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
