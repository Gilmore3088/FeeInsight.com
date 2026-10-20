import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { restoreReadableCopies } from "./current-copy";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof restoreReadableCopies>[0];

/**
 * Magellan's readable-copy sweep against real PostgreSQL. Temporary tables shadow the page copies
 * and their texts, so the shipped SQL runs unchanged over controlled rows.
 */
describe.skipIf(!connection)("Current copy of a page in isolated PostgreSQL (#2477)", () => {
  let db: postgres.Sql;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Current-copy SQL tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require" });
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, institution_id bigint, document_url text,
      status text, duplicate_of_id bigint, superseded_by_id bigint, content_hash text, crawled_at timestamptz)`;
    await db`CREATE TEMP TABLE agent_source_texts (id bigint PRIMARY KEY, source_document_id bigint, status text,
      char_count int, source_hash text)`;
    await db`INSERT INTO source_documents VALUES
      (1, 7, 'https://bank.example/fees', 'success', NULL, 2, 'fee-schedule', '2026-09-01'),
      (2, 7, 'https://bank.example/fees', 'success', NULL, NULL, 'landing-page', '2026-10-01'),
      (11, 8, 'https://other.example/fees', 'success', NULL, 12, 'old-schedule', '2026-09-01'),
      (12, 8, 'https://other.example/fees', 'success', NULL, NULL, 'new-schedule', '2026-10-01')`;
    await db`INSERT INTO agent_source_texts VALUES
      (1, 1, 'completed', 9000, 'fee-schedule'),
      (2, 2, 'wrong_document', 6000, 'landing-page'),
      (11, 11, 'completed', 9000, 'old-schedule'),
      (12, 12, 'completed', 8000, 'new-schedule')`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("hands the place back from a copy Rosetta judged not a fee document, and keeps a readable current copy", async () => {
    const result = await restoreReadableCopies(db as unknown as Db, { dryRun: true });
    expect(result.thinCopies).toEqual([2]);
  });
});
