"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetSessionChrome } from "@/components/use-session-chrome";
import { loginAction } from "./actions";
import { useHydrated } from "@/lib/use-hydrated";
import {
  UTILITY_FORM,
  UTILITY_INPUT,
  UTILITY_LABEL,
  UTILITY_SUBMIT,
  utilityNotice,
} from "@/components/utility/form-style";

interface LoginFormProps {
  redirectTo: string;
  forgotPasswordHref: string;
}

export function LoginForm({ redirectTo, forgotPasswordHref }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(e.currentTarget);
    try {
      const result = await loginAction(formData, redirectTo);
      if (result.success && result.redirect) {
        // The header cached "signed out" when /login loaded; re-read it so the next page
        // shows Account and Sign out, not Sign in.
        resetSessionChrome();
        router.push(result.redirect);
        return;
      }
      setError(result.error || "Invalid email or password");
    } catch {
      setError("Sign-in is temporarily unavailable. Please try again.");
    }
    setPending(false);
  }

  return (
    <form method="post" onSubmit={handleSubmit} className={UTILITY_FORM}>
      {error && (
        <div role="alert" className={utilityNotice("error")}>
          {error}
        </div>
      )}

      <div>
        <label htmlFor="username" className={UTILITY_LABEL}>
          Work email
        </label>
        <input
          id="username"
          name="username"
          type="text"
          inputMode="email"
          required
          autoComplete="username"
          className={UTILITY_INPUT}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="password" className="block text-[13px] font-medium text-ink">
            Password
          </label>
          <a
            href={forgotPasswordHref}
            className="text-[13px] font-medium text-brick underline-offset-2 hover:underline"
          >
            Forgot password?
          </a>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={UTILITY_INPUT}
        />
      </div>

      <button
        type="submit"
        disabled={pending || !hydrated}
        className={UTILITY_SUBMIT}
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
