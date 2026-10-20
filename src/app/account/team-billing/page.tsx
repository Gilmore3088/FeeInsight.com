export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium, isPaymentLapsed, PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { CONTACT_EMAIL } from "@/lib/constants";
import { BILLING_ISSUE_PATH, findLapsedTeam, teamBillingContact } from "@/lib/team-billing";
import { UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_CARD, UTILITY_LINK, UTILITY_QUIET_LINK, utilityButton } from "@/components/utility/form-style";

export const metadata: Metadata = { title: "Team subscription" };

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Where a seat member lands when their team owner's payment failed and the grace window has
 * ended. They can't fix the owner's card, so the page asks them to contact the owner
 * (James, 2026-10-20; #1999). The owner still goes to /account/billing-issue.
 */
export default async function TeamBillingPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login?from=%2Faccount%2Fteam-billing");
  if (isPaymentLapsed(user)) redirect(BILLING_ISSUE_PATH);
  if (canAccessPremium(user)) redirect("/pro/hamilton");
  const team = await findLapsedTeam(user.id);
  if (!team) redirect("/subscribe?from=%2Fpro%2Fhamilton");

  const contact = teamBillingContact(team, CONTACT_EMAIL);
  const teamLabel = contact.team ?? "your team";

  return (
    <UtilityShell>
      <UtilityHeading title={<>Your team&apos;s subscription needs attention</>} />
      <div className={`${UTILITY_CARD} space-y-5`}>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          {capitalised(contact.who)} pays for Hamilton for {teamLabel}. The last payment didn&apos;t go through and
          the {PAST_DUE_GRACE_DAYS}-day grace period has ended, so your seat is paused. Nothing has been deleted.
        </p>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          Ask {contact.who} to update the payment method. Your access comes back as soon as the payment goes
          through.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <a href={contact.href} className={utilityButton("primary")}>
            {contact.linkLabel}
          </a>
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
