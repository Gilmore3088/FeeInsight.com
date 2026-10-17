"use client";

import { useState } from "react";
import { HoneypotField } from "@/components/public/honeypot-field";
import { AUTH_BUTTON_CLASS, AUTH_FORM_CLASS, AUTH_INPUT_CLASS } from "../auth-card";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await requestPasswordReset(new FormData(e.currentTarget));
      if (result.ok) setSent(true);
      else setError(result.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Password reset is unavailable right now. Please try again shortly.");
    }
    setPending(false);
  }

  if (sent) {
    return (
      <div role="status" className={AUTH_FORM_CLASS}>
        <p className="text-sm text-ink">
          If that email has an account, a reset link is on its way. It works for one hour.
        </p>
        <p className="text-sm text-ink-muted">Nothing after a few minutes? Check your spam folder, then try again.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`relative ${AUTH_FORM_CLASS}`}>
      <HoneypotField />
      <p className="text-sm text-ink-muted">Enter the email you signed up with and we&apos;ll send a link to choose a new password.</p>
      {error && (
        <div role="alert" className="text-sm text-brick bg-brick-tint/40 border border-brick/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink mb-1">
          Work email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={AUTH_INPUT_CLASS} />
      </div>
      <button type="submit" disabled={pending} className={AUTH_BUTTON_CLASS}>
        {pending ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
