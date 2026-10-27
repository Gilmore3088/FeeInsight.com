/**
 * #1070: the `publish-sweeps` step runs each sweep in its own savepoint. Against real PostgreSQL
 * (postgres.js), a sweep whose SQL fails is rolled back alone, the sweeps after it still write,
 * the step's transaction still commits, and the failure is a ledger event. Loopback only.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Scope = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

const { sweeps } = vi.hoisted(() => ({
  sweeps: {
    importedTwins: vi.fn(),
    sourceLinkFill: vi.fn(),
    linkDrift: vi.fn(),
    feedbackSync: vi.fn(),
    holdFeedback: vi.fn(),
  },
}));

vi.mock("@/lib/data-store/connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/connection")>()),
  sql: vi.fn(),
}));
vi.mock("@/lib/agents/hamilton/source-check", () => ({ linkImportedFeesToTwins: sweeps.importedTwins }));
vi.mock("@/lib/agents/hamilton/source-link", () => ({ fillSourceLinks: sweeps.sourceLinkFill, repairLinkDrift: sweeps.linkDrift }));
vi.mock("@/lib/agents/learning/feedback-sync", () => ({ syncPipelineFeedback: sweeps.feedbackSync }));
vi.mock("@/lib/agents/learning/account-type-hold-feedback", () => ({ repairAccountTypeHoldFeedback: sweeps.holdFeedback }));

import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { recordSweepFailures, sweepsAfterRows, type MovedSweepContext, type SweepFailure } from "./publish-sweeps";

const connection = process.env.E2E_DATABASE_URL;

describe.skipIf(!connection)("publish-sweeps savepoint per sweep in PostgreSQL (#1070)", () => {
  let db: postgres.Sql<{ json: unknown }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Publish-sweeps isolation tests require a loopback E2E database; production connections are forbidden");
    }
    // The app's own JSON handling, so `${JSON.stringify(x)}::jsonb` stores an object as in production.
    db = postgres(connection, { max: 1, types: { json: JSON_TEXT_PASSTHROUGH } });
    await db`CREATE TEMP TABLE sweep_writes (sweep text NOT NULL)`;
    await db`CREATE TEMP TABLE agent_run_events (agent_run_id bigint, step_id bigint, event_type text, status text, message text, detail jsonb)`;
  });
  afterAll(async () => {
    if (db) await db.end();
  });
  beforeEach(async () => {
    await db`TRUNCATE sweep_writes, agent_run_events`;
    sweeps.importedTwins.mockImplementation(async (scope: Scope) => {
      await scope`INSERT INTO sweep_writes VALUES ('importedTwins')`;
      return { checked: 1, linked: 1, untraced: 0 };
    });
    // Writes a row, then fails: its savepoint must take the row back with it.
    sweeps.sourceLinkFill.mockImplementation(async (scope: Scope) => {
      await scope`INSERT INTO sweep_writes VALUES ('sourceLinkFill')`;
      await scope`SELECT 1 / 0`;
      return { on: true, dryRun: false, scanned: 0, fills: [], untraceable: 0, error: null };
    });
    sweeps.linkDrift.mockImplementation(async (scope: Scope) => {
      await scope`INSERT INTO sweep_writes VALUES ('linkDrift')`;
      return { live: true, dryRun: false, scanned: 0, repoints: [], flagged: 0, waiting: 0, archived: [], failing: [], skipped: [], error: null };
    });
    sweeps.feedbackSync.mockResolvedValue({ ready: true, takedowns: 0, restores: 0, categoryRejects: 0, answerKeyFees: 0, written: 0, relabeled: 0 });
    sweeps.holdFeedback.mockResolvedValue({ on: false, dryRun: false, due: null, zeroed: 0, release: { on: false, due: null, relabeled: 0 }, error: null });
  });

  it("rolls back only the failed sweep, keeps the others' writes, commits, and records the failure", async () => {
    const failures: SweepFailure[] = [];
    await db.begin(async (tx) => {
      const ctx: MovedSweepContext = {
        db: tx as unknown as MovedSweepContext["db"],
        runId: 1070,
        stepId: 10700,
        dryRun: false,
        institutionId: undefined,
        researchSplitFullCount: false,
        categoryGuardLimit: 100,
        sweepMs: {},
        mode: "sweeps",
        isolate: true,
        failures,
      };
      await sweepsAfterRows(ctx);
      // The transaction is still usable after the failed sweep.
      await recordSweepFailures(ctx.db, { runId: 1070, stepId: 10700, dryRun: false, failures });
    });
    expect(failures).toEqual([{ sweep: "sourceLinkFill", outcome: "failed", error: expect.stringContaining("division by zero"), after: null }]);
    expect((await db`SELECT sweep FROM sweep_writes ORDER BY sweep`).map((row) => row.sweep)).toEqual(["importedTwins", "linkDrift"]);
    const events = await db`SELECT agent_run_id, step_id, event_type, status, detail FROM agent_run_events`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agent_run_id: "1070", step_id: "10700", event_type: "publish_sweeps.sweep_failed", status: "failed" });
    expect(events[0].detail).toMatchObject({ sweep: "sourceLinkFill", dry_run: false });
  });

  it("without isolation (a publish step) the same failure aborts the transaction, as before", async () => {
    await expect(db.begin(async (tx) => {
      await sweepsAfterRows({
        db: tx as unknown as MovedSweepContext["db"],
        runId: 1070,
        stepId: 10700,
        dryRun: false,
        institutionId: undefined,
        researchSplitFullCount: false,
        categoryGuardLimit: 100,
        sweepMs: {},
        mode: "full",
      });
    })).rejects.toThrow(/division by zero/);
    expect(await db`SELECT sweep FROM sweep_writes`).toHaveLength(0);
  });
});
