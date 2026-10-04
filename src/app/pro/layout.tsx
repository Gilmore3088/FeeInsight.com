import { Suspense } from "react";
import { HamiltonPageSkeleton } from "@/components/hamilton/layout/HamiltonPageSkeleton";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium, isInPaymentGrace, isPaymentLapsed, PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { ManageBillingButton } from "@/app/account/manage-billing-button";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
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
    redirect(`/subscribe?from=${encodeURIComponent(returnTo)}`);
  }

  // Admins jumping from /admin → /pro lose their admin shell entirely.
  // Surface a slim "Back to Admin" banner so context is preserved without
  // overriding the Pro-tier nav that subscribers expect.
  const isAdmin = user.role === "admin" || user.role === "analyst";

  return (
    <>
      {isAdmin && (
        <div className="bg-gray-900 text-white text-xs px-4 py-1.5 flex items-center justify-between">
          <span className="text-gray-400">
            Viewing as {user.role} — this is the Pro subscriber view
          </span>
          <Link
            href="/admin"
            className="text-blue-400 hover:text-blue-300 font-medium"
          >
            Back to Admin
          </Link>
        </div>
      )}
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
