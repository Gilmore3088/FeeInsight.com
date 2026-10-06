"use client";

import { useState } from "react";
import type { SubscriptionAction } from "@/lib/email/subscription-token";
import { StateSelect } from "@/components/public/state-select";
import {
  FEE_ALERT_UNSUBSCRIBE_ACTION,
  FEE_ALERT_UNSUBSCRIBE_API_PATH,
  SUBSCRIPTION_API_PATH,
} from "@/lib/email/subscription-paths";

type PreferenceAction = SubscriptionAction | typeof FEE_ALERT_UNSUBSCRIBE_ACTION;

const COPY: Record<PreferenceAction, { prompt: string; button: string; done: string }> = {
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
  [FEE_ALERT_UNSUBSCRIBE_ACTION]: {
    prompt: "Stop all fee-change alerts for your saved institutions to",
    button: "Stop fee alerts",
    done: "Done. Fee-change alerts are off for",
  },
};

export function SubscriptionActionForm({
  action,
  email,
  token,
  uid,
}: {
  action: PreferenceAction;
  email: string;
  token: string;
  /** Account id, signed into fee-alert links. */
  uid?: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [state, setState] = useState("");
  const copy = COPY[action];

  async function submit() {
    setStatus("loading");
    try {
      const isFeeAlert = action === FEE_ALERT_UNSUBSCRIBE_ACTION;
      const resp = await fetch(isFeeAlert ? FEE_ALERT_UNSUBSCRIBE_API_PATH : SUBSCRIPTION_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isFeeAlert ? { action, uid, email, token } : { action, email, token, ...(action === "confirm" && state ? { state } : {}) },
        ),
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
      {action === "confirm" ? (
        <div className="space-y-1">
          <label htmlFor="preferences-state" className="block text-[13px] text-[#5A5347]">
            Pick your state to also get its numbers each month.
          </label>
          <StateSelect
            id="preferences-state"
            value={state}
            onChange={setState}
            className="w-full max-w-xs rounded-md border border-[#D4C9BA] bg-[#FAF7F2] px-3 py-2 text-[14px] text-[#1A1815] focus:outline-none focus:ring-1 focus:ring-[#C44B2E]/30"
          />
        </div>
      ) : null}
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
