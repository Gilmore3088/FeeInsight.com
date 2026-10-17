/**
 * H07-T02 (#982): the Hamilton fixtures seed, read back through the same views and readers the
 * app uses, and tear down without touching any row outside their reserved range.
 * Loopback only: E2E_DATABASE_URL must point at a local copy of tests/e2e/production-schema.sql.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EXCLUDED, FIXTURE_ID_MAX, FIXTURE_ID_MIN, FIXTURE_STOP_REASON, FIXTURE_USERS, HOME, NAMED_FEES, PEERS,
  PEER_WITHOUT_NSF, STALE_DATE, THIN_PEER, assertLoopbackDatabase, connectFixtureDb, seedHamiltonFixtures,
  teardownHamiltonFixtures, type FixtureDb,
} from "./fixtures";

const connection = process.env.E2E_DATABASE_URL;

describe("fixture database guard", () => {
  it("refuses any database that is not on this machine", () => {
    expect(() => assertLoopbackDatabase("postgres://u:p@db.example.supabase.co:5432/postgres")).toThrow(/local database/);
    expect(() => assertLoopbackDatabase(undefined)).toThrow(/E2E_DATABASE_URL/);
    expect(assertLoopbackDatabase("postgres://postgres:postgres@localhost:5432/e2e")).toContain("localhost");
  });
});

describe.skipIf(!connection)("Hamilton journey fixtures in isolated PostgreSQL", () => {
  let db: FixtureDb;
  let ids: Awaited<ReturnType<typeof seedHamiltonFixtures>>;
  const ids9 = [FIXTURE_ID_MIN, FIXTURE_ID_MAX];

  beforeAll(async () => {
    db = connectFixtureDb(connection);
    // An unrelated row that teardown must leave alone.
    await db`DELETE FROM institution_sources WHERE id = 9690001`;
    await db`INSERT INTO institution_sources (id, institution_name, charter_type, source) VALUES (9690001, 'Unrelated Row CU', 'credit_union', 'ncua')`;
    ids = await seedHamiltonFixtures(db);
  });
  afterAll(async () => {
    if (!db) return;
    await teardownHamiltonFixtures(db);
    await db`DELETE FROM institution_sources WHERE id = 9690001`;
    await db.end();
  });

  it("links the Pro account to its home and leaves the second Pro account with none", async () => {
    const rows = await db`SELECT user_id::int AS user_id, institution_id::int AS institution_id, membership_role
                            FROM institution_workspace_memberships WHERE user_id BETWEEN ${ids9[0]} AND ${ids9[1]}`;
    expect(rows).toEqual([{ user_id: FIXTURE_USERS.pro.id, institution_id: HOME.id, membership_role: "owner" }]);
    const users = await db`SELECT id::int AS id, role, subscription_status FROM users WHERE id BETWEEN ${ids9[0]} AND ${ids9[1]} ORDER BY id`;
    expect(users.map((u) => [u.id, u.role, u.subscription_status])).toEqual([
      [FIXTURE_USERS.pro.id, "premium", "active"],
      [FIXTURE_USERS.proNoHome.id, "premium", "active"],
      [FIXTURE_USERS.admin.id, "admin", "none"],
      [FIXTURE_USERS.viewer.id, "viewer", "none"],
    ]);
  });

  it("shows a $0 fee as a dollar line, a rate fee only in the rate catalog, and keeps a stale date", async () => {
    const [zero] = await db`SELECT amount, fee_treatment FROM published_fee_catalog WHERE id = ${ids.zeroNsf}`;
    expect(Number(zero.amount)).toBe(0);
    expect(zero.fee_treatment).toBe("no_charge");
    expect(await db`SELECT 1 FROM published_fee_catalog WHERE id = ${ids.rateForeign}`).toHaveLength(0);
    const [rate] = await db`SELECT rate_percent, amount FROM published_fee_rate_catalog WHERE id = ${ids.rateForeign}`;
    expect(Number(rate.rate_percent)).toBe(1);
    expect(rate.amount).toBeNull();
    const [stale] = await db`SELECT created_at FROM published_fee_catalog WHERE id = ${ids.staleNsf}`;
    expect(new Date(stale.created_at).toISOString()).toBe(new Date(STALE_DATE).toISOString());
  });

  it("keeps a peer with no NSF line, and a thin peer out of the catalog", async () => {
    expect(await db`SELECT 1 FROM published_fee_catalog WHERE institution_id = ${PEER_WITHOUT_NSF} AND fee_category = 'nsf'`).toHaveLength(0);
    expect(await db`SELECT 1 FROM published_fee_catalog WHERE institution_id = ${THIN_PEER}`).toHaveLength(0);
    const [deep] = await db`SELECT COUNT(DISTINCT institution_id)::int AS n FROM published_fee_catalog WHERE institution_id BETWEEN ${ids9[0]} AND ${ids9[1]}`;
    // Home, every peer but the thin one, and the three excluded institutions.
    expect(deep.n).toBe(1 + PEERS.length - 1 + EXCLUDED.length);
  });

  it("stores the home's schedule text for the correction source check", async () => {
    const [text] = await db`SELECT normalized_text FROM agent_source_texts WHERE institution_id = ${HOME.id}`;
    expect(String(text.normalized_text)).toContain("Stop Payment Fee | $30.00");
    const [fee] = await db`SELECT amount FROM published_fee_catalog WHERE id = ${ids.homeStopPayment}`;
    expect(Number(fee.amount)).toBe(NAMED_FEES.homeStopPayment.amount);
  });

  it("turns the provider stop on for the run", async () => {
    const [control] = await db`SELECT enabled, reason FROM automation_control WHERE control_key = 'global'`;
    expect(control).toMatchObject({ enabled: false, reason: FIXTURE_STOP_REASON });
  });

  it("seeds again from scratch with the same rows, and teardown removes only fixture rows", async () => {
    const count = async () => (await db`SELECT COUNT(*)::int AS n FROM published_fee_records WHERE institution_id BETWEEN ${ids9[0]} AND ${ids9[1]}`)[0].n;
    const before = await count();
    await seedHamiltonFixtures(db);
    expect(await count()).toBe(before);
    await teardownHamiltonFixtures(db);
    expect(await count()).toBe(0);
    expect(await db`SELECT 1 FROM users WHERE id BETWEEN ${ids9[0]} AND ${ids9[1]}`).toHaveLength(0);
    expect(await db`SELECT 1 FROM institution_sources WHERE id = 9690001`).toHaveLength(1);
    const [control] = await db`SELECT enabled FROM automation_control WHERE control_key = 'global'`;
    expect(control.enabled).toBe(true);
    ids = await seedHamiltonFixtures(db);
  });
});
