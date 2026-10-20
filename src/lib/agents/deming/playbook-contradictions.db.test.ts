/** Real PostgreSQL check of Deming's playbook contradiction check (#1105), on loopback-only temporary tables. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { runPlaybookContradictions } from "./playbook-contradictions";

const connection = process.env.E2E_DATABASE_URL;
type Db = NonNullable<Parameters<typeof runPlaybookContradictions>[0]>["db"];

describe.skipIf(!connection)("Deming playbook check in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Playbook check tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE agent_source_texts (id bigint PRIMARY KEY, status text, document_kind text)`;
    await db`CREATE TEMP TABLE institution_source_profiles (
      institution_id bigint PRIMARY KEY, canonical_source_url text, last_successful_text_id bigint,
      expected_fee_count integer, layout_fingerprint text,
      do_not_retry jsonb NOT NULL DEFAULT '[]', rejected_source_urls jsonb NOT NULL DEFAULT '[]')`;
    await db`INSERT INTO agent_source_texts VALUES (1, 'completed', 'fee_schedule'), (2, 'completed', 'product_page'), (3, 'completed', 'fee_schedule'), (4, 'failed', 'fee_schedule')`;
    const entry = (stage: string, strategy: string, outcome: string, fingerprint: string) => ({ stage, strategy, outcome, fingerprint, version: 1, at: "2026-10-09T00:00:00Z" });
    const rows = [
      // Space Coast's shape: the second-document search failed from its current link. Not a contradiction.
      { id: 8109, url: "https://a.example/Fee-Schedule.pdf", text: 3, expected: 30, layout: null, dnr: [entry("discover", "discover.second_document", "wrong_document", "https://a.example/Fee-Schedule.pdf")], rejected: [] },
      { id: 2, url: "https://b.example/fees.pdf", text: 3, expected: 30, layout: "x", dnr: [entry("fetch", "fetch.http", "too_large", "https://b.example/fees.pdf")], rejected: [] },
      { id: 3, url: "https://c.example/fees", text: 3, expected: 30, layout: "x", dnr: [entry("discover", "discover.link_check", "wrong_document", "https://c.example/fees")], rejected: ["https://c.example/fees"] },
      { id: 4, url: "https://d.example/fees", text: 1, expected: 2, layout: "x", dnr: [], rejected: [] },
      { id: 5, url: "https://e.example/checking", text: 2, expected: 20, layout: "x", dnr: [], rejected: [] },
      // A failed text is no current text: no kind check, no layout count.
      { id: 6, url: "https://f.example/fees", text: 4, expected: 1, layout: null, dnr: [], rejected: [] },
      { id: 7, url: null, text: null, expected: null, layout: null, dnr: "not an array", rejected: {} },
    ];
    for (const row of rows) {
      await db`INSERT INTO institution_source_profiles
        (institution_id, canonical_source_url, last_successful_text_id, expected_fee_count, layout_fingerprint, do_not_retry, rejected_source_urls)
        VALUES (${row.id}, ${row.url}, ${row.text}, ${row.expected}, ${row.layout}, ${JSON.stringify(row.dnr)}::jsonb, ${JSON.stringify(row.rejected)}::jsonb)`;
    }
  });
  afterAll(async () => { if (db) await db.end(); });

  it("counts each contradiction, reports search-from entries apart, and changes no row", async () => {
    const before = await db`SELECT * FROM institution_source_profiles ORDER BY institution_id`;
    const result = await runPlaybookContradictions({ db: db as unknown as Db });
    expect(result).toMatchObject({
      ready: true,
      profiles: 7,
      institutions: 4,
      counts: { source_rejected: 1, source_unfetchable: 1, source_judged_wrong: 1, schedule_expects_few: 1, product_page_expects_many: 1 },
      samples: { source_rejected: [3], source_unfetchable: [2], source_judged_wrong: [3], schedule_expects_few: [4], product_page_expects_many: [5] },
      searchFromEntries: 1,
      layoutNeverRecorded: 1,
    });
    expect(await db`SELECT * FROM institution_source_profiles ORDER BY institution_id`).toEqual(before);
  });
});
