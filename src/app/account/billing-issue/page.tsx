export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium, PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { CONTACT_EMAIL } from "@/lib/constants";
import { activateIfPaid } from "@/lib/subscription-activation";
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
    <main className="mx-auto max-w-lg px-6 py-20">
      <h1 className="text-2xl font-semibold text-[#1A1815]">Your payment didn&apos;t go through</h1>
      <p className="mt-4 text-sm text-[#5C554C]">
        We couldn&apos;t charge the card on file for your Hamilton subscription, and the {PAST_DUE_GRACE_DAYS}-day
        grace period has ended. Update your payment method and your workspace, saved reports and analyses come back
        right away. Nothing has been deleted.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <ManageBillingButton label="Update payment method" />
        <Link href="/account" className="text-sm underline text-[#1A1815]">
          Account settings
        </Link>
      </div>
      <p className="mt-8 text-xs text-[#5C554C]">Questions? Email {CONTACT_EMAIL}.</p>
    </main>
  );
}
