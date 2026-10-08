/**
 * Emails for the free, instant benchmark reports (National and Fed district). The
 * requester gets the report link at once; James gets a one-line notice. Nothing waits on
 * a person, so neither email promises a turnaround.
 */
import { SITE_URL } from "@/lib/constants";
import { benchmarkReportPath, benchmarkReportTitle, type BenchmarkScope } from "@/lib/benchmark-report";
import { adminLeadsUrl, emailOptInLines, sendLeadNotificationPair, type LeadNotificationOutcome } from "./lead-notification";

export interface BenchmarkReportEmailInput {
  email: string;
  scope: BenchmarkScope;
  src: string | null;
}

export function benchmarkReportUrl(scope: BenchmarkScope): string {
  return `${SITE_URL.replace(/\/$/, "")}${benchmarkReportPath(scope)}`;
}

export async function sendBenchmarkReportNotifications(
  input: BenchmarkReportEmailInput,
): Promise<LeadNotificationOutcome> {
  const title = benchmarkReportTitle(input.scope);
  const url = benchmarkReportUrl(input.scope);
  return sendLeadNotificationPair({
    requesterEmail: input.email,
    notification: {
      subject: `Free report sent: ${title} to ${input.email}`,
      lines: [
        `${input.email} asked for the ${title}, and the link went out automatically.`,
        "",
        ...(input.src ? [`Source: ${input.src}`, ""] : []),
        "Nothing is owed. If they ask for an institution report, it will arrive as its own request.",
      ],
      cta: { label: "Open /admin/leads", href: adminLeadsUrl() },
    },
    confirmation: {
      subject: `Your ${title}`,
      lines: [
        `Here is your ${title}: the median and typical range for the 15 headline fees, from each institution's own published fee schedule.`,
        "",
        "Want to see where your own institution stands against its competitors? That is the institution report, linked at the end of this one.",
        "To track competitors every month with up to 5 people on your team, see Fee Insight Pro at the end of the report.",
        ...emailOptInLines(input.email),
      ],
      cta: { label: "Open your report", href: url },
    },
  });
}
