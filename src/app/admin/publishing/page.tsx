export const dynamic = "force-dynamic";

import Link from "next/link";
import PaymentDeliveries from "./payment-deliveries";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import { getReportFreshness, type ReportFreshness } from "@/lib/data-store/feed-freshness";
import { buildPublishingCalendar, type Audience } from "@/lib/console/publishing-calendar";
import { getEmailSendLog, type EmailSendLog, type EmailSendStatus } from "@/lib/data-store/email-send-log";
import {
  SEND_STATUS_LABEL,
  emailCountLines,
  emailEventLabel,
  emailEventTone,
  type EventTone,
} from "@/lib/email/send-log-display";
import { RoomHeader, Unreadable } from "../room-hub";

const AUDIENCE_TONE: Record<Audience, string> = {
  Public: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  Clients: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  You: "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300",
};

function lastLine(lastAt: string | null, status: string | null): { text: string; bad: boolean } {
  if (!lastAt) return { text: status === "failed" ? "Last attempt failed" : "Never produced", bad: true };
  const failed = status !== null && !["complete", "completed"].includes(status);
  return { text: `${formatAdminDateTime(lastAt)}${failed ? ` · latest run ${status}` : ""}`, bad: failed };
}

/** The Publishing room: what goes out, to whom, when it last went and when it's next due. */
export default async function PublishingRoomPage() {
  await requireAuth("view");
  const [reports, emails] = await Promise.all([
    getReportFreshness().catch((error): ReportFreshness[] | null => {
      console.error("Publishing room report freshness failed", error);
      return null;
    }),
    getEmailSendLog(25),
  ]);
  const calendar = reports ? buildPublishingCalendar(reports) : [];
  const library = reports?.find((report) => report.key === "published_reports");
  const proReports = reports?.find((report) => report.key === "hamilton_reports");

  return (
    <div className="space-y-8 pb-10">
      <RoomHeader room="publishing">
        <Link href="/admin/hamilton/reports" prefetch={false} className="text-xs font-semibold text-[var(--brand-primary)]">
          Generate and publish reports
        </Link>
      </RoomHeader>

      {reports === null ? (
        <Unreadable what="Report history" />
      ) : (
        <>
          <section aria-label="Public library" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={`admin-card px-4 py-3 ${library?.count ? "" : "border-amber-300 dark:border-amber-800"}`}>
              <p className="text-xs text-gray-500">In the public report library</p>
              <p className="mt-1 font-mono text-2xl font-medium tabular-nums">{library?.count ?? 0}</p>
              <p className="mt-1 text-[11.5px] text-gray-500">
                {library?.lastAt
                  ? `Last published ${formatAdminDateTime(library.lastAt)}`
                  : "Nothing is published yet. Generated reports wait in Reports until you publish them."}
              </p>
            </div>
            <div className="admin-card px-4 py-3">
              <p className="text-xs text-gray-500">Reports saved by Hamilton Pro users</p>
              <p className="mt-1 font-mono text-2xl font-medium tabular-nums">{proReports?.count ?? 0}</p>
              <p className="mt-1 text-[11.5px] text-gray-500">
                {proReports?.lastAt ? `Latest ${formatAdminDateTime(proReports.lastAt)}` : "None yet"}
              </p>
            </div>
          </section>

          <section aria-label="Publishing schedule">
            <p className="admin-section-title">Schedule</p>
            <div className="admin-card mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left text-[11px] uppercase tracking-wide text-gray-500 dark:border-white/[0.06]">
                    <th className="px-4 py-2 font-semibold">What</th>
                    <th className="px-4 py-2 font-semibold">Goes to</th>
                    <th className="px-4 py-2 font-semibold">Cadence</th>
                    <th className="px-4 py-2 font-semibold">Last produced</th>
                    <th className="px-4 py-2 font-semibold">Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.map((row) => {
                    const off = row.publication.scheduled === false;
                    const last = off && !row.lastAt ? { text: "Not turned on", bad: false } : lastLine(row.lastAt, row.lastStatus);
                    return (
                      <tr key={row.publication.key} className="border-b border-black/[0.04] last:border-0 dark:border-white/[0.04]">
                        <td className="px-4 py-2.5">
                          <Link href={row.publication.href} prefetch={false} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">
                            {row.publication.name}
                          </Link>
                          {row.lastError ? <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">{row.lastError}</p> : null}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${AUDIENCE_TONE[row.publication.audience]}`}>
                            {row.publication.audience}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{row.publication.cadence}</td>
                        <td className={`px-4 py-2.5 tabular-nums ${last.bad ? "text-red-700 dark:text-red-400" : "text-gray-700 dark:text-gray-200"}`}>
                          {last.text}
                          {row.count !== null ? <span className="text-gray-500"> · {row.count} total</span> : null}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-gray-700 dark:text-gray-200">{row.nextAt ? formatAdminDateTime(row.nextAt) : "Off until you turn it on"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <PaymentDeliveries />
      <EmailLog log={emails} />

    </div>
  );
}

const EVENT_TONE: Record<EventTone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  neutral: "text-gray-600 dark:text-gray-300",
};

const STATUS_TONE: Record<EmailSendStatus, string> = {
  sent: "text-gray-700 dark:text-gray-200",
  failed: "text-red-700 dark:text-red-400",
  not_configured: "text-amber-700 dark:text-amber-400",
};

function EmailLog({ log }: { log: EmailSendLog }) {
  return (
    <section aria-label="Emails sent">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="admin-section-title">Emails sent</p>
        <p className="text-xs text-gray-500">Latest 25 from the app&apos;s own send log; delivery is Resend&apos;s latest webhook event</p>
      </div>
      {log.status === "not_migrated" ? (
        <p role="status" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          The email send log table (migration 20270110000034) is not in the database yet, so no send is recorded.
        </p>
      ) : log.status === "failed" ? (
        <p role="status" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          The email log could not be read. {log.reason}
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {emailCountLines(log.counts).map((line) => (
              <div key={line.label} className="admin-card px-4 py-3">
                <p className="text-xs text-gray-500">{line.label}</p>
                <p className="mt-1 font-mono text-2xl font-medium tabular-nums">{line.value}</p>
                <p className="mt-1 text-[11.5px] text-gray-500">{line.note}</p>
              </div>
            ))}
          </div>
          {log.rows.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No email has been sent since the log started.</p>
          ) : (
            <div className="admin-card mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left text-[11px] uppercase tracking-wide text-gray-500 dark:border-white/[0.06]">
                    <th className="px-4 py-2 font-semibold">Time</th>
                    <th className="px-4 py-2 font-semibold">Sender</th>
                    <th className="px-4 py-2 font-semibold">To</th>
                    <th className="px-4 py-2 font-semibold">Subject</th>
                    <th className="px-4 py-2 font-semibold">Send</th>
                    <th className="px-4 py-2 font-semibold">Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {log.rows.map((row) => (
                    <tr key={row.id} className="border-b border-black/[0.04] align-top last:border-0 dark:border-white/[0.04]">
                      <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-gray-300">{formatAdminDateTime(row.createdAt)}</td>
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200">{row.label ?? "—"}</td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{row.recipient ?? "—"}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{row.subject || "(no subject)"}</td>
                      <td className={`px-4 py-2.5 ${STATUS_TONE[row.status]}`}>
                        {SEND_STATUS_LABEL[row.status]}
                        {row.error ? <p className="mt-0.5 text-xs">{row.error}</p> : null}
                      </td>
                      <td className={`px-4 py-2.5 ${EVENT_TONE[emailEventTone(row.lastEvent)]}`}>
                        {row.status === "sent" ? emailEventLabel(row.lastEvent) : "—"}
                        {row.lastEventAt ? <p className="mt-0.5 text-xs text-gray-500">{formatAdminDateTime(row.lastEventAt)}</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
