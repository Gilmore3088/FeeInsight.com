/**
 * Reader replay (#2069): a reader version bump reaches every current document an older primary
 * reader wrote, whatever its fee count, a bounded number per read step, once per version, and
 * never trades the earlier text for a thinner one.
 */
import { describe, expect, it, vi } from "vitest";
import { rosettaReadCandidatesQuery, runRosettaRead } from "./read";
import { JS_FALLBACK_STRATEGY } from "./js-fallback";
import { OCR_STRATEGY } from "./ocr";
import { READER_REPLAY_EVENT, READER_REPLAY_OWN_VERSIONS, READER_REPLAY_PER_RUN, READER_REPLAY_READERS, readerReplayDueSql, recordReaderReplay } from "./reader-replay";
import { ROSETTA_JS_FALLBACK_VERSION, ROSETTA_OCR_VERSION, ROSETTA_READ_VERSION } from "./reader-versions";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn>; begin?: unknown };

const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));
const LANE_MARKER = "AND EXISTS (\n      SELECT 1 FROM agent_source_texts replay_text";

function feeLines(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Service fee number ${i + 1} $${i + 5}.00 per item`);
}

describe("reader replay selection", () => {
  const select = (mode: "include" | "only" | "exclude" | undefined, currentCopy = true) =>
    rosettaReadCandidatesQuery(10, true, undefined, undefined, true, true, true, currentCopy, "exclude", mode);

  it("leaves older-reader documents out of the ordinary selection, so only the bounded lane takes them", () => {
    for (const { query, params } of [select(undefined), select("exclude")]) {
      expect(query).not.toContain("replay_text");
      expect(params).not.toContain(READER_REPLAY_EVENT);
    }
  });

  it("selects only due documents in its lane, with the text to beat and what the receipt reports", () => {
    const { query, params } = select("only");
    expect(query).toContain(LANE_MARKER);
    for (const column of ["reader_replay_due", "reader_replay_text", "reader_replay_text_hash", "reader_replay_reader", "reader_replay_from_version"]) {
      expect(query).toContain(`AS ${column}`);
    }
    expect(params).toContainEqual(READER_REPLAY_READERS);
    expect(params).toContain(READER_REPLAY_EVENT);
    expect(params).toContain(ROSETTA_READ_VERSION);
    expect(params).toContainEqual(READER_REPLAY_OWN_VERSIONS.map(({ reader }) => reader));
  });

  it("selects nothing in its lane without the current-copy columns", () => {
    const { query } = select("only", false);
    expect(query).not.toContain("replay_text");
    expect(query).toContain("AND FALSE");
  });

  it("has no fee-count threshold: a text that yielded many fees is due too", () => {
    const due = readerReplayDueSql("t", { readers: "$1", version: "$2", event: "$3" }, "TRUE");
    expect(due).not.toContain("raw_fee_observations");
    // Once per version: a receipt at the current version settles the document, whatever its outcome.
    expect(due).toContain("replayed.event_type = $3");
    expect(due).toContain("(replayed.detail->>'reader_version')::int >= $2::int");
    expect(due).toContain("t.reader IS NULL OR t.reader = ANY($1::text[])");
  });

  it("re-reads all: OCR and JavaScript-fallback texts below their own versions are due too, the paid pass never", () => {
    expect(READER_REPLAY_OWN_VERSIONS).toEqual([
      { reader: OCR_STRATEGY, version: ROSETTA_OCR_VERSION, receiptKey: "ocr_version" },
      { reader: JS_FALLBACK_STRATEGY, version: ROSETTA_JS_FALLBACK_VERSION, receiptKey: "js_fallback_version" },
    ]);
    const due = readerReplayDueSql("t", { readers: "$1", version: "$2", event: "$3" }, "TRUE");
    expect(due).toContain(`t.reader = '${OCR_STRATEGY}'`);
    expect(due).toContain(`own_read.strategy_version >= ${ROSETTA_OCR_VERSION}`);
    expect(due).toContain(`(replayed.detail->>'ocr_version')::int >= ${ROSETTA_OCR_VERSION}::int`);
    expect(due).toContain(`t.reader = '${JS_FALLBACK_STRATEGY}'`);
    expect(due).toContain(`(replayed.detail->>'js_fallback_version')::int >= ${ROSETTA_JS_FALLBACK_VERSION}::int`);
    expect(due).not.toContain("read.paid_transcribe");
    expect(READER_REPLAY_READERS).not.toContain("read.paid_transcribe");
  });

  it("lets an OCR or fallback replay past its bytes' scanned_pdf or js_required primary read", () => {
    const { query } = select("only");
    const failedRead = query.slice(query.indexOf("OR NOT EXISTS (\n           SELECT 1\n             FROM pipeline_attempts pa") - 400);
    expect(failedRead.slice(0, 400)).toContain("replay_text");
  });

  it("lets a replay through the current-copy rule when its link has a newer download", () => {
    const { query } = select("only");
    const newer = query.slice(query.indexOf("FROM source_documents newer"));
    const guard = newer.slice(0, newer.indexOf("OR profile.read_strategy IS NULL"));
    expect(guard).toContain("SELECT 1 FROM agent_source_texts replay_text");
    // The ordinary selection keeps the rule as it was.
    const ordinary = select("exclude").query;
    const ordinaryNewer = ordinary.slice(ordinary.indexOf("FROM source_documents newer"));
    expect(ordinaryNewer.slice(0, ordinaryNewer.indexOf("OR profile.read_strategy IS NULL"))).not.toContain("replay_text");
  });
});

describe("recordReaderReplay", () => {
  function receiptDb(current: { text_hash: string | null; status: string } | null) {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: text(strings), values });
      return Promise.resolve(text(strings).includes("SELECT text_hash") && current ? [current] : []);
    });
    return { db: db as unknown as Parameters<typeof recordReaderReplay>[0], calls };
  }
  const row = { source_document_id: 7, institution_id: 3, content_hash: "bytes", reader_replay_text_hash: "old", reader_replay_reader: null, reader_replay_from_version: 2 };

  it("records a changed text", async () => {
    const { db, calls } = receiptDb({ text_hash: "new", status: "completed" });
    const result = await recordReaderReplay(db, { runId: 1, stepId: 2 }, row, { status: "completed", attemptOutcome: "ok", reader: "read.pdf_layout" });
    expect(result.textChanged).toBe(true);
    const insert = calls.find((call) => call.sql.includes("INSERT INTO agent_run_events"))!;
    expect(insert.values[2]).toBe(READER_REPLAY_EVENT);
    expect(JSON.parse(String(insert.values[5]))).toMatchObject({
      reader_version: ROSETTA_READ_VERSION, ocr_version: ROSETTA_OCR_VERSION, js_fallback_version: ROSETTA_JS_FALLBACK_VERSION, from_reader: null, from_reader_version: 2, source_document_id: 7,
      source_hash: "bytes", old_text_hash: "old", new_text_hash: "new", text_changed: true,
    });
  });

  it("records a kept text and a failed read, so neither is replayed again at this version", async () => {
    const kept = receiptDb({ text_hash: "old", status: "completed" });
    expect((await recordReaderReplay(kept.db, { runId: 1, stepId: null }, row, { status: "completed", attemptOutcome: "ok" })).textChanged).toBe(false);
    const failed = receiptDb({ text_hash: "old", status: "completed" });
    expect((await recordReaderReplay(failed.db, { runId: 1, stepId: null }, row, { status: "failed", attemptOutcome: "timeout" })).textChanged).toBe(false);
    const insert = failed.calls.find((call) => call.sql.includes("INSERT INTO agent_run_events"))!;
    expect(insert.values[3]).toBe("skipped");
  });
});

describe("the read step's replay lane", () => {
  const oldText = feeLines(10).join("\n");
  const replayRow = (id: number) => ({
    source_document_id: id,
    institution_id: 40 + id,
    institution_name: `Replay Bank ${id}`,
    document_url: `https://replay${id}.example/fees`,
    content_hash: null,
    is_reread: true,
    reader_replay_due: true,
    reader_replay_text: oldText,
    reader_replay_text_hash: `old-${id}`,
    reader_replay_reader: null,
    reader_replay_from_version: null,
  });

  function laneDb(replays: Array<Record<string, unknown>>) {
    let written = false;
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = text(strings);
      if (sql.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (sql.includes("column_name = 'superseded_by_id'")) return Promise.resolve([{ ready: true }]);
      if (sql.includes("INSERT INTO agent_source_texts")) { written = true; return Promise.resolve([{ id: 901 }]); }
      if (sql.includes("SELECT text_hash, status FROM agent_source_texts")) {
        return Promise.resolve([{ text_hash: written ? "new" : `old-${String(values[0])}`, status: "completed" }]);
      }
      return Promise.resolve([]);
    }) as DbMock;
    db.unsafe = vi.fn((query: string, params: unknown[]) => {
      if (!query.includes("FROM source_documents")) return Promise.resolve([]);
      if (query.includes(LANE_MARKER)) return Promise.resolve(replays.slice(0, Number(params[0])));
      return Promise.resolve([]);
    });
    db.begin = vi.fn(async (work: (scope: DbMock) => Promise<unknown>) => work(db));
    return db;
  }
  const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof runRosettaRead>[0]["db"]>;
  const receipts = (db: DbMock) => db.mock.calls.filter((call) => text(call[0]).includes("INSERT INTO agent_run_events")
    && call.slice(1).includes(READER_REPLAY_EVENT));

  it("reads at most READER_REPLAY_PER_RUN a step and keeps a thinner new text", async () => {
    const db = laneDb(Array.from({ length: READER_REPLAY_PER_RUN + 3 }, (_, i) => replayRow(i + 1)));
    const thin = `<main><h1>Fees</h1><p>${feeLines(1)[0]}</p></main>`;
    const fetchImpl = vi.fn(async () => new Response(thin, { headers: { "content-type": "text/html" } }));
    const result = await runRosettaRead({ runId: 20, stepId: 3, db: asDb(db), fetchImpl, limit: 25 });

    const laneCall = db.unsafe.mock.calls.find((call) => String(call[0]).includes(LANE_MARKER))!;
    expect(laneCall[1][0]).toBe(READER_REPLAY_PER_RUN);
    expect(result.readerReplayed).toBe(READER_REPLAY_PER_RUN);
    expect(result.readerReplayTextChanged).toBe(0);
    expect(receipts(db)).toHaveLength(READER_REPLAY_PER_RUN);
    // The lost-text rule: no thinner text was stored.
    expect(db.mock.calls.some((call) => text(call[0]).includes("INSERT INTO agent_source_texts"))).toBe(false);
  });

  it("leaves no receipt for a scan deferred past this run's OCR allowance, so it stays due", async () => {
    const db = laneDb([{ ...replayRow(1), document_url: "https://replay1.example/scan.pdf" }]);
    const fetchImpl = vi.fn(async () => new Response(new TextEncoder().encode("%PDF-1.4 scan"), { headers: { "content-type": "application/pdf" } }));
    const reader = { read: vi.fn(async () => ({ text: "", pages: [], pageCount: 1, imagePages: 1, confidence: 90 })), close: vi.fn(async () => undefined) };
    const result = await runRosettaRead({
      runId: 22,
      db: asDb(db),
      fetchImpl,
      pdfTextExtractor: vi.fn(async () => ({ totalPages: 1, text: "" })),
      scannedPdfReader: reader,
      ocrDocumentsPerRun: 0,
      limit: 25,
    });
    expect(result).toMatchObject({ deferred: 1, readerReplayed: 0 });
    expect(reader.read).not.toHaveBeenCalled();
    expect(receipts(db)).toHaveLength(0);
  });

  it("stores a new text that lists at least as many fees and counts it as changed", async () => {
    const db = laneDb([replayRow(1)]);
    const rich = `<main><h1>Schedule of Fees</h1>${feeLines(12).map((line) => `<p>${line}</p>`).join("")}</main>`;
    const fetchImpl = vi.fn(async () => new Response(rich, { headers: { "content-type": "text/html" } }));
    const result = await runRosettaRead({ runId: 21, db: asDb(db), fetchImpl, limit: 25 });
    expect(result.readerReplayed).toBe(1);
    expect(result.readerReplayTextChanged).toBe(1);
    expect(db.mock.calls.some((call) => text(call[0]).includes("INSERT INTO agent_source_texts"))).toBe(true);
  });
});
