export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import type { Metadata } from "next";
import { resolvePostLoginRedirect, sanitizeInternalRedirect } from "@/lib/safe-redirect";
import Link from "next/link";
import { UtilityFootnote, UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_LINK, UTILITY_QUIET_LINK } from "@/components/utility/form-style";

export const metadata: Metadata = {
  title: "Sign In",
};

const FORGOT_PASSWORD_HREF = "/forgot-password";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const destination = sanitizeInternalRedirect(params.from, "/account");

  if (user) {
    redirect(resolvePostLoginRedirect(destination, user.role));
  }

  const registerHref = params.from
    ? `/register?from=${encodeURIComponent(params.from)}`
    : "/register";
  // Signed-out visitors to /pro land here. A prospect who has never paid needs the way to
  // the plans, not only a sign-in form.
  const proPlansHref =
    destination === "/pro" || destination.startsWith("/pro/") || destination.startsWith("/pro?")
      ? `/subscribe?from=${encodeURIComponent(destination)}#pro`
      : null;

  return (
    <UtilityShell>
      <UtilityHeading title="Sign in" />
      <LoginForm redirectTo={params.from || "/account"} forgotPasswordHref={FORGOT_PASSWORD_HREF} />
      <UtilityFootnote>
        Don&apos;t have an account?{" "}
        <Link href={registerHref} className={UTILITY_QUIET_LINK}>
          Create one
        </Link>
      </UtilityFootnote>
      {proPlansHref && (
        <p className="mt-2 text-center text-[14px] text-ink-muted">
          New to Pro?{" "}
          <Link href={proPlansHref} className={UTILITY_LINK}>
            See plans and prices
          </Link>
        </p>
      )}
    </UtilityShell>
  );
}
