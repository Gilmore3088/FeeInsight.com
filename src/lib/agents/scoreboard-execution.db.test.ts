// @vitest-environment node
/** Real route → selector → ledger transactions. Only step effects are injected. */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as postgres.Sql | null, pipeline: true, marketing: true, backend: true,
  effects: [] as string[], schedule: vi.fn(), provider: vi.fn(), audit: vi.fn(), pipelineReads: 0,
  unpauseAfterTickRead: false, beforeTransaction: null as (() => Promise<void>) | null }));
vi.mock("@/lib/data-store/connection", async (original) => ({
  ...await original<typeof import("@/lib/data-store/connection")>(),
  sql: new Proxy(() => {}, {
    apply: (_target, _this, args) => Reflect.apply(state.db!, state.db, args),
    get: (_target, key) => {
      const value = Reflect.get(state.db!, key);
      return typeof value === "function" ? value.bind(state.db) : value;
    },
  }),
  withTransaction: async (callback: (tx: postgres.TransactionSql) => Promise<unknown>) => {
    const before = state.beforeTransaction; state.beforeTransaction = null;
    if (before) await before();
    return state.db!.begin(callback);
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => null, hasPermission: () => false }));
vi.mock("@/lib/api-hardening/audit", () => ({ recordApiRouteAuditEvent: state.audit, getRequestSubjectKey: () => "isolated-scoreboard" }));
vi.mock("@/lib/api-hardening/rate-limit", () => ({ isRateLimited: async () => false }));
vi.mock("@/lib/execution-backend", () => ({ getExecutionBackend: () => state.backend ? "agentic_v1" : "disabled",
  getExecutionBackendStatus: () => ({ enabled: state.backend, backend: state.backend ? "agentic_v1" : "disabled", detail: "Fixture backend" }) }));
vi.mock("@/lib/automation-control", () => ({ getPipelineControl: async () => {
  if (++state.pipelineReads > 1 && state.unpauseAfterTickRead) state.pipeline = true;
  return { enabled: state.pipeline, reason: "Fixture pipeline" };
},
  getMarketingControl: async () => ({ enabled: state.marketing, reason: "Fixture marketing" }),
  getAutomationControl: state.provider, assertAutomationEnabled: state.provider }));
vi.mock("@/lib/api-hardening/budget", () => ({ assertCronTickBudgetAllowed: state.provider }));
vi.mock("@/lib/agents/state-lane-scheduler", () => ({ scheduleDueStateLaneRuns: state.schedule, STATE_LANE_LIMIT_PER_TICK: 3 }));
vi.mock("@/lib/agents/atlas/priority-institutions", () => ({ schedulePriorityInstitutionRuns: state.schedule }));
vi.mock("@/lib/agents/atlas/priority-state-research", () => ({ schedulePriorityStateResearchRuns: state.schedule }));
vi.mock("@/lib/agents/hamilton/guard-catch-up", () => ({ scheduleGuardCatchUpRun: state.schedule }));
vi.mock("@/lib/agents/hamilton/publish-sweeps-schedule", () => ({ schedulePublishSweepsRun: state.schedule }));
vi.mock("@/lib/agents/darwin/audience-relabel-schedule", () => ({ scheduleAudienceRelabelRun: state.schedule }));
vi.mock("@/lib/agents/deming/live-source-schedule",()=>({scheduleLiveSourceAudit:state.schedule}));
vi.mock("@/lib/agents/growth/withdraw", () => ({ scheduleStaleOutreachWithdrawal: state.schedule }));

async function effect(key: string, result: Record<string, unknown> = {}) { state.effects.push(key); return result; }
vi.mock("@/lib/agents/atlas/answer-key-relabels", () => ({ runAnswerKeyRelabels: () => effect("relabel"),
  summarizeAnswerKeyRelabels: () => "Synthetic relabel", answerKeyRelabelDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/answer-key-score", async (original) => ({ ...await original<typeof import("./answer-key-score")>(),
  runAnswerKeyScore: () => effect("score-answer-key", { schemaReady: true, score: null, series: [] }), summarizeAnswerKeyScore: () => "Synthetic score" }));
vi.mock("@/lib/agents/deming/regression", () => ({ DEMING_REGRESSION_VERSION: 1,
  runDemingRegression: () => effect("deming-regression", { regressions: [] }), summarizeDemingRegression: () => "Synthetic regression" }));
vi.mock("@/lib/agents/deming/fresh-audit", () => ({ FRESH_AUDIT_VERSION: 5,
  runFreshAudit: () => effect("deming-fresh-audit", { readable: false, misses: [] }), summarizeFreshAudit: () => "Synthetic stored audit", freshAuditDetail: () => ({ readable: false }) }));
vi.mock("@/lib/data-store/live-source-audit",async(original)=>({...await original<typeof import("@/lib/data-store/live-source-audit")>(),createLiveAuditDraw:async()=>{state.effects.push("deming-live-source-draw");return {id:1,valid:true,detail:{state:"ready",rows:[]}};}}));
vi.mock("@/lib/agents/deming/benchmark-health", () => ({ runBenchmarkHealth: () => effect("deming-benchmark-health"),
  summarizeBenchmarkHealth: () => "Synthetic benchmark health", benchmarkHealthDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/deming/playbook-contradictions", () => ({ runPlaybookContradictions: () => effect("deming-playbook-check"),
  summarizePlaybookContradictions: () => "Synthetic playbook check", playbookContradictionsDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/deming/data-quality", () => ({ runDataQuality: () => effect("deming-data-quality"),
  summarizeDataQuality: () => "Synthetic quality check", dataQualityDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/hoovie/source-health", () => ({ readSourceHealth: () => effect("deming-source-health"),
  summarizeSourceHealth: () => "Synthetic source health", sourceHealthDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/scoreboard", () => ({ runScoreboardSnapshot: async ({ db, runId }: { db: postgres.Sql; runId: number }) => {
  state.effects.push("scoreboard-snapshot");
  await db`INSERT INTO fixture_snapshots (agent_run_id) VALUES (${runId})`;
  return { schemaReady: true, stored: true, snapshotDate: "2026-10-19", numbers: {} };
}, summarizeScoreboard: () => "Synthetic snapshot stored" }));
vi.mock("@/lib/agents/deming/change-outcomes", () => ({ runChangeOutcomes: () => effect("deming-change-outcomes", { judged: [] }), summarizeChangeOutcomes: () => "Synthetic outcomes" }));
vi.mock("@/lib/agents/deming/sunday-maintenance", () => ({ runSundayMaintenance: () => effect("deming-sunday-maintenance", { email: null }), summarizeSundayMaintenance: () => "Synthetic maintenance" }));
vi.mock("@/lib/agents/atlas/city-repair", () => ({ runCityRepair: () => effect("atlas-city-repair"), summarizeCityRepair: () => "Synthetic city repair", cityRepairDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/atlas/hand-link-repair", () => ({ runHandLinkRepair: () => effect("hand-links", { candidates: [] }), summarizeHandLinkRepair: () => "Synthetic links", handLinkRepairDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/atlas/storage-retention", () => ({ runStorageRetention: () => effect("atlas-storage-retention", { alerts: [] }), summarizeStorageRetention: () => "Synthetic retention", storageRetentionDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/hoovie/storage-tiers", () => ({ runColdTier: () => effect("cold-tier"), summarizeColdTier: () => "Synthetic cold tier", coldTierDetail: () => ({ fixture: true }) }));
vi.mock("@/lib/agents/atlas/vault-retention", () => ({ runVaultRetention: () => effect("vault-retention", { alerts: [] }), summarizeVaultRetention: () => "Synthetic vault", vaultRetentionDetail: () => ({ fixture: true }) }));

import { executeAgentRun, executeQueuedAgentRuns, reapStaleAgentSteps, startAgentRun, type StartAgentRunInput } from "./run-store";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { GET as queueScoreboard } from "@/app/api/admin/crew/scoreboard/route";
import { GET as tick } from "@/app/api/admin/agents/tick/route";

const connection = process.env.E2E_DATABASE_URL;
const schema = `scoreboard_budget_${randomBytes(8).toString("hex")}`;
const scope = { agent: "atlas", kind: "workflow", source: "atlas.scoreboard" } as const;
const request = (path: string) => new NextRequest(`https://feeinsight.com/api/admin/${path}`, { headers: { authorization: "Bearer synthetic-scoreboard-cron" } });
const template = (source = "atlas.scoreboard", key = "fixture-scoreboard"): StartAgentRunInput => ({ agent: "atlas", kind: "workflow",
  title: "Synthetic scoreboard", params: { source }, triggeredBy: "isolated-test", idempotencyKey: key,
  steps: [{ key: "score-answer-key", agent: "atlas", title: "Synthetic score" }] });

describe.skipIf(!connection)("scoreboard execution in isolated PostgreSQL", () => {
  let admin: postgres.Sql;
  let db: postgres.Sql;
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Scoreboard SQL tests require a loopback fixture");
    admin = postgres(connection, { ssl: "require", prepare: false, onnotice: () => undefined });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    for (const table of ["agent_runs", "agent_run_steps", "agent_run_events"]) {
      await admin.unsafe(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
      // Never advance a public sequence: each copied table receives its own identity.
      await admin.unsafe(`ALTER TABLE "${schema}".${table} ALTER COLUMN id DROP DEFAULT`);
      await admin.unsafe(`ALTER TABLE "${schema}".${table} ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY`);
    }
    await admin.unsafe(`CREATE TABLE "${schema}".agent_state_lanes (LIKE public.agent_state_lanes INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    await admin.unsafe(`CREATE TABLE "${schema}".fixture_snapshots (agent_run_id integer PRIMARY KEY)`);
    db = postgres(connection, { ssl: "require", prepare: false, max: 8, onnotice: () => undefined, connection: { search_path: schema },
      types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } }) as unknown as postgres.Sql;
    state.db = db;
    vi.stubEnv("CRON_SECRET", "synthetic-scoreboard-cron");
  });
  beforeEach(async () => {
    await db`TRUNCATE agent_run_events, agent_run_steps, agent_runs, fixture_snapshots RESTART IDENTITY`;
    state.pipeline = state.marketing = state.backend = true;
    state.pipelineReads = 0; state.unpauseAfterTickRead = false; state.beforeTransaction = null;
    state.effects.length = 0;
    state.provider.mockReset().mockRejectedValue(new Error("No provider path is allowed in this fixture"));
    state.schedule.mockReset().mockResolvedValue({ selected: 0, scheduled: 0, reused: 0, failed: [], results: [] });
    state.audit.mockReset().mockResolvedValue(undefined);
  });
  afterAll(async () => {
    if (db) await db.end();
    state.db = null;
    if (admin) { await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`; await admin.end(); }
    vi.unstubAllEnvs();
  });
  const row = async (id: number) => (await db`SELECT status, progress_current, progress_total, current_stage FROM agent_runs WHERE id=${id}`)[0];
  const steps = async (id: number) => db`SELECT step_key, status FROM agent_run_steps WHERE agent_run_id=${id} ORDER BY sequence, id`;

  it("serializes concurrent real daily requests and reuses their original steps", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, async () => {
      const response = await queueScoreboard(request("crew/scoreboard"));
      expect(response.status).toBe(200);
      return response.json();
    }));
    expect(new Set(results.map(body => body.runId)).size).toBe(1);
    expect(results.filter(body => !body.reused)).toHaveLength(1);
    expect((await db`SELECT count(*)::int AS n FROM agent_runs`)[0].n).toBe(1);
    expect(await steps(results[0].runId)).toHaveLength(14);
    expect(state.effects).toEqual([]);
  });

  it.each(["queued", "running", "cancel_requested", "complete", "completed", "failed", "cancelled", "blocked"])("reuses canonical %s history, including a paused run, without resetting steps", async (status) => {
    const first = await (await queueScoreboard(request("crew/scoreboard"))).json();
    await db`UPDATE agent_runs SET status=${status} WHERE id=${first.runId}`;
    await db`UPDATE agent_run_steps SET summary='Original state retained' WHERE agent_run_id=${first.runId} AND sequence=1`;
    state.pipeline = state.marketing = false;
    const body = await (await queueScoreboard(request("crew/scoreboard"))).json();
    expect(body).toMatchObject({ reused: true, runId: first.runId, result: { status } });
    expect((await db`SELECT summary FROM agent_run_steps WHERE agent_run_id=${first.runId} AND sequence=1`)[0].summary).toBe("Original state retained");
    expect((await db`SELECT count(*)::int AS n FROM agent_runs`)[0].n).toBe(1);
    expect(state.effects).toEqual([]);
  });

  it("uses the earliest existing duplicate key deterministically without deleting later history", async () => {
    const input = { ...template(), reuseTerminal: true };
    const first = await startAgentRun(input);
    await db`UPDATE agent_runs SET status='failed' WHERE id=${first.run.id}`;
    const second = await startAgentRun({ ...input, reuseTerminal: false });
    const reused = await startAgentRun(input);
    expect(reused).toMatchObject({ reused: true, run: { id: first.run.id, status: "failed" } });
    expect(second.run.id).not.toBe(first.run.id);
    expect(await row(second.run.id)).toMatchObject({ status: "queued", progress_current: 0 });
    expect((await db`SELECT count(*)::int AS n FROM agent_runs`)[0].n).toBe(2);
  });

  it("preserves default active-only idempotency for unrelated callers", async () => {
    const input = template("fixture.other", "active-only");
    const first = await startAgentRun(input);
    expect((await startAgentRun(input)).run.id).toBe(first.run.id);
    await db`UPDATE agent_runs SET status='completed' WHERE id=${first.run.id}`;
    expect((await startAgentRun(input)).run.id).not.toBe(first.run.id);
  });

  it("advances all 14 real ledger steps over ticks, snapshots after measurements, and holds/resumes the paused tail", async () => {
    const body = await (await queueScoreboard(request("crew/scoreboard"))).json();
    state.pipeline = state.marketing = false;
    const firstTick = await (await tick(request("agents/tick"))).json();
    expect(firstTick).toMatchObject({ measurementOnly: true, selected: 1, results: [{ runId: body.runId, executedSteps: 10, terminal: false }] });
    expect(await row(body.runId)).toMatchObject({ status: "queued", progress_current: 10, current_stage: "deming-live-source-draw" });
    expect((await db`SELECT agent_run_id FROM fixture_snapshots`)[0].agent_run_id).toBe(body.runId);
    expect(state.effects.indexOf("scoreboard-snapshot")).toBeGreaterThan(state.effects.indexOf("deming-source-health"));
    const secondTick = await (await tick(request("agents/tick"))).json();
    expect(secondTick.selected).toBe(0);
    expect((await steps(body.runId)).slice(-4).map(s => s.status)).toEqual(["queued", "queued", "queued", "queued"]);
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.provider).not.toHaveBeenCalled();
    state.pipeline = true;
    const resumed = await (await tick(request("agents/tick"))).json();
    expect(resumed.results).toMatchObject([{ runId: body.runId, terminal: true, executedSteps: 4 }]);
    expect(await row(body.runId)).toMatchObject({ status: "completed", progress_current: 14, progress_total: 14 });
    expect((await db`SELECT count(*)::int AS n FROM agent_run_events WHERE agent_run_id=${body.runId} AND event_type='step.finished'`)[0].n).toBe(14);
    expect((await db`SELECT count(*)::int AS n FROM agent_run_events WHERE agent_run_id=${body.runId} AND event_type='run.completed'`)[0].n).toBe(1);
  });

  it.each([[false, true], [true, false], [true, true]])("preserves the pipeline=%s marketing=%s measurement and tail controls", async (pipeline, marketing) => {
    const body = await (await queueScoreboard(request("crew/scoreboard"))).json();
    state.pipeline = pipeline; state.marketing = marketing;
    const first = await (await tick(request("agents/tick"))).json();
    expect(first.results).toMatchObject([{ runId: body.runId, executedSteps: 10 }]);
    expect((await db`SELECT count(*)::int AS n FROM fixture_snapshots`)[0].n).toBe(1);
    const tail = await (await tick(request("agents/tick"))).json();
    expect(await row(body.runId)).toMatchObject({ status: pipeline ? "completed" : "queued", progress_current: pipeline ? 14 : 10 });
    expect(tail.selected).toBe(pipeline ? 1 : 0);
    expect(state.provider).not.toHaveBeenCalled();
  });

  it("leaves every other queued exempt/marketing/data/agent/kind run unchanged in the both-paused route", async () => {
    const controls = [
      { ...template("fixture.alert"), steps: [{ key: "fee-alert-dispatch", agent: "atlas" as const, title: "Do not dispatch" }] },
      { ...template("fixture.digest"), steps: [{ key: "pro-digest", agent: "atlas" as const, title: "Do not send" }] },
      { ...template("fixture.marketing"), agent: "growth" as const, steps: [{ key: "content-market-spread", agent: "growth" as const, title: "Do not write" }] },
      { ...template("fixture.provider"), steps: [{ key: "extract-paid", agent: "knox" as const, title: "Do not call" },
        { key: "discover", agent: "magellan" as const, title: "Do not discover" }] },
      { ...template("fixture.data"), steps: [{ key: "discover", agent: "magellan" as const, title: "Do not discover" }] },
      { ...template(), agent: "growth" as const },
      { ...template(), kind: "manual_repair" as const },
    ];
    const ids: number[] = [];
    for (let i=0; i<controls.length; i++) ids.push((await startAgentRun({ ...controls[i], idempotencyKey: `negative-${i}` })).run.id);
    const baseline = await db`SELECT to_jsonb(r) AS state FROM agent_runs r ORDER BY id`;
    await queueScoreboard(request("crew/scoreboard"));
    state.pipeline = state.marketing = false;
    const result = await (await tick(request("agents/tick"))).json();
    expect(result.results).toHaveLength(1);
    expect(await db`SELECT to_jsonb(r) AS state FROM agent_runs r WHERE id=ANY(${ids}::int[]) ORDER BY id`).toEqual(baseline);
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it("keeps the narrow continuation exempt-only when controls change after the tick's read", async () => {
    const run = await startAgentRun({ ...template(), steps: [
      { key: "deming-playbook-check", agent: "atlas", title: "Measurement" },
      { key: "atlas-city-repair", agent: "atlas", title: "Tail" },
    ] });
    state.pipeline = state.marketing = false;
    state.unpauseAfterTickRead = true;
    const out = await (await tick(request("agents/tick"))).json();
    expect(state.pipeline).toBe(true);
    expect(out).toMatchObject({ measurementOnly: true, results: [{ runId: run.run.id, executedSteps: 1, terminal: false }] });
    expect(state.effects).toEqual(["deming-playbook-check"]);
    expect(await row(run.run.id)).toMatchObject({ status: "queued", current_stage: "atlas-city-repair" });
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.provider).not.toHaveBeenCalled();
    // A subsequent normal tick honors the now-unpaused pipeline and finishes the tail.
    expect((await (await tick(request("agents/tick"))).json()).results).toMatchObject([{ runId: run.run.id, executedSteps: 1, terminal: true }]);
    expect(state.effects).toContain("atlas-city-repair");
  });

  it("checks the actual locked claim when another executor advances beyond the peeked measurement", async () => {
    const run = await startAgentRun({ ...template(), steps: [
      { key: "deming-playbook-check", agent: "atlas", title: "Measurement" },
      { key: "atlas-city-repair", agent: "atlas", title: "Tail" },
    ] });
    let atClaim!: () => void, continueClaim!: () => void;
    const reached = new Promise<void>(resolve => { atClaim = resolve; });
    const resume = new Promise<void>(resolve => { continueClaim = resolve; });
    state.beforeTransaction = async () => { atClaim(); await resume; };
    const first = executeAgentRun(run.run.id, { maxSteps: 1, pauseExemptOnly: true });
    await reached;
    try {
      const other = await executeAgentRun(run.run.id, { maxSteps: 1, pauseExemptOnly: true });
      expect(other).toMatchObject({ executedSteps: 1, terminal: false });
      expect(await row(run.run.id)).toMatchObject({ current_stage: "atlas-city-repair" });
    } finally { continueClaim(); }
    expect(await first).toMatchObject({ executedSteps: 0, terminal: false, status: "queued" });
    expect(state.effects).toEqual(["deming-playbook-check"]);
    expect((await steps(run.run.id))[1]).toMatchObject({ step_key: "atlas-city-repair", status: "queued" });
    expect((await db`SELECT count(*)::int AS n FROM agent_run_events WHERE event_type='step.started'`)[0].n).toBe(1);
  });

  it("enforces150s score-step fit even with the first-run override, then advances with enough budget", async () => {
    const run = await startAgentRun(template());
    expect(await executeAgentRun(run.run.id, { maxSteps: 1, alwaysRunFirstStep: true, deadlineAt: Date.now() + 149_000 }))
      .toMatchObject({ executedSteps: 0, heldForDeadline: true, terminal: false });
    expect(state.effects).toEqual([]);
    expect(await row(run.run.id)).toMatchObject({ status: "queued", progress_current: 0 });
    expect((await db`SELECT detail FROM agent_run_events WHERE event_type='step.deferred'`)[0].detail).toMatchObject({ step_key: "score-answer-key", expected_ms: 150_000 });
    expect(await executeAgentRun(run.run.id, { maxSteps: 1, alwaysRunFirstStep: true, deadlineAt: Date.now() + 151_000 }))
      .toMatchObject({ executedSteps: 1, terminal: true });
    expect(state.effects).toContain("score-answer-key");
  });

  it("keeps the unrelated first-step progress override", async () => {
    const run = await startAgentRun(template("fixture.other"));
    expect(await executeAgentRun(run.run.id, { maxSteps: 1, alwaysRunFirstStep: true, deadlineAt: Date.now() - 1 }))
      .toMatchObject({ executedSteps: 1, terminal: true });
  });

  it("leaves the first selected scoreboard queued when a tick has insufficient time", async () => {
    const run = await startAgentRun(template());
    const out = await executeQueuedAgentRuns({ scope, allowProviderSteps: false, deadlineAt: Date.now() + 149_000 });
    expect(out).toMatchObject({ selected: 1, results: [{ runId: run.run.id, executedSteps: 0, heldForDeadline: true, terminal: false }] });
    expect(state.effects).toEqual([]);
    const next = await executeQueuedAgentRuns({ scope, allowProviderSteps: false, deadlineAt: Date.now() + 151_000 });
    expect(next.results).toMatchObject([{ runId: run.run.id, executedSteps: 1, terminal: true }]);
  });

  it("scopes stale-step and orphan recovery to the scoreboard without advancing its paused tail", async () => {
    const score = await startAgentRun({ ...template(), steps: [{ key: "atlas-city-repair", agent: "atlas", title: "Paused tail" }] });
    const other = await startAgentRun(template("fixture.other", "other"));
    const orphan = await startAgentRun(template("fixture.other-orphan", "orphan"));
    const scoreOrphan = await startAgentRun({ ...template("atlas.scoreboard", "score-orphan"), steps: [{ key: "atlas-storage-retention", agent: "atlas", title: "Paused storage" }] });
    await db`UPDATE agent_runs SET status='running', updated_at=now()-interval '1 hour'`;
    await db`UPDATE agent_run_steps SET status='running', updated_at=now()-interval '1 hour' WHERE agent_run_id=ANY(${[score.run.id,other.run.id]}::int[])`;
    const baseline = await db`SELECT to_jsonb(r) AS state FROM agent_runs r WHERE id=ANY(${[other.run.id,orphan.run.id]}::int[]) ORDER BY id`;
    state.pipeline = state.marketing = false;
    const result = await (await tick(request("agents/tick"))).json();
    expect(result.reaped.requeued.map((r: { runId: number }) => r.runId)).toEqual([score.run.id]);
    expect(result.reaped.orphanRunsRequeued).toEqual([scoreOrphan.run.id]);
    expect(result.selected).toBe(0);
    expect(await row(score.run.id)).toMatchObject({ status: "queued", progress_current: 0 });
    expect(await db`SELECT to_jsonb(r) AS state FROM agent_runs r WHERE id=ANY(${[other.run.id,orphan.run.id]}::int[]) ORDER BY id`).toEqual(baseline);
    expect(state.effects).toEqual([]);
    // The ordinary recovery path remains global when no scope is supplied.
    const recovered = await reapStaleAgentSteps();
    expect(recovered.requeued.map(r => r.runId)).toContain(other.run.id);
    expect(recovered.orphanRunsRequeued).toContain(orphan.run.id);
  });

  it("keeps backend-disabled ticks a hard no-op even with both controls paused", async () => {
    const run = await startAgentRun(template());
    state.pipeline = state.marketing = false;
    state.backend = false;
    const before = await db`SELECT to_jsonb(r) AS state FROM agent_runs r`;
    const result = await (await tick(request("agents/tick"))).json();
    expect(result).toMatchObject({ paused: true, selected: 0, results: [] });
    expect(await db`SELECT to_jsonb(r) AS state FROM agent_runs r`).toEqual(before);
    expect(await row(run.run.id)).toMatchObject({ status: "queued", progress_current: 0 });
    expect(state.effects).toEqual([]);
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.provider).not.toHaveBeenCalled();
  });
  it.each(["deming-live-source-audit","magellan-live-audit-capture"])("requires the actual %s step to fit 150 seconds even with first-run override",async(key)=>{
    const capture=key==="magellan-live-audit-capture";
    const run=await startAgentRun({agent:capture?"magellan":"atlas",kind:"workflow",title:"Synthetic live diagnostic deadline",triggeredBy:"fixture",
      params:{source:"deming.live_source_audit",drawId:999,requestId:999},steps:[{key,agent:capture?"magellan":"atlas",title:"Bounded diagnostic work"}]});
    const held=await executeAgentRun(run.run.id,{maxSteps:1,alwaysRunFirstStep:true,deadlineAt:Date.now()+149000,allowProviderSteps:false});
    expect(held).toMatchObject({heldForDeadline:true,executedSteps:0});
    expect((await steps(run.run.id))[0].status).toBe("queued");
    const allowed=await executeAgentRun(run.run.id,{maxSteps:1,alwaysRunFirstStep:true,deadlineAt:Date.now()+180000,allowProviderSteps:false});
    expect(allowed).toMatchObject({terminal:true,executedSteps:1});
    expect((await steps(run.run.id))[0].status).toBe("completed");expect(state.provider).not.toHaveBeenCalled();
  });

});
