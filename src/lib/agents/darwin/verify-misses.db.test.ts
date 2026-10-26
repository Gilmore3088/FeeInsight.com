/**
 * Darwin's reader of the findings filed against verify (#2057), in real PostgreSQL, loopback only,
 * against the production schema: a seeded verify-stage hold, correction and Deming miss reach
 * Darwin's step and its ledger event; the takedown sync's copy, other stages and a released hold
 * do not count as standing misses.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { readVerifyMisses, VERIFY_MISS_EVENT } from "./verify-misses";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20570001;
type Db = Parameters<typeof readVerifyMisses>[0];

describe.skipIf(!connection)("Darwin reads verify-stage findings in isolated PostgreSQL (#2057)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let runId = 0;
  let n = 0;

  async function row(input: { kind: string; stage: string; check: string; by: string; fee: number; evidence?: Record<string, unknown>; minutesAgo?: number; dedupe?: string }) {
    n += 1;
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, fee_published_id, canonical_fee_key, amount, weight, evidence, dedupe_key, created_at)
              VALUES (${input.stage}, ${input.kind.endsWith("release") || input.kind.endsWith("reversed") ? "restored" : "wrong"}, ${input.kind}, ${input.by}, ${input.check}, ${INST}, ${input.fee},
                      'nsf', 35, 1, ${JSON.stringify(input.evidence ?? {})}::jsonb, ${input.dedupe ?? `test2057:${n}`},
                      NOW() - make_interval(mins => ${input.minutesAgo ?? 60}::int))`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Verify-miss DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    const [run] = await raw<{ id: number }[]>`INSERT INTO agent_runs (agent_name, run_kind, title, status) VALUES ('darwin', 'state_agent', 'Verify misses fixture', 'running') RETURNING id`;
    runId = Number(run.id);
  });

  afterAll(async () => {
    if (raw) {
      await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
      if (runId) await raw`DELETE FROM agent_runs WHERE id = ${runId}`;
      await raw.end();
    }
  });

  it("reads a person's verify-stage hold and correction and Deming's verify miss into lessons and a per-check tally", async () => {
    await row({
      kind: "admin_correction", stage: "verify", check: "admin.fee_correction", by: "human", fee: 1,
      evidence: { cause: "verify_missed", actor: "James", reason: "Overdraft line", before: { canonicalFeeKey: "nsf", feeName: "Insufficient Item Fee", amount: 35 }, after: { canonicalFeeKey: "overdraft", feeName: "Overdraft Item Fee", amount: 35 } },
    });
    await row({ kind: "admin_hold", stage: "verify", check: "admin.fee_hold", by: "human", fee: 2, evidence: { cause: "verify_missed", reason: "A limit, not a fee", fee_name: "Courtesy Pay Limit" } });
    await row({ kind: "audit_miss", stage: "verify", check: "hamilton.source_check", by: "deming", fee: 3, evidence: { reason: "amount_not_on_line", fee_name: "Stop Payment" } });
    // A hold released afterwards: withdrawn.
    await row({ kind: "admin_hold", stage: "verify", check: "admin.fee_hold", by: "human", fee: 4, minutesAgo: 90 });
    await row({ kind: "admin_release", stage: "publish", check: "admin.fee_hold", by: "human", fee: 4, minutesAgo: 30 });
    // Not Darwin's: the takedown sync's copy, a hand row at another stage.
    await row({ kind: "admin_correction", stage: "verify", check: "hamilton.admin_correction", by: "gutenberg", fee: 5, dedupe: "hamilton.takedown:pub:20570005:verify" });
    await row({ kind: "admin_correction", stage: "extract", check: "admin.fee_correction", by: "human", fee: 6 });

    const result = await readVerifyMisses(raw as unknown as Db, { runId, institutionId: INST });
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ read: 4, standing: 3, withdrawn: 1, byKind: { admin_correction: 1, admin_hold: 2, audit_miss: 1 } });
    expect(result.missedByCheck).toEqual({ category_guard: 1, no_check: 1, source_check: 1 });
    expect(result.lessons.map((lesson) => lesson.feePublishedId).sort()).toEqual([1, 2, 3]);

    const events = await raw<{ message: string; detail: string }[]>`SELECT message, detail::text AS detail FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${VERIFY_MISS_EVENT}`;
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain("3 standing, 1 withdrawn; no fee changed");
    expect(JSON.parse(events[0].detail)).toMatchObject({ changes_fees: false, missed_by_check: { category_guard: 1, no_check: 1, source_check: 1 } });

    // A dry run reads the same and writes no event.
    const dry = await readVerifyMisses(raw as unknown as Db, { runId, institutionId: INST, dryRun: true });
    expect(dry.standing).toBe(3);
    const [{ count }] = await raw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${VERIFY_MISS_EVENT}`;
    expect(count).toBe(1);
  });
});
