import { Suspense } from "react";
import { HamiltonPageSkeleton } from "@/components/hamilton/layout/HamiltonPageSkeleton";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium, isInPaymentGrace, isPaymentLapsed, PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { ManageBillingButton } from "@/app/account/manage-billing-button";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { subscribeReason } from "@/lib/subscribe-reason";
import type { Metadata } from "next";
import { SITE_TITLE_TEMPLATE } from "@/lib/constants";

export const metadata: Metadata = {
  title: {
    default: "Hamilton",
    template: SITE_TITLE_TEMPLATE,
  },
};

export default function ProLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<HamiltonPageSkeleton />}>
      <ProLayoutInner>{children}</ProLayoutInner>
    </Suspense>
  );
}

async function ProLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    // DB not available or session expired
  }

  if (!user) {
    const headersList = await headers();
    const requestPath =
      headersList.get("x-invoke-path") ||
      headersList.get("x-next-url") ||
      headersList.get("x-pathname") ||
      "/pro";
    const returnTo = sanitizeInternalRedirect(requestPath, "/pro");
    redirect(`/login?from=${encodeURIComponent(returnTo)}`);
  }

  if (isPaymentLapsed(user)) {
    redirect("/account/billing-issue");
  }

  if (!canAccessPremium(user)) {
    const headersList = await headers();
    const requestPath =
      headersList.get("x-invoke-path") ||
      headersList.get("x-next-url") ||
      headersList.get("x-pathname") ||
      "/pro";
    const returnTo = sanitizeInternalRedirect(requestPath, "/pro");
    redirect(`/subscribe?from=${encodeURIComponent(returnTo)}&reason=${subscribeReason(user)}`);
  }

  // The Hamilton shell renders the admin "Back to Admin" bar; one bar is enough.

  return (
    <>
      {isInPaymentGrace(user) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900 border-b border-amber-200">
          <span>
            Your last payment didn&apos;t go through. Update your card within {PAST_DUE_GRACE_DAYS} days of the failed
            charge to keep Hamilton access.
          </span>
          <ManageBillingButton label="Update card" />
        </div>
      )}
      {children}
    </>
  );
}
