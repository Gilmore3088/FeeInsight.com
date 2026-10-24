import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";

import type { DocumentVault } from "@/lib/agents/document-vault";
import {
  LAYOUT_RECHECK_EVENT,
  LAYOUT_RECHECK_PER_RUN,
  LAYOUT_RECHECK_VERSION,
  classifyFee,
  layoutRecheckQuery,
  runLayoutRecheck,
  type LayoutRecheckCandidate,
  type LayoutRecheckFeeRow,
} from "./layout-recheck";
import { PDF_LAYOUT_VERSION } from "./reader-versions";
import type { PdfTextExtraction } from "./pdf-document-text";

const pdfBytes = new TextEncoder().encode("%PDF-1.7\n% layout recheck fixture\n");
const sourceHash = createHash("sha256").update(pdfBytes).digest("hex");
const vaultKey = `${sourceHash.slice(0, 2)}/${sourceHash}`;

// Enough readable prose that the reader does not take the page for a scan.
const PREAMBLE = "Schedule of Fees\nThese charges apply to personal deposit accounts opened with the credit union and are subject to change with notice to members as required by law and by the account agreement for each account.\n";
const OLD_TEXT = PREAMBLE + "Stop Payment $30.00\nWire Transfer Outgoing Domestic $25.00\nOverdraft | Returned Item | Fee per item";
const NEW_TEXT = PREAMBLE + "Stop Payment $30.00\nWire Transfer Outgoing Domestic | Overdraft Fee $35.00\nReturned Item Fee per item";

function candidate(overrides: Partial<LayoutRecheckCandidate> = {}): LayoutRecheckCandidate {
  return {
    source_text_id: 9001,
    source_document_id: 501,
    institution_id: 42,
    source_hash: sourceHash,
    text_hash: createHash("sha256").update(OLD_TEXT).digest("hex"),
    read_layout_version: 1,
    live_fees: 3,
    document_url: "https://bank.example/fees.pdf",
    document_r2_key: vaultKey,
    content_type: "application/pdf",
    normalized_text: OLD_TEXT,
    ...overrides,
  };
}

function fee(id: number, name: string, amount: number, key: string): LayoutRecheckFeeRow {
  return {
    fee_published_id: id, published_amount: amount, canonical_fee_key: key, verified_amount: amount,
    fee_name: name, amount, source_document_id: 501, amount_kind: "flat", rate_percent: null,
    product_name: null, outlier_flags: [],
  };
}
const FEES = [
  fee(1, "Stop Payment", 30, "stop_payment"),
  fee(2, "Wire Transfer Outgoing Domestic", 25, "wire_domestic_outgoing"),
  fee(3, "Overdraft Fee", 35, "overdraft"),
];

type Call = { text: string; values: unknown[] };
function fakeDb(rows: LayoutRecheckCandidate[], fees: LayoutRecheckFeeRow[] = FEES) {
  const calls: Call[] = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("FROM raw_fee_observations r")) return fees;
    return [];
  }) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(async () => rows);
  return { db: db as never, calls, unsafe: db.unsafe };
}

function vault(bytes: Uint8Array = pdfBytes): DocumentVault {
  return { configured: true, read: vi.fn(async () => bytes), store: vi.fn(), presign: vi.fn() } as unknown as DocumentVault;
}
const extractor = (text: string) => vi.fn(async (): Promise<PdfTextExtraction> => ({ text, totalPages: 1 }));

const writes = (calls: Call[]) => calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/i.test(call.text));
const receipt = (calls: Call[]) => {
  const insert = calls.find((call) => call.text.includes("INSERT INTO agent_run_events"));
  if (!insert) throw new Error("no receipt");
  return { eventType: insert.values[2], status: insert.values[3], detail: JSON.parse(String(insert.values[5])) };
};

describe("layout recheck selection", () => {
  it("skips texts already receipted for this text hash at the current layout and protocol", () => {
    const { query, params } = layoutRecheckQuery(LAYOUT_RECHECK_PER_RUN);
    expect(params.slice(0, 5)).toEqual([LAYOUT_RECHECK_PER_RUN, "read.pdf_layout", PDF_LAYOUT_VERSION, LAYOUT_RECHECK_EVENT, LAYOUT_RECHECK_VERSION]);
    expect(query).toContain("receipted AS MATERIALIZED");
    expect(query).toMatch(/e\.event_type = \$4[\s\S]*pdf_layout_version' = \$3::text[\s\S]*protocol_version' = \$5::text/);
    expect(query).toMatch(/rc\.source_text_id = adt\.id::text AND rc\.text_hash = adt\.text_hash/);
  });

  it("keeps current copies with vault bytes below the current layout and ranks by live fees", () => {
    const { query } = layoutRecheckQuery(3);
    expect(query).toContain("cr.superseded_by_id IS NULL AND cr.duplicate_of_id IS NULL");
    expect(query).toContain("cr.document_r2_key = left(cr.content_hash, 2) || '/' || cr.content_hash");
    expect(query).toContain("cr.content_hash = adt.source_hash");
    expect(query).toMatch(/COALESCE\(MAX\(COALESCE\(\(pa\.detail->>'pdf_layout'\)::int, 1\)\), 1\)/);
    expect(query).toContain("WHERE read_layout.version < $3");
    expect(query).toContain("p.rolled_back_at IS NULL AND p.quarantined_at IS NULL");
    expect(query).toContain("ORDER BY live.live_fees DESC");
  });

  it("scopes to the run's institution or state like the other read selections", () => {
    const one = layoutRecheckQuery(3, { institutionId: 77 });
    expect(one.params).toContain(77);
    expect(one.query).toContain("AND adt.institution_id = $6");
    const state = layoutRecheckQuery(3, { stateCode: "tx" });
    expect(state.params).toContain("TX");
    expect(state.query).toContain("upper(btrim(ct.state_code)) = $6");
  });
});

describe("layout recheck", () => {
  it("does nothing without a configured vault", async () => {
    const { db, calls, unsafe } = fakeDb([candidate()]);
    const result = await runLayoutRecheck(db, { runId: 1, vault: null, pdfTextExtractor: extractor(OLD_TEXT) });
    expect(result).toMatchObject({ ready: false, selected: 0 });
    expect(unsafe).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("records an unchanged text as text_changed false with every fee supported both ways", async () => {
    const { db, calls } = fakeDb([candidate()], [FEES[0]]);
    const result = await runLayoutRecheck(db, { runId: 7, stepId: 8, vault: vault(), pdfTextExtractor: extractor(OLD_TEXT) });
    expect(result).toMatchObject({ ready: true, selected: 1, rechecked: 1, textChanged: 0, supportedBoth: 1, lost: 0, gained: 0 });
    const event = receipt(calls);
    expect(event.eventType).toBe(LAYOUT_RECHECK_EVENT);
    expect(event.status).toBe("completed");
    expect(event.detail).toMatchObject({
      protocol_version: LAYOUT_RECHECK_VERSION, outcome: "compared", source_text_id: 9001, source_document_id: 501,
      institution_id: 42, read_layout_version: 1, pdf_layout_version: PDF_LAYOUT_VERSION, text_changed: false,
      counts: { supported_both: 1, lost: 0, gained: 0, unsupported_both: 0 }, reader_disagreements: null,
    });
    expect(writes(calls)).toHaveLength(1);
  });

  it("classifies lost and gained fees on a changed text with the shared source check", async () => {
    // The shared check itself: wire traces in the old text only, overdraft in the new text only.
    expect(classifyFee(OLD_TEXT, NEW_TEXT, FEES[0])).toBe("supported_both");
    expect(classifyFee(OLD_TEXT, NEW_TEXT, FEES[1])).toBe("lost");
    expect(classifyFee(OLD_TEXT, NEW_TEXT, FEES[2])).toBe("gained");
    expect(classifyFee("Nothing here", "Nothing here either", FEES[2])).toBe("unsupported_both");

    const { db, calls } = fakeDb([candidate()]);
    const pdfTextExtractor = vi.fn(async (): Promise<PdfTextExtraction> => ({
      text: NEW_TEXT, totalPages: 1,
      readerAgreement: { version: 1, textHash: createHash("sha256").update(NEW_TEXT).digest("hex"), compared: 3, disagreementCount: 2, disagreements: [] },
    }));
    const result = await runLayoutRecheck(db, { runId: 7, vault: vault(), pdfTextExtractor });
    expect(result).toMatchObject({ rechecked: 1, textChanged: 1, supportedBoth: 1, lost: 1, gained: 1, unsupportedBoth: 0 });
    const { detail } = receipt(calls);
    expect(detail.text_changed).toBe(true);
    expect(detail.counts).toEqual({ supported_both: 1, lost: 1, gained: 1, unsupported_both: 0 });
    expect(detail.reader_disagreements).toBe(2);
    // Lost first, then gained, for sampling.
    expect(detail.examples.map((example: { fee_published_id: number; class: string }) => [example.fee_published_id, example.class]))
      .toEqual([[2, "lost"], [3, "gained"], [1, "supported_both"]]);
    expect(writes(calls)).toHaveLength(1);
  });

  it("records an unavailable receipt and compares nothing when the vault bytes do not match", async () => {
    const { db, calls } = fakeDb([candidate()]);
    const pdfTextExtractor = extractor(NEW_TEXT);
    const result = await runLayoutRecheck(db, {
      runId: 7, vault: vault(new TextEncoder().encode("%PDF-1.7\n% other bytes\n")), pdfTextExtractor,
    });
    expect(result).toMatchObject({ selected: 1, rechecked: 0, notCompared: 1, lost: 0, gained: 0 });
    expect(pdfTextExtractor).not.toHaveBeenCalled();
    expect(calls.some((call) => call.text.includes("FROM raw_fee_observations"))).toBe(false);
    const event = receipt(calls);
    expect(event.status).toBe("skipped");
    expect(event.detail).toMatchObject({ outcome: "unavailable", byte_identity: "mismatch", text_changed: null });
    expect(writes(calls)).toHaveLength(1);
  });

  it("never downloads when the vault read fails", async () => {
    const broken = { configured: true, read: vi.fn(async () => { throw new Error("vault down"); }), store: vi.fn(), presign: vi.fn() } as unknown as DocumentVault;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { db, calls } = fakeDb([candidate()]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runLayoutRecheck(db, { runId: 7, vault: broken, pdfTextExtractor: extractor(NEW_TEXT) });
    consoleError.mockRestore();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(result.notCompared).toBe(1);
    expect(receipt(calls).detail.outcome).toBe("unavailable");
  });

  it("writes only one event per document and nothing else", async () => {
    const { db, calls } = fakeDb([candidate(), candidate({ source_text_id: 9002, source_document_id: 502 })]);
    await runLayoutRecheck(db, { runId: 7, vault: vault(), pdfTextExtractor: extractor(NEW_TEXT) });
    const written = writes(calls);
    expect(written).toHaveLength(2);
    for (const call of written) expect(call.text).toMatch(/^\s*INSERT INTO agent_run_events \(/);
    expect(calls.map((call) => call.text).join("\n")).not.toMatch(/agent_source_texts|pipeline_attempts|published_fee_records\s+SET/);
  });
});

describe("read step wiring", () => {
  it("reports zero rechecks and runs no recheck query on a dry run", async () => {
    const { runRosettaRead } = await import("./read");
    const db = vi.fn(async () => []) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe = vi.fn(async () => []);
    const result = await runRosettaRead({ runId: 1, dryRun: true, db: db as never, vault: vault(), pdfTextExtractor: extractor(OLD_TEXT) });
    expect(result).toMatchObject({ layoutRechecked: 0, layoutRecheckNotCompared: 0, layoutRecheckTextChanged: 0, layoutRecheckLost: 0, layoutRecheckGained: 0, layoutRecheckError: null });
    expect(db.unsafe.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain("receipted AS MATERIALIZED");
  });
});
