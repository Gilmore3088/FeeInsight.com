"use client";

import { useActionState, useState } from "react";
import { createApiKeyAction, type CreateKeyState } from "./actions";

const initialState: CreateKeyState = {};

export function CreateKeyForm() {
  const [state, formAction, pending] = useActionState(createApiKeyAction, initialState);
  const [copied, setCopied] = useState(false);

  async function copyKey() {
    if (!state.key) return;
    try {
      await navigator.clipboard.writeText(state.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">Who is it for</span>
          <input
            id="organization_name"
            name="organization_name"
            required
            minLength={2}
            placeholder="betteranalyst.com"
            className="rounded-md border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">Label (optional)</span>
          <input
            id="key_name"
            name="key_name"
            placeholder="Testing"
            className="rounded-md border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">Monthly allowance</span>
          <select
            id="tier"
            name="tier"
            defaultValue="enterprise"
            className="rounded-md border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]"
          >
            <option value="enterprise">Unlimited</option>
            <option value="pro">10,000 requests</option>
            <option value="free">100 requests</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-gray-100 dark:text-gray-950"
        >
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>

      {state.error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {state.error}
        </p>
      ) : null}

      {state.key ? (
        <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="font-semibold text-emerald-900 dark:text-emerald-200">
            Key for {state.organizationName}. Copy it now: it is shown only once.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded bg-white px-2 py-1 font-mono text-xs text-gray-900 dark:bg-black/40 dark:text-gray-100">
              {state.key}
            </code>
            <button
              type="button"
              onClick={copyKey}
              className="rounded-md border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-900 dark:border-emerald-800 dark:text-emerald-200"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
