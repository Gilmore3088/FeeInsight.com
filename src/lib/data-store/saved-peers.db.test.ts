/** Real PostgreSQL round trip of saved peer groups, wider dimensions included, in a loopback-only, temporary-table connection. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const connection = process.env.E2E_DATABASE_URL;

describe.skipIf(!connection)("saved peer groups in isolated PostgreSQL", () => {
  let store: typeof import("./saved-peers");
  let db: typeof import("./connection")["sql"];

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Saved peer SQL tests require a loopback E2E database; production connections are forbidden");
    // One connection, so the temporary tables below are the ones the store reads.
    vi.stubEnv("DATABASE_URL", connection);
    vi.stubEnv("DATABASE_POOL_MAX", "1");
    vi.resetModules();
    store = await import("./saved-peers");
    db = (await import("./connection")).sql;
    await db`CREATE TEMP TABLE saved_peer_sets (
      id bigserial PRIMARY KEY, name text NOT NULL, tiers text, districts text, charter_type text, created_by text,
      created_at timestamptz DEFAULT now(), filters jsonb, institution_ids integer[], states text[], institution_id integer,
      is_default boolean NOT NULL DEFAULT false)`;
    await db`CREATE TEMP TABLE institution_workspace_memberships (institution_id bigint, user_id bigint, membership_status text, membership_role text)`;
  });
  afterAll(async () => {
    if (db) await db.end();
    vi.unstubAllEnvs();
  });

  it("saves the wider dimensions in filters and reads them back", async () => {
    const advanced = {
      asset_min: 500_000_000, asset_max: 2_000_000_000, regulators: ["occ", "fdic"] as ("occ" | "fdic")[],
      holding_company_rssd: "1234", market_code: 45220, nearest: 10,
    };
    const id = Number(await store.savePeerSet("Tallahassee banks", { charter_type: "bank", states: ["FL"], advanced }, "7", null));
    const [stored] = await db`SELECT filters, jsonb_typeof(filters) AS kind, tiers, states FROM saved_peer_sets WHERE id = ${id}`;
    expect(stored.kind).toBe("object");
    expect(stored.states).toEqual(["FL"]);
    const read = await store.getSavedPeerSetById(id, "7");
    expect(read).toMatchObject({ name: "Tallahassee banks", charter_type: "bank", states: ["FL"], institution_ids: null, advanced });
  });

  it("keeps a basic group's columns as before, with no filters", async () => {
    const id = Number(await store.savePeerSet("Southeast", { charter_type: "credit_union", asset_tiers: ["community_mid"], fed_districts: [6], states: ["GA"] }, "7", null));
    const [stored] = await db`SELECT tiers, districts, charter_type, states, institution_ids, filters FROM saved_peer_sets WHERE id = ${id}`;
    expect(stored).toEqual({ tiers: "community_mid", districts: "6", charter_type: "credit_union", states: ["GA"], institution_ids: null, filters: null });
    expect((await store.getSavedPeerSetById(id, "7"))?.advanced).toBeNull();
  });

  it("clears the wider dimensions on edit and never keeps them with chosen institutions", async () => {
    const id = Number(await store.savePeerSet("Metro", { advanced: { market_code: 45220 } }, "7", null));
    expect(await store.updatePeerSet(id, "Chosen", { institution_ids: [5, 21], advanced: { nearest: 3 } }, "7")).toBe(true);
    const [stored] = await db`SELECT filters, institution_ids FROM saved_peer_sets WHERE id = ${id}`;
    expect(stored).toEqual({ filters: null, institution_ids: [5, 21] });
  });

  it("ignores malformed stored values", async () => {
    const [row] = await db`INSERT INTO saved_peer_sets (name, created_by, filters)
      VALUES ('Old', '7', ${'{"nearest": "ten", "regulators": ["occ", "cfpb"], "market_code": -4, "asset_min": 9, "asset_max": 3}'}::jsonb) RETURNING id`;
    expect((await store.getSavedPeerSetById(Number(row.id), "7"))?.advanced).toEqual({ regulators: ["occ"] });
  });
});
