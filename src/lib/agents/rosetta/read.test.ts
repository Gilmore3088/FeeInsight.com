import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";

import { runRosettaRead } from "./read";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn(() => Promise.resolve([])) as DbMock;
  db.unsafe = vi.fn((query: string) => {
    if (query.includes("FROM source_documents")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
  return db;
}

function asReadDb(db: DbMock): NonNullable<Parameters<typeof runRosettaRead>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runRosettaRead>[0]["db"]>;
}

function response(body: BodyInit, contentType = "text/html", status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

const htmlCandidate = {
  source_document_id: 501,
  institution_id: 42,
  institution_name: "Test Bank",
  document_url: "https://testbank.example/fees",
  content_hash: "source-hash",
};

describe("Rosetta agentic read", () => {
  it("normalizes fetched HTML into an internal text artifact", async () => {
    const body = `
      <main>
        <h1>Schedule of Fees</h1>
        <p>Monthly maintenance fee $5</p>
        <script>window.noise = true</script>
      </main>
    `;
    const db = createDbMock([htmlCandidate]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(body));

    const result = await runRosettaRead({
      runId: 101,
      limit: 500,
      db: asReadDb(db),
      fetchImpl,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      completed: 1,
      empty: 0,
      needsOcr: 0,
      failed: 0,
      skipped: 0,
      limit: 50,
      dryRun: false,
    });
    expect(result.results[0]).toMatchObject({
      sourceDocumentId: 501,
      institutionId: 42,
      status: "completed",
      documentType: "html",
      textHash: createHash("sha256")
        .update("Schedule of Fees\n\nMonthly maintenance fee $5")
        .digest("hex"),
    });

    const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(sqlText).toContain("INSERT INTO agent_source_texts");
    expect(JSON.stringify(db.mock.calls)).toContain("Monthly maintenance fee $5");
    expect(JSON.stringify(db.mock.calls)).not.toContain("window.noise");
  });

  it("keeps dry runs read-only while still reporting normalized text", async () => {
    const db = createDbMock([htmlCandidate]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response("<p>Overdraft fee $35</p>"));

    const result = await runRosettaRead({
      runId: 102,
      dryRun: true,
      db: asReadDb(db),
      fetchImpl,
    });

    expect(result.completed).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(db.unsafe).toHaveBeenCalledTimes(1);
    expect(db).not.toHaveBeenCalled();
  });

  it("extracts embedded PDF text into an internal text artifact", async () => {
    const db = createDbMock([
      {
        ...htmlCandidate,
        source_document_id: 502,
        document_url: "https://testbank.example/schedule-of-fees.pdf",
      },
    ]);
    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(pdfBytes, "application/pdf"));
    const pdfText = `Schedule of Fees\n\nMonthly maintenance fee $7\n\n${"Overdraft fee $35 per item. ".repeat(10).trim()}`;
    const pdfTextExtractor = vi.fn().mockResolvedValueOnce({
      totalPages: 1,
      text: pdfText,
    });

    const result = await runRosettaRead({
      runId: 103,
      db: asReadDb(db),
      fetchImpl,
      pdfTextExtractor,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      completed: 1,
      needsOcr: 0,
      failed: 0,
    });
    expect(result.results[0]).toMatchObject({
      sourceDocumentId: 502,
      status: "completed",
      documentType: "pdf",
      charCount: pdfText.length,
      textHash: createHash("sha256").update(pdfText).digest("hex"),
      error: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(pdfTextExtractor).toHaveBeenCalledWith(pdfBytes);

    const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(sqlText).toContain("INSERT INTO agent_source_texts");
    expect(JSON.stringify(db.mock.calls)).toContain("Monthly maintenance fee $7");
  });

  it("routes scanned PDFs to OCR after embedded text extraction is empty", async () => {
    const db = createDbMock([
      {
        ...htmlCandidate,
        source_document_id: 503,
        document_url: "https://testbank.example/scanned-fees.pdf",
      },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(new Uint8Array([37, 80, 68, 70]), "application/pdf"));
    const pdfTextExtractor = vi.fn().mockResolvedValueOnce({
      totalPages: 4,
      text: " \n \n",
    });

    const result = await runRosettaRead({
      runId: 104,
      db: asReadDb(db),
      fetchImpl,
      pdfTextExtractor,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      completed: 0,
      needsOcr: 1,
      failed: 0,
    });
    expect(result.results[0]).toMatchObject({
      sourceDocumentId: 503,
      status: "needs_ocr",
      documentType: "pdf",
      error: "No embedded PDF text found across 4 pages; OCR required",
    });
  });

  it("records visible failures when PDF text extraction errors", async () => {
    const db = createDbMock([
      {
        ...htmlCandidate,
        source_document_id: 504,
        document_url: "https://testbank.example/broken-fees.pdf",
      },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(new Uint8Array([37, 80, 68, 70]), "application/pdf"));
    const pdfTextExtractor = vi.fn().mockRejectedValueOnce(new Error("invalid xref"));

    const result = await runRosettaRead({
      runId: 105,
      db: asReadDb(db),
      fetchImpl,
      pdfTextExtractor,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      completed: 0,
      needsOcr: 0,
      failed: 1,
    });
    expect(result.results[0]).toMatchObject({
      sourceDocumentId: 504,
      status: "failed",
      documentType: "pdf",
      error: "PDF text extraction failed: invalid xref",
    });
  });

  it("records failed reads for non-OK source responses", async () => {
    const db = createDbMock([htmlCandidate]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response("missing", "text/html", 404));

    const result = await runRosettaRead({
      runId: 106,
      db: asReadDb(db),
      fetchImpl,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      completed: 0,
      failed: 1,
    });
    expect(result.results[0]).toMatchObject({
      status: "failed",
      error: "HTTP 404",
    });

    const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(sqlText).toContain("INSERT INTO agent_source_texts");
  });

  it("filters read candidates by state lane and source profile strategy", async () => {
    const db = createDbMock([]);
    const fetchImpl = vi.fn();

    await runRosettaRead({
      runId: 107,
      stateCode: "OR",
      db: asReadDb(db),
      fetchImpl,
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("upper(btrim(ct.state_code))");
    expect(unsafeSql).toContain("institution_source_profiles");
    expect(unsafeSql).toContain("profile.read_strategy IN ('pdf_text', 'html_dom')");
  });

  describe("with the learning core", () => {
    function learningDb(rows: Array<Record<string, unknown>>): DbMock {
      const db = vi.fn((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("INSERT INTO agent_source_texts")) return Promise.resolve([{ id: 801 }]);
        return Promise.resolve([]);
      }) as DbMock;
      db.unsafe = vi.fn((query: string) => {
        if (query.includes("FROM source_documents")) return Promise.resolve(rows);
        return Promise.resolve([]);
      });
      return db;
    }

    function attemptValues(db: DbMock): unknown[][] {
      return db.mock.calls
        .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
        .map((call) => call.slice(1));
    }

    it("reads a PDF served as octet-stream from an extensionless URL as a PDF", async () => {
      const db = learningDb([{ ...htmlCandidate, document_url: "https://testbank.example/download?id=7" }]);
      const bytes = new TextEncoder().encode("%PDF-1.4 binary");
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(bytes, "application/octet-stream"));
      const text = "Overdraft fee $35 per item. ".repeat(12);
      const pdfTextExtractor = vi.fn().mockResolvedValueOnce({ totalPages: 1, text });

      const result = await runRosettaRead({ runId: 301, stepId: 9, db: asReadDb(db), fetchImpl, pdfTextExtractor });

      expect(pdfTextExtractor).toHaveBeenCalledTimes(1);
      expect(result.results[0]).toMatchObject({
        status: "completed",
        documentType: "pdf",
        strategy: "read.pdf_text",
        format: "pdf_text",
        attemptOutcome: "ok",
      });
      expect(result).toMatchObject({ learning: true, outcomes: { ok: 1 } });
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining([42, 501, "read", "read.pdf_text", "source-hash", "ok", 301, 9]));
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).toContain("UPDATE institution_source_profiles");
      expect(JSON.stringify(db.mock.calls)).toContain('"pdf_text"');
    });

    it("marks a PDF with only a header line per page as a scan", async () => {
      const db = learningDb([htmlCandidate]);
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(new TextEncoder().encode("%PDF-1.4"), "application/pdf"));
      const pdfTextExtractor = vi.fn().mockResolvedValueOnce({
        totalPages: 3,
        text: "First Bank Fee Schedule Page 1\nPage 2\nPage 3",
      });

      const result = await runRosettaRead({ runId: 302, db: asReadDb(db), fetchImpl, pdfTextExtractor });

      expect(result).toMatchObject({ needsOcr: 1, completed: 0, outcomes: { scanned_pdf: 1 } });
      expect(result.results[0]).toMatchObject({ status: "needs_ocr", format: "pdf_scanned" });
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining(["read", "scanned_pdf"]));
    });

    it("excludes known failures and already-read bytes in candidate SQL", async () => {
      const db = learningDb([]);

      await runRosettaRead({ runId: 303, db: asReadDb(db), fetchImpl: vi.fn() });

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("FROM pipeline_attempts pa");
      expect(query).toContain("pa.outcome = ANY(");
      expect(query).toContain("adt.source_hash = cr.content_hash");
      expect(query).toContain("profile.do_not_retry");
      expect(params).toContainEqual(expect.arrayContaining(["scanned_pdf", "parse_error"]));
    });

    it("skips an input the playbook says already failed with this reader version", async () => {
      const db = learningDb([
        {
          ...htmlCandidate,
          do_not_retry: [
            { stage: "read", strategy: "read.html_text", version: 1, fingerprint: "source-hash", outcome: "js_required", at: "2026-09-01T00:00:00Z" },
          ],
        },
      ]);
      const fetchImpl = vi.fn().mockResolvedValueOnce(response("<div id=app></div>"));

      const result = await runRosettaRead({ runId: 304, db: asReadDb(db), fetchImpl });

      expect(result).toMatchObject({ skippedKnownFailures: 1, completed: 0, failed: 0 });
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).not.toContain("INSERT INTO agent_source_texts");
      expect(attemptValues(db)).toHaveLength(0);
    });

    it("records Word documents as unsupported instead of reading them as text", async () => {
      const db = learningDb([htmlCandidate]);
      const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("word/document.xml")]);
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(docx, "application/octet-stream"));

      const result = await runRosettaRead({ runId: 305, db: asReadDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ status: "failed", documentType: "docx", attemptOutcome: "unsupported_format" });
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining(["read", "unsupported_format"]));
    });
  });

  describe("with the document vault and fee-page check", () => {
    const vaultKey = `ab/${"ab".repeat(32)}`;
    const feeText = ["Schedule of fees", "Overdraft fee $35.00", "NSF fee $35.00", "Stop payment fee $30.00"].join("\n");

    function vaultDb(rows: Array<Record<string, unknown>>, triageRows: Array<Record<string, unknown>> = []): DbMock {
      const db = vi.fn((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("vault_schema_ready")) return Promise.resolve([{ vault_schema_ready: true }]);
        if (text.includes("INSERT INTO agent_source_texts")) return Promise.resolve([{ id: 801 }]);
        if (text.includes("UPDATE institution_sources inst")) return Promise.resolve([{ id: 42 }]);
        return Promise.resolve([]);
      }) as DbMock;
      db.unsafe = vi.fn((query: string) => {
        if (query.includes("FROM source_documents")) return Promise.resolve(rows);
        if (query.includes("has_knox_fees")) return Promise.resolve(triageRows);
        return Promise.resolve([]);
      });
      return db;
    }

    function fakeVault(bytes: Uint8Array) {
      return { configured: true, store: vi.fn(), read: vi.fn(async () => bytes), presign: vi.fn() };
    }

    it("reads our stored copy instead of downloading again", async () => {
      const html = `<table>${feeText.split("\n").map((line) => `<tr><td>${line}</td></tr>`).join("")}</table>`;
      const db = vaultDb([{ ...htmlCandidate, document_r2_key: vaultKey, stored_content_type: "text/html" }]);
      const vault = fakeVault(new TextEncoder().encode(html));
      const fetchImpl = vi.fn();

      const result = await runRosettaRead({ runId: 601, db: asReadDb(db), fetchImpl, vault });

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(vault.read).toHaveBeenCalledWith(vaultKey);
      expect(result).toMatchObject({ completed: 1, readFromVault: 1, wrongDocuments: 0 });
      expect(result.results[0].pageCheck).toMatchObject({ verdict: "fee_page" });
    });

    it("marks a homepage as wrong_document and sends the bank back to Magellan", async () => {
      const db = vaultDb([htmlCandidate]);
      const fetchImpl = vi.fn().mockResolvedValueOnce(response("<p>Welcome to Test Bank</p><p>Fee Schedule | Privacy</p>"));

      const result = await runRosettaRead({ runId: 602, db: asReadDb(db), fetchImpl, vault: fakeVault(new Uint8Array()) });

      expect(result).toMatchObject({ completed: 0, wrongDocuments: 1, sentBackToMagellan: 1, outcomes: { wrong_document: 1 } });
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).toContain("rejected_source_urls = COALESCE(rejected_source_urls");
      expect(sqlText).toContain("SET fee_schedule_url = NULL");
      expect(sqlText).toContain("locked_by_correction IS TRUE");
      expect(JSON.stringify(db.mock.calls)).toContain('"wrong_document"');
    });

    it("re-checks earlier texts without downloading, sparing ones Knox found fees in", async () => {
      const db = vaultDb([], [
        { text_id: 1, source_document_id: 11, institution_id: 42, source_url: "https://a.example", text_hash: "h1", normalized_text: "Welcome home", has_knox_fees: false },
        { text_id: 2, source_document_id: 12, institution_id: 43, source_url: "https://b.example", text_hash: "h2", normalized_text: "Welcome home", has_knox_fees: true },
        { text_id: 3, source_document_id: 13, institution_id: 44, source_url: "https://c.example", text_hash: "h3", normalized_text: feeText, has_knox_fees: false },
      ]);

      const result = await runRosettaRead({ runId: 603, db: asReadDb(db), fetchImpl: vi.fn(), vault: fakeVault(new Uint8Array()) });

      expect(result).toMatchObject({ triagedTexts: 3, triagedWrongDocuments: 1, sentBackToMagellan: 1 });
      const statusUpdates = db.mock.calls.filter((call) => templateText(call[0]).includes("SET status = 'wrong_document'"));
      expect(statusUpdates).toHaveLength(1);
      expect(statusUpdates[0]).toEqual(expect.arrayContaining([1]));
    });
  });
});
