import Link from "next/link";
import { getAlertSubscriptions } from "@/lib/data-store/alerts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAbsoluteDate } from "@/lib/public-stats";
import { AlertRemoveButton } from "./alert-remove-button";

function plain(category: string): string {
  return getDisplayName(category).replace(/\s*\([^)]*\)/g, "");
}

/**
 * The reader's saved banks and credit unions and the fees they follow at each — the
 * destination of "Manage your alerts" on guides and institution pages.
 */
export async function AlertsPanel({ userId }: { userId: number }) {
  const subscriptions = await getAlertSubscriptions(userId).catch(() => []);

  return (
    <section
      id="alerts"
      aria-labelledby="alerts-heading"
      className="scroll-mt-24 rounded-xl border border-[#E8DFD1] bg-white/70 p-5 mb-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="alerts-heading"
          className="text-[18px] font-medium text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Your institutions and alerts
        </h2>
        <p className="text-[12px] text-[#6B6255]">One email when a verified fee you follow changes.</p>
      </div>

      {subscriptions.length === 0 ? (
        <div className="mt-3 text-[13px] text-[#5A5347]">
          <p>You haven&rsquo;t saved a bank or credit union yet.</p>
          <Link
            href="/institutions"
            className="mt-3 inline-flex items-center rounded-md bg-[#C44B2E] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#A93D25]"
          >
            Find your institution
          </Link>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-[#F0EBE3]">
          {subscriptions.map((sub) => (
            <li key={sub.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0">
                <Link
                  href={`/institution/${sub.institution_id}`}
                  className="text-[14px] font-medium text-[#1A1815] hover:text-[#A93D25]"
                >
                  {sub.institution_name}
                </Link>
                <div className="mt-1 flex flex-wrap gap-1.5" aria-label="Fees you follow">
                  {sub.fee_categories === null ? (
                    <span className="rounded-full border border-[#E0D7C9] bg-[#FAF7F2] px-2.5 py-0.5 text-[12px] text-[#5A5347]">
                      All fees
                    </span>
                  ) : (
                    sub.fee_categories.map((category) => (
                      <Link
                        key={category}
                        href={`/institution/${sub.institution_id}?fee=${category}#fee-${category}`}
                        className="rounded-full border border-[#E0D7C9] bg-[#FAF7F2] px-2.5 py-0.5 text-[12px] text-[#5A5347] hover:border-[#C44B2E]/40"
                      >
                        {plain(category)}
                      </Link>
                    ))
                  )}
                </div>
                <p className="mt-1 text-[12px] text-[#6B6255]">
                  {sub.last_alerted_at
                    ? `Last alert ${formatAbsoluteDate(sub.last_alerted_at)}`
                    : "No changes since you saved it"}
                </p>
              </div>
              <AlertRemoveButton institutionId={sub.institution_id} institutionName={sub.institution_name} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
