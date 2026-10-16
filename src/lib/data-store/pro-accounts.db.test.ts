/** Real PostgreSQL checks of the Pro institution fee view (#1078) in a loopback-only, temporary-table connection. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATLAS_PRIORITY_RUN_SOURCE, getProInstitutionCoverage } from "./pro-accounts";
import { PRIORITY_INSTITUTION_SOURCE } from "@/lib/agents/atlas/priority-institutions";

const connection = process.env.E2E_DATABASE_URL;

describe("Atlas's direct-run source", () => {
  it("matches the name Atlas records its runs under", () => {
    expect(ATLAS_PRIORITY_RUN_SOURCE).toBe(PRIORITY_INSTITUTION_SOURCE);
  });
});

describe.skipIf(!connection)("Pro institution fees SQL in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Pro institution SQL tests require a loopback E2E database; production connections are forbidden");
    db = postgres(connection, { max: 1, ssl: "require" });
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, institution_name text NOT NULL)`;
    await db`CREATE TEMP TABLE institution_workspace_memberships (id bigint, institution_id bigint, user_id bigint, membership_status text)`;
    await db`CREATE TEMP TABLE published_fee_catalog (id bigint, institution_id bigint)`;
    await db`CREATE TEMP TABLE agent_runs (id bigint, status text, started_at timestamptz, params_json jsonb)`;
    await db`INSERT INTO institution_sources VALUES (323, 'Capital City Bank'), (4956, 'Navy Federal Credit Union'), (21, 'Manufacturers and Traders Trust Company')`;
    await db`INSERT INTO institution_workspace_memberships VALUES (1, 323, 7, 'active'), (2, 323, 8, 'active'), (3, 4956, 9, 'active'), (4, 21, 10, 'revoked')`;
    await db`INSERT INTO published_fee_catalog VALUES (1, 323), (2, 4956), (3, 4956), (4, 4956), (5, 4956)`;
    await db`INSERT INTO agent_runs VALUES
      (1, 'completed', '2026-10-14T10:00:00Z', ${db.json({ source: ATLAS_PRIORITY_RUN_SOURCE, institution_id: "323" })}),
      (2, 'failed', '2026-10-15T10:00:00Z', ${db.json({ source: ATLAS_PRIORITY_RUN_SOURCE, institution_id: "323" })}),
      (3, 'completed', '2026-10-16T10:00:00Z', ${db.json({ source: "other", institution_id: "323" })})`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("lists active memberships only, fewest live fees first, with the newest Atlas direct run", async () => {
    const rows = await getProInstitutionCoverage(db as never);
    expect(rows).toEqual([
      { institutionId: 323, name: "Capital City Bank", members: 2, liveFees: 1, belowMinimum: true, lastAtlasRunAt: "2026-10-15T10:00:00.000Z", lastAtlasRunStatus: "failed" },
      { institutionId: 4956, name: "Navy Federal Credit Union", members: 1, liveFees: 4, belowMinimum: false, lastAtlasRunAt: null, lastAtlasRunStatus: null },
    ]);
  });
});
