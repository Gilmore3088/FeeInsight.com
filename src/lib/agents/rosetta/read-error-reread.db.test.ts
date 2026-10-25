/**
 * A reader version bump re-reads the documents a read error names (#2059), in real PostgreSQL,
 * loopback only, against the production schema: the read step's own selection query.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { DOCUMENT_KIND_VERSION } from "@/lib/agents/learning/document-kind";
import { rosettaReadCandidatesQuery } from "./read";
import { ROSETTA_READ_VERSION } from "./reader-versions";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20590001, DOC = 20590101;
const HASH = "hash-2059-bytes";
// A product page is exempt from the thin re-reads, and a text with lines is not a flat legacy one,
// so only a read error can select it.
const TEXT = "OTHER SERVICES\nStop Payment Fee $35.00\nWire Transfer $25.00";
const TEXT_HASH = "text-hash-2059";

describe.skipIf(!connection)("Rosetta re-reads a document with a read error on a reader version bump (#2059)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;

  async function selected(): Promise<number[]> {
    const { query, params } = rosettaReadCandidatesQuery(10, true, INST, undefined, false, false, true, false);
    const rows = await raw.unsafe(query, params as never[]);
    return rows.map((row) => Number(row.source_document_id));
  }

  async function clean() {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    await raw`DELETE FROM pipeline_attempts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  async function readAt(version: number) {
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome)
              VALUES (${INST}, ${DOC}, 'read', 'read.pdf_layout', ${version}, ${HASH}, 'ok')`;
  }

  async function readError(createdAt: string, textHash?: string) {
    const evidence = textHash ? { text_hash: textHash } : {};
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, source_document_id, dedupe_key, created_at, evidence)
              VALUES ('read', 'wrong', 'admin_hold', 'human', 'admin.fee_hold', ${INST}, ${DOC}, ${`test2059:${createdAt}`}, ${createdAt}, ${raw.json(evidence)})`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Read-error re-read DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });

  beforeEach(async () => {
    await clean();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${INST}, 'Reread Test Bank', 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://bank2059.test/fees.pdf', ${HASH}, '2026-10-01T00:00:00Z')`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text, text_hash, source_hash, reader, document_type,
                                              document_kind, document_kind_version, updated_at)
              VALUES (${DOC}, ${INST}, 'completed', ${TEXT}, ${TEXT_HASH}, ${HASH}, 'read.pdf_layout', 'pdf', 'product_page', ${DOCUMENT_KIND_VERSION}, '2026-10-02T00:00:00Z')`;
    await readAt(ROSETTA_READ_VERSION - 1);
  });

  afterAll(async () => {
    if (raw) {
      await clean();
      await raw.end();
    }
  });

  it("leaves a settled text alone when no read error names it", async () => {
    expect(await selected()).toEqual([]);
  });

  it("reads a text with a read error again once its reader version is older than the current one", async () => {
    await readError("2026-10-05T00:00:00Z");
    expect(await selected()).toEqual([DOC]);
    // The current text is kept unless the new reader's text lists as many fees.
    const { query, params } = rosettaReadCandidatesQuery(10, true, INST, undefined, false, false, true, false);
    expect((await raw.unsafe(query, params as never[]))[0].last_lost_text).toBe(TEXT);
    // Read by the current reader: settled until the next bump.
    await readAt(ROSETTA_READ_VERSION);
    expect(await selected()).toEqual([]);
  });

  it("keeps an error that names the text's hash open through a re-read that writes the same text", async () => {
    await readError("2026-10-05T00:00:00Z", TEXT_HASH);
    // The same text written again later: still the text the error is about.
    await raw`UPDATE agent_source_texts SET updated_at = '2026-10-10T00:00:00Z' WHERE source_document_id = ${DOC}`;
    expect(await selected()).toEqual([DOC]);
    // A different text settles it, whenever it was written.
    await raw`UPDATE agent_source_texts SET text_hash = 'text-hash-2059-new', updated_at = '2026-10-03T00:00:00Z' WHERE source_document_id = ${DOC}`;
    expect(await selected()).toEqual([]);
  });

  it("matches a correction by the lost text's document in its evidence, not by the document it cites", async () => {
    // A correction's own document is the one its new value came from.
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, source_document_id, dedupe_key, created_at, evidence)
              VALUES ('read', 'wrong', 'admin_correction', 'human', 'admin.fee_correction', ${INST}, NULL, 'test2059:correction', '2026-10-05T00:00:00Z',
                      ${raw.json({ lost_text_document_id: DOC, text_hash: TEXT_HASH })})`;
    expect(await selected()).toEqual([DOC]);
    await raw`UPDATE pipeline_feedback SET evidence = ${raw.json({ lost_text_document_id: DOC + 1, text_hash: TEXT_HASH })}, source_document_id = ${DOC}
               WHERE dedupe_key = 'test2059:correction'`;
    expect(await selected()).toEqual([]);
  });

  it("ignores an error recorded before the current text was written, which was about an earlier text", async () => {
    await readError("2026-09-20T00:00:00Z");
    expect(await selected()).toEqual([]);
  });
});
