export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium, PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { CONTACT_EMAIL } from "@/lib/constants";
import { activateIfPaid } from "@/lib/subscription-activation";
import { UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_CARD, UTILITY_LINK, UTILITY_QUIET_LINK } from "@/components/utility/form-style";
import { ManageBillingButton } from "../manage-billing-button";

export const metadata: Metadata = { title: "Payment issue" };

/** Where a subscriber lands when their card failed and the grace window has ended. */
export default async function BillingIssuePage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login?from=%2Faccount%2Fbilling-issue");
  if (canAccessPremium(user)) redirect("/pro/hamilton");
  // Stripe events can arrive out of order: if Stripe says the subscription is paid, restore it now.
  if (await activateIfPaid(user)) redirect("/pro/hamilton");

  return (
    <UtilityShell>
      <UtilityHeading title={<>Your payment didn&apos;t go through</>} />
      <div className={`${UTILITY_CARD} space-y-5`}>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          We couldn&apos;t charge the card on file for your Hamilton subscription, and the {PAST_DUE_GRACE_DAYS}-day
          grace period has ended. Update your payment method and your workspace, saved reports and analyses come back
          right away. Nothing has been deleted.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <ManageBillingButton label="Update payment method" variant="primary" />
          <Link href="/account" className={`text-[14px] ${UTILITY_QUIET_LINK}`}>
            Account settings
          </Link>
        </div>
      </div>
      <p className="mt-5 text-center text-[13px] text-ink-muted">
        Questions? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className={UTILITY_LINK}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </UtilityShell>
  );
}
