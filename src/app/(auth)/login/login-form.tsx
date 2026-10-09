"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetSessionChrome } from "@/components/use-session-chrome";
import { loginAction } from "./actions";

interface LoginFormProps {
  redirectTo: string;
  forgotPasswordHref: string;
}

export function LoginForm({ redirectTo, forgotPasswordHref }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    <form onSubmit={handleSubmit} className="bg-[#FFFDF9] rounded-lg border border-[#E8DFD1] shadow-sm p-6 space-y-4">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="username" className="block text-sm font-medium text-[#1A1815] mb-1">
          Work email
        </label>
        <input
          id="username"
          name="username"
          type="text"
          inputMode="email"
          required
          autoComplete="username"
          className="w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C44B2E] focus:border-transparent"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="password" className="block text-sm font-medium text-[#1A1815]">
            Password
          </label>
          <a
            href={forgotPasswordHref}
            className="text-xs font-medium text-[#6B6255] hover:text-[#1A1815] hover:underline"
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
          className="w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C44B2E] focus:border-transparent"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A83D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
