export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import { getReportFreshness, type ReportFreshness } from "@/lib/data-store/feed-freshness";
import { buildPublishingCalendar, type Audience } from "@/lib/console/publishing-calendar";
import { RoomHeader, RoomScreens, Unreadable } from "../room-hub";

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
  let reports: ReportFreshness[] | null = null;
  try {
    reports = await getReportFreshness();
  } catch (error) {
    console.error("Publishing room report freshness failed", error);
  }
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
                    const last = lastLine(row.lastAt, row.lastStatus);
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
                        <td className="px-4 py-2.5 tabular-nums text-gray-700 dark:text-gray-200">{formatAdminDateTime(row.nextAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <RoomScreens room="publishing" />
    </div>
  );
}
