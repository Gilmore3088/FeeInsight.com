// @vitest-environment node
/** Real hot SQL, canonical identity reads and checked in-memory cold files; loopback only. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  db: null as unknown,
  refs: [] as Array<{ source: string; period: string; objectKey: string; rowCount: number; sha256: string }>,
  files: new Map<string, Uint8Array>(),
}));
vi.mock("@/lib/data-store/connection", async (original) => ({
  ...(await original<typeof import("@/lib/data-store/connection")>()),
  withTransaction: (callback: (tx: unknown) => Promise<unknown>) =>
    (context.db as { begin: (fn: (tx: unknown) => Promise<unknown>) => unknown }).begin(callback),
}));
vi.mock("./cold-reads", async (original) => ({
  ...(await original<typeof import("./cold-reads")>()),
  prunedCallFiles: async () => context.refs,
}));
vi.mock("@/lib/agents/hoovie/cold-files", async (original) => ({
  ...(await original<typeof import("@/lib/agents/hoovie/cold-files")>()),
  getColdStore: () => ({ configured: true, bucket: "test", put: async () => { throw new Error("No cold writes in read tests"); },
    get: async (key: string) => { const bytes = context.files.get(key); if (!bytes) throw new Error("Unknown test file"); return bytes; } }),
}));

import { ColdFileWriter } from "@/lib/agents/hoovie/cold-files";
import { CALL_ITEM_COLUMNS } from "@/lib/agents/hoovie/storage-tiers";
import { queryData } from "./query-data";

const connection = process.env.E2E_DATABASE_URL;
const itemKey = "service_charges_deposits_ytd";
const measure = `call:${itemKey}`;
const period = "2026-06-30";

describe.skipIf(!connection)("canonical cold call-report reads in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Cold SQL tests require a loopback database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    context.db = db;
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, charter_type text)`;
    await db`CREATE TEMP TABLE institution_call_report_items (
      institution_id bigint, source text, report_date date, item_code text, item_key text,
      item_description text, schedule text, value numeric, unit text, period_basis text,
      source_url text, fetched_at timestamptz)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    context.refs = [];
    context.files.clear();
    await db`TRUNCATE pg_temp.institution_sources, pg_temp.institution_call_report_items`;
  });

  async function seed(hot: "ffiec" | "ncua", cold: "ffiec" | "ncua") {
    const hotCharter = hot === "ffiec" ? "bank" : "credit_union";
    const coldCharter = cold === "ffiec" ? "bank" : "credit_union";
    for (let id = 1; id <= 5; id++) {
      await db`INSERT INTO institution_sources VALUES (${id}, ${hotCharter}), (${id + 10}, ${coldCharter})`;
      await db`INSERT INTO institution_call_report_items VALUES (${id}, ${hot}, ${period}, 'TEST', ${itemKey}, 'Fee income', 'RI', 1000, 'dollars', 'ytd', 'https://hot.test', '2026-10-19')`;
    }
    await db`INSERT INTO institution_sources VALUES (21, 'unknown')`;
    const writer = new ColdFileWriter(CALL_ITEM_COLUMNS);
    const base = { source: cold, report_date: period, item_code: "TEST", item_key: itemKey,
      item_description: "Fee income", schedule: "RI", unit: "dollars", period_basis: "ytd",
      source_url: "https://cold.test", fetched_at: "2026-10-19", agent_run_id: null };
    writer.push([
      ...Array.from({ length: 5 }, (_, i) => ({ ...base, id: String(i + 1), institution_id: String(i + 11), value: "200" })),
      // Valid archive integrity does not make these wrong-charter/unknown/missing IDs eligible.
      ...[1, 21, 22].map((id) => ({ ...base, id: String(id + 20), institution_id: String(id), value: "999999" })),
    ]);
    const file = writer.finish();
    context.files.set(cold, file.bytes);
    context.refs = [{ source: cold, period, objectKey: cold, rowCount: file.rowCount, sha256: file.sha256 }];
  }

  it.each([
    { hot: "ffiec" as const, cold: "ncua" as const },
    { hot: "ncua" as const, cold: "ffiec" as const },
  ])("returns separate hot $hot and archived $cold medians for the same period", async ({ hot, cold }) => {
    await seed(hot, cold);
    const result = await queryData({ measure, scope: { kind: "national" } });
    expect(result).toMatchObject({ ok: true, rows: [
      expect.objectContaining({ period, sources: hot, median: 1000, institution_count: 5 }),
      expect.objectContaining({ period, sources: cold, median: 200, institution_count: 5 }),
    ] });
  });

  it.each([
    { hot: "ffiec" as const, cold: "ncua" as const },
    { hot: "ncua" as const, cold: "ffiec" as const },
  ])("excludes archived $cold rows for a canonical $hot institution and unknown identity", async ({ hot, cold }) => {
    await seed(hot, cold);
    const result = await queryData({ measure, scope: { kind: "institution", id: "1" } });
    expect(result).toMatchObject({ ok: true, rows: [expect.objectContaining({ source: hot, value: 1000 })] });
    const unknown = await queryData({ measure, scope: { kind: "institution", id: "21" } });
    expect(unknown).toMatchObject({ ok: true, rows: [], unit: null });
  });
});
