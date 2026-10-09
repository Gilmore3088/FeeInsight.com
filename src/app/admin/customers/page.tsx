export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getLeads, type LeadRow } from "@/lib/admin-queries";
import { formatAdminDateTime } from "@/lib/admin-time";
import {
  LEAD_STATUS_LABELS,
  isLeadOverdue,
  isLeadStatus,
  isRequestLead,
  isTestLead,
  type LeadStatus,
} from "@/lib/leads/lead-status";
import { countInstitutionsPassingReportRule, getMarketReadiness } from "@/lib/data-store/market-readiness";
import { getProAccounts, type ProAccount } from "@/lib/data-store/pro-accounts";
import { getPlanWatchList, type PlanWatchList } from "@/lib/pro-plan-watch-store";
import { logReadFailure, type ReadFailure } from "@/lib/admin-read-failure";
import { RoomHeader, Unreadable } from "../room-hub";

/** Board columns, left to right, in the order a request moves. */
const LANES: { title: string; note: string; statuses: LeadStatus[]; collapsed?: boolean }[] = [
  { title: "Waiting on us", note: "Owed a reply", statuses: ["new", "needs_reply", "overdue", "email_failed", "in_progress"] },
  { title: "Held", note: "Their market isn't ready", statuses: ["held"] },
  { title: "Quoted", note: "Waiting on their payment", statuses: ["quoted"] },
  { title: "Paid or sent", note: "Answered", statuses: ["paid", "sent", "followed_up"] },
  { title: "Closed", note: "Done", statuses: ["closed"], collapsed: true },
];

const LANE_LIMIT = 8;

function status(lead: LeadRow): LeadStatus {
  return isLeadStatus(lead.status) ? lead.status : "new";
}

function LeadCard({ lead, now }: { lead: LeadRow; now: Date }) {
  const late = isLeadOverdue({ source: lead.source, status: lead.status, created_at: lead.created_at_iso }, now);
  const failed = lead.status === "email_failed";
  return (
    <li
      className={`rounded-md border bg-white px-3 py-2 text-xs dark:bg-white/[0.03] ${
        failed || late ? "border-red-300 dark:border-red-800" : "border-black/[0.06] dark:border-white/[0.08]"
      }`}
    >
      <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-gray-100">{lead.company || lead.name}</p>
      <p className="truncate text-gray-500">{lead.company ? lead.name : lead.email}</p>
      <p className="mt-1 text-gray-500">
        {LEAD_STATUS_LABELS[status(lead)]}
        {late && !failed ? " · overdue" : ""} · {formatAdminDateTime(lead.created_at_iso)}
      </p>
    </li>
  );
}

/** The Customers room: requests as a board by stage, plus who could get a report today. */
export default async function CustomersRoomPage() {
  await requireAuth("view");
  const [leads, markets, proAccounts, planWatch] = await Promise.all([
    getLeads(500),
    getMarketReadiness().catch((error) => {
      console.error("Customers room market readiness failed", error);
      return null;
    }),
    getProAccounts().catch((error) => {
      console.error("Customers room Pro accounts failed", error);
      return null;
    }),
    getPlanWatchList().catch((error): ReadFailure => logReadFailure("Customers room plan watch list", error)),
  ]);
  const now = new Date();
  // Named test requests stay in Leads but out of the counts and the board.
  const allRequests = leads.filter((lead) => isRequestLead(lead.source));
  const requests = allRequests.filter((lead) => !isTestLead(lead));
  const testRequests = allRequests.length - requests.length;
  const subscriptions = leads.length - allRequests.length;
  // Institution reports paid by card through /pay/report (the Stripe webhook sets paid_at).
  const orders = requests.filter((lead) => lead.paid_at !== null);
  const readyMarkets = markets ? markets.filter((market) => market.ready).length : null;

  return (
    <div className="space-y-8 pb-10">
      <RoomHeader room="customers">
        <Link href="/admin/leads" prefetch={false} className="text-xs font-semibold text-[var(--brand-primary)]">
          Every lead, with replies and email status
        </Link>
      </RoomHeader>

      <section aria-label="Customer numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Requests"
          value={String(requests.length)}
          note={`reports, contact and enterprise${testRequests > 0 ? `; ${testRequests} test ${testRequests === 1 ? "request" : "requests"} not counted` : ""}`}
        />
        <Stat label="Paid report orders" value={String(orders.length)} note="institution reports paid by card" />
        <Stat label="Subscribers" value={String(subscriptions)} note="newsletter and sign-ups" />
        <Stat
          label="Markets ready for a report"
          value={readyMarkets === null ? null : `${readyMarkets} of ${markets!.length}`}
          note={
            markets
              ? `${countInstitutionsPassingReportRule(markets).toLocaleString("en-US")} institutions could get one today`
              : "Could not read market readiness."
          }
        />
      </section>

      <section aria-label="Requests by stage">
        <p className="admin-section-title">Requests by stage</p>
        {testRequests > 0 ? (
          <p className="mt-1 text-xs text-gray-500">
            {testRequests} test {testRequests === 1 ? "request is" : "requests are"} left off the board;{" "}
            <Link href="/admin/leads" prefetch={false} className="font-semibold text-[var(--brand-primary)]">
              see them in Leads
            </Link>
            .
          </p>
        ) : null}
        {leads.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No leads were read. If you expected some, the leads table may be unreachable.</p>
        ) : null}
        {/* Stacked on a phone, a board from sm up; an empty stage is one short line, closed requests fold behind a count. */}
        <div className="mt-2 grid grid-cols-1 items-start gap-2 pb-2 sm:auto-cols-[minmax(13rem,1fr)] sm:grid-flow-col sm:grid-cols-none sm:gap-3 sm:overflow-x-auto">
          {LANES.map((lane) => {
            const inLane = requests.filter((lead) => lane.statuses.includes(status(lead)));
            const cards = (
              <>
                <ul className="mt-2 space-y-2">
                  {inLane.slice(0, LANE_LIMIT).map((lead) => <LeadCard key={lead.id} lead={lead} now={now} />)}
                </ul>
                {inLane.length > LANE_LIMIT ? (
                  <Link href="/admin/leads" prefetch={false} className="mt-2 block px-1 text-xs font-semibold text-[var(--brand-primary)]">
                    {inLane.length - LANE_LIMIT} more in Leads
                  </Link>
                ) : null}
              </>
            );
            return (
              <div key={lane.title} className={`rounded-lg bg-black/[0.03] dark:bg-white/[0.03] ${inLane.length === 0 ? "px-2.5 py-1.5" : "p-2.5"}`}>
                <p className="flex items-baseline justify-between gap-2 px-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  <span>
                    {lane.title}
                    <span className="ml-1.5 font-normal text-[11px] text-gray-500">{lane.note}</span>
                  </span>
                  <span className="font-mono tabular-nums">{inLane.length}</span>
                </p>
                {inLane.length === 0 ? null : lane.collapsed ? (
                  <details>
                    <summary className="mt-1 cursor-pointer px-1 text-xs font-semibold text-[var(--brand-primary)]">
                      Show {inLane.length} {lane.title.toLowerCase()}
                    </summary>
                    {cards}
                  </details>
                ) : (
                  cards
                )}
              </div>
            );
          })}
        </div>
      </section>

      {"ref" in planWatch ? (
        <Unreadable what="Plan watch list (Stripe plan check)" failure={planWatch} retryHref="/admin/customers" />
      ) : (
        <PlanWatch list={planWatch} />
      )}

      {proAccounts ? <ProAccounts accounts={proAccounts} /> : <Unreadable what="Pro accounts" />}

      {markets === null ? <Unreadable what="Market readiness" /> : null}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string | null; note: string }) {
  return (
    <div className="admin-card px-4 py-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-medium tabular-nums ${value === null ? "text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>
        {value ?? "Not read"}
      </p>
      <p className="mt-1 text-[11.5px] leading-snug text-gray-500 dark:text-gray-400">{note}</p>
    </div>
  );
}

/** Paid plans that may be on the wrong price. Shown only when there is one to look at. */
function PlanWatch({ list: { rows, unread } }: { list: PlanWatchList }) {
  if (rows.length === 0 && unread.length === 0) return null;
  return (
    <section aria-label="Plans to check">
      <p className="admin-section-title">Plans to check</p>
      <p className="mt-1 text-xs text-gray-500">
        Pro is priced by the bank picked at checkout. These plans have signs they cover a larger one. Nothing changes
        unless you move the plan in Stripe.
      </p>
      {unread.length > 0 ? (
        <p role="status" className="mt-2 text-xs text-amber-800 dark:text-amber-300">
          Stripe could not read {unread.length === 1 ? "one paid plan" : `${unread.length} paid plans`}, so{" "}
          {unread.length === 1 ? "it was" : "they were"} not checked:{" "}
          {unread.map((plan) => `${plan.name || `user ${plan.userId}`} (${plan.code})`).join(", ")}.
        </p>
      ) : null}
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.userId} className="admin-card px-4 py-3 text-sm">
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {row.name} <span className="font-normal text-gray-500">{row.email ?? "No email"}</span>
            </p>
            <p className="text-xs text-gray-500">Paid for {row.paidFor}</p>
            <ul className="mt-1 list-disc pl-5 text-gray-700 dark:text-gray-200">
              {row.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProAccounts({ accounts }: { accounts: ProAccount[] }) {
  const billed = accounts.filter((account) => account.hasStripeCustomer).length;
  return (
    <section aria-label="Hamilton Pro accounts">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="admin-section-title">Hamilton Pro accounts</p>
        <p className="text-xs text-gray-500">
          {accounts.length} with Pro access · {billed} linked to a Stripe customer · {accounts.length - billed} granted without Stripe
        </p>
      </div>
      {accounts.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No one has Pro access yet.</p>
      ) : (
        <div className="admin-card mt-2 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-black/[0.06] text-left text-[11px] uppercase tracking-wide text-gray-500 dark:border-white/[0.06]">
                <th className="px-4 py-2 font-semibold">Who</th>
                <th className="px-4 py-2 font-semibold">Institution</th>
                <th className="px-4 py-2 font-semibold">Access</th>
                <th className="px-4 py-2 font-semibold">Billing</th>
                <th className="px-4 py-2 font-semibold">Since</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b border-black/[0.04] last:border-0 dark:border-white/[0.04]">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{account.name}</p>
                    <p className="text-xs text-gray-500">{account.email ?? "No email"}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200">{account.institution ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200">
                    {account.isActive ? account.status : "Deactivated"}
                    {account.pastDueSince ? (
                      <span className="block text-xs text-red-700 dark:text-red-400">Past due since {formatAdminDateTime(account.pastDueSince)}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200">
                    {account.hasStripeCustomer ? "Stripe customer" : "Granted without Stripe"}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-gray-300">{formatAdminDateTime(account.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
