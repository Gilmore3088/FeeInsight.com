// @vitest-environment node
/** Executes the actual institution reader's unpublished-count CTE using only loopback temp tables. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({ query: "", values: [] as unknown[] }));
vi.mock("./connection", () => ({
  sql: Object.assign((parts: TemplateStringsArray, ...values: unknown[]) => {
    capture.query = parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    capture.values = values;
    return Promise.resolve([]);
  }, { unsafe: (query: string, values: unknown[] = []) => {
    capture.query = query;
    capture.values = values;
    return Promise.resolve(/SELECT COUNT\(\*\) as cnt\s+FROM institution_sources ct/.test(query) ? [{ cnt: 0 }] : []);
  } }),
}));
import { getInstitutionById } from "./core";
import { getInstitutionFeeScheduleEvidence } from "./institution";
import { getLargestInstitutions } from "./search";
import { getDataTrustQueueRows, searchInstitutions } from "../admin-queries";

async function unpublishedCte() {
  await getInstitutionById(101);
  const end = capture.query.indexOf("raw_unverified_counts AS");
  expect(end).toBeGreaterThan(0);
  const prefix = capture.query.slice(0, end).trim().replace(/,$/, "");
  const parameters = Math.max(...[...prefix.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
  return { text: `${prefix} SELECT institution_id, verified_unpublished_fee_count FROM verified_unpublished_counts`, values: capture.values.slice(0, parameters) };
}

it("bounds unpublished publication lookup to the verified row's institution (#2351)", async () => {
  const query = await unpublishedCte();
  expect(query.text).toContain("pfc.institution_id = fv.institution_id");
  expect(query.values).toEqual([101, 101]);
});

interface CountQuery { label: string; text: string; values: unknown[] }
let otherQueries: Promise<CountQuery[]> | undefined;
function remainingCountQueries(): Promise<CountQuery[]> {
  return otherQueries ??= (async () => {
    const queries: CountQuery[] = [];
    await getInstitutionFeeScheduleEvidence(101);
    const alias = capture.query.indexOf(") AS verified_without_published_count");
    const countStart = capture.query.lastIndexOf("SELECT COUNT(*)::int", alias);
    expect(alias).toBeGreaterThan(countStart);
    const values: unknown[] = [];
    const statement = capture.query.slice(countStart, alias).replace(/\$(\d+)/g, (_match, index: string) => {
      values.push(capture.values[Number(index) - 1]); return `$${values.length}`;
    });
    queries.push({ label: "institution source evidence", text: `SELECT (${statement}) AS count`, values });
    for (const [label, read] of [
      ["admin institution quality", () => searchInstitutions(undefined, 1, 10)],
      ["admin data trust queue", () => getDataTrustQueueRows()],
      ["public multi-institution search", () => getLargestInstitutions({ limit: 2 })],
    ] as const) {
      await read();
      const body = /verified_unpublished_counts AS \(([\s\S]*?)\n\s*\),/.exec(capture.query)?.[1];
      expect(body, label).toBeDefined();
      const countColumn = label === "admin data trust queue" ? "verified_without_published_count" : "verified_unpublished_fee_count";
      // Execute each reader's actual count CTE; scoped aliases include both test institutions.
      const text = `WITH scope_catalog AS (SELECT * FROM published_fee_catalog), scope_verified AS (SELECT * FROM verified_fee_observations WHERE review_status <> 'rejected'), verified_unpublished_counts AS (${body}) SELECT COALESCE((SELECT ${countColumn} FROM verified_unpublished_counts WHERE institution_id = 101), 0) AS count`;
      queries.push({ label, text, values: [] });
    }
    return queries;
  })();
}

it("bounds every remaining catalog anti-join to the verified row's institution (#2375)", async () => {
  for (const query of await remainingCountQueries()) {
    expect(query.text, query.label).toContain("pfc.institution_id = fv.institution_id");
  }
});

const connection = process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("actual unpublished-count SQL lineage in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Institution lineage SQL tests require loopback; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    await db`CREATE TEMP TABLE verified_fee_observations (institution_id bigint, fee_verified_id bigint, review_status text)`;
    await db`CREATE TEMP TABLE published_fee_catalog (institution_id bigint, fee_verified_id bigint, review_status text)`;
    await db`INSERT INTO verified_fee_observations VALUES (101, 1, 'approved')`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it.each([
    ["another institution's publication", 102, "approved", 1],
    ["its own approved publication", 101, "approved", 0],
    ["its own provisional publication", 101, "pending", 0],
    ["its own rejected publication", 101, "rejected", 1],
  ] as const)("counts unpublished rows correctly beside %s", async (_label, institutionId, reviewStatus, expected) => {
    await db`TRUNCATE pg_temp.published_fee_catalog`;
    await db`INSERT INTO published_fee_catalog VALUES (${institutionId}, 1, ${reviewStatus})`;
    const query = await unpublishedCte();
    const rows = await db.unsafe(query.text, query.values as never[]);
    expect(Number(rows[0]?.verified_unpublished_fee_count ?? 0)).toBe(expected);
    for (const other of await remainingCountQueries()) {
      const counts = await db.unsafe(other.text, other.values as never[]);
      expect(Number(counts[0]?.count ?? 0), other.label).toBe(expected);
    }
  });
});
