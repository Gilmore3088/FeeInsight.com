import { sql, withTransaction } from "./data-store/connection";

export interface AutomationControlState {
  enabled: boolean;
  reason: string | null;
  changedBy: string;
  changedAt: string;
  revision: number;
}

/**
 * Provider error text that means billing/credits are exhausted. The provider circuit
 * (ai-provider-usage.ts) and the resume guard below share this one list so they can
 * never disagree about whether a failure is a billing failure.
 */
export const PROVIDER_CREDIT_ERROR_MARKERS = [
  "credit balance is too low",
  "insufficient credits",
  "purchase credits",
  "plans & billing",
] as const;

export const PROVIDER_CREDIT_ERROR_PATTERNS = PROVIDER_CREDIT_ERROR_MARKERS.map((marker) => `%${marker}%`);

export class EmergencyStopActiveError extends Error {
  readonly control: AutomationControlState;

  constructor(control: AutomationControlState, context: string) {
    super(`Emergency stop is active; ${context} is blocked${control.reason ? `: ${control.reason}` : ""}`);
    this.name = "EmergencyStopActiveError";
    this.control = control;
  }
}

function mapControl(row: Record<string, unknown>): AutomationControlState {
  return {
    enabled: Boolean(row.enabled),
    reason: row.reason ? String(row.reason) : null,
    changedBy: String(row.changed_by ?? "system"),
    changedAt: new Date(row.changed_at as string | Date).toISOString(),
    revision: Number(row.revision ?? 1),
  };
}

export class PipelinePausedError extends Error {
  readonly control: AutomationControlState;

  constructor(control: AutomationControlState, context: string) {
    super(`Pipeline is paused; ${context} is blocked${control.reason ? `: ${control.reason}` : ""}`);
    this.name = "PipelinePausedError";
    this.control = control;
  }
}

export async function getAutomationControl(): Promise<AutomationControlState> {
  const [row] = await sql`
    SELECT enabled, reason, changed_by, changed_at, revision
      FROM automation_control
     WHERE control_key = 'global'
  `;
  if (!row) {
    throw new Error("Global automation control is not configured");
  }
  return mapControl(row);
}

export async function assertAutomationEnabled(context: string): Promise<AutomationControlState> {
  const control = await getAutomationControl();
  if (!control.enabled) {
    throw new EmergencyStopActiveError(control, context);
  }
  return control;
}

/**
 * Operator pause for deterministic pipeline steps (discover, fetch, read, extract,
 * verify, publish). Independent of the provider stop above. A missing row means the
 * pipeline is enabled, so code can deploy before its migration.
 */
export async function getPipelineControl(): Promise<AutomationControlState> {
  const [row] = await sql`
    SELECT enabled, reason, changed_by, changed_at, revision
      FROM automation_control
     WHERE control_key = 'pipeline'
  `;
  return row ? mapControl(row) : defaultEnabledControl();
}

export async function assertPipelineEnabled(context: string): Promise<AutomationControlState> {
  const control = await getPipelineControl();
  if (!control.enabled) {
    throw new PipelinePausedError(control, context);
  }
  return control;
}

/** The state a missing operator-pause row stands for: enabled, never changed. */
function defaultEnabledControl(): AutomationControlState {
  return {
    enabled: true,
    reason: null,
    changedBy: "default",
    changedAt: new Date(0).toISOString(),
    revision: 0,
  };
}

/** Upserts one operator-pause row and audits the change, in one transaction. */
async function setOperatorControl(
  controlKey: "pipeline" | "marketing",
  actor: string,
  enabled: boolean,
  normalizedReason: string,
): Promise<AutomationControlState> {
  return withTransaction(async (tx) => {
    const [row] = await tx`
      INSERT INTO automation_control (control_key, enabled, reason, changed_by, changed_at, revision)
      VALUES (${controlKey}, ${enabled}, ${normalizedReason}, ${actor}, NOW(), 1)
      ON CONFLICT (control_key) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             reason = EXCLUDED.reason,
             changed_by = EXCLUDED.changed_by,
             changed_at = NOW(),
             revision = automation_control.revision + 1
      RETURNING enabled, reason, changed_by, changed_at, revision
    `;
    await tx`
      INSERT INTO automation_control_audit
        (action, reason, actor, active_job_count)
      VALUES
        (${`${controlKey}_${enabled ? "resume" : "pause"}`}, ${normalizedReason}, ${actor}, 0)
    `;
    return mapControl(row);
  });
}

export async function setPipelineEnabled(
  actor: string,
  enabled: boolean,
  reason: string,
): Promise<AutomationControlState> {
  const normalizedReason = reason.trim().slice(0, 500)
    || (enabled ? "Pipeline resumed by an administrator" : "Pipeline paused by an administrator");
  return setOperatorControl("pipeline", actor, enabled, normalizedReason);
}

/**
 * Operator pause for growth's marketing steps (`MARKETING_STEP_KEYS`: content drafts and
 * the monthly email). Separate from the pipeline pause: each leaves the other's runs
 * going. A missing row means marketing is enabled, so code can deploy before any row.
 */
export async function getMarketingControl(): Promise<AutomationControlState> {
  const [row] = await sql`
    SELECT enabled, reason, changed_by, changed_at, revision
      FROM automation_control
     WHERE control_key = 'marketing'
  `;
  return row ? mapControl(row) : defaultEnabledControl();
}

export async function setMarketingEnabled(
  actor: string,
  enabled: boolean,
  reason: string,
): Promise<AutomationControlState> {
  const normalizedReason = reason.trim().slice(0, 500)
    || (enabled ? "Marketing resumed by an administrator" : "Marketing paused by an administrator");
  return setOperatorControl("marketing", actor, enabled, normalizedReason);
}

/**
 * Operator attestation that provider billing was fixed. Provider credit failures
 * recorded before this moment no longer hold the circuit open or block resume.
 */
export async function recordBillingResolved(actor: string, reason: string): Promise<void> {
  const normalizedReason = reason.trim().slice(0, 500) || "Provider billing resolved by an administrator";
  await sql`
    INSERT INTO automation_control_audit
      (action, reason, actor, active_job_count)
    VALUES
      ('billing_resolved', ${normalizedReason}, ${actor}, 0)
  `;
}

/**
 * Most recent provider credit failure in the last 24 hours that is newer than the
 * latest operator billing-resolved attestation. Null means the circuit is clear.
 */
export async function findOpenProviderCreditFailure(provider?: string): Promise<{
  provider: string;
  agentName: string;
  operation: string;
  createdAt: string;
} | null> {
  const [failure] = await sql`
    SELECT provider, model, agent_name, operation, created_at
      FROM ai_api_usage_events
     WHERE status = 'failed'
       AND (${provider ?? null}::text IS NULL OR provider = ${provider ?? null})
       AND error_summary ILIKE ANY(${PROVIDER_CREDIT_ERROR_PATTERNS as string[]})
       AND created_at >= NOW() - INTERVAL '24 hours'
       AND created_at > COALESCE(
         (SELECT MAX(created_at) FROM automation_control_audit WHERE action = 'billing_resolved'),
         '-infinity'::timestamptz
       )
     ORDER BY created_at DESC
     LIMIT 1
  `;
  if (!failure) return null;
  return {
    provider: String(failure.provider ?? "provider"),
    agentName: String(failure.agent_name ?? "unknown agent"),
    operation: String(failure.operation ?? "unknown operation"),
    createdAt: new Date(failure.created_at as string | Date).toISOString(),
  };
}

export async function engageEmergencyStop(
  actor: string,
  reason: string,
): Promise<AutomationControlState> {
  const normalizedReason = reason.trim().slice(0, 500)
    || "Emergency stop engaged by an administrator";

  return withTransaction(async (tx) => {
    const [active] = await tx`
      SELECT COUNT(*)::int AS count
        FROM agent_runs
       WHERE run_kind IN ('workflow', 'workflow_lane', 'state_agent', 'report', 'manual_repair', 'dry_run')
         AND status IN ('queued', 'running', 'cancel_requested')
    `;
    const [row] = await tx`
      UPDATE automation_control
         SET enabled = FALSE,
             reason = ${normalizedReason},
             changed_by = ${actor},
             changed_at = NOW(),
             revision = revision + 1
       WHERE control_key = 'global'
       RETURNING enabled, reason, changed_by, changed_at, revision
    `;
    await tx`
      INSERT INTO automation_control_audit
        (action, reason, actor, active_job_count)
      VALUES
        ('emergency_stop', ${normalizedReason}, ${actor}, ${Number(active?.count ?? 0)})
    `;
    if (!row) throw new Error("Global automation control is not configured");
    return mapControl(row);
  });
}

async function assertNoRecentProviderCreditFailure(): Promise<void> {
  const failure = await findOpenProviderCreditFailure();
  if (!failure) return;
  throw new Error(
    `Cannot resume automation: latest ${failure.provider} credit-balance failure was ${failure.createdAt} on ${failure.agentName}.${failure.operation}. Fix provider billing and record "billing resolved", or move this route off the failing provider before resuming.`,
  );
}

export async function resumeAutomation(
  actor: string,
  reason: string,
): Promise<AutomationControlState> {
  await assertNoRecentProviderCreditFailure();

  const normalizedReason = reason.trim().slice(0, 500)
    || "Automation resumed after operator review";

  return withTransaction(async (tx) => {
    const [row] = await tx`
      UPDATE automation_control
         SET enabled = TRUE,
             reason = ${normalizedReason},
             changed_by = ${actor},
             changed_at = NOW(),
             revision = revision + 1
       WHERE control_key = 'global'
       RETURNING enabled, reason, changed_by, changed_at, revision
    `;
    await tx`
      INSERT INTO automation_control_audit
        (action, reason, actor, active_job_count)
      VALUES
        ('resume', ${normalizedReason}, ${actor}, 0)
    `;
    if (!row) throw new Error("Global automation control is not configured");
    return mapControl(row);
  });
}

export async function recordEmergencyStopOutcome(
  actor: string,
  outcome: {
    requested: number;
    cancelled: number;
    failed: Array<{ runId: number; error: string }>;
  },
): Promise<void> {
  await sql`
    UPDATE automation_control_audit
       SET metadata = ${JSON.stringify({
         cancellation_requested: outcome.requested,
         cancellation_confirmed: outcome.cancelled,
         cancellation_failures: outcome.failed,
       })}::JSONB
     WHERE id = (
       SELECT id
         FROM automation_control_audit
        WHERE action = 'emergency_stop'
          AND actor = ${actor}
        ORDER BY created_at DESC
        LIMIT 1
     )
  `;
}
