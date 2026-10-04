import type { ReportJob, ReportType } from "@/lib/report-engine/types";

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  national_index: "National Index",
  state_index: "State Index",
  peer_brief: "Peer Brief",
  monthly_pulse: "Monthly Pulse",
};

export function getReportTitle(job: ReportJob): string {
  const typeLabel = REPORT_TYPE_LABELS[job.report_type] ?? job.report_type;
  if (job.report_type === "state_index" && job.params?.state_code) {
    return `${typeLabel} — ${job.params.state_code}`;
  }
  const year = new Date(job.created_at).getFullYear();
  const quarter = Math.ceil((new Date(job.created_at).getMonth() + 1) / 3);
  return `${typeLabel} Q${quarter} ${year}`;
}
