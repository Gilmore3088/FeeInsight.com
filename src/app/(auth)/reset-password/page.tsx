import type { Metadata } from "next";
import Link from "next/link";
import { parsePasswordResetToken } from "@/lib/password-reset";
import { AUTH_FORM_CLASS, AuthCard } from "../auth-card";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
  // The token is in the URL; keep it out of Referer headers to other sites.
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const parsed = parsePasswordResetToken(token);

  return (
    <AuthCard title="Choose a new password">
      {parsed ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div role="status" className={AUTH_FORM_CLASS}>
          <p className="text-sm text-[#1A1815]">This reset link has expired or isn&apos;t complete.</p>
          <Link href="/forgot-password" className="text-sm font-medium text-[#C44B2E] hover:underline">
            Get a new link
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
