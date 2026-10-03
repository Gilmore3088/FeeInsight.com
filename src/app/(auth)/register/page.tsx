export const dynamic = "force-dynamic";
import { RegisterForm } from "./register-form";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolvePostLoginRedirect } from "@/lib/safe-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { PLAN_DISPLAY_NAME, isProPlan, planPriceLine, type ProPlan } from "@/app/subscribe/pricing";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { registerCategoryFor, registerDestinationFor, registerVariantFor } from "./register-destination";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Create your Fee Insight account to access fee benchmarking data",
};

// Only what a free account actually does today.
const FREE_ACCOUNT_BENEFITS = [
  "Save your bank or credit union and see what it charges on every fee guide",
  "One email when a saved institution changes a fee you follow",
  `A one-click path to ${SITE_NAME} Pro when you need benchmarks, scenarios and monitoring`,
];

const PRO_ACCOUNT_BENEFITS = [
  "Hamilton workspace: Analyze, Benchmark, Scenario, Report and Monitor",
  "Unlimited peer sets and CSV exports (API access on request)",
  "Cancel monthly seats at the end of any billing period",
];

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; plan?: string; intent?: string; category?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const summary = await getPublicStatsSummary();
  const plan: ProPlan | null = isProPlan(params.plan) ? params.plan : null;
  const intent = { plan, from: params.from, intent: params.intent, category: params.category };
  // ?plan= hands straight to checkout; ?from= is honoured; a guide's ?category= lands on
  // the institution lookup focused on that fee.
  const destination = registerDestinationFor(intent);
  const variant = registerVariantFor(intent);
  const category = registerCategoryFor(params.category);
  const feeLabel = category ? getDisplayName(category).replace(/\s*\([^)]*\)/g, "").toLowerCase() : null;

  if (user) redirect(resolvePostLoginRedirect(destination, user.role));

  const loginHref = `/login?from=${encodeURIComponent(destination)}`;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel - hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-[#FAF7F2] flex-col justify-center items-center px-12">
        {/* Grid texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(#1A1815 1px, transparent 1px), linear-gradient(90deg, #1A1815 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative z-10 max-w-md">
          {/* Logo */}
          <Link href="/" className="inline-flex items-center gap-2 text-[#1A1815] no-underline mb-10">
            <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-[#C44B2E]" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="13" width="4" height="8" rx="1" />
              <rect x="10" y="8" width="4" height="13" rx="1" />
              <rect x="16" y="3" width="4" height="18" rx="1" />
            </svg>
            <span className="text-[15px] font-medium tracking-tight" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
              {SITE_NAME}
            </span>
          </Link>

          {/* Accent line */}
          <div className="w-10 h-[3px] bg-[#C44B2E] rounded-full mb-6" />

          <p
            className="text-3xl text-[#1A1815] tracking-tight leading-snug mb-3"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif", fontStyle: "italic" }}
          >
            {plan
              ? `Finish setting up ${SITE_NAME} Pro — ${PLAN_DISPLAY_NAME[plan]}, ${planPriceLine(plan)}`
              : "Create your free account"}
          </p>

          <p className="text-sm text-[#6B6255] leading-relaxed mb-10">
            {plan
              ? "Create your account, then continue straight to checkout. Your seat is active as soon as payment clears."
              : feeLabel
                ? `Next you'll pick your bank or credit union. We'll email you when its ${feeLabel} changes.`
                : `Published fees for ${summary.institutionsLabel} U.S. banks and credit unions. An account keeps your place and opens the path to ${SITE_NAME} Pro.`}
          </p>

          {/* Feature list: what an account gives, not what the public index already gives. */}
          <ul className="space-y-4">
            {(plan ? PRO_ACCOUNT_BENEFITS : FREE_ACCOUNT_BENEFITS).map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-[18px] w-[18px] text-[#C44B2E] mt-0.5 shrink-0"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm text-[#1A1815]">{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center bg-white px-4 py-12 lg:py-0">
        <div className="w-full max-w-md">
          {/* Mobile header */}
          <div className="flex items-center justify-between mb-8 lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2 text-[#1A1815] no-underline">
              <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-[#C44B2E]" stroke="currentColor" strokeWidth="1.5">
                <rect x="4" y="13" width="4" height="8" rx="1" />
                <rect x="10" y="8" width="4" height="13" rx="1" />
                <rect x="16" y="3" width="4" height="18" rx="1" />
              </svg>
              <span className="text-[15px] font-medium tracking-tight" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
                {SITE_NAME}
              </span>
            </Link>
            <Link href={loginHref} className="text-[13px] font-medium text-[#6B6255] hover:text-[#1A1815] transition-colors">
              Sign in
            </Link>
          </div>

          <div className="lg:bg-white lg:rounded-xl lg:p-8">
            <div className="text-center mb-8">
              <h1
                className="text-2xl font-normal tracking-tight text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                {variant === "consumer" ? "Create a free account" : "Create your account"}
              </h1>
              <p className="mt-2 text-sm text-[#6B6255]">
                {plan
                  ? `Create your account, then continue to checkout for ${SITE_NAME} Pro — ${PLAN_DISPLAY_NAME[plan]}.`
                  : variant === "consumer"
                    ? feeLabel
                      ? `Then pick your bank or credit union and we'll tell you when its ${feeLabel} changes.`
                      : "Save your bank or credit union and get an email when its fees change."
                    : `Save your institution and peer group; upgrade to ${SITE_NAME} Pro whenever you need benchmarks.`}
              </p>
            </div>
            <RegisterForm redirectTo={destination} variant={variant} />
            <p className="mt-4 text-center text-sm text-[#6B6255]">
              Already have an account?{" "}
              <Link href={loginHref} className="text-[#1A1815] font-medium hover:underline">
                Sign in
              </Link>
            </p>
            <p className="mt-6 text-center text-sm">
              <Link href="/" className="text-[#6B6255] hover:text-[#1A1815] hover:underline">
                ← Back to {SITE_NAME}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
