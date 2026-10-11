import { safeJsonb, toISO } from "@/lib/pg-helpers";
import type {
  AdminAgent,
  AgentRunEventSnapshot,
  AgentRunKind,
  AgentRunSnapshot,
  AgentRunStepSnapshot,
  AgentRunTriggerSource,
} from "./types";

// Database row shapes stay private to the ledger boundary; only typed snapshots leave it.
function requiredIso(value: unknown): string {
  return toISO(value as string | Date | null | undefined) ?? new Date(0).toISOString();
}

function optionalIso(value: unknown): string | null {
  return toISO(value as string | Date | null | undefined);
}

function safeRecord(value: unknown): Record<string, unknown> {
  const parsed = safeJsonb<Record<string, unknown>>(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export function mapRun(row: Record<string, unknown>): AgentRunSnapshot {
  return {
    id: Number(row.id),
    agent: String(row.agent_name ?? "atlas") as AdminAgent,
    runKind: String(row.run_kind ?? "workflow") as AgentRunKind,
    title: String(row.title ?? "Agent run"),
    status: String(row.status ?? "queued") as AgentRunSnapshot["status"],
    startedAt: requiredIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    updatedAt: requiredIso(row.updated_at ?? row.started_at),
    triggerSource: String(row.trigger_source ?? "admin") as AgentRunTriggerSource,
    triggeredBy: row.triggered_by ? String(row.triggered_by) : null,
    correlationId: String(row.correlation_id ?? ""),
    backend: String(row.backend ?? "agentic_v1"),
    progressCurrent: Number(row.progress_current ?? 0),
    progressTotal: Number(row.progress_total ?? 0),
    currentStage: row.current_stage ? String(row.current_stage) : null,
    error: row.error_summary ? String(row.error_summary) : null,
    summary: row.summary ? String(row.summary) : null,
    params: safeRecord(row.params_json),
  };
}

export function mapStep(row: Record<string, unknown>): AgentRunStepSnapshot {
  return {
    id: Number(row.id),
    runId: Number(row.agent_run_id),
    stepKey: String(row.step_key),
    agent: String(row.agent_name) as AdminAgent,
    title: String(row.title),
    input: safeRecord(row.input_payload),
    status: String(row.status) as AgentRunStepSnapshot["status"],
    sequence: Number(row.sequence ?? 0),
    summary: row.summary ? String(row.summary) : null,
    error: row.error_summary ? String(row.error_summary) : null,
    queuedAt: requiredIso(row.queued_at),
    startedAt: optionalIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    updatedAt: requiredIso(row.updated_at ?? row.queued_at),
  };
}

export function mapEvent(row: Record<string, unknown>): AgentRunEventSnapshot {
  return {
    id: Number(row.id),
    runId: Number(row.agent_run_id),
    stepId: row.step_id == null ? null : Number(row.step_id),
    eventType: String(row.event_type),
    status: String(row.status),
    message: String(row.message),
    detail: safeRecord(row.detail),
    createdAt: requiredIso(row.created_at),
  };
}

