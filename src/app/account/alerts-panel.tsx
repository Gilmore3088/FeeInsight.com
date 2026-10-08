import Link from "next/link";
import type { AlertSubscription } from "@/lib/data-store/alerts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAbsoluteDate } from "@/lib/public-stats";
import { AlertRemoveButton } from "./alert-remove-button";
import { AccountCard } from "./account-card";

function plain(category: string): string {
  return getDisplayName(category).replace(/\s*\([^)]*\)/g, "");
}

/**
 * The reader's saved banks and credit unions and the fees they follow at each — the
 * destination of "Manage your alerts" on guides and institution pages. The page loads the
 * subscriptions, so this renders without a database.
 */
export function AlertsPanel({ subscriptions }: { subscriptions: AlertSubscription[] }) {
  return (
    <AccountCard
      id="alerts"
      title="Banks you follow"
      note="One email when a fee changes at a bank you follow. Free."
    >
      {subscriptions.length === 0 ? (
        <div className="text-[14px] text-[#5A5347]">
          <p>You aren&rsquo;t following a bank or credit union yet.</p>
          <Link
            href="/institutions"
            className="mt-3 inline-flex min-h-11 items-center rounded-md bg-[#C44B2E] px-4 text-[14px] font-semibold text-white no-underline hover:bg-[#A93D25]"
          >
            Find a bank
          </Link>
        </div>
      ) : (
        <ul className="-my-3 divide-y divide-[#F0EBE3]">
          {subscriptions.map((sub) => (
            <li key={sub.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <Link
                  href={`/institution/${sub.institution_id}`}
                  className="text-[15px] font-medium text-[#1A1815] no-underline hover:text-[#A93D25]"
                >
                  {sub.institution_name}
                </Link>
                <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Fees you follow">
                  {sub.fee_categories === null ? (
                    <span className="rounded-full border border-[#E0D7C9] bg-[#FAF7F2] px-2.5 py-0.5 text-[12px] text-[#5A5347]">
                      All fees
                    </span>
                  ) : (
                    sub.fee_categories.map((category) => (
                      <Link
                        key={category}
                        href={`/institution/${sub.institution_id}?fee=${category}#fee-${category}`}
                        className="rounded-full border border-[#E0D7C9] bg-[#FAF7F2] px-2.5 py-0.5 text-[12px] text-[#5A5347] no-underline hover:border-[#C44B2E]/40"
                      >
                        {plain(category)}
                      </Link>
                    ))
                  )}
                </div>
                <p className="mt-1.5 text-[12px] text-[#6B6255]">
                  {sub.last_alerted_at
                    ? `Last alert ${formatAbsoluteDate(sub.last_alerted_at)}`
                    : "No changes since you started following it"}
                </p>
              </div>
              <AlertRemoveButton institutionId={sub.institution_id} institutionName={sub.institution_name} />
            </li>
          ))}
        </ul>
      )}
      {subscriptions.length > 0 && (
        <Link href="/institutions" className="mt-4 inline-block text-[13px] font-medium text-[#A93D25] hover:underline">
          Follow another bank
        </Link>
      )}
    </AccountCard>
  );
}
