import type postgres from "postgres";
import { sql } from "@/lib/data-store/connection";
import { enqueueHamiltonRefreshJobsForSignal } from "@/lib/hamilton/refresh-jobs";
import {
  HAMILTON_EVIDENCE_POLICIES,
  type HamiltonEvidencePolicy,
} from "@/lib/hamilton/request-contract";

export type HamiltonMonitorSignalSeverity = "low" | "medium" | "high";

export interface HamiltonMonitorSignalInput {
  institutionId: number;
  signalType: string;
  severity: HamiltonMonitorSignalSeverity;
  title: string;
  body: string;
  sourceJson?: postgres.JSONValue | null;
  priorityAlertUserId?: number | null;
  /** Also raise a priority alert for every user watching this institution. */
  alertWatchers?: boolean;
}

type SqlClient = typeof sql;
type JsonCapableSqlClient = SqlClient & {
  json?: (value: postgres.JSONValue) => postgres.Parameter;
};

const MONITOR_SIGNAL_POLICY_VERSION = "2026-08-15";

function jsonParam(value: postgres.JSONValue, db: SqlClient): postgres.Parameter | string {
  const dbJson = (db as JsonCapableSqlClient).json;
  if (typeof dbJson === "function") return dbJson(value);
  const sqlJson = (sql as JsonCapableSqlClient).json;
  if (typeof sqlJson === "function") return sqlJson(value);
  return JSON.stringify(value);
}

function sourceObject(value: postgres.JSONValue | null | undefined): Record<string, postgres.JSONValue> {
  if (!value) return {};
  if (Array.isArray(value) || typeof value !== "object") {
    return { source_value: value };
  }
  return value as Record<string, postgres.JSONValue>;
}

function isEvidencePolicy(value: unknown): value is HamiltonEvidencePolicy {
  return (
    typeof value === "string" &&
    (HAMILTON_EVIDENCE_POLICIES as readonly string[]).includes(value)
  );
}

function defaultEvidencePolicyForSignal(signalType: string): HamiltonEvidencePolicy {
  const normalized = signalType.toLowerCase();
  if (normalized.startsWith("source_") || normalized.startsWith("claim_")) {
    return "source-diligence";
  }
  if (normalized.includes("needs_review")) {
    return "source-diligence";
  }
  if (normalized.startsWith("knox_")) {
    return "provisional-first";
  }
  return "verified-only";
}

function isProviderOriginated(source: Record<string, postgres.JSONValue>): boolean {
  const sourceLabel = String(source.source ?? source.origin ?? "").toLowerCase();
  return (
    source.provider_generated === true ||
    sourceLabel.includes("provider") ||
    typeof source.provider === "string" ||
    typeof source.model === "string"
  );
}

function isMovementOrCompetitorSignal(signalType: string): boolean {
  const normalized = signalType.toLowerCase();
  return normalized.includes("movement") || normalized.includes("competitor");
}

export function buildHamiltonMonitorSignalSourceJson(input: {
  institutionId: number;
  signalType: string;
  sourceJson?: postgres.JSONValue | null;
}): postgres.JSONValue | null {
  const source = sourceObject(input.sourceJson);
  if (source.provider_call_queued === true) return null;

  const hasExplicitEvidencePolicy = isEvidencePolicy(source.evidence_policy);
  const evidencePolicy = hasExplicitEvidencePolicy
    ? source.evidence_policy
    : defaultEvidencePolicyForSignal(input.signalType);
  if (
    isProviderOriginated(source) &&
    isMovementOrCompetitorSignal(input.signalType) &&
    !hasExplicitEvidencePolicy
  ) {
    return null;
  }

  return {
    ...source,
    institution_id: String(input.institutionId),
    evidence_policy: evidencePolicy,
    provider_call_queued: false,
    monitor_policy_version: MONITOR_SIGNAL_POLICY_VERSION,
  };
}

export async function recordHamiltonMonitorSignal(
  input: HamiltonMonitorSignalInput,
  db: SqlClient = sql,
): Promise<string | null> {
  if (!Number.isInteger(input.institutionId) || input.institutionId <= 0) return null;
  const sourceJson = buildHamiltonMonitorSignalSourceJson({
    institutionId: input.institutionId,
    signalType: input.signalType,
    sourceJson: input.sourceJson ?? null,
  });
  if (!sourceJson) return null;

  const rows = await db<{ id: string }[]>`
    INSERT INTO hamilton_signals (
      institution_id,
      signal_type,
      severity,
      title,
      body,
      source_json,
      created_at
    ) VALUES (
      ${String(input.institutionId)},
      ${input.signalType},
      ${input.severity},
      ${input.title},
      ${input.body},
      ${jsonParam(sourceJson, db)},
      NOW()
    )
    RETURNING id
  `;

  const signalId = rows[0]?.id ? String(rows[0].id) : null;
  if (signalId) {
    await enqueueHamiltonRefreshJobsForSignal({
      signalId,
      institutionId: input.institutionId,
      signalType: input.signalType,
      severity: input.severity,
      title: input.title,
      sourceJson,
      db,
    }).catch((error) => {
      console.error("enqueueHamiltonRefreshJobsForSignal failed:", error);
    });
  }

  if (signalId && input.alertWatchers) {
    // institution_ids is a jsonb array of id strings (or numbers); match either form.
    await db`
      INSERT INTO hamilton_priority_alerts (user_id, signal_id, status, created_at)
      SELECT w.user_id, ${signalId}::uuid, 'active', NOW()
        FROM hamilton_watchlists w
       WHERE (w.institution_ids ? ${String(input.institutionId)}
              OR w.institution_ids @> ${JSON.stringify([input.institutionId])}::jsonb)
         AND w.user_id IS DISTINCT FROM ${input.priorityAlertUserId ?? null}
    `.catch((error: unknown) => {
      console.error("watcher priority alerts failed:", error);
    });
  }

  if (!signalId || !input.priorityAlertUserId) return signalId;

  await db`
    INSERT INTO hamilton_priority_alerts (
      user_id,
      signal_id,
      status,
      created_at
    ) VALUES (
      ${input.priorityAlertUserId},
      ${signalId}::uuid,
      'active',
      NOW()
    )
  `;

  return signalId;
}
