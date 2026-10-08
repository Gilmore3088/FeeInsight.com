"use client";

import Link from "next/link";
import { useState } from "react";
import { AUTH_BUTTON_CLASS, AUTH_FORM_CLASS, AUTH_INPUT_CLASS } from "../auth-card";
import { resetPassword } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
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
      <div role="status" className={AUTH_FORM_CLASS}>
        <p className="text-sm text-[#1A1815]">Your password is changed, and you&apos;re signed out on every device.</p>
        <Link href="/login" className={`block text-center ${AUTH_BUTTON_CLASS}`}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={AUTH_FORM_CLASS}>
      <input type="hidden" name="token" value={token} />
      {error && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}{" "}
          {error.includes("expired") && (
            <Link href="/forgot-password" className="font-medium underline">
              Get a new link
            </Link>
          )}
        </div>
      )}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-[#1A1815] mb-1">
          New password
        </label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={AUTH_INPUT_CLASS} />
        <p className="mt-1 text-xs text-[#6B6255]">At least 8 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-[#1A1815] mb-1">
          Confirm new password
        </label>
        <input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" className={AUTH_INPUT_CLASS} />
      </div>
      <button type="submit" disabled={pending} className={AUTH_BUTTON_CLASS}>
        {pending ? "Saving..." : "Set new password"}
      </button>
    </form>
  );
}
