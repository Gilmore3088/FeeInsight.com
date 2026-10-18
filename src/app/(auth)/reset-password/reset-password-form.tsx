"use client";

import Link from "next/link";
import { useState } from "react";
import {
  UTILITY_CARD,
  UTILITY_FORM,
  UTILITY_HINT,
  UTILITY_INPUT,
  UTILITY_LABEL,
  UTILITY_SUBMIT,
  utilityNotice,
} from "@/components/utility/form-style";
import { resetPassword } from "./actions";
import { useHydrated } from "@/lib/use-hydrated";

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await resetPassword(new FormData(e.currentTarget));
      if (result.ok) setDone(true);
      else setError(result.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Password reset is unavailable right now. Please try again shortly.");
    }
    setPending(false);
  }

  if (done) {
    return (
      <div role="status" className={`${UTILITY_CARD} space-y-4`}>
        <p className="text-[15px] leading-relaxed text-ink">Your password is changed, and you&apos;re signed out on every device.</p>
        <Link href="/login" className={`block text-center ${UTILITY_SUBMIT}`}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={handleSubmit} className={UTILITY_FORM}>
      <input type="hidden" name="token" value={token} />
      {error && (
        <div role="alert" className={utilityNotice("error")}>
          {error}{" "}
          {error.includes("expired") && (
            <Link href="/forgot-password" className="font-medium underline">
              Get a new link
            </Link>
          )}
        </div>
      )}
      <div>
        <label htmlFor="password" className={UTILITY_LABEL}>
          New password
        </label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={UTILITY_INPUT} />
        <p className={UTILITY_HINT}>At least 8 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm" className={UTILITY_LABEL}>
          Confirm new password
        </label>
        <input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" className={UTILITY_INPUT} />
      </div>
      <button type="submit" disabled={pending || !hydrated} className={UTILITY_SUBMIT}>
        {pending ? "Saving..." : "Set new password"}
      </button>
    </form>
  );
}
