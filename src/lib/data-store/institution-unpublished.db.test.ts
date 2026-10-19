// @vitest-environment node
/** Executes the actual institution reader's unpublished-count CTE using only loopback temp tables. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({ query: "", values: [] as unknown[] }));
vi.mock("./connection", () => ({
  sql: (parts: TemplateStringsArray, ...values: unknown[]) => {
    capture.query = parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    capture.values = values;
    return Promise.resolve([]);
  },
}));
import { getInstitutionById } from "./core";

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
  });
});
