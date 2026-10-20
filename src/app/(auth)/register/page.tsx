export const dynamic = "force-dynamic";
import { RegisterForm } from "./register-form";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolvePostLoginRedirect } from "@/lib/safe-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { UtilityFootnote, UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_QUIET_LINK } from "@/components/utility/form-style";
import { PLAN_DISPLAY_NAME, PLAN_TEAM_LABEL, isProPlan, type ProPlan } from "@/app/subscribe/pricing";
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
  `A one-click path to Hamilton when you need benchmarks, scenarios and monitoring`,
];

const PRO_ACCOUNT_BENEFITS = [
  "Hamilton workspace: This month, My fees, Try a price and Reports",
  "Unlimited peer sets and CSV exports (API access on request)",
  "One plan for up to 5 people; monthly plans cancel at the end of any billing period",
];

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; plan?: string; intent?: string; category?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
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

  const benefits = plan ? PRO_ACCOUNT_BENEFITS : FREE_ACCOUNT_BENEFITS;

  return (
    <UtilityShell
      headerAction={
        <Link href={loginHref} className={UTILITY_QUIET_LINK}>
          Sign in
        </Link>
      }
      aside={
        <>
          {/* What an account gives, not what the public index already gives. */}
          <ul className="space-y-3.5">
            {benefits.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-brick">
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-[14px] leading-snug text-ink">{feature}</span>
              </li>
            ))}
          </ul>
        </>
      }
    >
      <UtilityHeading
        title={variant === "consumer" ? "Create a free account" : "Create your account"}
        lede={
          plan
            ? `Next: checkout for Hamilton ${PLAN_DISPLAY_NAME[plan]}, ${PLAN_TEAM_LABEL}. Your plan is active as soon as payment clears.`
            : variant === "consumer"
              ? feeLabel
                ? `Then pick your bank or credit union and we'll tell you when its ${feeLabel} changes.`
                : "Follow your bank and hear when its fees change."
              : `Save your institution and peer group; upgrade to Hamilton whenever you need benchmarks.`
        }
      />
      <RegisterForm redirectTo={destination} variant={variant} checkout={plan !== null} />
      <UtilityFootnote>
        Already have an account?{" "}
        <Link href={loginHref} className={UTILITY_QUIET_LINK}>
          Sign in
        </Link>
      </UtilityFootnote>
    </UtilityShell>
  );
}
