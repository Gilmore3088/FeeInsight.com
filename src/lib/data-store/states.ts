/**
 * State detail page queries.
 *
 * All functions use `sql` from connection.ts, wrap numeric returns with Number(),
 * and provide try/catch with safe fallbacks.
 */

import { sql } from "@/lib/data-store/connection";
import { toDateStr, safeJsonb } from "@/lib/pg-helpers";
import { institutionDisplayName } from "@/lib/institution-display-name";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StateInstitution {
  id: number;
  institution_name: string;
  city: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  asset_size: number | null;
  fee_schedule_url: string | null;
  document_type: string | null;
  fee_count: number;
  last_crawled: string;
}

export interface StateSummary {
  total: number;
  withUrl: number;
  withFees: number;
  coveragePct: number;
}

export interface StateAgentRun {
  id: number;
  started_at: string;
  completed_at: string;
  status: string;
  total_institutions: number;
  discovered: number;
  classified: number;
  extracted: number;
  validated: number;
  failed: number;
}

export interface StateUrlResolutionInstitution {
  id: number;
  institution_name: string;
  website_url: string | null;
  latest_failure_reason: string | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getStateInstitutions(
  stateCode: string,
): Promise<StateInstitution[]> {
  try {
    const rows = await sql`
      SELECT
        ct.id,
        ct.institution_name,
        ct.city,
        ct.charter_type,
        ct.asset_size_tier,
        ct.asset_size,
        ct.fee_schedule_url,
        ct.document_type,
        COALESCE(fc.fee_count, 0) as fee_count,
        ct.last_crawl_at as last_crawled
      FROM institution_sources ct
      LEFT JOIN (
        SELECT institution_id, COUNT(*) as fee_count
        FROM published_fee_catalog
        GROUP BY institution_id
      ) fc ON fc.institution_id = ct.id
      WHERE ct.state_code = ${stateCode}
      ORDER BY ct.asset_size DESC NULLS LAST
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      institution_name: institutionDisplayName(String(r.institution_name)),
      city: r.city ? String(r.city) : null,
      charter_type: r.charter_type ? String(r.charter_type) : null,
      asset_size_tier: r.asset_size_tier ? String(r.asset_size_tier) : null,
      asset_size: r.asset_size != null ? Number(r.asset_size) : null,
      fee_schedule_url: r.fee_schedule_url ? String(r.fee_schedule_url) : null,
      document_type: r.document_type ? String(r.document_type) : null,
      fee_count: Number(r.fee_count),
      last_crawled: toDateStr(r.last_crawled as string | Date | null),
    }));
  } catch (e) {
    console.error("getStateInstitutions failed:", e);
    return [];
  }
}

export async function getStateSummary(
  stateCode: string,
): Promise<StateSummary> {
  try {
    const rows = await sql`
      SELECT
        COUNT(DISTINCT ct.id) as total,
        COUNT(DISTINCT CASE WHEN ct.fee_schedule_url IS NOT NULL THEN ct.id END) as with_url,
        COUNT(DISTINCT ef.institution_id) as with_fees,
        COUNT(DISTINCT CASE WHEN ct.document_type = 'offline' OR ct.website_url IS NULL THEN ct.id END) as excluded
      FROM institution_sources ct
      LEFT JOIN published_fee_catalog ef ON ef.institution_id = ct.id
      WHERE ct.state_code = ${stateCode}
    `;
    const r = rows[0];
    const total = Number(r.total);
    const withFees = Number(r.with_fees);
    const excluded = Number(r.excluded);
    const addressable = total - excluded;
    return {
      total,
      withUrl: Number(r.with_url),
      withFees,
      coveragePct: addressable > 0 ? Math.round((withFees / addressable) * 100) : 0,
    };
  } catch (e) {
    console.error("getStateSummary failed:", e);
    return { total: 0, withUrl: 0, withFees: 0, coveragePct: 0 };
  }
}

export async function getStateAgentRuns(
  stateCode: string,
  limit = 5,
): Promise<StateAgentRun[]> {
  try {
    const rows = await sql`
      SELECT id, started_at, completed_at, status,
             total_institutions, discovered, classified,
             extracted, validated, failed
      FROM agent_runs
      WHERE state_code = ${stateCode}
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      started_at: toDateStr(r.started_at as string | Date | null),
      completed_at: toDateStr(r.completed_at as string | Date | null),
      status: String(r.status),
      total_institutions: Number(r.total_institutions),
      discovered: Number(r.discovered),
      classified: Number(r.classified),
      extracted: Number(r.extracted),
      validated: Number(r.validated),
      failed: Number(r.failed),
    }));
  } catch (e) {
    console.error("getStateAgentRuns failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Agent Run Detail
// ---------------------------------------------------------------------------

export interface AgentRunDetail {
  id: number;
  state_code: string;
  status: string;
  discovered: number;
  classified: number;
  extracted: number;
  validated: number;
  failed: number;
  started_at: string;
  completed_at: string;
}

export interface AgentRunResult {
  id: number;
  institution_id: number;
  institution_name: string;
  stage: string;
  status: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

function isMissingAgentRunResultsSchemaError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return code === "42P01" ||
    (message.includes("agent_institution_run_results") &&
      (message.includes("does not exist") || message.includes("undefined_table")));
}

export async function getAgentRunDetail(runId: number): Promise<{
  run: AgentRunDetail | null;
  results: AgentRunResult[];
}> {
  try {
    const runRows = await sql`
      SELECT id, state_code, status, discovered, classified,
             extracted, validated, failed, started_at, completed_at
      FROM agent_runs
      WHERE id = ${runId}
      LIMIT 1
    `;
    if (runRows.length === 0) return { run: null, results: [] };

    const r = runRows[0];
    const run: AgentRunDetail = {
      id: Number(r.id),
      state_code: r.state_code ? String(r.state_code).toUpperCase() : "",
      status: String(r.status),
      discovered: Number(r.discovered),
      classified: Number(r.classified),
      extracted: Number(r.extracted),
      validated: Number(r.validated),
      failed: Number(r.failed),
      started_at: toDateStr(r.started_at as string | Date | null),
      completed_at: toDateStr(r.completed_at as string | Date | null),
    };

    let resultRows: Record<string, unknown>[] = [];
    try {
      resultRows = await sql`
        SELECT arr.id, arr.institution_id, ct.institution_name,
               arr.stage, arr.status, arr.detail, arr.created_at
        FROM agent_institution_run_results arr
        JOIN institution_sources ct ON ct.id = arr.institution_id
        WHERE arr.agent_run_id = ${runId}
        ORDER BY ct.institution_name, arr.created_at
      `;
    } catch (error) {
      if (!isMissingAgentRunResultsSchemaError(error)) {
        console.error("getAgentRunDetail results query failed:", error);
      }
    }

    const results: AgentRunResult[] = resultRows.map((row) => ({
      id: Number(row.id),
      institution_id: Number(row.institution_id),
      institution_name: institutionDisplayName(String(row.institution_name)),
      stage: String(row.stage),
      status: String(row.status),
      detail: safeJsonb<Record<string, unknown>>(row.detail),
      created_at: toDateStr(row.created_at as string | Date | null),
    }));

    return { run, results };
  } catch (e) {
    console.error("getAgentRunDetail failed:", e);
    return { run: null, results: [] };
  }
}

export async function getStateUrlResolutionQueue(
  stateCode: string,
): Promise<StateUrlResolutionInstitution[]> {
  try {
    const rows = await sql`
      SELECT
        ct.id,
        ct.institution_name,
        ct.website_url,
        latest_result.reason as latest_failure_reason
      FROM institution_sources ct
      LEFT JOIN LATERAL (
        SELECT arr.detail->>'reason' as reason
        FROM agent_institution_run_results arr
        WHERE arr.institution_id = ct.id AND arr.status = 'failed'
        ORDER BY arr.created_at DESC
        LIMIT 1
      ) latest_result ON true
      WHERE ct.state_code = ${stateCode}
        AND ct.fee_schedule_url IS NULL
        AND (ct.document_type IS DISTINCT FROM 'offline')
      ORDER BY ct.institution_name
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      institution_name: institutionDisplayName(String(r.institution_name)),
      website_url: r.website_url ? String(r.website_url) : null,
      latest_failure_reason: r.latest_failure_reason
        ? String(r.latest_failure_reason)
        : null,
    }));
  } catch (e) {
    console.error("getStateUrlResolutionQueue failed:", e);
    return [];
  }
}
