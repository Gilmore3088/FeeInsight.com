/**
 * The same-line restore and Darwin's re-check against real SQL (production schema, loopback only,
 * #1673). The older line of a same-line takedown came down because a newer line replaced it; the
 * copy stays down while that replacement, followed down the chain, is live, and a copy v1 already
 * brought back comes down on Darwin's second look only with its switch on.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { restoreSameLineDuplicates } from "./same-line-duplicates";
import { SAME_LINE_REPLACEMENT_ROWS_SQL, findSameLineReplacements, recheckSameLineReplacements, type SameLineReplacementRow } from "@/lib/agents/darwin/same-line-replacement-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1673001;
const EVENT = "00000000-0000-4000-8000-000001673000";
type Db = Parameters<typeof restoreSameLineDuplicates>[0];
type Tx = postgres.Sql<{ numeric: number; json: unknown; text: string }>;
class Rollback extends Error {}

describe.skipIf(!connection)("same-line restore follows the older line's replacement (#1673)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 1673100;
  let nextRun = -1673001;

  beforeAll(() => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Same-line restore DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });
  afterAll(async () => { if (raw) await raw.end(); });

  /** Each case runs in its own transaction, rolled back at the end. */
  async function inRollback(work: (tx: Tx, runId: number) => Promise<void>): Promise<void> {
    const runId = nextRun--;
    await raw.begin(async (transaction) => {
      const tx = transaction as unknown as Tx;
      await tx`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Same Line Test Bank', 'bank', 'fdic', 'NJ')`;
      await tx`INSERT INTO agent_runs (id, agent_name, run_kind, title, status) VALUES (${runId}, 'hamilton', 'state_agent', 'Same-line restore fixture', 'running')`;
      await work(tx, runId);
      throw new Rollback();
    }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
  }

  async function fee(tx: Tx, name: string, reason: string | null, options: { amount?: number; key?: string; frequency?: string | null } = {}): Promise<number> {
    const rawId = nextRaw++;
    const amount = options.amount ?? 25;
    const key = options.key ?? "wire_domestic_outgoing";
    const frequency = options.frequency === undefined ? "per_item" : options.frequency;
    await tx`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, agent_event_id, fee_name, amount, frequency, source)
             VALUES (${rawId}, ${INST}, ${EVENT}, ${name}, ${amount}, ${frequency}, 'knox')`;
    const [verified] = await tx`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status, outlier_flags)
             VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, ${frequency}, ${reason ? "rejected" : "verified"}, ${reason?.startsWith("same_line_duplicate") ? '["same_line_duplicate"]' : "[]"}::jsonb) RETURNING fee_verified_id`;
    const [published] = await tx`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url, rolled_back_at, rolled_back_reason)
             VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, ${frequency}, 'agentic-run-1673', 'https://bank.test/fees.pdf',
                     ${reason ? new Date("2026-10-10T00:00:00Z") : null}, ${reason}) RETURNING fee_published_id`;
    return Number(published.fee_published_id);
  }

  const takeDown = (tx: Tx, id: number, reason: string) => tx`UPDATE published_fee_records SET rolled_back_at = '2026-10-11', rolled_back_reason = ${reason} WHERE fee_published_id = ${id}`;
  const state = async (tx: Tx, id: number) => (await tx`SELECT rolled_back_at, rolled_back_reason FROM published_fee_records WHERE fee_published_id = ${id}`)[0];
  const restore = (tx: Tx, runId: number, dryRun = false) => restoreSameLineDuplicates(tx as unknown as Db, { runId, dryRun, institutionId: INST });

  /** Copy C, taken down for older line O; O refreshed by R1; R1 a duplicate of R2. Returns the ids. */
  async function chain(tx: Tx, live: { r2Reason?: string | null; r2Amount?: number } = {}) {
    const r2 = await fee(tx, "Outgoing Wire Transfer", live.r2Reason ?? null, { amount: live.r2Amount });
    const r1 = await fee(tx, "Outgoing Wire Transfer", `duplicate of #${r2}`);
    const older = await fee(tx, "Outgoing Wire Transfer", `refreshed by #${r1}`);
    const copy = await fee(tx, "Checking/Savings Account Fees: Outgoing Wire Transfer", `same_line_duplicate: live fee #${older}`);
    return { r2, r1, older, copy };
  }

  it("keeps the copy down while the older line's replacement, two steps on, is live", async () => {
    await inRollback(async (tx, runId) => {
      const { copy } = await chain(tx);
      expect(await restore(tx, runId, true)).toBe(0);
      expect(await restore(tx, runId)).toBe(0);
      expect((await state(tx, copy)).rolled_back_reason).toMatch(/^same_line_duplicate: live fee #/);
    });
  });

  it("keeps the copy down while that replacement is held by the account type hold", async () => {
    await inRollback(async (tx, runId) => {
      const { copy } = await chain(tx, { r2Reason: "account_type_hold: money_market (#1100)" });
      expect(await restore(tx, runId)).toBe(0);
      expect((await state(tx, copy)).rolled_back_at).not.toBeNull();
    });
  });

  it("brings the copy back when the replacement is gone, or is another price", async () => {
    await inRollback(async (tx, runId) => {
      const gone = await chain(tx, { r2Reason: "operator_closed" });
      expect(await restore(tx, runId)).toBe(1);
      expect(await state(tx, gone.copy)).toMatchObject({ rolled_back_at: null, rolled_back_reason: null });
    });
    await inRollback(async (tx, runId) => {
      const repriced = await chain(tx, { r2Amount: 30 });
      expect(await restore(tx, runId)).toBe(1);
      expect((await state(tx, repriced.copy)).rolled_back_at).toBeNull();
    });
  });

  it("brings the copy back when the chain leads to the copy itself", async () => {
    await inRollback(async (tx, runId) => {
      const copy = await fee(tx, "Night Deposit Key Replacement", null);
      // Prod's 14458: 104758 -> 134564 -> 134645, a line taken down in 14458's own favour.
      const kept = await fee(tx, "Night Deposit Key Replacement (Business)", `duplicate of #${copy}`);
      const older = await fee(tx, "Night Deposit Key Replacement (Business)", `duplicate of #${kept}`);
      await takeDown(tx, copy, `same_line_duplicate: live fee #${older}`);
      expect(await restore(tx, runId)).toBe(1);
      expect((await state(tx, copy)).rolled_back_at).toBeNull();
    });
  });

  it("Darwin reads a copy v1 brought back beside the replacement, and takes it down only with its switch on", async () => {
    await inRollback(async (tx, runId) => {
      const { r2, older } = await chain(tx);
      // The copy v1 restored: live again, its same-line takedown confirmed in the second-look log.
      const copy = await fee(tx, "Checking/Savings Account Fees: Outgoing Wire Transfer", null);
      const other = await fee(tx, "Garnishment", null, { key: "garnishment_levy", amount: 30 });
      for (const id of [copy, other]) {
        await tx`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, fee_published_id, evidence, dedupe_key)
                 VALUES ('publish', 'wrong', 'takedown_confirmed', 'hamilton', 'hamilton.same_line_duplicate', ${INST}, ${id},
                         ${JSON.stringify({ reason: `same_line_duplicate: live fee #${older}` })}::jsonb, ${`hamilton.second_look:hamilton.same_line_duplicate:pub:${id}`})`;
      }
      const rows = (await tx.unsafe(SAME_LINE_REPLACEMENT_ROWS_SQL, [INST, 100])) as unknown as SameLineReplacementRow[];
      expect(rows.map((row) => [Number(row.fee_published_id), row.replacement_fee_published_id == null ? null : Number(row.replacement_fee_published_id)]))
        .toEqual([[copy, r2], [other, null]]);
      expect(findSameLineReplacements(rows).matches.map((match) => [match.feePublishedId, match.reason])).toEqual([[copy, `same_line_duplicate: live fee #${r2}`]]);

      const db = tx as unknown as Db;
      const off = await recheckSameLineReplacements(db, { runId, dryRun: false, institutionId: INST, live: false });
      expect(off).toMatchObject({ live: false, checked: 2, matched: 1, flagged: 0, takenDown: [] });
      expect((await state(tx, copy)).rolled_back_at).toBeNull();

      const first = await recheckSameLineReplacements(db, { runId, dryRun: false, institutionId: INST, live: true });
      expect(first).toMatchObject({ flagged: 1, takenDown: [] });
      const laterRun = runId - 1000;
      await tx`INSERT INTO agent_runs (id, agent_name, run_kind, title, status) VALUES (${laterRun}, 'darwin', 'state_agent', 'Same-line re-check, second look', 'running')`;
      const second = await recheckSameLineReplacements(db, { runId: laterRun, dryRun: false, institutionId: INST, live: true, now: new Date(Date.now() + 13 * 3_600_000) });
      expect(second.takenDown).toEqual([copy]);
      expect((await state(tx, copy)).rolled_back_reason).toBe(`same_line_duplicate: live fee #${r2}`);
      expect((await state(tx, other)).rolled_back_at).toBeNull();
      // Its reason names the live line, so the restore keeps it down while that line is live.
      expect(await restore(tx, laterRun)).toBe(0);
    });
  });
});
