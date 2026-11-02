// @vitest-environment node
/**
 * Magellan's live-source refetch selection (`selectStaleLiveSources`) against real PostgreSQL, with
 * and without Knox's refetch requests (gap 10, `refetchRequestDays`). Loopback-only; every table the
 * query reads is a temporary table that shadows the real one for this connection. No network or
 * provider call.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

const connection = process.env.E2E_DATABASE_URL;
type Select = typeof import("./live-source-refetch").selectStaleLiveSources;
type Db = Parameters<Select>[0];

describe.skipIf(!connection)("live-source refetch selection in isolated PostgreSQL (gap 10)", () => {
  let db: postgres.Sql;
  let selectStaleLiveSources: Select;
  let requestKind: string;
  let requestDays: number;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Live-source refetch DB tests require a loopback E2E database; production connections are forbidden");
    }
    // CI's e2e database requires TLS like the other DB tests; a local server without TLS sets E2E_DATABASE_SSL=disable.
    db = postgres(connection, { max: 1, ssl: process.env.E2E_DATABASE_SSL === "disable" ? false : "require", onnotice: () => {} });
    ({ selectStaleLiveSources } = await import("./live-source-refetch"));
    ({ HOLD_REFETCH_REQUEST_KIND: requestKind } = await import("@/lib/agents/darwin/hold-source-reread-switch"));
    ({ KNOX_REREAD_REFETCH_DAYS: requestDays } = await import("@/lib/agents/knox/reread-backlog"));
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, institution_name text, asset_size numeric,
      last_crawl_at timestamptz, consecutive_failures int DEFAULT 0, status text DEFAULT 'active', fee_schedule_url text,
      last_success_at timestamptz)`;
    await db`CREATE TEMP TABLE institution_source_profiles (institution_id bigint PRIMARY KEY, source_kind text DEFAULT 'unknown',
      read_strategy text, locked_by_correction boolean DEFAULT false, canonical_source_url text)`;
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, institution_id bigint, document_url text,
      status text DEFAULT 'success', crawled_at timestamptz, last_checked_at timestamptz, superseded_by_id bigint,
      companion_source_id bigint)`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint PRIMARY KEY, source_document_id bigint)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigint PRIMARY KEY, fee_raw_id bigint)`;
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, lineage_ref bigint,
      institution_id bigint, rolled_back_at timestamptz)`;
    await db`CREATE TEMP TABLE pipeline_feedback (id bigserial PRIMARY KEY, kind text, institution_id bigint,
      source_document_id bigint, evidence jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now())`;
    await db`CREATE TEMP TABLE pipeline_attempts (id bigserial PRIMARY KEY, institution_id bigint, source_document_id bigint,
      stage text, strategy text, outcome text, detail jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now())`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE institution_sources, institution_source_profiles, source_documents, raw_fee_observations,
      verified_fee_observations, published_fee_records, pipeline_feedback, pipeline_attempts`;
  });

  let feeId = 0;
  /** `count` live fees read from document `documentId` at bank `institutionId`. */
  async function liveFees(institutionId: number, documentId: number, count: number) {
    for (let i = 0; i < count; i += 1) {
      feeId += 1;
      await db`INSERT INTO raw_fee_observations VALUES (${feeId}, ${documentId})`;
      await db`INSERT INTO verified_fee_observations VALUES (${feeId}, ${feeId})`;
      await db`INSERT INTO published_fee_records (fee_published_id, lineage_ref, institution_id) VALUES (${feeId}, ${feeId}, ${institutionId})`;
    }
  }
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
  async function bank(id: number, feeScheduleUrl: string, lastSuccessAt: Date | null = null) {
    await db`INSERT INTO institution_sources (id, institution_name, fee_schedule_url, last_success_at)
      VALUES (${id}, ${`Bank ${id}`}, ${feeScheduleUrl}, ${lastSuccessAt})`;
    await db`INSERT INTO institution_source_profiles (institution_id) VALUES (${id})`;
  }
  async function doc(id: number, institutionId: number, url: string, checkedDaysAgo: number, status = "success") {
    await db`INSERT INTO source_documents (id, institution_id, document_url, status, crawled_at, last_checked_at)
      VALUES (${id}, ${institutionId}, ${url}, ${status}, ${daysAgo(checkedDaysAgo)}, ${daysAgo(checkedDaysAgo)})`;
  }

  /**
   * 1 (A): its live fees cite document 10, current but last checked 120 days ago, on the plain fetch's
   * own address; another current copy of the same page (11, under "www." and a trailing slash) was
   * stored 5 days ago. 2 (B): a page off the plain fetch address, newest copy 40 days ago. 3 (C): a
   * page with no stored copy (its only document failed), checked 200 days ago. 4 (D): a page whose
   * newest copy is 400 days old. 5 (E): a held-only page, Darwin's request on a current document
   * checked 120 days ago, the plain fetch address with a copy 5 days old.
   */
  async function seed() {
    await bank(1, "https://a.example/fees");
    await doc(10, 1, "https://a.example/fees", 120);
    await doc(11, 1, "https://www.a.example/fees/", 5);
    await liveFees(1, 10, 3);

    await bank(2, "https://b.example/");
    await doc(20, 2, "https://b.example/fee-schedule.pdf", 40);
    await liveFees(2, 20, 2);

    await bank(3, "https://c.example/");
    await doc(30, 3, "https://c.example/fees.pdf", 200, "failed");
    await liveFees(3, 30, 1);

    await bank(4, "https://d.example/");
    await doc(40, 4, "https://d.example/fees", 400);
    await liveFees(4, 40, 4);

    await bank(5, "https://e.example/fees");
    await doc(50, 5, "https://e.example/fees", 120);
    await doc(51, 5, "https://www.e.example/fees/", 5);
    await db`INSERT INTO pipeline_feedback (kind, institution_id, source_document_id, evidence)
      VALUES (${requestKind}, 5, 50, '{"held_fees": 2}'::jsonb)`;
  }
  const ids = async (options: { refetchRequestDays?: number | null } = {}) =>
    (await selectStaleLiveSources(db as unknown as Db, 10, null, options)).map((row) => Number(row.id));

  it("off: returns main's selection (no stored copy first, then the oldest copy; the plain address and fresh copies left out)", async () => {
    await seed();
    expect(await ids()).toEqual([3, 4, 2]);
    expect(await ids({ refetchRequestDays: null })).toEqual([3, 4, 2]);
  });

  it("on: takes a page whose cited current document is unchecked 90+ days, even on the plain fetch address with a newer copy", async () => {
    await seed();
    const rows = await selectStaleLiveSources(db as unknown as Db, 10, null, { refetchRequestDays: requestDays });
    expect(rows.map((row) => Number(row.id))).toEqual([3, 4, 1, 2]);
    const a = rows.find((row) => Number(row.id) === 1);
    expect(a).toMatchObject({ page: "a.example/fees", live_fees: 3 });
    expect(a?.document_ids.map(Number)).toEqual([10]);
  });

  it("on: a page with no stored copy still sorts first, ahead of older checks (LEAST ignores NULL)", async () => {
    await seed();
    // C's check (200 days) is newer than D's copy (400 days): only its missing copy puts it first.
    expect((await ids({ refetchRequestDays: requestDays }))[0]).toBe(3);
  });

  it("on: a held-only page is not taken by the request clause; Darwin's request path still governs it", async () => {
    await seed();
    expect(await ids({ refetchRequestDays: requestDays })).not.toContain(5);
    // Its page is stale on its own terms (no copy in 30 days) once the newer copy is gone: Darwin's path takes it, after live pages.
    await db`DELETE FROM source_documents WHERE id = 51`;
    await db`UPDATE institution_sources SET fee_schedule_url = 'https://e.example/' WHERE id = 5`;
    const on = await ids({ refetchRequestDays: requestDays });
    expect(on.at(-1)).toBe(5);
  });

  it("on: a page whose live document was checked recently is not requested, even with an old held document beside it", async () => {
    await bank(6, "https://f.example/fees");
    await doc(60, 6, "https://f.example/fees", 10);
    await liveFees(6, 60, 2);
    await doc(61, 6, "https://f.example/fees", 150);
    await db`INSERT INTO pipeline_feedback (kind, institution_id, source_document_id) VALUES (${requestKind}, 6, 61)`;
    expect(await ids({ refetchRequestDays: requestDays })).toEqual([]);
  });
});
