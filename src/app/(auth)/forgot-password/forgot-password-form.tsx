"use client";

import { useState } from "react";
import {
  UTILITY_CARD,
  UTILITY_FORM,
  UTILITY_INPUT,
  UTILITY_LABEL,
  UTILITY_SUBMIT,
  utilityNotice,
} from "@/components/utility/form-style";
import { HoneypotField } from "@/components/public/honeypot-field";
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
      <div role="status" className={`${UTILITY_CARD} space-y-4`}>
        <p className="text-[15px] leading-relaxed text-ink">
          If that email has an account, a reset link is on its way. It works for one hour.
        </p>
        <p className="text-[14px] leading-relaxed text-ink-muted">Nothing after a few minutes? Check your spam folder, then try again.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`relative ${UTILITY_FORM}`}>
      <HoneypotField />
      <p className="text-[14px] leading-relaxed text-ink-muted">Enter the email you signed up with and we&apos;ll send a link to choose a new password.</p>
      {error && (
        <div role="alert" className={utilityNotice("error")}>
          {error}
        </div>
      )}
      <div>
        <label htmlFor="email" className={UTILITY_LABEL}>
          Work email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={UTILITY_INPUT} />
      </div>
      <button type="submit" disabled={pending} className={UTILITY_SUBMIT}>
        {pending ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
