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
import {
  UTILITY_CARD,
  UTILITY_FORM,
  UTILITY_HINT,
  UTILITY_LABEL,
  UTILITY_LINK,
  UTILITY_SELECT,
  UTILITY_SUBMIT,
  utilityNotice,
} from "@/components/utility/form-style";

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
      setError(body.error ?? "Something went wrong. Try again.");
      setStatus("error");
    } catch {
      setError("Something went wrong. Try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className={`${UTILITY_CARD} space-y-3`} role="status">
        <p className="text-[15px] leading-relaxed text-ink">
          {copy.done} <strong>{email}</strong>.
        </p>
        {action === "confirm" ? (
          <p className="text-[14px] leading-relaxed text-ink-soft">
            While you wait for the first one:{" "}
            <Link href="/reports/benchmark/national" className={UTILITY_LINK}>open the national report</Link>
            {" "}or{" "}
            <Link href="/research" className={UTILITY_LINK}>see your state&apos;s fees</Link>.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={UTILITY_FORM}>
      <p className="text-[15px] leading-relaxed text-ink-soft">
        {copy.prompt} <strong className="text-ink">{email}</strong>?
      </p>
      {action === "confirm" ? (
        <div>
          <label htmlFor="preferences-state" className={UTILITY_LABEL}>
            Your state
          </label>
          <StateSelect id="preferences-state" value={state} onChange={setState} className={UTILITY_SELECT} />
          <p className={UTILITY_HINT}>Pick your state to also get its numbers each month.</p>
        </div>
      ) : null}
      {status === "error" && (
        <p className={utilityNotice("error")} role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={submit} disabled={status === "loading"} className={UTILITY_SUBMIT}>
        {status === "loading" ? "Saving…" : copy.button}
      </button>
    </div>
  );
}
