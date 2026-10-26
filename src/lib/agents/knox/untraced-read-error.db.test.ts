/**
 * Untraced held lines go back to Rosetta as possible reading errors (#1102), in real PostgreSQL,
 * loopback only, against the production schema: Knox's report, then Rosetta's own read selection.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { DOCUMENT_KIND_VERSION } from "@/lib/agents/learning/document-kind";
import { rosettaReadCandidatesQuery } from "@/lib/agents/rosetta/read";
import { ROSETTA_READ_VERSION } from "@/lib/agents/rosetta/reader-versions";
import { reportUntracedToRosetta, UNTRACED_READ_ERROR_CHECK, UNTRACED_READ_ERROR_KIND } from "./untraced-read-error";

const connection = process.env.E2E_DATABASE_URL;
const INST = 11020001, DOC = 11020101;
const HASH = "hash-1102-bytes";
// A product page is exempt from the thin re-reads, and a text with lines is not a flat legacy one,
// so only a read error can select it.
const TEXT = "SAFE DEPOSIT BOXES\nAnnual Fees\nEach | $40.00\nStop Payment Fee $35.00";
const TEXT_HASH = "text-hash-1102";
const EVENT = "00000000-0000-4000-8000-000000001102";

describe.skipIf(!connection)("Knox sends untraced held lines to Rosetta as possible reading errors (#1102)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  type Db = Parameters<typeof reportUntracedToRosetta>[0];
  const db = () => raw as unknown as Db;

  async function selected(): Promise<number[]> {
    const { query, params } = rosettaReadCandidatesQuery(10, true, INST, undefined, false, false, true, false);
    const rows = await raw.unsafe(query, params as never[]);
    return rows.map((row) => Number(row.source_document_id));
  }

  async function clean() {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    await raw`DELETE FROM pipeline_attempts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  async function readAt(version: number) {
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome)
              VALUES (${INST}, ${DOC}, 'read', 'read.pdf_layout', ${version}, ${HASH}, 'ok')`;
  }

  async function held(name: string, versions: number, options: { textHash?: string; flags?: string[] } = {}) {
    const flags = ["knox_review:untraced", ...Array.from({ length: versions }, (_, i) => `knox_untraced_recheck:extract.rules:v${120 + i}`), ...(options.flags ?? [])];
    const note = `Knox held for review (untraced) from Rosetta artifact #1. canonical_hint=safe_deposit_box; text_hash=${options.textHash ?? TEXT_HASH}; excerpt="Each | $40.00"`;
    await raw`INSERT INTO raw_fee_observations (institution_id, source_document_id, source_url, extraction_confidence, fee_name, amount, extraction_note, outlier_flags, source, agent_event_id)
              VALUES (${INST}, ${DOC}, 'https://bank1102.test/fees.pdf', 0.5, ${name}, 40, ${note}, ${JSON.stringify(flags)}::jsonb, 'knox', ${EVENT})`;
  }

  async function reports() {
    return raw`SELECT check_name, kind, signal, about_stage, reported_by, weight, source_document_id, evidence
                 FROM pipeline_feedback WHERE institution_id = ${INST} AND check_name = ${UNTRACED_READ_ERROR_CHECK}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Untraced read-error DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });

  beforeEach(async () => {
    await clean();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${INST}, 'Untraced Test Bank', 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://bank1102.test/fees.pdf', ${HASH}, '2026-10-01T00:00:00Z')`;
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

  it("reports nothing for lines the re-check has read under fewer than 3 rules versions, or that left the pile", async () => {
    await held("Safe Deposit Box Annual Fees: Each", 2);
    await held("Safe Deposit Box 3x5", 3, { flags: ["needs_darwin_verification"] });
    await held("Safe Deposit Box 5x5", 3, { flags: ["superseded_by_reread"] });
    await held("Safe Deposit Box 10x10", 3, { textHash: "an-older-text" });
    const result = await reportUntracedToRosetta(db(), { runId: null });
    expect(result).toMatchObject({ ready: true, candidates: 0, reported: 0 });
    expect(await reports()).toHaveLength(0);
    expect(await selected()).toEqual([]);
  });

  it("counts on a dry run and writes nothing", async () => {
    await held("Safe Deposit Box Annual Fees: Each", 3);
    await held("Safe Deposit Box Annual Fees: Large", 4);
    const result = await reportUntracedToRosetta(db(), { runId: null, dryRun: true });
    expect(result).toMatchObject({ ready: true, dryRun: true, candidates: 1, candidateLines: 2, institutions: 1, reported: 1, reportedLines: 2 });
    expect(await reports()).toHaveLength(0);
    expect(await selected()).toEqual([]);
  });

  it("writes one read error per text, once, and Rosetta reads the document again at the current reader", async () => {
    await held("Safe Deposit Box Annual Fees: Each", 3);
    await held("Safe Deposit Box Annual Fees: Large", 3);
    expect(await selected()).toEqual([]);

    const result = await reportUntracedToRosetta(db(), { runId: null });
    expect(result).toMatchObject({ candidates: 1, candidateLines: 2, reported: 1 });
    const [row, ...rest] = await reports();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ kind: UNTRACED_READ_ERROR_KIND, signal: "wrong", about_stage: "read", reported_by: "knox", weight: 0.5 });
    expect(Number(row.source_document_id)).toBe(DOC);
    const evidence = typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence;
    expect(evidence).toMatchObject({ text_hash: TEXT_HASH, untraced_lines: 2 });

    // Reported once: the next step finds nothing new.
    expect(await reportUntracedToRosetta(db(), { runId: null })).toMatchObject({ candidates: 0, reported: 0 });

    // Rosetta's selection takes the document, and keeps its text unless the new one lists as many fees.
    expect(await selected()).toEqual([DOC]);
    const { query, params } = rosettaReadCandidatesQuery(10, true, INST, undefined, false, false, true, false);
    expect((await raw.unsafe(query, params as never[]))[0].last_lost_text).toBe(TEXT);

    // Read by the current reader: settled until the next reader version.
    await readAt(ROSETTA_READ_VERSION);
    expect(await selected()).toEqual([]);
  });

  it("settles when the text changes, and a new text with lines still untraced gets its own report", async () => {
    await held("Safe Deposit Box Annual Fees: Each", 3);
    await reportUntracedToRosetta(db(), { runId: null });
    expect(await selected()).toEqual([DOC]);
    await raw`UPDATE agent_source_texts SET text_hash = 'text-hash-1102-new' WHERE source_document_id = ${DOC}`;
    expect(await selected()).toEqual([]);
    await held("Safe Deposit Box Annual Fees: Small", 3, { textHash: "text-hash-1102-new" });
    expect(await reportUntracedToRosetta(db(), { runId: null })).toMatchObject({ candidates: 1, reported: 1 });
    expect(await reports()).toHaveLength(2);
    expect(await selected()).toEqual([DOC]);
  });
});
