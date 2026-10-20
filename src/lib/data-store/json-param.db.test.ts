/**
 * #2004 in real PostgreSQL: a value sent as `${JSON.stringify(x)}::jsonb` through the app's
 * connection types is stored as `x`, whatever its kind. A lone number or string came back as a
 * JSON string ("1250000") because the json parameter serializer encoded the text a second time.
 * Loopback only, one temporary table.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "./connection";

const connection = process.env.E2E_DATABASE_URL;

describe.skipIf(!connection)("json parameters in isolated PostgreSQL (#2004)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("JSON parameter tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, {
      max: 1,
      ssl: "require",
      prepare: false,
      types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL },
    }) as unknown as typeof db;
    await db`CREATE TEMP TABLE json_param_check (k text PRIMARY KEY, value jsonb NOT NULL)`;
  });
  afterAll(async () => {
    if (db) await db.end();
  });

  const cases: [string, unknown, string][] = [
    ["number", 1250000, "number"],
    ["decimal", 0.35, "number"],
    ["string", "Acme Bank", "string"],
    ["numeric string", "1250000", "string"],
    ["true", true, "boolean"],
    ["null", null, "null"],
    ["object", { a: 1, b: ["x"] }, "object"],
    ["array", ["needs_darwin_verification"], "array"],
  ];

  it.each(cases)("stores a lone %s as itself", async (key, value, kind) => {
    await db`INSERT INTO json_param_check (k, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb)`;
    const [row] = await db<{ value: unknown; kind: string }[]>`
      SELECT value, jsonb_typeof(value) AS kind FROM json_param_check WHERE k = ${key}`;
    expect(row.kind).toBe(kind);
    expect(row.value).toEqual(value);
  });

  it("still stores plain text as a JSON string", async () => {
    await db`INSERT INTO json_param_check (k, value) VALUES ('plain', ${"hello"}::jsonb)`;
    const [row] = await db<{ value: unknown; kind: string }[]>`
      SELECT value, jsonb_typeof(value) AS kind FROM json_param_check WHERE k = 'plain'`;
    expect(row).toEqual({ value: "hello", kind: "string" });
  });
});
