/**
 * The MailerLite fields the lifecycle emails read (Reports/studio/email-campaigns/content.mjs):
 * which report a requester asked for and one finding from it, and what a follower follows.
 * Built from the reader's lead rows on confirm. Never throws; a field it can't fill is null,
 * and the email falls back to its default wording.
 */
import { SITE_URL } from "@/lib/constants";
import { benchmarkReportPath, parseBenchmarkScope, type BenchmarkScope } from "@/lib/benchmark-report";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { stateFromUseCase } from "@/lib/lead-capture";
import type { Finding } from "@/lib/research-report/finding";

export interface LeadRow {
  source: string | null;
  use_case?: string | null;
  created_at?: string | Date | null;
}

export type LifecycleFields = Record<"report_name" | "report_url" | "report_finding" | "follow_name" | "follow_url", string | null>;

export interface LifecycleDeps {
  /** The report's first key finding, as the report page shows it. */
  loadFinding: (scope: BenchmarkScope) => Promise<Finding | null>;
  institutionName: (id: number) => Promise<string | null>;
}

const SITE = SITE_URL.replace(/\/$/, "");
const SAMPLE_PATH = "/reports/sample-competitive-fee-position";
const FINDING_DEADLINE_MS = 4_000;

const sources = (row: LeadRow) => (row.source ?? "").split(",").map((s) => s.trim());
const newestFirst = (rows: LeadRow[]) => {
  const time = (row: LeadRow) => (row.created_at ? new Date(row.created_at).getTime() || 0 : 0);
  return [...rows].sort((a, b) => time(b) - time(a));
};

/** `scope=national` or `scope=district-N` on a benchmark-report row. */
export function scopeFromUseCase(useCase: string | null | undefined): BenchmarkScope | null {
  const match = /(?:^|;\s*)scope=([a-z0-9-]+)/.exec(useCase ?? "");
  return match ? parseBenchmarkScope(match[1]) : null;
}

export function institutionIdFromUseCase(useCase: string | null | undefined): number | null {
  const match = /(?:^|;\s*)institution_id=(\d+)/.exec(useCase ?? "");
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * One finding as a sentence an email can carry, dated because it is read on confirm and emailed
 * days later, when the live report may have moved: "As of October 17, 2026: The X median ...".
 */
export function findingSentence(finding: Finding, asOf: Date = new Date()): string {
  const date = asOf.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `As of ${date}: ${finding.headline}: ${finding.figure}. ${finding.detail}`;
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work.catch(() => null), late]).finally(() => clearTimeout(timer));
}

export async function lifecycleFields(rows: LeadRow[], deps: LifecycleDeps): Promise<LifecycleFields> {
  const fields: LifecycleFields = {
    report_name: null,
    report_url: null,
    report_finding: null,
    follow_name: null,
    follow_url: null,
  };
  const ordered = newestFirst(rows);

  // The newest free report they asked for: a benchmark report, else the sample report.
  for (const row of ordered) {
    const scope = sources(row).some((s) => s === "report_national" || s === "report_district") ? scopeFromUseCase(row.use_case) : null;
    if (scope) {
      fields.report_name = scope.kind === "national"
        ? "the National Fee Benchmark Report"
        : `the ${DISTRICT_NAMES[scope.district]} district Fee Benchmark Report`;
      fields.report_url = `${SITE}${benchmarkReportPath(scope)}`;
      const finding = await withDeadline(deps.loadFinding(scope), FINDING_DEADLINE_MS);
      fields.report_finding = finding ? findingSentence(finding) : null;
      break;
    }
    if (sources(row).some((s) => s === "capture_report_sample" || s === "capture_homepage")) {
      fields.report_name = "the sample Competitive Fee Position Report";
      fields.report_url = `${SITE}${SAMPLE_PATH}`;
      break;
    }
  }

  // What they follow: the newest institution or state they signed up to watch.
  for (const row of ordered) {
    if (!sources(row).some((s) => s === "capture_institution" || s === "capture_state")) continue;
    const institutionId = institutionIdFromUseCase(row.use_case);
    if (institutionId) {
      const name = await withDeadline(deps.institutionName(institutionId), FINDING_DEADLINE_MS);
      if (name) {
        fields.follow_name = name;
        fields.follow_url = `${SITE}/institution/${institutionId}`;
        break;
      }
    }
    const state = stateFromUseCase(row.use_case);
    if (state && STATE_NAMES[state]) {
      fields.follow_name = STATE_NAMES[state];
      fields.follow_url = `${SITE}/research/state/${state}`;
      break;
    }
  }
  return fields;
}
