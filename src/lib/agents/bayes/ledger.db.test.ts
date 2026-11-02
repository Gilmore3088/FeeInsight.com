// @vitest-environment node
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runBayesLedger } from "./ledger";
import type { ReplayManifest } from "./manifests";
import { getAgentQuality, replayTotals } from "@/lib/data-store/agent-quality";

const url = process.env.E2E_DATABASE_URL;

/** Superseded replay rows (2026-11-02): an older version's open or stuck row is closed, once. */
describe.skipIf(!url)("Bayes ledger closes superseded rows", () => {
  let db: postgres.Sql;
  const manifest = (key: string, version: number, queued: number): ReplayManifest => ({
    key, version, owner: "knox", stage: "extract", strategy: "rules", unit: "text", affects: "current copies",
    count: async () => ({ affected: queued + 1, done: 1, queued, exclusions: {} }),
  });

  beforeAll(async () => {
    if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Loopback PostgreSQL only");
    db = postgres(url, { max: 1, onnotice: () => {} });
    // The ledger checks for public.replay_jobs, so the tables go in public of the throwaway e2e
    // database (the migration is IF NOT EXISTS). Only this test reads or writes them.
    const migration = readFileSync("supabase/migrations/20270110000038_bayes_replay_ledger.sql", "utf8");
    await db.begin((tx) => tx.unsafe(migration));
  });
  afterAll(async () => { if (db) { await db.unsafe("TRUNCATE public.replay_job_checks, public.replay_jobs RESTART IDENTITY CASCADE"); await db.end(); } });
  beforeEach(async () => {
    await db.unsafe("TRUNCATE public.replay_job_checks, public.replay_jobs RESTART IDENTITY CASCADE");
  });

  async function seed(changeKey: string, manifestKey: string, status: string, queued: number, minutesAgo: number) {
    await db`
      INSERT INTO replay_jobs (change_key, manifest_key, owner_agent, unit, affects, status, affected, queued, last_checked_at)
      VALUES (${changeKey}, ${manifestKey}, 'knox', 'text', 'current copies', ${status}, ${queued}, ${queued}, NOW() - make_interval(mins => ${minutesAgo}))
    `;
  }

  it("closes older open and stuck rows with a note and a check, leaves the rest, and is idempotent", async () => {
    await seed("knox.rules@147", "knox.rules", "open", 8340, 60);
    await seed("knox.rules@145", "knox.rules", "stuck", 8100, 120);
    await seed("knox.rules@100", "knox.rules", "closed", 0, 600);
    await seed("darwin.peer_range@3", "darwin.peer_range", "not_counted", 0, 600);
    await seed("retired.manifest@1", "retired.manifest", "open", 7, 600);
    const manifests = [manifest("knox.rules", 163, 25)];

    const dry = await runBayesLedger({ runId: 41, dryRun: true, db: db as never, manifests });
    expect(dry.superseded.map((job) => job.changeKey)).toEqual(["knox.rules@147", "knox.rules@145"]);
    const [{ count: untouched }] = await db<Array<{ count: string }>>`SELECT COUNT(*) FROM replay_jobs WHERE status IN ('open', 'stuck')`;
    expect(Number(untouched)).toBe(3);

    const first = await runBayesLedger({ runId: 42, db: db as never, manifests });
    expect(first.superseded).toEqual([
      { changeKey: "knox.rules@147", manifestKey: "knox.rules", supersededBy: "knox.rules@163", previousStatus: "open", lastQueued: 8340 },
      { changeKey: "knox.rules@145", manifestKey: "knox.rules", supersededBy: "knox.rules@163", previousStatus: "stuck", lastQueued: 8100 },
    ]);
    const rows = await db<Array<{ change_key: string; status: string; note: string | null; queued: number; closed: boolean; last_run_id: string | null }>>`
      SELECT change_key, status, note, queued, closed_at IS NOT NULL AS closed, last_run_id FROM replay_jobs ORDER BY change_key
    `;
    expect(rows.map((row) => [row.change_key, row.status, row.note, row.queued, row.closed])).toEqual([
      ["darwin.peer_range@3", "not_counted", null, 0, false],
      ["knox.rules@100", "closed", null, 0, false],
      ["knox.rules@145", "closed", "superseded by knox.rules@163", 8100, true],
      ["knox.rules@147", "closed", "superseded by knox.rules@163", 8340, true],
      ["knox.rules@163", "open", null, 25, false],
      ["retired.manifest@1", "open", null, 7, false],
    ]);
    const checks = await db<Array<{ change_key: string; status: string; note: string | null; agent_run_id: string }>>`
      SELECT j.change_key, c.status, c.note, c.agent_run_id FROM replay_job_checks c JOIN replay_jobs j ON j.id = c.job_id ORDER BY c.id
    `;
    expect(checks.map((check) => [check.change_key, check.status, check.note, Number(check.agent_run_id)])).toEqual([
      ["knox.rules@163", "open", null, 42],
      ["knox.rules@147", "closed", "superseded by knox.rules@163", 42],
      ["knox.rules@145", "closed", "superseded by knox.rules@163", 42],
    ]);

    const second = await runBayesLedger({ runId: 43, db: db as never, manifests });
    expect(second.superseded).toEqual([]);
    const [{ count: closeChecks }] = await db<Array<{ count: string }>>`SELECT COUNT(*) FROM replay_job_checks WHERE note LIKE 'superseded by %'`;
    expect(Number(closeChecks)).toBe(2);
  });

  it("the Quality read counts only current rows in the queue", async () => {
    await seed("knox.rules@147", "knox.rules", "open", 8340, 60);
    await seed("hamilton.current_copy@5", "hamilton.current_copy", "open", 204, 600);
    await seed("hamilton.current_copy@6", "hamilton.current_copy", "open", 1230, 5);
    // Before any v2 run: the newer row of the same manifest marks the older one superseded.
    const before = await getAgentQuality(db as never);
    expect(replayTotals(before.replayJobs ?? [])).toEqual({ open: 2, stuck: 0, queued: 8340 + 1230, superseded: 1 });

    await runBayesLedger({ runId: 50, db: db as never, manifests: [manifest("knox.rules", 163, 25)] });
    const after = await getAgentQuality(db as never);
    expect(replayTotals(after.replayJobs ?? [])).toEqual({ open: 2, stuck: 0, queued: 25 + 1230, superseded: 2 });
    expect(after.replayJobs?.filter((job) => job.superseded).map((job) => job.changeKey).sort()).toEqual(["hamilton.current_copy@5", "knox.rules@147"]);
  });
});
