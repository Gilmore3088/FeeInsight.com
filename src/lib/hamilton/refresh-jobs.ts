import type postgres from "postgres";
import { sql } from "@/lib/data-store/connection";
import type { HamiltonEvidencePolicy } from "@/lib/hamilton/request-contract";

type SqlClient = typeof sql;
type JsonCapableSqlClient = SqlClient & {
  json?: (value: postgres.JSONValue) => postgres.Parameter;
};

export type HamiltonRefreshJobType =
  | "report_refresh"
  | "scenario_refresh"
  | "watchlist_review";

export type HamiltonRefreshJobStatus = "queued" | "completed" | "dismissed";

export interface HamiltonRefreshJobEntry {
  id: string;
  institutionId: string;
  jobType: HamiltonRefreshJobType;
  status: HamiltonRefreshJobStatus;
  priority: number;
  reason: string;
  sourceSignalId: string | null;
  sourceSignalType: string | null;
  evidencePolicy: HamiltonEvidencePolicy | null;
  providerCallQueued: boolean;
  automationMode: "manual_rerun" | "provider_queued";
  pipelineStage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface EnqueueRefreshJobsOptions {
  signalId: string;
  institutionId: number | string;
  signalType: string;
  severity: string;
  title: string;
  sourceJson?: postgres.JSONValue | null;
  db?: SqlClient;
}

interface CompleteRefreshJobsOptions {
  institutionId: number | string;
  jobTypes: HamiltonRefreshJobType[];
  completedByUserId?: number | null;
  db?: SqlClient;
}

function jsonParam(value: postgres.JSONValue, db: SqlClient): postgres.Parameter | string {
  const dbJson = (db as JsonCapableSqlClient).json;
  if (typeof dbJson === "function") return dbJson(value);
  const sqlJson = (sql as JsonCapableSqlClient).json;
  if (typeof sqlJson === "function") return sqlJson(value);
  return JSON.stringify(value);
}

function sourceObject(value: postgres.JSONValue | null | undefined): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function refreshTargetsFromSource(sourceJson: postgres.JSONValue | null | undefined): string[] {
  const source = sourceObject(sourceJson);
  const recommended = source?.refresh_recommended;
  if (!Array.isArray(recommended)) return [];
  return recommended
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);
}

function jobTypeForTarget(target: string): HamiltonRefreshJobType | null {
  if (target === "report" || target === "reports" || target === "brief" || target === "briefs") {
    return "report_refresh";
  }
  if (target === "scenario" || target === "scenarios" || target === "simulation") {
    return "scenario_refresh";
  }
  if (target === "watchlist" || target === "monitor") {
    return "watchlist_review";
  }
  return null;
}

function priorityForSeverity(severity: string): number {
  if (severity.toLowerCase() === "high") return 3;
  if (severity.toLowerCase() === "medium") return 2;
  return 1;
}

function normalizeInstitutionId(value: number | string): string | null {
  const institutionId = String(value).trim();
  return /^[1-9]\d*$/.test(institutionId) ? institutionId : null;
}

export function deriveRefreshJobTypes(
  sourceJson: postgres.JSONValue | null | undefined,
): HamiltonRefreshJobType[] {
  return Array.from(
    new Set(
      refreshTargetsFromSource(sourceJson)
        .map(jobTypeForTarget)
        .filter((jobType): jobType is HamiltonRefreshJobType => jobType !== null),
    ),
  );
}

export async function enqueueHamiltonRefreshJobsForSignal(
  options: EnqueueRefreshJobsOptions,
): Promise<number> {
  const db = options.db ?? sql;
  const institutionId = normalizeInstitutionId(options.institutionId);
  if (!institutionId) return 0;

  const jobTypes = deriveRefreshJobTypes(options.sourceJson);
  if (jobTypes.length === 0) return 0;

  let inserted = 0;
  for (const jobType of jobTypes) {
    const rows = await db<{ id: string }[]>`
      INSERT INTO hamilton_refresh_jobs (
        institution_id,
        source_signal_id,
        source_signal_type,
        job_type,
        status,
        priority,
        reason,
        source_json,
        created_at,
        updated_at
      ) VALUES (
        ${institutionId},
        ${options.signalId}::uuid,
        ${options.signalType},
        ${jobType},
        'queued',
        ${priorityForSeverity(options.severity)},
        ${options.title},
        ${options.sourceJson ? jsonParam(options.sourceJson, db) : null},
        NOW(),
        NOW()
      )
      ON CONFLICT (source_signal_id, job_type) DO NOTHING
      RETURNING id
    `;
    if (rows.length > 0) inserted += 1;
  }

  return inserted;
}

export async function completeHamiltonRefreshJobsForInstitution(
  options: CompleteRefreshJobsOptions,
): Promise<number> {
  const db = options.db ?? sql;
  const institutionId = normalizeInstitutionId(options.institutionId);
  if (!institutionId || options.jobTypes.length === 0) return 0;

  // A subscriber finishing the work clears it for themselves only: the job is shared
  // by everyone watching the institution.
  if (options.completedByUserId) {
    const rows = await db<{ job_id: string }[]>`
      INSERT INTO hamilton_refresh_job_completions (job_id, user_id, completed_at)
      SELECT j.id, ${options.completedByUserId}, NOW()
        FROM hamilton_refresh_jobs j
       WHERE j.institution_id = ${institutionId}
         AND j.job_type = ANY(${options.jobTypes}::text[])
         AND j.status = 'queued'
      ON CONFLICT (job_id, user_id) DO NOTHING
      RETURNING job_id
    `;
    return rows.length;
  }

  // System completion (no user) closes the shared job for everyone.
  const rows = await db<{ id: string }[]>`
    UPDATE hamilton_refresh_jobs
       SET status = 'completed',
           completed_at = NOW(),
           completed_by_user_id = NULL,
           updated_at = NOW()
     WHERE institution_id = ${institutionId}
       AND job_type = ANY(${options.jobTypes}::text[])
       AND status = 'queued'
    RETURNING id
  `;

  return rows.length;
}

export async function fetchQueuedHamiltonRefreshJobs(
  options: {
    institutionIds?: string[];
    /** Hide jobs this user already completed. */
    userId?: number | null;
    limit?: number;
    db?: SqlClient;
  } = {},
): Promise<HamiltonRefreshJobEntry[]> {
  const db = options.db ?? sql;
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 10)), 1), 50);
  const institutionIds = (options.institutionIds ?? [])
    .map((id) => normalizeInstitutionId(id))
    .filter((id): id is string => id !== null);

  const rows = institutionIds.length > 0
    ? await db`
        SELECT id, institution_id, source_signal_id, source_signal_type, job_type, status,
               priority, reason, created_at, updated_at, completed_at,
               source_json ->> 'evidence_policy' AS evidence_policy,
               COALESCE((source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued,
               source_json ->> 'pipeline_stage' AS pipeline_stage
          FROM hamilton_refresh_jobs
         WHERE status = 'queued'
           AND institution_id = ANY(${institutionIds}::text[])
           AND NOT EXISTS (
             SELECT 1 FROM hamilton_refresh_job_completions c
              WHERE c.job_id = hamilton_refresh_jobs.id
                AND c.user_id = ${options.userId ?? -1}
           )
         ORDER BY priority DESC, created_at DESC
         LIMIT ${limit}
      `
    : await db`
        SELECT id, institution_id, source_signal_id, source_signal_type, job_type, status,
               priority, reason, created_at, updated_at, completed_at,
               source_json ->> 'evidence_policy' AS evidence_policy,
               COALESCE((source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued,
               source_json ->> 'pipeline_stage' AS pipeline_stage
          FROM hamilton_refresh_jobs
         WHERE status = 'queued'
         ORDER BY priority DESC, created_at DESC
         LIMIT ${limit}
      `;

  return rows.map((row) => ({
    id: String(row.id),
    institutionId: String(row.institution_id),
    sourceSignalId: row.source_signal_id == null ? null : String(row.source_signal_id),
    sourceSignalType: row.source_signal_type == null ? null : String(row.source_signal_type),
    evidencePolicy: row.evidence_policy == null ? null : String(row.evidence_policy) as HamiltonEvidencePolicy,
    providerCallQueued: row.provider_call_queued === true,
    automationMode: row.provider_call_queued === true ? "provider_queued" : "manual_rerun",
    pipelineStage: row.pipeline_stage == null ? null : String(row.pipeline_stage),
    jobType: String(row.job_type) as HamiltonRefreshJobType,
    status: String(row.status) as HamiltonRefreshJobStatus,
    priority: Number(row.priority ?? 1),
    reason: String(row.reason ?? "Refresh queued"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  }));
}
