"use client";

import { useActionState } from "react";
import type { LeadEmailConfig } from "@/lib/email/lead-notification";
import { sendTestEmailAction, type TestEmailState } from "./email-actions";

const INITIAL_STATE: TestEmailState = { status: "idle", message: "" };

/** Shows how lead emails are configured and sends a real test through the same path. */
export function EmailDeliveryPanel({ config, defaultTo }: { config: LeadEmailConfig; defaultTo: string }) {
  const [state, formAction, isPending] = useActionState(sendTestEmailAction, INITIAL_STATE);

  return (
    <section className="admin-card space-y-3 px-4 py-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Lead email delivery</h2>
      <dl className="grid gap-1 text-sm sm:grid-cols-[180px_1fr]">
        <dt className="text-gray-500">RESEND_API_KEY</dt>
        <dd className={config.apiKeyConfigured ? "text-emerald-600" : "text-red-600"}>
          {config.apiKeyConfigured ? "Set" : "Missing — no lead emails can be sent"}
        </dd>
        <dt className="text-gray-500">From address</dt>
        <dd className="text-gray-900 dark:text-gray-100">
          {config.from}{" "}
          <span className="text-gray-500">
            ({config.fromSource === "default" ? "default; no From variable set" : `from ${config.fromSource}`})
          </span>
        </dd>
      </dl>
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="test-email-to" className="sr-only">
          Send a test email to
        </label>
        <input
          id="test-email-to"
          name="to"
          type="email"
          defaultValue={defaultTo}
          required
          className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
        >
          {isPending ? "Sending…" : "Send test email"}
        </button>
      </form>
      {state.status !== "idle" && (
        <p role="status" className={`text-sm ${state.status === "sent" ? "text-emerald-600" : "text-red-600"}`}>
          {state.message}
        </p>
      )}
    </section>
  );
}
