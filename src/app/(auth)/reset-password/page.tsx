import type { Metadata } from "next";
import Link from "next/link";
import { parsePasswordResetToken } from "@/lib/password-reset";
import { AuthCard } from "../auth-card";
import { UTILITY_CARD, UTILITY_LINK } from "@/components/utility/form-style";
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
        <div role="status" className={`${UTILITY_CARD} space-y-4`}>
          <p className="text-[15px] leading-relaxed text-ink">This reset link has expired or isn&apos;t complete.</p>
          <Link href="/forgot-password" className={`text-[14px] ${UTILITY_LINK}`}>
            Get a new link
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
