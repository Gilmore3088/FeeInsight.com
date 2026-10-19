/** Exact publish/collapse identity against real SQL, confined to loopback fixtures. */
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { collapsePublishedDuplicates } from "./duplicate-collapse";
import { selectExactCopies, type CollapseLine } from "./exact-duplicate";

const connection = process.env.E2E_DATABASE_URL;
const audiences = ["consumer", "business", "both", "unknown"] as const;
const distinct = audiences.flatMap((a) => audiences.filter((b) => a !== b).map((b) => [a, b] as const));
type Db = Parameters<typeof collapsePublishedDuplicates>[0];
const types = { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL };
const line = (feeAudience: string | null): CollapseLine => ({ institutionId: 42, canonicalFeeKey: "coin_counting",
  variantType: null, amountKind: "flat", amount: 5, ratePercent: null, rateMinAmount: null,
  rateMaxAmount: null, rateBasis: null, feeName: "Coin Counting", feeAudience });

describe.skipIf(!connection)("Exact duplicate identity in isolated PostgreSQL (#2131)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Exact duplicate tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types });
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, institution_id bigint,
      canonical_fee_key text, fee_name text, amount numeric, variant_type text, frequency text,
      fee_audience text, amount_kind text DEFAULT 'flat', rate_percent numeric, rate_min_amount numeric,
      rate_max_amount numeric, rate_basis text, published_at timestamptz, rolled_back_at timestamptz,
      rolled_back_reason text, rolled_back_by_batch_id text, quarantined_at timestamptz,
      lineage_ref bigint, source_url text)`;
    await db`CREATE TEMP TABLE agent_run_events (agent_run_id bigint, event_type text, status text, message text, detail jsonb)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => { await db`TRUNCATE published_fee_records, agent_run_events`; });
  async function seed(a: string | null, b: string | null) {
    await db`INSERT INTO published_fee_records (fee_published_id, institution_id, canonical_fee_key, fee_name,
      amount, frequency, fee_audience, published_at) VALUES
      (1, 42, 'coin_counting', 'Coin Counting', 5, 'per_item', ${a}, '2026-10-01'),
      (2, 42, 'coin_counting', 'Coin Counting', 5, 'per_item', ${b}, '2026-10-02')`;
  }
  const run = (dryRun = false) => collapsePublishedDuplicates(db as unknown as Db,
    { runId: 2131, batchId: "test-2131", dryRun, institutionId: 42 });
  const live = () => db`SELECT fee_published_id, fee_audience FROM published_fee_records WHERE rolled_back_at IS NULL ORDER BY fee_published_id`;

  it.each(distinct)("keeps %s and %s in either publication order", async (a, b) => {
    await seed(a, b);
    expect(await run(true)).toEqual([]);
    expect(await run()).toEqual([]);
    expect(await live()).toHaveLength(2);
    await db`UPDATE published_fee_records SET published_at = '2026-10-03' WHERE fee_published_id = 1`;
    expect(await run()).toEqual([]);
    expect(await live()).toHaveLength(2);
    expect(await db`SELECT 1 FROM agent_run_events`).toHaveLength(0);
    const copies = await selectExactCopies(db as unknown as Db, line(a));
    expect(copies.map((copy) => Number(copy.fee_published_id))).toEqual([1]);
  });

  it.each(audiences)("still collapses a true %s twin and dry run changes nothing", async (audience) => {
    await seed(audience, audience);
    expect(await run(true)).toMatchObject([{ feePublishedId: 1, keptFeePublishedId: 2 }]);
    expect(await live()).toHaveLength(2);
    expect(await db`SELECT 1 FROM agent_run_events`).toHaveLength(0);
    expect(await run()).toMatchObject([{ feePublishedId: 1, keptFeePublishedId: 2 }]);
    expect(await live()).toEqual([{ fee_published_id: "2", fee_audience: audience }]);
    expect((await db`SELECT rolled_back_reason FROM published_fee_records WHERE fee_published_id = 1`)[0].rolled_back_reason).toBe("duplicate of #2");
    expect((await db`SELECT detail FROM agent_run_events`)[0].detail).toMatchObject({ collapsed: 1 });
  });

  it.each([[null, "unknown"], ["unknown", null]])("normalizes legacy %s only to %s", async (a, b) => {
    await seed(a, b);
    expect(await selectExactCopies(db as unknown as Db, line("unknown"))).toHaveLength(2);
    expect(await run()).toMatchObject([{ feePublishedId: 1, keptFeePublishedId: 2 }]);
  });

  it("keeps unrelated frequency conflicts out of one audience's decision", async () => {
    await seed("consumer", "consumer");
    await db`INSERT INTO published_fee_records (fee_published_id, institution_id, canonical_fee_key, fee_name,
      amount, frequency, fee_audience, published_at) VALUES
      (3, 42, 'coin_counting', 'Coin Counting', 5, 'annual', 'business', '2026-10-03')`;
    expect(await run()).toMatchObject([{ feePublishedId: 1, keptFeePublishedId: 2 }]);
    expect(await live()).toEqual([{ fee_published_id: "2", fee_audience: "consumer" }, { fee_published_id: "3", fee_audience: "business" }]);
  });

  it.each(["variant", "amount", "frequency", "rate_value", "rate_basis", "rate_floor", "rate_cap"])(
    "preserves distinct %s applicability in SQL and live-copy selection", async (dimension) => {
      await seed("consumer", "consumer");
      const identity = line("consumer");
      if (dimension.startsWith("rate")) {
        await db`UPDATE published_fee_records SET amount = NULL, amount_kind = 'percent', rate_percent = 5, rate_basis = 'transaction'`;
        Object.assign(identity, { amount: null, amountKind: "percent", ratePercent: 5, rateBasis: "transaction" });
      }
      if (dimension === "variant") await db`UPDATE published_fee_records SET variant_type = 'premium' WHERE fee_published_id = 2`;
      if (dimension === "amount") await db`UPDATE published_fee_records SET amount = 6 WHERE fee_published_id = 2`;
      if (dimension === "frequency") await db`UPDATE published_fee_records SET frequency = 'annual' WHERE fee_published_id = 2`;
      if (dimension === "rate_value") await db`UPDATE published_fee_records SET rate_percent = 6 WHERE fee_published_id = 2`;
      if (dimension === "rate_basis") await db`UPDATE published_fee_records SET rate_basis = 'balance' WHERE fee_published_id = 2`;
      if (dimension === "rate_floor") await db`UPDATE published_fee_records SET rate_min_amount = 1 WHERE fee_published_id = 2`;
      if (dimension === "rate_cap") await db`UPDATE published_fee_records SET rate_max_amount = 20 WHERE fee_published_id = 2`;
      expect(await run()).toEqual([]);
      expect(await live()).toHaveLength(2);
      // The SQL selector deliberately leaves frequency to the pure frequency-class check.
      const copies = await selectExactCopies(db as unknown as Db, identity);
      expect(copies.map((copy) => Number(copy.fee_published_id)).sort()).toEqual(dimension === "frequency" ? [1, 2] : [1]);
    },
  );

  it.each([["per_item", "per_transaction", 1], [null, "per_item", 1], ["monthly", null, 2]] as const)(
    "preserves the %s/%s frequency keep preference", async (a, b, closed) => {
      await seed("consumer", "consumer");
      await db`UPDATE published_fee_records SET frequency = ${a} WHERE fee_published_id = 1`;
      await db`UPDATE published_fee_records SET frequency = ${b} WHERE fee_published_id = 2`;
      expect((await run()).map((row) => row.feePublishedId)).toEqual([closed]);
    },
  );

  it.each([1, 2])("does not close or use held row %i as a keeper", async (held) => {
    await seed("consumer", "consumer");
    await db`UPDATE published_fee_records SET quarantined_at = NOW() WHERE fee_published_id = ${held}`;
    expect(await run()).toEqual([]);
    expect(await live()).toHaveLength(2);
    const copies = await selectExactCopies(db as unknown as Db, line("consumer"));
    expect(copies.map((copy) => Number(copy.fee_published_id))).toEqual([held === 1 ? 2 : 1]);
  });

  it("handles the bounded 500-target batch with a shared keeper", async () => {
    await db`INSERT INTO published_fee_records (fee_published_id, institution_id, canonical_fee_key, fee_name,
      amount, frequency, fee_audience, published_at)
      SELECT id, 42, 'coin_counting', 'Coin Counting', 5, 'per_item', 'consumer', '2026-10-01'::timestamptz
        FROM generate_series(1, 502) id`;
    expect(await run()).toHaveLength(500);
    expect(await live()).toEqual([{ fee_published_id: "501", fee_audience: "consumer" }, { fee_published_id: "502", fee_audience: "consumer" }]);
    expect((await db`SELECT detail FROM agent_run_events`)[0].detail).toMatchObject({ collapsed: 500 });
  });

  it.each([
    ["hold", 1, false], ["closure", 1, false], ["audience", 1, false], ["frequency", 1, false],
    ["amount", 1, false], ["variant", 1, false], ["rate_basis", 1, false], ["lineage", 1, false],
    ["source", 1, false], ["hold", 2, false], ["closure", 2, false], ["audience", 2, false],
    ["lineage", 2, false], ["source", 2, false], ["hold", 3, false], ["audience", 3, false],
    ["audience", 1, true],
  ] as const)("rechecks committed %s on pair member %i; unrelated pair: %s", async (change, changedId, unrelated) => {
    await seed("consumer", "consumer");
    if (changedId === 3) await db`INSERT INTO published_fee_records (fee_published_id, institution_id,
      canonical_fee_key, fee_name, amount, frequency, fee_audience, published_at)
      VALUES (3, 42, 'coin_counting', 'Coin Counting', 5, 'per_item', 'consumer', '2026-10-03')`;
    if (unrelated) await db`INSERT INTO published_fee_records (fee_published_id, institution_id,
      canonical_fee_key, fee_name, amount, frequency, fee_audience, published_at) VALUES
      (10, 42, 'coin_counting', 'Other Coin Fee', 5, 'per_item', 'consumer', '2026-10-01'),
      (11, 42, 'coin_counting', 'Other Coin Fee', 5, 'per_item', 'consumer', '2026-10-02')`;
    const schema = `exact_duplicate_${randomBytes(8).toString("hex")}`;
    await db`CREATE SCHEMA ${db(schema)}`;
    await db`CREATE TABLE ${db(schema)}.published_fee_records (LIKE pg_temp.published_fee_records INCLUDING ALL)`;
    await db`CREATE TABLE ${db(schema)}.agent_run_events (LIKE pg_temp.agent_run_events INCLUDING ALL)`;
    await db`INSERT INTO ${db(schema)}.published_fee_records SELECT * FROM pg_temp.published_fee_records`;
    const holder = postgres(connection!, { max: 1, ssl: "require", types });
    const writer = postgres(connection!, { max: 1, ssl: "require", types });
    let release!: () => void;
    let locked!: () => void;
    let started!: (pid: number) => void;
    const canCommit = new Promise<void>((resolve) => { release = resolve; });
    const hasLock = new Promise<void>((resolve) => { locked = resolve; });
    const writerPid = new Promise<number>((resolve) => { started = resolve; });
    const holding = holder.begin(async (scope) => {
      const tx = scope as unknown as typeof db;
      await tx`SET LOCAL search_path TO ${tx(schema)}`;
      // Every case blocks the writer on target 1; the keeper may change while it waits.
      await tx`SELECT fee_published_id FROM published_fee_records WHERE fee_published_id = 1 FOR UPDATE`;
      if (change === "hold") await tx`UPDATE published_fee_records SET quarantined_at = NOW() WHERE fee_published_id = ${changedId}`;
      else if (change === "closure") await tx`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_reason = 'operator_closed' WHERE fee_published_id = ${changedId}`;
      else if (change === "audience") await tx`UPDATE published_fee_records SET fee_audience = 'business' WHERE fee_published_id = ${changedId}`;
      else if (change === "frequency") await tx`UPDATE published_fee_records SET frequency = 'annual' WHERE fee_published_id = ${changedId}`;
      else if (change === "amount") await tx`UPDATE published_fee_records SET amount = 6 WHERE fee_published_id = ${changedId}`;
      else if (change === "variant") await tx`UPDATE published_fee_records SET variant_type = 'premium' WHERE fee_published_id = ${changedId}`;
      else if (change === "lineage") await tx`UPDATE published_fee_records SET lineage_ref = 99 WHERE fee_published_id = ${changedId}`;
      else if (change === "source") await tx`UPDATE published_fee_records SET source_url = 'https://example.test/new-copy' WHERE fee_published_id = ${changedId}`;
      else await tx`UPDATE published_fee_records SET rate_basis = 'balance' WHERE fee_published_id = ${changedId}`;
      locked();
      await canCommit;
    });
    let writing: Promise<unknown> | undefined;
    try {
      await hasLock;
      writing = writer.begin(async (scope) => {
        const tx = scope as unknown as typeof db;
        await tx`SET LOCAL search_path TO ${tx(schema)}`;
        const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
        started(pid);
        return collapsePublishedDuplicates(tx as unknown as Db, { runId: 2131, batchId: "test-2131", dryRun: false });
      });
      const pid = await writerPid;
      let blocked = false;
      for (let i = 0; i < 100; i += 1) {
        const [state] = await db`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
        if (state?.wait_event_type === "Lock") { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      release();
      await holding;
      expect(await writing).toEqual(unrelated ? [expect.objectContaining({ feePublishedId: 10, keptFeePublishedId: 11 })] : []);
      const [target] = await db`SELECT rolled_back_at, rolled_back_reason FROM ${db(schema)}.published_fee_records WHERE fee_published_id = 1`;
      if (change === "closure" && changedId === 1) expect(target.rolled_back_reason).toBe("operator_closed");
      else expect(target.rolled_back_at).toBeNull();
      const [changed] = await db`SELECT * FROM ${db(schema)}.published_fee_records WHERE fee_published_id = ${changedId}`;
      if (change === "hold") expect(changed.quarantined_at).not.toBeNull();
      if (change === "closure") expect(changed.rolled_back_reason).toBe("operator_closed");
      if (change === "audience") expect(changed.fee_audience).toBe("business");
      const events = await db`SELECT detail FROM ${db(schema)}.agent_run_events`;
      if (unrelated) expect(events.map((row) => row.detail)).toMatchObject([{ collapsed: 1 }]);
      else expect(events).toHaveLength(0);
    } finally {
      release();
      await Promise.allSettled([holding, writing]);
      await holder.end();
      await writer.end();
      await db`DROP SCHEMA ${db(schema)} CASCADE`;
    }
  });
});
