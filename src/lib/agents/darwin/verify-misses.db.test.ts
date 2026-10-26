/**
 * Darwin's reader of the findings filed against verify (#2057), in real PostgreSQL, loopback only,
 * against the production schema: a seeded verify-stage hold and correction reach Darwin's step and
 * its ledger event; the takedown sync's copy, another stage and an undone hold do not count as
 * standing misses, and an undo of another act on a related fee withdraws nothing.
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

  const eventCount = async () => {
    const [{ count }] = await raw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${VERIFY_MISS_EVENT}`;
    return count;
  };

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Verify-miss DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    // The hourly clock is global: clear earlier events of this check so this run starts it.
    await raw`DELETE FROM agent_run_events WHERE event_type = ${VERIFY_MISS_EVENT}`;
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

  it("reads a person's verify-stage hold and correction into lessons and a per-check tally, hourly", async () => {
    await row({
      kind: "admin_correction", stage: "verify", check: "admin.fee_correction", by: "human", fee: 1,
      evidence: { cause: "verify_missed", actor: "James", reason: "Overdraft line", new_fee_published_id: 11, before: { canonicalFeeKey: "nsf", feeName: "Insufficient Item Fee", amount: 35 }, after: { canonicalFeeKey: "overdraft", feeName: "Overdraft Item Fee", amount: 35 } },
      minutesAgo: 120,
    });
    // The corrected fee (11) is later held and released for another reason: the correction stands.
    await row({ kind: "admin_hold", stage: "publish", check: "admin.fee_hold", by: "human", fee: 11, minutesAgo: 90 });
    await row({ kind: "admin_release", stage: "publish", check: "admin.fee_hold", by: "human", fee: 11, minutesAgo: 80 });
    // A correction later reversed (the reversal names the fee the correction created): withdrawn.
    await row({ kind: "admin_correction", stage: "verify", check: "admin.fee_correction", by: "human", fee: 12, evidence: { new_fee_published_id: 13, before: { amount: 35 }, after: { amount: 30 } }, minutesAgo: 90 });
    await row({ kind: "admin_correction_reversed", stage: "publish", check: "admin.fee_correction", by: "human", fee: 13, minutesAgo: 30 });
    await row({ kind: "admin_hold", stage: "verify", check: "admin.fee_hold", by: "human", fee: 2, evidence: { cause: "verify_missed", reason: "A limit, not a fee", fee_name: "Courtesy Pay Limit" } });
    // A hold released afterwards: withdrawn.
    await row({ kind: "admin_hold", stage: "verify", check: "admin.fee_hold", by: "human", fee: 4, minutesAgo: 90 });
    await row({ kind: "admin_release", stage: "publish", check: "admin.fee_hold", by: "human", fee: 4, minutesAgo: 30 });
    // Not Darwin's: the takedown sync's copy, a hand row at another stage.
    await row({ kind: "admin_correction", stage: "verify", check: "hamilton.admin_correction", by: "gutenberg", fee: 5, dedupe: "hamilton.takedown:pub:20570005:verify" });
    await row({ kind: "admin_correction", stage: "extract", check: "admin.fee_correction", by: "human", fee: 6 });

    // A read scoped to the institution writes no event and starts no clock.
    const scoped = await readVerifyMisses(raw as unknown as Db, { runId, institutionId: INST });
    expect(scoped.error).toBeUndefined();
    expect(scoped).toMatchObject({ read: 4, standing: 2, withdrawn: 2, scoped: true, byKind: { admin_correction: 2, admin_hold: 2 } });
    expect(scoped.missedByCheck).toEqual({ category_guard: 1, no_check: 1 });
    expect(scoped.lessons.map((lesson) => lesson.feePublishedId).sort()).toEqual([1, 2]);
    expect(await eventCount()).toBe(0);

    // A dry run reads and writes nothing.
    expect((await readVerifyMisses(raw as unknown as Db, { runId, dryRun: true })).skipped).toBe(false);
    expect(await eventCount()).toBe(0);

    // A full read writes one event; another within the hour skips; one after it reads again.
    const full = await readVerifyMisses(raw as unknown as Db, { runId });
    expect(full.skipped).toBe(false);
    expect(full.standing).toBeGreaterThanOrEqual(2);
    const events = await raw<{ message: string; detail: string }[]>`SELECT message, detail::text AS detail FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${VERIFY_MISS_EVENT}`;
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain("Read the newest 500 finding(s) filed against verify");
    expect(JSON.parse(events[0].detail)).toMatchObject({ changes_fees: false, newest_limit: 500, scoped: false });
    expect((await readVerifyMisses(raw as unknown as Db, { runId })).skipped).toBe(true);
    expect(await eventCount()).toBe(1);
    const later = await readVerifyMisses(raw as unknown as Db, { runId, now: new Date(Date.now() + 61 * 60_000) });
    expect(later.skipped).toBe(false);
    expect(await eventCount()).toBe(2);
  });
});
