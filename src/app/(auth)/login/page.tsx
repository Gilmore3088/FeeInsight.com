export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/brand/components";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import type { Metadata } from "next";
import { resolvePostLoginRedirect, sanitizeInternalRedirect } from "@/lib/safe-redirect";
import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";
import { getPublicStatsSummary } from "@/lib/public-stats";

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
  const summary = await getPublicStatsSummary();
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
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel - hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-paper flex-col justify-center items-center px-12">
        {/* Grid texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(#132338 1px, transparent 1px), linear-gradient(90deg, #132338 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative z-10 max-w-md">
          {/* Logo */}
          <Link href="/" className="inline-flex items-center gap-2 text-ink no-underline mb-10">
            <Logo mark="fee-insight-oneline" height={22} />
          </Link>

          {/* Accent line */}
          <div className="w-10 h-[3px] bg-brick rounded-full mb-6" />

          <p
            className="font-semibold text-3xl text-ink tracking-tight leading-snug mb-10"
            style={{ fontFamily: "var(--fi-font-sans)", fontStyle: "italic" }}
          >
            Welcome back
          </p>

          <p className="text-sm text-ink-muted leading-relaxed mb-10">
            Published fees for {summary.institutionsLabel} U.S. banks and credit unions: free
            lookup, plus peer benchmarks and competitive reports for banking teams.
          </p>

          {/* Stats */}
          <div className="flex gap-8">
            <div>
              <p className="text-lg font-bold text-ink tabular-nums">{summary.institutionsLabel}</p>
              <p className="text-[11px] text-ink-muted uppercase tracking-wider font-medium mt-0.5">Institutions</p>
            </div>
            <div>
              <p className="text-lg font-bold text-ink tabular-nums">{summary.categoriesLabel}</p>
              <p className="text-[11px] text-ink-muted uppercase tracking-wider font-medium mt-0.5">Fee categories</p>
            </div>
            <div>
              <p className="text-lg font-bold text-ink tabular-nums">{summary.statesLabel}</p>
              <p className="text-[11px] text-ink-muted uppercase tracking-wider font-medium mt-0.5">States</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center bg-white px-4 py-12 lg:py-0">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="text-center mb-8 lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2 text-ink no-underline mb-4">
              <Logo mark="fee-insight-oneline" height={22} />
            </Link>
          </div>

          <div className="lg:bg-white lg:rounded-xl lg:p-8">
            <h1
              className="text-2xl font-extrabold tracking-tight text-ink text-center mb-8"
              style={{ fontFamily: "var(--fi-font-sans)" }}
            >
              Sign in
            </h1>
            <LoginForm redirectTo={params.from || "/account"} forgotPasswordHref={FORGOT_PASSWORD_HREF} />
            <p className="mt-4 text-center text-sm text-ink-muted">
              Don&apos;t have an account?{" "}
              <Link href={registerHref} className="text-ink font-medium hover:underline">
                Create one
              </Link>
            </p>
            {proPlansHref && (
              <p className="mt-2 text-center text-sm text-ink-muted">
                New to Pro?{" "}
                <Link href={proPlansHref} className="text-brick font-medium hover:underline">
                  See plans and prices
                </Link>
              </p>
            )}
            <p className="mt-6 text-center text-sm">
              <Link href="/" className="text-ink-muted hover:text-ink hover:underline">
                ← Back to {SITE_NAME}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
