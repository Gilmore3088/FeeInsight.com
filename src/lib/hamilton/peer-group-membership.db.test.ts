/**
 * One membership everywhere, against the production schema (tests/e2e/production-schema.sql) on a
 * loopback-only database seeded with the synthetic Hamilton fixtures: a saved group gives the peer
 * list, the benchmark (getPeerIndex and getPeerFeeValues) and the report's peer index the same
 * institutions, for a basic group and for one with wider dimensions. How many of them publish a
 * fee may differ; who is in the group may not. A group that matches nobody stays empty.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ALL_INSTITUTIONS,
  FIXTURE_USERS,
  HOME,
  connectFixtureDb,
  seedHamiltonFixtures,
  teardownHamiltonFixtures,
  type FixtureDb,
} from "../../../tests/e2e/hamilton/fixtures";

const connection = process.env.E2E_DATABASE_URL;
const USER = String(FIXTURE_USERS.pro.id);
const AS_OF = "2026-10-17";

describe.skipIf(!connection)("saved peer group membership in isolated PostgreSQL", () => {
  let fixtures: FixtureDb;
  let peerIndex: typeof import("./peer-index");
  let peerList: typeof import("./peer-list");
  let listStore: typeof import("@/lib/data-store/hamilton-peer-list");
  let feeIndex: typeof import("@/lib/data-store/fee-index");
  let savedPeers: typeof import("@/lib/data-store/saved-peers");
  let appDb: typeof import("@/lib/data-store/connection")["sql"];
  const savedIds: number[] = [];

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Peer group membership tests require a loopback E2E database; production connections are forbidden");
    }
    fixtures = connectFixtureDb(connection);
    // tests/e2e/production-schema.sql predates the custom peer group columns: add them the way
    // the migration does (idempotent, loopback database only).
    await fixtures.unsafe(readFileSync(resolve(__dirname, "../../../supabase/migrations/20270110000021_saved_peer_sets_custom_peers.sql"), "utf8"));
    await seedHamiltonFixtures(fixtures);
    // The registry's total assets (USD thousands), which the wider "asset range" dimension reads.
    for (const inst of ALL_INSTITUTIONS) {
      await fixtures`UPDATE institution_sources SET asset_size = ${inst.assetsThousands} WHERE id = ${inst.id}`;
    }
    vi.stubEnv("DATABASE_URL", connection);
    vi.resetModules();
    peerIndex = await import("./peer-index");
    peerList = await import("./peer-list");
    listStore = await import("@/lib/data-store/hamilton-peer-list");
    feeIndex = await import("@/lib/data-store/fee-index");
    savedPeers = await import("@/lib/data-store/saved-peers");
    appDb = (await import("@/lib/data-store/connection")).sql;
  }, 60_000);

  afterAll(async () => {
    if (savedIds.length && fixtures) await fixtures`DELETE FROM saved_peer_sets WHERE id = ANY(${savedIds})`;
    if (fixtures) {
      await teardownHamiltonFixtures(fixtures);
      await fixtures.end();
    }
    if (appDb) await appDb.end();
    vi.unstubAllEnvs();
  });

  /** Every surface's institutions for one saved group. */
  async function everywhere(setId: number) {
    const set = await savedPeers.getSavedPeerSetById(setId, USER);
    if (!set) throw new Error("saved group missing");
    const membership = await peerIndex.resolveSavedPeerGroupMembership(set, HOME.id);

    const subject = await listStore.getPeerListSubject(HOME.id, AS_OF);
    if (!subject) throw new Error("subject missing");
    const active = await peerIndex.savedPeerGroupFor(set, HOME.id, subject.name);
    if (active.status !== "ready") return { membership, active, listIds: null, totalMatches: null, benchmark: null, publishers: null };
    const intent = peerList.parsePeerListQuestion("List all saved peers");
    const criteria = intent ? peerList.planPeerList(intent, subject, active).criteria : null;
    if (!criteria) throw new Error("no list criteria");
    const listed = await listStore.getPeerListRows(HOME.id, criteria, AS_OF, undefined, { offset: 0, limit: 50 });

    // The report and every chart read this, with the group picked by id.
    const benchmark = await peerIndex.resolveHamiltonPeerIndex({
      userId: USER, peerSetId: String(setId), selectedInstitution: { id: HOME.id, institution_name: HOME.name, state_code: HOME.state, charter_type: HOME.charter, asset_size_tier: null, fed_district: 6 },
    });
    // The engine's peer read (briefing, research, Ask): the institutions behind each fee.
    const values = benchmark.status === "ready" && benchmark.filters
      ? (await feeIndex.getPeerFeeValues([benchmark.filters], ["overdraft", "nsf"], HOME.id))[0]
      : new Map();
    const publishers = new Set([...values.values()].flat().map((v) => v.institution_id));
    return {
      membership,
      active,
      listIds: listed.rows.map((row) => row.institutionId).sort((a, b) => a - b),
      totalMatches: listed.totalMatches,
      benchmark,
      publishers,
    };
  }

  const cases: { kind: string; name: string; filters: Parameters<typeof savedPeers.savePeerSet>[1]; expected: number[] }[] = [
    {
      kind: "basic",
      name: "Florida credit unions",
      filters: { charter_type: "credit_union", states: ["FL"] },
      // Every Florida credit union in the fixtures except the research institution itself.
      expected: ALL_INSTITUTIONS.filter((i) => i.charter === "credit_union" && i.state === "FL" && i.id !== HOME.id).map((i) => i.id),
    },
    {
      kind: "wider",
      name: "Credit unions $7B to $12B",
      filters: { charter_type: "credit_union", advanced: { asset_min: 7_000_000_000, asset_max: 12_000_000_000 } },
      expected: ALL_INSTITUTIONS.filter((i) => i.charter === "credit_union" && i.id !== HOME.id && i.assetsThousands !== null
        && i.assetsThousands >= 7_000_000 && i.assetsThousands <= 12_000_000).map((i) => i.id),
    },
  ];

  for (const c of cases) {
    it(`gives the peer list, the benchmark and the report the same institutions (${c.kind} group)`, async () => {
      const id = Number(await savedPeers.savePeerSet(c.name, c.filters, USER, null));
      savedIds.push(id);
      const seen = await everywhere(id);
      const expected = [...c.expected].sort((a, b) => a - b);
      expect(expected.length).toBeGreaterThan(3);

      expect([...seen.membership.institutionIds].sort((a, b) => a - b)).toEqual(expected);
      expect(seen.listIds).toEqual(expected);
      expect(seen.totalMatches).toBe(expected.length);
      expect(seen.benchmark).toMatchObject({ status: "ready", source: "saved-peer-set", peerSetId: String(id), group: { institutionCount: expected.length } });
      expect(seen.benchmark?.status === "ready" ? [...(seen.benchmark.filters?.institutionIds ?? [])].sort((a, b) => a - b) : null).toEqual(expected);
      // Coverage may differ (a peer with no NSF line, one too thin for the catalog); membership may not.
      expect(seen.publishers && [...seen.publishers].every((pid) => expected.includes(Number(pid)))).toBe(true);
      expect(seen.publishers?.has(HOME.id)).toBe(false);
      for (const entry of seen.benchmark?.entries ?? []) expect(entry.institution_count).toBeLessThanOrEqual(expected.length);
    });
  }

  it("keeps a group that matches no institutions empty, with no list or benchmark in its place", async () => {
    const id = Number(await savedPeers.savePeerSet("Alaska credit unions", { charter_type: "credit_union", states: ["AK"] }, USER, null));
    savedIds.push(id);
    const seen = await everywhere(id);
    expect(seen.membership).toMatchObject({ status: "empty", institutionIds: [], filters: null });
    expect(seen.active).toMatchObject({ status: "empty", id, institutionName: HOME.name });
    const benchmark = await peerIndex.resolveHamiltonPeerIndex({ userId: USER, peerSetId: String(id), institutionId: HOME.id });
    expect(benchmark).toMatchObject({ status: "empty", entries: [], peerSetId: String(id) });
  });
});
