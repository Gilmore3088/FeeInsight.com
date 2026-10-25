/**
 * Deming's error classes (#2063) in real PostgreSQL, loopback only, against the production schema:
 * the grouping query. Rows other suites left behind are excluded by comparing only this suite's
 * own pattern keys.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { readErrorClasses } from "./error-classes";

const connection = process.env.E2E_DATABASE_URL;
const BANKS = [20630001, 20630002, 20630003];
const DOC = 20630101;
// A category no other suite uses, so its counts are this suite's alone.
const KEY = "test_2063_category";
type Db = Parameters<typeof readErrorClasses>[0];

describe.skipIf(!connection)("error classes in isolated PostgreSQL (#2063)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let n = 0;

  async function feedback(stage: string, kind: string, institution: number, extra: {
    feePublishedId?: number | null; reportedBy?: string; weight?: number; daysAgo?: number; signal?: string; key?: string | null; documentId?: number;
  } = {}) {
    n += 1;
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, source_document_id, fee_published_id,
                                             canonical_fee_key, weight, dedupe_key, created_at)
              VALUES (${stage}, ${extra.signal ?? "wrong"}, ${kind}, ${extra.reportedBy ?? "hamilton"}, 'hamilton.category_guard:v1', ${institution},
                      ${extra.documentId ?? null}, ${"feePublishedId" in extra ? extra.feePublishedId ?? null : 2063000 + n}, ${extra.key === undefined ? KEY : extra.key}, ${extra.weight ?? 1},
                      ${`test2063:${n}`}, NOW() - make_interval(days => ${extra.daysAgo ?? 1}::int))`;
  }

  async function clean() {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ANY(${BANKS})`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id = ${DOC}`;
    await raw`DELETE FROM source_documents WHERE id = ${DOC}`;
    await raw`DELETE FROM institution_sources WHERE id = ANY(${BANKS})`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Error class DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await clean();
    for (const id of BANKS) {
      await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${id}, ${`Class Test ${id}`}, 'bank', 'fdic', 'TX')`;
    }
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${BANKS[0]}, 'success', 'https://bank2063.test/fees.pdf', 'hash-2063', NOW())`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text, text_hash, source_hash, reader, document_type, document_kind)
              VALUES (${DOC}, ${BANKS[0]}, 'completed', 'Fee schedule', 'text-2063', 'hash-2063', 'read.test_2063', 'pdf', 'product_page')`;
  });

  afterAll(async () => {
    if (raw) {
      await clean();
      await raw.end();
    }
  });

  it("groups confirmed errors by stage, kind and pattern, and lists only those at two or more banks", async () => {
    // A class: the same category error at three banks, one bank twice.
    await feedback("extract", "wrong_category", BANKS[0]);
    await feedback("extract", "wrong_category", BANKS[0]);
    await feedback("extract", "wrong_category", BANKS[1]);
    await feedback("extract", "wrong_category", BANKS[2]);
    // The same errors at verify are Darwin's class, not Knox's.
    await feedback("verify", "wrong_category", BANKS[0]);
    await feedback("verify", "wrong_category", BANKS[1]);
    // Not confirmed or not counted: a pre-publish reject with no live fee, a weight-0 record, a right
    // signal, and a row older than the week.
    await feedback("extract", "wrong_category", BANKS[1], { feePublishedId: null, reportedBy: "darwin" });
    await feedback("extract", "wrong_category", BANKS[2], { weight: 0 });
    await feedback("extract", "wrong_category", BANKS[2], { signal: "right" });
    await feedback("extract", "wrong_category", BANKS[2], { daysAgo: 9 });
    // One bank only: counted, not listed.
    await feedback("extract", "wrong_amount", BANKS[0]);
    // A person's hold with no fee key, on a read document: its pattern is the reader's layout.
    await feedback("read", "admin_hold", BANKS[0], { reportedBy: "human", feePublishedId: null, key: null, documentId: DOC });
    await feedback("read", "admin_hold", BANKS[1], { reportedBy: "human", feePublishedId: null, key: null, documentId: DOC });

    const summary = await readErrorClasses(raw as unknown as Db);
    const mine = summary.classes.filter((cls) => cls.pattern.includes("2063"));
    expect(mine.map((cls) => [cls.key, cls.owner, cls.banks, cls.rows])).toEqual([
      [`extract:wrong_category:category:${KEY}`, "knox", 3, 4],
      ["read:admin_hold:layout:read.test_2063/pdf", "rosetta", 2, 2],
      [`verify:wrong_category:category:${KEY}`, "darwin", 2, 2],
    ]);
    const extract = mine[0];
    expect(extract.checks).toEqual(["hamilton.category_guard"]);
    expect(extract.exampleInstitutions).toEqual(BANKS);
    expect(extract.fees).toBe(4);
    expect(summary.oneBankPatterns).toBeGreaterThanOrEqual(1);
  });
});
