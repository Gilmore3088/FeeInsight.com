import Link from "next/link";
import type { User } from "@/lib/auth";
import type { AlertSubscription } from "@/lib/data-store/alerts";
import type { BillingSummary } from "@/lib/billing-summary";
import { CONTACT_EMAIL } from "@/lib/constants";
import { AccountCard } from "./account-card";
import { AlertsPanel } from "./alerts-panel";
import { EmailSwitch } from "./email-switch";
import type { AccountEmailKind } from "./email-kinds";
import { SITE_FEE_BAR, type AccountReport, type OwnInstitution, type PaidReport } from "./account-types";
import { ConfirmEmailButton } from "./confirm-email-button";
import { LogoutButton } from "./logout-button";
import { ManageBillingButton } from "./manage-billing-button";
import { ProfileForm } from "./profile-form";
import { SubscriptionStatusNotice } from "./subscription-status-notice";

export type AccountPlan =
  | {
      kind: "free";
      /** The lowest Pro monthly price, from PRO_TIERS. */
      fromMonthlyUsd: number;
    }
  | {
      kind: "pro";
      /** subscription: pays for Pro; seat: on someone else's team plan; staff: Fee Insight staff. */
      access: "subscription" | "seat" | "staff";
      billing: BillingSummary | null;
      canManageBilling: boolean;
      /** The bank whose team plan a seat holder is on. */
      seatInstitutionName: string | null;
      /** Seats used on the team the user can manage; null when they manage none. */
      team: { institutionName: string; used: number; limit: number } | null;
      hamiltonHref: string;
    };

export interface AccountViewData {
  heading: string;
  email: string;
  justSubscribed: boolean;
  statusUser: Pick<User, "role" | "subscription_status" | "stripe_customer_id" | "past_due_since">;
  invitations: { id: number; institutionName: string; role: string }[];
  plan: AccountPlan;
  subscriptions: AlertSubscription[];
  /** The user's own Hamilton reports (Pro); null for free accounts. */
  reports: AccountReport[] | null;
  /** Whether the account email is proven; paid reports show only when it is. */
  emailConfirmed: boolean;
  /** Market reports bought with the confirmed email. Empty when unconfirmed. */
  paidReports: PaidReport[];
  /** The user's own bank, when known; drives the fee schedule reminder. */
  ownInstitution: OwnInstitution | null;
  /** Pro email switches; null hides them. */
  emails: Record<AccountEmailKind, boolean> | null;
  profile: {
    institution_name: string | null;
    institution_type: string | null;
    asset_tier: string | null;
    state_code: string | null;
    job_role: string | null;
  };
}

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

function longDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Pill({ tone, children }: { tone: "green" | "amber" | "plain"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    plain: "bg-[#F3EDE4] text-[#5A5347]",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function PlanCard({ plan }: { plan: AccountPlan }) {
  if (plan.kind === "free") {
    return (
      <AccountCard id="plan" title="Your plan" action={<Pill tone="plain">Free</Pill>}>
        <p className="text-[14px] leading-relaxed text-[#3D3830]">
          Following banks, fee alerts and the monthly brief are free.
        </p>
        <p className="mt-2 text-[14px] leading-relaxed text-[#3D3830]">
          Pro adds Hamilton: peer benchmarks, competitor tracking, reports and data downloads for up to 5 people
          at your organization. From ${plan.fromMonthlyUsd} a month.
        </p>
        <Link
          href="/subscribe?from=%2Faccount"
          className="mt-4 inline-flex min-h-11 items-center rounded-md bg-[#C44B2E] px-5 text-[14px] font-semibold text-white no-underline hover:bg-[#A93D25]"
        >
          See Pro plans
        </Link>
      </AccountCard>
    );
  }

  const { billing } = plan;
  const status = billing?.cancelsAtPeriodEnd ? (
    <Pill tone="amber">Ending</Pill>
  ) : (
    <Pill tone="green">Active</Pill>
  );

  return (
    <AccountCard id="plan" title="Fee Insight Pro" action={status}>
      {plan.access === "staff" && (
        <p className="text-[14px] text-[#3D3830]">Staff access. Nothing to bill.</p>
      )}
      {plan.access === "seat" && (
        <p className="text-[14px] text-[#3D3830]">
          You&rsquo;re on {plan.seatInstitutionName ? `${plan.seatInstitutionName}'s` : "a"} team plan. The person who
          bought it handles billing.
        </p>
      )}
      {plan.access === "subscription" && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
          {billing?.tierLabel && (
            <>
              <dt className="text-[#6B6255]">Plan</dt>
              <dd className="text-[#1A1815]">{billing.tierLabel}</dd>
            </>
          )}
          {billing?.priceLabel && (
            <>
              <dt className="text-[#6B6255]">Price</dt>
              <dd className="text-[#1A1815]">{billing.priceLabel}</dd>
            </>
          )}
          {billing?.periodEnd && (
            <>
              <dt className="text-[#6B6255]">{billing.cancelsAtPeriodEnd ? "Ends" : "Renews"}</dt>
              <dd className="text-[#1A1815]">{longDate(billing.periodEnd)}</dd>
            </>
          )}
          {!billing && (
            <dd className="col-span-2 text-[#6B6255]">Plan details are on the billing page.</dd>
          )}
        </dl>
      )}

      {plan.team && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[#FAF7F2] px-4 py-3">
          <p className="min-w-0 text-[14px] text-[#1A1815]">
            Team: {plan.team.used} of {plan.team.limit} seats used
          </p>
          <Link
            href="/pro/settings#workspace-access"
            className="shrink-0 text-[14px] font-medium text-[#A93D25] hover:underline"
          >
            Manage team
          </Link>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={plan.hamiltonHref}
          className="inline-flex min-h-11 items-center rounded-md bg-[#1A1815] px-5 text-[14px] font-semibold text-white no-underline hover:bg-[#3D3830]"
        >
          Open Hamilton
        </Link>
        {plan.canManageBilling && <ManageBillingButton label="Billing and invoices" />}
      </div>
      {plan.access === "subscription" && (
        <p className="mt-3 text-[13px] text-[#6B6255]">
          Change your card, download invoices or cancel on the billing page.
        </p>
      )}
    </AccountCard>
  );
}

function EmailsCard({ emails }: { emails: Record<AccountEmailKind, boolean> }) {
  return (
    <AccountCard id="emails" title="Emails">
      <div className="-my-3 divide-y divide-[#F0EBE3]">
        <EmailSwitch
          kind="watchlist_alerts"
          label="Competitor fee alerts"
          description="An email when a fee changes at a bank on your Hamilton watch list."
          initialOn={emails.watchlist_alerts}
        />
        <EmailSwitch
          kind="pro_digest"
          label="Monday digest"
          description="Each Monday: fee changes in your state, where your bank stands, and moves at banks you watch."
          initialOn={emails.pro_digest}
        />
      </div>
    </AccountCard>
  );
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function PaidReportList({ reports }: { reports: PaidReport[] }) {
  return (
    <div className="mt-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Market reports you bought</p>
      <ul className="mt-1 divide-y divide-[#F0EBE3]">
        {reports.map((report) => (
          <li key={report.leadId} className="flex items-baseline justify-between gap-4 py-3">
            {report.href ? (
              <Link href={report.href} className="min-w-0 text-[15px] font-medium text-[#1A1815] no-underline hover:text-[#A93D25]">
                {report.institutionName} market report
              </Link>
            ) : (
              <span className="min-w-0 text-[15px] font-medium text-[#1A1815]">
                {report.institutionName} market report
              </span>
            )}
            <span className="shrink-0 text-[12px] text-[#6B6255]">Bought {shortDate(report.paidAt)}</span>
          </li>
        ))}
      </ul>
      {reports.some((report) => !report.href) && (
        <p className="text-[13px] text-[#6B6255]">
          For a report without a link, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}?subject=My%20market%20report`} className="text-[#A93D25] hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          and we&rsquo;ll send it.
        </p>
      )}
    </div>
  );
}

function ReportsCard({
  reports,
  paidReports,
  emailConfirmed,
}: {
  reports: AccountReport[] | null;
  paidReports: PaidReport[];
  emailConfirmed: boolean;
}) {
  const bought = emailConfirmed ? (
    paidReports.length > 0 ? <PaidReportList reports={paidReports} /> : null
  ) : (
    <p className="mt-4 text-[13px] text-[#6B6255]">
      Bought a market report? Confirm your email under Sign-in and it will show here.
    </p>
  );

  if (reports === null) {
    return (
      <AccountCard id="reports" title="Your reports">
        <p className="text-[14px] text-[#3D3830]">
          Free benchmark reports for the nation and each Fed district, ready to read now.
        </p>
        <Link href="/reports" className="mt-3 inline-block text-[14px] font-medium text-[#A93D25] hover:underline">
          Get a free report
        </Link>
        {bought}
      </AccountCard>
    );
  }

  return (
    <AccountCard
      id="reports"
      title="Your reports"
      action={
        reports.length > 0 ? (
          <Link href="/pro/reports" className="shrink-0 text-[14px] font-medium text-[#A93D25] hover:underline">
            All reports
          </Link>
        ) : undefined
      }
    >
      {reports.length === 0 ? (
        <>
          <p className="text-[14px] text-[#3D3830]">You haven&rsquo;t made a Hamilton report yet.</p>
          <Link
            href="/pro/reports/new"
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-[#D5CBBF] bg-[#FFFDF9] px-4 text-[14px] font-medium text-[#1A1815] no-underline hover:border-[#1A1815]"
          >
            Make a report
          </Link>
        </>
      ) : (
        <ul className="-my-3 divide-y divide-[#F0EBE3]">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={report.href}
                className="flex items-baseline justify-between gap-4 py-3 text-[#1A1815] no-underline hover:text-[#A93D25]"
              >
                <span className="min-w-0 text-[15px] font-medium">{report.title}</span>
                <span className="shrink-0 text-[12px] text-[#6B6255]">{shortDate(report.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {bought}
    </AccountCard>
  );
}

function FeeScheduleReminder({ institution }: { institution: OwnInstitution }) {
  const submitHref = `/submit-fees?institutionId=${institution.id}&institutionName=${encodeURIComponent(institution.name)}`;
  const mailHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Fee schedule for ${institution.name}`)}`;
  return (
    <section
      aria-labelledby="fee-schedule-heading"
      className="rounded-xl border border-[#E8C9B8] bg-[#FBF1EA] p-5"
    >
      <h2 id="fee-schedule-heading" className="text-[15px] font-semibold text-[#1A1815]">
        We don&rsquo;t have {institution.name}&rsquo;s fee schedule yet
      </h2>
      <p className="mt-1 text-[14px] text-[#3D3830]">
        Send us the link to it, or email us the PDF. Your bank page, benchmarks and reports start from it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={submitHref}
          className="inline-flex min-h-11 items-center rounded-md bg-[#C44B2E] px-4 text-[14px] font-semibold text-white no-underline hover:bg-[#A93D25]"
        >
          Send the link
        </Link>
        <a
          href={mailHref}
          className="inline-flex min-h-11 items-center rounded-md border border-[#D5CBBF] bg-[#FFFDF9] px-4 text-[14px] font-medium text-[#1A1815] no-underline hover:border-[#1A1815]"
        >
          Email it to us
        </a>
      </div>
    </section>
  );
}

function SignInCard({ email, emailConfirmed }: { email: string; emailConfirmed: boolean }) {
  return (
    <AccountCard id="sign-in" title="Sign-in">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
        <dt className="text-[#6B6255]">Email</dt>
        <dd className="min-w-0 break-words text-[#1A1815]">
          {email}{" "}
          {emailConfirmed ? <Pill tone="green">Confirmed</Pill> : <Pill tone="amber">Not confirmed</Pill>}
        </dd>
      </dl>
      {!emailConfirmed && (
        <div className="mt-3 rounded-lg bg-[#FAF7F2] px-4 py-3">
          <p className="text-[14px] text-[#3D3830]">
            Confirm this address and reports you buy will show on this page. New accounts get the link by email when they sign up.
          </p>
          <ConfirmEmailButton />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/forgot-password" className="text-[14px] font-medium text-[#A93D25] hover:underline">
          Change password
        </Link>
        <LogoutButton />
      </div>
      <p className="mt-4 text-[13px] text-[#6B6255]">
        Need help or want your account deleted? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}?subject=My%20account`} className="text-[#A93D25] hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </AccountCard>
  );
}

/**
 * The account page body. Pure: the page loads everything, so this renders without a
 * database or Stripe. Order is what needs the reader first: payment problems, invites and
 * a missing fee schedule, then the plan, reports, the banks they follow, emails,
 * organization and sign-in.
 */
export function AccountView({ data }: { data: AccountViewData }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#A93D25]">Account</p>
        <h1 className="mt-1 text-[1.75rem] leading-[1.15] tracking-[-0.02em] text-[#1A1815]" style={SERIF}>
          {data.heading}
        </h1>
        <p className="mt-1 break-words text-[14px] text-[#6B6255]">{data.email}</p>
      </header>

      <div className="space-y-4">
        {data.justSubscribed && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-800">
            Pro is active. Welcome to Fee Insight Pro.
          </div>
        )}

        <SubscriptionStatusNotice user={data.statusUser} />

        {data.invitations.length > 0 && (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
            <p className="text-[15px] font-semibold">
              {data.invitations.length === 1
                ? `You're invited to ${data.invitations[0].institutionName}'s Pro team.`
                : "You're invited to a Pro team."}
            </p>
            <p className="mt-1 text-[14px]">
              Joining is free for you. Open the link in the invite email to accept.
            </p>
            {data.invitations.length > 1 && (
              <ul className="mt-2 list-disc pl-5 text-[14px]">
                {data.invitations.map((invitation) => (
                  <li key={invitation.id}>{invitation.institutionName}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {data.ownInstitution && data.ownInstitution.publishedFeeCount < SITE_FEE_BAR && (
          <FeeScheduleReminder institution={data.ownInstitution} />
        )}

        <PlanCard plan={data.plan} />
        <ReportsCard reports={data.reports} paidReports={data.paidReports} emailConfirmed={data.emailConfirmed} />
        <AlertsPanel subscriptions={data.subscriptions} />
        {data.emails && <EmailsCard emails={data.emails} />}
        <ProfileForm user={data.profile} />
        <SignInCard email={data.email} emailConfirmed={data.emailConfirmed} />
      </div>
    </div>
  );
}
