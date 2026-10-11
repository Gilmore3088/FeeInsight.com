import { describe, expect, it } from "vitest";
import { mapEvent, mapRun, mapStep } from "./run-row-mappers";

const day = "2026-10-11T03:00:00.000Z";

describe("agent ledger row-to-snapshot mappings (R05)", () => {
  it("maps a persisted run, preserving numeric progress, JSON params and date lineage", () => {
    const result = mapRun({
      id: "42", agent_name: "hamilton", run_kind: "workflow_lane",
      title: "Fee review", status: "running", started_at: new Date(day),
      updated_at: null, completed_at: null, trigger_source: "schedule",
      triggered_by: "cron", correlation_id: "opaque", backend: "agentic_v1",
      progress_current: "2", progress_total: "7", current_stage: "publish",
      summary: "In progress", params_json: '{"institution_id":47,"dry_run":true}',
    });
    expect(result).toMatchObject({
      id: 42, agent: "hamilton", runKind: "workflow_lane", status: "running",
      startedAt: day, updatedAt: day, completedAt: null,
      triggerSource: "schedule", triggeredBy: "cron", progressCurrent: 2, progressTotal: 7,
      currentStage: "publish", params: { institution_id: 47, dry_run: true },
    });
  });

  it("retains existing fallbacks for sparse run rows without inventing metadata", () => {
    const result = mapRun({ id: 5 });
    expect(result).toMatchObject({
      id: 5, agent: "atlas", runKind: "workflow", title: "Agent run",
      status: "queued", startedAt: "1970-01-01T00:00:00.000Z",
      completedAt: null, updatedAt: "1970-01-01T00:00:00.000Z",
      triggerSource: "admin", triggeredBy: null, correlationId: "",
      backend: "agentic_v1", progressCurrent: 0, progressTotal: 0,
      currentStage: null, error: null, summary: null, params: {},
    });
  });

  it("maps step ordering, input JSON and optional lifecycle timestamps", () => {
    const result = mapStep({
      id: "8", agent_run_id: "42", step_key: "verify", agent_name: "darwin",
      title: "Review fee evidence", status: "completed", sequence: "3",
      input_payload: { stage: "source" }, queued_at: day, updated_at: null,
      started_at: new Date(day), completed_at: day, error_summary: null,
    });
    expect(result).toMatchObject({
      id: 8, runId: 42, stepKey: "verify", agent: "darwin", sequence: 3,
      input: { stage: "source" }, status: "completed", queuedAt: day,
      startedAt: day, completedAt: day, updatedAt: day, summary: null, error: null,
    });
  });

  it("maps append-only event lineage and preserves zero as an actual step ID", () => {
    const result = mapEvent({
      id: "99", agent_run_id: "42", step_id: 0, event_type: "step.completed",
      status: "completed", message: "Published", detail: '{"published":0}',
      created_at: day,
    });
    expect(result).toEqual({
      id: 99, runId: 42, stepId: 0, eventType: "step.completed",
      status: "completed", message: "Published", detail: { published: 0 },
      createdAt: day,
    });
    expect(mapEvent({ id: 100, agent_run_id: 42, step_id: null, created_at: null }).stepId).toBeNull();
  });

  it("keeps malformed, non-record or absent JSONB snapshots empty", () => {
    for (const invalid of [null, undefined, "not json", '["not","a","record"]', 3]) {
      expect(mapRun({ id: 1, params_json: invalid }).params).toEqual({});
      expect(mapStep({ id: 1, input_payload: invalid }).input).toEqual({});
      expect(mapEvent({ id: 1, detail: invalid }).detail).toEqual({});
    }
  });
});
