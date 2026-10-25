/**
 * A reader version bump reaches every current document an older reader wrote (#2069), in real
 * PostgreSQL, loopback only, against the production schema: the read step's own selection query.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { rosettaReadCandidatesQuery } from "./read";
import { READER_REPLAY_EVENT } from "./reader-replay";
import { OCR_STRATEGY } from "./ocr";
import { ROSETTA_OCR_VERSION, ROSETTA_READ_VERSION } from "./reader-versions";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20690001, DOC = 20690101, RUN = 20690201;
const HASH = "hash-2069-bytes";
// Many fees: the thin re-read (under 5 fees sent to Darwin) never selects it.
const TEXT = Array.from({ length: 12 }, (_, i) => `Service fee ${i + 1} $${i + 5}.00`).join("\n");

describe.skipIf(!connection)("Rosetta replays older-reader documents on a reader version bump (#2069)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;

  async function selected(mode: "only" | "exclude"): Promise<number[]> {
    const { query, params } = rosettaReadCandidatesQuery(10, true, INST, undefined, false, false, true, true, "exclude", mode);
    const rows = await raw.unsafe(query, params as never[]);
    return rows.map((row) => Number(row.source_document_id));
  }

  async function clean() {
    await raw`DELETE FROM agent_run_events WHERE agent_run_id = ${RUN}`;
    await raw`DELETE FROM agent_runs WHERE id = ${RUN}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM pipeline_attempts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  async function readAt(version: number, outcome = "ok") {
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome)
              VALUES (${INST}, ${DOC}, 'read', 'read.pdf_layout', ${version}, ${HASH}, ${outcome})`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Reader replay DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });

  beforeEach(async () => {
    await clean();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${INST}, 'Replay Test Bank', 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://bank2069.test/fees.pdf', ${HASH}, '2026-10-01T00:00:00Z')`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text, text_hash, source_hash, reader, document_type, updated_at)
              VALUES (${DOC}, ${INST}, 'completed', ${TEXT}, 'text-hash-2069', ${HASH}, 'read.pdf_layout', 'pdf', '2026-10-02T00:00:00Z')`;
    await raw`INSERT INTO agent_runs (id, agent_name, run_kind, title, status) VALUES (${RUN}, 'rosetta', 'state_agent', 'Replay fixture', 'running')`;
    await readAt(ROSETTA_READ_VERSION - 1);
  });

  afterAll(async () => {
    if (raw) {
      await clean();
      await raw.end();
    }
  });

  it("selects an older-reader text with many fees in the replay lane only", async () => {
    expect(await selected("exclude")).toEqual([]);
    expect(await selected("only")).toEqual([DOC]);
    const { query, params } = rosettaReadCandidatesQuery(10, true, INST, undefined, false, false, true, true, "exclude", "only");
    const [row] = await raw.unsafe(query, params as never[]);
    expect(row).toMatchObject({ reader_replay_due: true, reader_replay_text: TEXT, reader_replay_text_hash: "text-hash-2069",
      reader_replay_reader: "read.pdf_layout", reader_replay_from_version: ROSETTA_READ_VERSION - 1 });
  });

  it("is settled by a read at the current version", async () => {
    await readAt(ROSETTA_READ_VERSION);
    expect(await selected("only")).toEqual([]);
  });

  it("is settled by its receipt at the current version, whatever the read's outcome", async () => {
    await readAt(ROSETTA_READ_VERSION, "timeout");
    expect(await selected("only")).toEqual([DOC]);
    await raw`INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
              VALUES (${RUN}, ${READER_REPLAY_EVENT}, 'skipped', 'fixture',
                      ${raw.json({ source_document_id: DOC, source_hash: HASH, reader_version: ROSETTA_READ_VERSION })})`;
    expect(await selected("only")).toEqual([]);
  });

  it("replays a copy whose link has a newer download, since its fees are still live", async () => {
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC + 1}, ${INST}, 'success', 'https://bank2069.test/fees-new.pdf', 'hash-2069-new', '2026-10-03T00:00:00Z')`;
    expect(await selected("exclude")).not.toContain(DOC);
    expect(await selected("only")).toContain(DOC);
  });

  it("replays an OCR text below the OCR version until an OCR read or receipt at that version", async () => {
    await readAt(ROSETTA_READ_VERSION, "scanned_pdf");
    await raw`UPDATE agent_source_texts SET reader = ${OCR_STRATEGY} WHERE source_document_id = ${DOC}`;
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome)
              VALUES (${INST}, ${DOC}, 'read', ${OCR_STRATEGY}, ${ROSETTA_OCR_VERSION - 1}, ${HASH}, 'ok')`;
    expect(await selected("only")).toEqual([DOC]);
    await raw`INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
              VALUES (${RUN}, ${READER_REPLAY_EVENT}, 'skipped', 'fixture',
                      ${raw.json({ source_document_id: DOC, source_hash: HASH, reader_version: ROSETTA_READ_VERSION, ocr_version: ROSETTA_OCR_VERSION })})`;
    expect(await selected("only")).toEqual([]);
  });

  it("leaves a superseded copy alone", async () => {
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC + 1}, ${INST}, 'success', 'https://bank2069.test/fees-new.pdf', 'hash-2069-new', '2026-10-03T00:00:00Z')`;
    await raw`UPDATE source_documents SET superseded_by_id = ${DOC + 1} WHERE id = ${DOC}`;
    expect(await selected("only")).not.toContain(DOC);
  });
});
