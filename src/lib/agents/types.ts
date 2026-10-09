export type AdminAgent = "atlas" | "magellan" | "rosetta" | "darwin" | "knox" | "hamilton" | "growth";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "blocked"
  | "complete"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export type AgentRunStepStatus =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "skipped";

export type AgentRunKind =
  | "workflow"
  | "workflow_lane"
  | "state_agent"
  | "report"
  | "manual_repair"
  | "dry_run"
  /** A paid Pro AI request recorded after it finishes; never executed by the tick. */
  | "pro_request";

export type AgentRunTriggerSource = "schedule" | "admin" | "api" | "agent";

export interface AgentRunStepDefinition {
  key: string;
  title: string;
  agent: AdminAgent;
  input?: Record<string, unknown>;
}

export interface AgentRunSnapshot {
  id: number;
  agent: AdminAgent;
  runKind: AgentRunKind;
  title: string;
  status: AgentRunStatus;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  triggerSource: AgentRunTriggerSource;
  triggeredBy: string | null;
  correlationId: string;
  backend: string;
  progressCurrent: number;
  progressTotal: number;
  currentStage: string | null;
  error: string | null;
  summary: string | null;
  params: Record<string, unknown>;
}

export interface AgentRunStepSnapshot {
  id: number;
  runId: number;
  stepKey: string;
  agent: AdminAgent;
  title: string;
  input: Record<string, unknown>;
  status: AgentRunStepStatus;
  sequence: number;
  summary: string | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface AgentRunEventSnapshot {
  id: number;
  runId: number;
  stepId: number | null;
  eventType: string;
  status: string;
  message: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

/**
 * Step keys that may call a paid model provider. Only these steps are gated by the
 * provider budget policy and the global (provider) automation stop. Every other step
 * is deterministic and is paused only by the separate pipeline control.
 */
/** Pass-3 steps: paid model calls for what the free passes left, under the budget caps. */
export const PROVIDER_STEP_KEYS: readonly string[] = ["discover-paid", "read-paid", "extract-paid", "verify-paid", "report-render", "marketing-write"];

export function isProviderStep(stepKey: string): boolean {
  return PROVIDER_STEP_KEYS.includes(stepKey);
}

/** A step still `running` after this long was killed (function timeout, crash). */
export const STALE_RUNNING_STEP_MINUTES = 15;
/** Reaped attempts allowed before a step is declared dead and its run failed. */
export const MAX_STEP_ATTEMPTS = 3;

/**
 * Steps that report on the pipeline rather than change data. They still run while
 * the pipeline control is paused, so the operator keeps hearing from Atlas.
 */
export const PAUSE_EXEMPT_STEP_KEYS: readonly string[] = [
  "briefing-refresh",
  "competitor-alerts",
  "daily-brief",
  "fee-alert-dispatch",
  "lead-watch",
  "pro-digest",
  "pro-seat-check",
  "score-answer-key",
  "scoreboard-snapshot",
];

/**
 * Growth's marketing steps (content drafts, monthly email, queue intake, weekly scoring).
 * They obey the `marketing` control (`getMarketingControl`) instead of the pipeline pause:
 * pausing marketing leaves data runs going, and pausing the pipeline leaves marketing runs going.
 */
export const MARKETING_STEP_KEYS: readonly string[] = [
  "content-fee-depth",
  "content-market-spread",
  "content-od-by-state",
  "growth-contact-picks",
  "growth-contacts",
  "growth-conversion",
  "growth-intel",
  "growth-outreach",
  "growth-learning",
  "growth-press",
  "growth-intake",
  "growth-score",
  "growth-tools",
  "marketing-score",
  "marketing-send",
  "marketing-states",
  "marketing-write",
];

export function isMarketingStep(stepKey: string): boolean {
  return MARKETING_STEP_KEYS.includes(stepKey);
}

/**
 * Which operator pause holds a step: `marketing` for growth's steps, `none` for the
 * reporting steps that run through any pause, `pipeline` for everything else.
 */
export function pauseScopeForStep(stepKey: string): "marketing" | "pipeline" | "none" {
  if (isMarketingStep(stepKey)) return "marketing";
  if (PAUSE_EXEMPT_STEP_KEYS.includes(stepKey)) return "none";
  return "pipeline";
}
