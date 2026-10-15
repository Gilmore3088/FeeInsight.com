"use client";

import Link from "next/link";
import { useState } from "react";
import type { SubscriptionAction } from "@/lib/email/subscription-token";
import { StateSelect } from "@/components/public/state-select";
import {
  FEE_ALERT_UNSUBSCRIBE_ACTION,
  FEE_ALERT_UNSUBSCRIBE_API_PATH,
  PRO_DIGEST_UNSUBSCRIBE_ACTION,
  SUBSCRIPTION_API_PATH,
} from "@/lib/email/subscription-paths";

type PreferenceAction =
  | SubscriptionAction
  | typeof FEE_ALERT_UNSUBSCRIBE_ACTION
  | typeof PRO_DIGEST_UNSUBSCRIBE_ACTION;

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
  [PRO_DIGEST_UNSUBSCRIBE_ACTION]: {
    prompt: "Stop the Monday Hamilton digest to",
    button: "Stop the digest",
    done: "Done. The Monday digest is off for",
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
      const isFeeAlert = action === FEE_ALERT_UNSUBSCRIBE_ACTION || action === PRO_DIGEST_UNSUBSCRIBE_ACTION;
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
      <p className="mt-4 text-[15px] leading-relaxed text-ink" role="status">
        {copy.done} <strong>{email}</strong>.
        {action === "confirm" ? (
          <span className="mt-4 block text-[14px] text-ink-soft">
            While you wait for the first one:{" "}
            <Link href="/reports/benchmark/national" className="text-brick underline">open the national report</Link>
            {" "}or{" "}
            <Link href="/research" className="text-brick underline">see your state&apos;s fees</Link>.
          </span>
        ) : null}
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[15px] leading-relaxed text-ink-soft">
        {copy.prompt} <strong className="text-ink">{email}</strong>?
      </p>
      {action === "confirm" ? (
        <div className="space-y-1">
          <label htmlFor="preferences-state" className="block text-[13px] text-ink-soft">
            Pick your state to also get its numbers each month.
          </label>
          <StateSelect
            id="preferences-state"
            value={state}
            onChange={setState}
            className="w-full max-w-xs rounded-md border border-border bg-paper px-3 py-2 text-[14px] text-ink focus:outline-none focus:ring-1 focus:ring-brick/30"
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={status === "loading"}
        className="rounded-md bg-brick px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brick-ink disabled:opacity-50"
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
