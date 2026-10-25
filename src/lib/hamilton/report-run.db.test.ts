/**
 * Real PostgreSQL checks of durable report runs (#1921, V5 O1) against the production schema
 * (tests/e2e/production-schema.sql) on a loopback-only database: the active-key unique index,
 * the lease, section checkpoints, carry-over after a failure and the already-saved replay.
 * Synthetic user 900101 only; its rows are removed before and after.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import {
  completeReportRun,
  failReportRun,
  failReportSection,
  openReportRun,
  REPORT_RUN_LEASE_MS,
  REPORT_SAVE_STEP,
  ReportRunLeaseLostError,
  reportSectionStepKey,
  reportTaskKey,
  saveReportSection,
  startReportSection,
  type ReportRunHandle,
} from "./report-run";

const connection = process.env.E2E_DATABASE_URL;
const USER = 900101;
const SECTIONS = ["Answer", "Strategic rationale", "Recommendation"];

describe.skipIf(!connection)("durable report runs in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  type Db = NonNullable<Parameters<typeof saveReportSection>[3]>;
  const asDb = () => db as unknown as Db;
  const cleanup = async () => {
    const runs = await db`SELECT id FROM agent_runs WHERE triggered_by = ${`user:${USER}`}`;
    const ids = runs.map((row) => Number(row.id));
    if (ids.length) {
      await db`DELETE FROM agent_run_events WHERE agent_run_id = ANY(${ids})`;
      await db`DELETE FROM agent_run_steps WHERE agent_run_id = ANY(${ids})`;
      await db`DELETE FROM agent_runs WHERE id = ANY(${ids})`;
    }
    await db`DELETE FROM hamilton_reports WHERE user_id = ${String(USER)}`;
  };
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Report run tests require a loopback E2E database; production connections are forbidden");
    }
    // The production client's types, so json parameters are written exactly as in production.
    db = postgres(connection, {
      max: 1, ssl: "require",
      types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL },
    }) as unknown as ReturnType<typeof postgres>;
  });
  beforeEach(cleanup);
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.end();
    }
  });

  const open = (taskKey: string, now = new Date()) =>
    openReportRun({ userId: USER, institutionId: 101, title: "Hamilton report: Synthetic CU", taskKey, sectionTitles: SECTIONS, now, db: asDb() });
  const later = () => new Date(Date.now() + REPORT_RUN_LEASE_MS + 60_000);
  const checkpoint = (narrative: string) => ({
    inputHash: `hash-${narrative}`,
    output: { status: "ok", section: { narrative, wordCount: 2, model: "m", usage: { inputTokens: 1, outputTokens: 1 } } },
    providerResponses: [{ usage: { inputTokens: 1, outputTokens: 1 }, model: "m" }],
  });

  it("opens one running run with a step per section and a save step", async () => {
    const key = reportTaskKey(USER, { templateType: "peer_benchmark", institutionId: 101 });
    const opened = await open(key);
    expect(opened.kind).toBe("opened");
    const run = (opened as { run: ReportRunHandle }).run;
    const [row] = await db`SELECT status, run_kind, current_stage, idempotency_key, params_json FROM agent_runs WHERE id = ${run.runId}`;
    expect(row).toMatchObject({ status: "running", run_kind: "pro_request", current_stage: "pro.report", idempotency_key: key });
    expect(row.params_json.report_id).toBe(run.reportId);
    const steps = await db`SELECT step_key, status FROM agent_run_steps WHERE agent_run_id = ${run.runId} ORDER BY sequence`;
    expect(steps.map((step) => step.step_key)).toEqual([...SECTIONS.map((_, i) => reportSectionStepKey(i)), REPORT_SAVE_STEP]);
    expect(steps.every((step) => step.status === "queued")).toBe(true);
  });

  it("tells a second request the report is still being written while the lease is live", async () => {
    const key = reportTaskKey(USER, { n: 2 });
    const first = await open(key);
    expect(first.kind).toBe("opened");
    const second = await open(key);
    expect(second).toEqual({ kind: "busy", runId: (first as { run: ReportRunHandle }).run.runId });
    const active = await db`SELECT COUNT(*)::int AS n FROM agent_runs WHERE idempotency_key = ${key}`;
    expect(active[0].n).toBe(1);
  });

  it("resumes an interrupted run from its saved sections, and the cut-off request can no longer write", async () => {
    const key = reportTaskKey(USER, { n: 3 });
    const first = (await open(key)) as { kind: "opened"; run: ReportRunHandle };
    await startReportSection(first.run, reportSectionStepKey(0), asDb());
    await saveReportSection(first.run, reportSectionStepKey(0), checkpoint("answer"), asDb());
    await startReportSection(first.run, reportSectionStepKey(1), asDb());
    // The request is cut off here: section 2 is left running and nothing closes the run.

    const resumed = await open(key, later());
    expect(resumed.kind).toBe("resumed");
    const run = (resumed as { run: ReportRunHandle }).run;
    expect(run.runId).toBe(first.run.runId);
    expect(run.reportId).toBe(first.run.reportId);
    expect([...run.checkpoints.keys()]).toEqual([reportSectionStepKey(0)]);
    expect(run.checkpoints.get(reportSectionStepKey(0))?.inputHash).toBe("hash-answer");

    // The old request lost its lease: its next write throws and changes nothing.
    await expect(saveReportSection(first.run, reportSectionStepKey(1), checkpoint("stale"), asDb())).rejects.toBeInstanceOf(ReportRunLeaseLostError);
    const [step] = await db`SELECT status, output_payload FROM agent_run_steps WHERE agent_run_id = ${run.runId} AND step_key = ${reportSectionStepKey(1)}`;
    expect(step.output_payload).toBeNull();

    const events = await db`SELECT event_type FROM agent_run_events WHERE agent_run_id = ${run.runId} ORDER BY id`;
    expect(events.map((event) => event.event_type)).toEqual(["run.created", "section.saved", "run.resumed"]);
  });

  it("finds an already saved report on replay instead of saving it again", async () => {
    const key = reportTaskKey(USER, { n: 4 });
    const first = (await open(key)) as { kind: "opened"; run: ReportRunHandle };
    await db`
      INSERT INTO hamilton_reports (id, user_id, institution_id, report_type, report_json, status)
      VALUES (${first.run.reportId}::uuid, ${String(USER)}, '101', 'peer_benchmark', ${JSON.stringify({ title: "Synthetic" })}, 'generated')
    `;
    // Cut off between the save and closing the run.
    const replay = await open(key, later());
    expect(replay.kind).toBe("already_saved");
    expect((replay as { run: ReportRunHandle }).run.reportId).toBe(first.run.reportId);
  });

  it("ends a failed run with its fault, and a retry within the hour carries the finished sections over", async () => {
    const key = reportTaskKey(USER, { n: 5 });
    const first = (await open(key)) as { kind: "opened"; run: ReportRunHandle };
    await saveReportSection(first.run, reportSectionStepKey(0), checkpoint("answer"), asDb());
    await failReportSection(first.run, reportSectionStepKey(1), { kind: "timeout", retryable: true, readerMessage: "x", detail: "deadline" }, [{ attempt: 1, fault: "timeout" }, { attempt: 2, fault: "timeout" }], asDb());
    expect(await failReportRun(first.run, "A report section could not finish. Report not saved.", { fault: "timeout" }, asDb())).toBe(true);
    const [failed] = await db`SELECT status, error_summary FROM agent_runs WHERE id = ${first.run.runId}`;
    expect(failed).toMatchObject({ status: "failed", error_summary: "A report section could not finish. Report not saved." });
    const steps = await db`SELECT step_key, status FROM agent_run_steps WHERE agent_run_id = ${first.run.runId} ORDER BY sequence`;
    expect(steps.map((step) => step.status)).toEqual(["completed", "failed", "skipped", "skipped"]);

    const retry = await open(key);
    expect(retry.kind).toBe("opened");
    const run = (retry as { run: ReportRunHandle }).run;
    expect(run.runId).not.toBe(first.run.runId);
    expect(run.carriedFromRun).toBe(first.run.runId);
    expect(run.checkpoints.get(reportSectionStepKey(0))?.writtenInRun).toBe(first.run.runId);
    expect(run.checkpoints.has(reportSectionStepKey(1))).toBe(false);
  });

  it("closes a completed run and its save step", async () => {
    const key = reportTaskKey(USER, { n: 6 });
    const { run } = (await open(key)) as { kind: "opened"; run: ReportRunHandle };
    expect(await completeReportRun(run, "Report saved (x).", { report_id: run.reportId }, asDb())).toBe(true);
    const [row] = await db`SELECT status FROM agent_runs WHERE id = ${run.runId}`;
    expect(row.status).toBe("completed");
    const [save] = await db`SELECT status FROM agent_run_steps WHERE agent_run_id = ${run.runId} AND step_key = ${REPORT_SAVE_STEP}`;
    expect(save.status).toBe("completed");
    // The key is free again: the same request later opens a fresh run.
    expect((await open(key)).kind).toBe("opened");
  });

  it("closes a run nobody resumed for a day", async () => {
    const { run } = (await open(reportTaskKey(USER, { n: 7 }))) as { kind: "opened"; run: ReportRunHandle };
    await db`UPDATE agent_runs SET updated_at = NOW() - interval '25 hours' WHERE id = ${run.runId}`;
    await open(reportTaskKey(USER, { n: 8 }));
    const [row] = await db`SELECT status FROM agent_runs WHERE id = ${run.runId}`;
    expect(row.status).toBe("failed");
  });
});

describe("durable report runs without a ledger", () => {
  it("returns unavailable, never throws, when the ledger cannot be written", async () => {
    const broken = (() => Promise.reject(new Error("connection refused"))) as unknown as Parameters<typeof openReportRun>[0]["db"];
    const opened = await openReportRun({ userId: 1, institutionId: 1, title: "t", taskKey: "k", sectionTitles: ["A"], db: broken });
    expect(opened.kind).toBe("unavailable");
  });

  it("keys a request by the reader and every parameter, in any key order", () => {
    expect(reportTaskKey(1, { a: 1, b: 2 })).toBe(reportTaskKey(1, { b: 2, a: 1 }));
    expect(reportTaskKey(1, { a: 1 })).not.toBe(reportTaskKey(2, { a: 1 }));
    expect(reportTaskKey(1, { a: 1 })).not.toBe(reportTaskKey(1, { a: 2 }));
  });
});

// The app's own client must point at the same loopback database for the save itself.
describe.skipIf(!connection || process.env.DATABASE_URL !== connection)("idempotent report save in isolated PostgreSQL", () => {
  it("saves one row for a run-chosen id however often the run replays", async () => {
    const { saveHamiltonReport } = await import("./pro-tables");
    const db = postgres(connection!, { max: 1, ssl: "require" });
    const reportId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    try {
      await db`DELETE FROM hamilton_reports WHERE id = ${reportId}::uuid`;
      const input = { userId: USER, institutionId: "101", reportType: "peer_benchmark", reportJson: { title: "Synthetic" } as never, reportId };
      expect(await saveHamiltonReport(input)).toBe(reportId);
      expect(await saveHamiltonReport({ ...input, reportJson: { title: "Replay" } as never })).toBe(reportId);
      const rows = await db`SELECT report_json->>'title' AS title FROM hamilton_reports WHERE id = ${reportId}::uuid`;
      expect(rows.map((row) => row.title)).toEqual(["Synthetic"]);
    } finally {
      await db`DELETE FROM hamilton_reports WHERE id = ${reportId}::uuid`;
      await db.end();
    }
  });
});
