import Link from "next/link";
import type { User } from "@/lib/auth";
import { SITE_NAME } from "@/lib/constants";
import { ManageBillingButton } from "./manage-billing-button";

/**
 * Says why Pro is not active when a subscription has lapsed. Without it a past-due or
 * cancelled subscriber saw the free upsell with no explanation. Staff accounts never
 * depend on a subscription and never see it.
 */
export function SubscriptionStatusNotice({ user }: { user: Pick<User, "role" | "subscription_status" | "stripe_customer_id"> }) {
  if (user.role === "admin" || user.role === "analyst") return null;

  if (user.subscription_status === "past_due") {
    return (
      <div role="status" className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <p className="text-[14px] font-semibold">Your {SITE_NAME} Pro payment is past due.</p>
        <p className="mt-1 text-[13px]">
          Pro features are paused until the payment goes through. Update your card to pick up where you left off.
        </p>
        {user.stripe_customer_id && (
          <div className="mt-3">
            <ManageBillingButton />
          </div>
        )}
      </div>
    );
  }

  if (user.subscription_status === "canceled") {
    return (
      <div role="status" className="mb-8 rounded-xl border border-[#E8DFD1] bg-white/70 p-5">
        <p className="text-[14px] font-semibold text-[#1A1815]">Your {SITE_NAME} Pro subscription has ended.</p>
        <p className="mt-1 text-[13px] text-[#6B6255]">
          Your saved institutions and fee alerts are kept. Restart Pro any time to get the Hamilton workspace back.
        </p>
        <Link
          href="/subscribe"
          className="mt-3 inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#A93D25]"
        >
          Restart Pro
        </Link>
      </div>
    );
  }

  return null;
}
