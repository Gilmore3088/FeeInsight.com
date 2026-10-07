import { createHash } from "crypto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { runKnoxExtract } from "../knox/extract";
import {
  REREAD_MAX_KNOX_FEES,
  ROSETTA_READ_MAX_LIMIT,
  ROSETTA_READ_VERSION,
  STUCK_LINK_MAX_FAILURES,
  STUCK_LINK_OUTCOMES,
  STUCK_LINK_WINDOW_DAYS,
  runRosettaRead,
} from "./read";
import { ROSETTA_OCR_VERSION } from "./ocr";

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
      limit: ROSETTA_READ_MAX_LIMIT,
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

  it("strips NUL characters, which Postgres text columns reject", async () => {
    const body = "<main><h1>Schedule\u0000 of Fees</h1><p>Overdraft fee\u0000 $30</p></main>";
    const db = createDbMock([htmlCandidate]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(body));

    const result = await runRosettaRead({ runId: 102, limit: 5, db: asReadDb(db), fetchImpl });

    expect(result.results[0]).toMatchObject({ status: "completed" });
    const values = JSON.stringify(db.mock.calls);
    expect(values).toContain("Schedule of Fees");
    expect(values).toContain("Overdraft fee $30");
    expect(values).not.toContain("\\u0000");
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

  it("strips NUL characters from PDF text before it is stored", async () => {
    const db = createDbMock([
      {
        ...htmlCandidate,
        source_document_id: 503,
        document_url: "https://testbank.example/fees-with-nul.pdf",
      },
    ]);
    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(pdfBytes, "application/pdf"));
    const cleanText = `Schedule of Fees\n\n${"Overdraft fee $35 per item. ".repeat(10).trim()}`;
    const pdfTextExtractor = vi.fn().mockResolvedValueOnce({
      totalPages: 1,
      text: cleanText.replace("Overdraft", "Over\u0000draft").replace("Schedule", "\u0000Schedule"),
    });

    const result = await runRosettaRead({ runId: 104, db: asReadDb(db), fetchImpl, pdfTextExtractor });

    expect(result.results[0]).toMatchObject({
      status: "completed",
      charCount: cleanText.length,
      textHash: createHash("sha256").update(cleanText).digest("hex"),
    });
    const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO agent_source_texts"));
    expect(insert).toBeDefined();
    const storedText = insert!.slice(1).find((value) => typeof value === "string" && value.startsWith("Schedule of Fees"));
    expect(storedText).toBe(cleanText);
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
      error: expect.stringContaining("No embedded PDF text found across 4 pages; OCR required"),
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
    expect(unsafeSql).toContain("profile.read_strategy IN ('pdf_text', 'html_dom', 'ocr', 'browser_render')");
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
        strategy: "read.pdf_layout",
        format: "pdf_text",
        attemptOutcome: "ok",
      });
      expect(result).toMatchObject({ learning: true, outcomes: { ok: 1 } });
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining([42, 501, "read", "read.pdf_layout", "source-hash", "ok", 301, 9]));
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
            { stage: "read", strategy: "read.html_dom", version: ROSETTA_READ_VERSION, fingerprint: "source-hash", outcome: "js_required", at: "2026-09-01T00:00:00Z" },
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

    it("reads a reopened page once although the playbook still lists its earlier failure", async () => {
      const db = learningDb([
        {
          ...htmlCandidate,
          reopen_pending: true,
          do_not_retry: [
            { stage: "read", strategy: "read.html_dom", version: ROSETTA_READ_VERSION, fingerprint: "source-hash", outcome: "wrong_document", at: "2026-09-01T00:00:00Z" },
          ],
        },
      ]);
      const body = "<h1>Schedule of Fees</h1><table><tr><td>Overdraft fee</td><td>$35.00</td></tr><tr><td>Stop payment</td><td>$30.00</td></tr></table>";
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(body));

      const result = await runRosettaRead({ runId: 305, db: asReadDb(db), fetchImpl });

      expect(result.skippedKnownFailures).toBe(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(attemptValues(db).length).toBeGreaterThan(0);
      const selection = db.unsafe.mock.calls.find((call) => String(call[0]).includes("FROM source_documents"));
      expect(String(selection?.[0])).toContain("AS reopen_pending");
    });

    it("reads a fee table so Knox can pair each fee with its amount", async () => {
      const db = learningDb([htmlCandidate]);
      const body = `
        <h1>Schedule of Fees</h1>
        <table>
          <tr><th>Service</th><th>Fee</th></tr>
          <tr><td>Overdraft fee</td><td>$35.00 per item</td></tr>
          <tr><td>Stop payment</td><td>$30.00</td></tr>
          <tr><td>Outgoing domestic wire</td><td>$25.00</td></tr>
        </table>`;
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(body));

      const result = await runRosettaRead({ runId: 306, db: asReadDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ status: "completed", strategy: "read.html_dom", tableRows: 4 });
      expect(result.tableRows).toBe(4);
      const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO agent_source_texts"));
      const normalizedText = insert?.slice(1).find((value) => typeof value === "string" && value.includes("Overdraft")) as string;
      expect(normalizedText).toContain("Overdraft fee | $35.00 per item");

      // The same text handed to Knox now yields fees; tag stripping split every row in two.
      const knoxDb = vi.fn(() => Promise.resolve([{ fee_raw_id: 1 }])) as DbMock;
      knoxDb.unsafe = vi.fn((query: string) =>
        Promise.resolve(
          query.includes("FROM agent_source_texts")
            ? [{ document_text_id: 801, source_document_id: 501, institution_id: 42, source_url: null, text_hash: "t", normalized_text: normalizedText }]
            : [],
        ),
      );
      const knox = await runKnoxExtract({
        runId: 307,
        dryRun: true,
        db: knoxDb as unknown as NonNullable<Parameters<typeof runKnoxExtract>[0]["db"]>,
      });
      expect(knox.results[0].candidates.map((candidate) => [candidate.feeName, candidate.amount])).toEqual([
        ["Overdraft fee", 35],
        ["Stop payment", 30],
        ["Outgoing domestic wire", 25],
      ]);
    });

    it("re-reads older texts Knox found few or no fees in, newest documents first", async () => {
      const db = learningDb([]);

      await runRosettaRead({ runId: 308, db: asReadDb(db), fetchImpl: vi.fn() });

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("AS is_reread");
      expect(query).toContain("FROM pipeline_attempts current_read");
      expect(query).toContain("current_read.strategy_version >= $");
      expect(query).toContain("current_read.outcome = ANY(");
      expect(query).toContain("fr.source_document_id = adt.source_document_id");
      expect(query).toContain("ORDER BY is_reread ASC");
      expect(query).toMatch(/SELECT COUNT\(\*\) FROM raw_fee_observations fr[\s\S]*\) < \$\d+/);
      expect(params).toContain(ROSETTA_READ_VERSION);
      expect(params).toContain(REREAD_MAX_KNOX_FEES);
    });

    it("binds every candidate-SQL placeholder to a parameter of the type it is used as", async () => {
      // A drifted `$${params.length - k}` once cast REREAD_MAX_KNOX_FEES to text[] and made
      // every read fail with "operator does not exist: bigint < text[]".
      const db = learningDb([]);

      await runRosettaRead({ runId: 309, db: asReadDb(db), fetchImpl: vi.fn() });

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      const valueAt = (placeholder: string) => params[Number(placeholder) - 1];
      for (const [, n] of query.matchAll(/\$(\d+)::text\[\]/g)) {
        expect(Array.isArray(valueAt(n))).toBe(true);
      }
      for (const [, n] of query.matchAll(/strategy_version (?:=|>=) \$(\d+)/g)) {
        expect(typeof valueAt(n)).toBe("number");
      }
      for (const [, n] of query.matchAll(/\) < \$(\d+)/g)) {
        expect(valueAt(n)).toBe(REREAD_MAX_KNOX_FEES);
      }
    });

    it("keeps the earlier text when a re-read fails", async () => {
      const db = learningDb([{ ...htmlCandidate, is_reread: true }]);
      const fetchImpl = vi.fn().mockResolvedValueOnce(response("gone", "text/html", 503));

      const result = await runRosettaRead({ runId: 309, db: asReadDb(db), fetchImpl });

      expect(result).toMatchObject({ failed: 1, reread: 1 });
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).not.toContain("INSERT INTO agent_source_texts");
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining(["read", "http_5xx"]));
    });

    it("reads a Word document's text and table rows for free", async () => {
      const docxBytes = (body: string) =>
        zipSync({ "word/document.xml": strToU8(`<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`) });
      const db = learningDb([htmlCandidate]);
      const fee = (name: string, amount: string) =>
        `<w:tr><w:tc><w:p><w:r><w:t>${name}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${amount}</w:t></w:r></w:p></w:tc></w:tr>`;
      const docx = docxBytes(`<w:tbl>${fee("Overdraft fee", "$35.00")}${fee("NSF fee", "$35.00")}${fee("Stop payment fee", "$30.00")}</w:tbl>`);
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));

      const result = await runRosettaRead({ runId: 306, db: asReadDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ status: "completed", documentType: "docx", reader: "read.docx_text", tableRows: 3 });
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining(["read", "read.docx_text", "ok"]));
    });

    it("records a file that is not a readable .docx as unsupported instead of reading it as text", async () => {
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

    function vaultDb(
      rows: Array<Record<string, unknown>>,
      triageRows: Array<Record<string, unknown>> = [],
      blockedBefore = false,
      reopenRows: Array<Record<string, unknown>> = [],
    ): DbMock {
      const db = vi.fn((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("AS blocked")) return Promise.resolve([{ blocked: blockedBefore }]);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("vault_schema_ready")) return Promise.resolve([{ vault_schema_ready: true }]);
        if (text.includes("INSERT INTO agent_source_texts")) return Promise.resolve([{ id: 801 }]);
        if (text.includes("UPDATE institution_sources inst")) return Promise.resolve([{ id: 42 }]);
        if (text.includes("UPDATE institution_source_profiles")) return Promise.resolve([{ institution_id: 42 }]);
        return Promise.resolve([]);
      }) as DbMock;
      db.unsafe = vi.fn((query: string) => {
        if (query.includes("FROM source_documents")) return Promise.resolve(rows);
        if (query.includes("has_knox_fees")) return Promise.resolve(triageRows);
        if (query.includes("FROM agent_source_texts adt")) return Promise.resolve(reopenRows);
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

      // The fallback finds no script-built fee page either; a page with its own text is not
      // "JavaScript required" (that would hand it to the paid finder as a script page).
      expect(result).toMatchObject({ completed: 0, wrongDocuments: 1, sentBackToMagellan: 1, outcomes: { wrong_document: 2 } });
      expect(result.outcomes.js_required).toBeUndefined();
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).toContain("WHERE entry->>'url' IS DISTINCT FROM");
      expect(sqlText).toContain("SET fee_schedule_url = NULL");
      expect(sqlText).toContain("locked_by_correction IS TRUE");
      expect(JSON.stringify(db.mock.calls)).toContain('"wrong_document"');
    });

    it("sends a bank whose link is gone (HTTP 404) back to Magellan, only while that link is current", async () => {
      const db = vaultDb([htmlCandidate]);
      const fetchImpl = vi.fn().mockResolvedValue(response("Not found", "text/html", 404));

      const result = await runRosettaRead({ runId: 604, db: asReadDb(db), fetchImpl, vault: fakeVault(new Uint8Array()) });

      expect(result).toMatchObject({ failed: 1, sentBackToMagellan: 1, outcomes: { http_404: 1 } });
      const clear = db.mock.calls.find((call) => templateText(call[0]).includes("SET fee_schedule_url = NULL"));
      expect(clear).toEqual(expect.arrayContaining(["rosetta_dead_link", true, htmlCandidate.document_url]));
    });

    it("reads only a bank's current document, and never re-downloads a dead link", async () => {
      const db = vaultDb([]);

      await runRosettaRead({ runId: 607, db: asReadDb(db), fetchImpl: vi.fn(), vault: fakeVault(new Uint8Array()) });

      const query = String(db.unsafe.mock.calls.find((call) => String(call[0]).includes("FROM source_documents"))?.[0]);
      // A newer download replaces this one; a newer failed download does too when we hold no copy.
      expect(query).toContain("FROM source_documents newer");
      expect(query).toContain("(newer.status = 'success' AND newer.duplicate_of_id IS DISTINCT FROM cr.id)");
      expect(query).toContain("(newer.status = 'failed' AND cr.document_r2_key IS NULL)");
      // A link that already came back gone is not fetched again unless the vault has the bytes.
      expect(query).toMatch(/cr\.document_r2_key IS NULL\s+AND EXISTS \(\s+SELECT 1\s+FROM pipeline_attempts dead/);
      expect(query).toContain("dead.outcome IN ('http_404', 'http_410')");
    });

    it("keeps a link that blocked us once, and sends it back when the block repeats", async () => {
      const blocked = () => vi.fn().mockResolvedValue(response("Forbidden", "text/html", 403));

      const first = vaultDb([htmlCandidate]);
      const once = await runRosettaRead({ runId: 605, db: asReadDb(first), fetchImpl: blocked(), vault: fakeVault(new Uint8Array()) });
      expect(once).toMatchObject({ failed: 1, sentBackToMagellan: 0 });

      const repeat = vaultDb([htmlCandidate], [], true);
      const twice = await runRosettaRead({ runId: 606, db: asReadDb(repeat), fetchImpl: blocked(), vault: fakeVault(new Uint8Array()) });
      expect(twice).toMatchObject({ failed: 1, sentBackToMagellan: 1 });
    });

    it("sends a link back after repeated timeouts, and stops downloading it for a week", async () => {
      const timedOut = () => vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

      const early = vaultDb([htmlCandidate]);
      const first = await runRosettaRead({ runId: 609, db: asReadDb(early), fetchImpl: timedOut(), vault: fakeVault(new Uint8Array()) });
      expect(first).toMatchObject({ failed: 1, sentBackToMagellan: 0 });
      const check = early.mock.calls.find((call) => templateText(call[0]).includes("AS blocked"));
      expect(check).toEqual(expect.arrayContaining([STUCK_LINK_MAX_FAILURES, STUCK_LINK_OUTCOMES, STUCK_LINK_WINDOW_DAYS]));

      const stuck = vaultDb([htmlCandidate], [], true);
      const last = await runRosettaRead({ runId: 610, db: asReadDb(stuck), fetchImpl: timedOut(), vault: fakeVault(new Uint8Array()) });
      expect(last).toMatchObject({ failed: 1, sentBackToMagellan: 1 });

      const selection = early.unsafe.mock.calls.find((call) => String(call[0]).includes("FROM source_documents"));
      const query = String(selection?.[0]);
      expect(query).toContain("FROM pipeline_attempts stuck");
      expect(selection?.[1]).toEqual(expect.arrayContaining([STUCK_LINK_OUTCOMES, STUCK_LINK_MAX_FAILURES, STUCK_LINK_WINDOW_DAYS]));
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

    it("reopens a script-loaded fee page rejected as menus: lifts the ban, restores a missing link, logs the reopen", async () => {
      const url = "https://testbank.example/personal/fee-schedule";
      const db = vaultDb([], [], false, [
        { text_id: 9, source_document_id: 19, institution_id: 42, source_url: url, source_hash: "menus-hash", normalized_text: "Home | Personal | Business | Fee Schedule | Contact us" },
        { text_id: 10, source_document_id: 20, institution_id: 43, source_url: "https://other.example/fees", source_hash: "priced-hash", normalized_text: "Overdraft $35\nNSF $35\nWire $25" },
      ]);

      const result = await runRosettaRead({ runId: 610, db: asReadDb(db), fetchImpl: vi.fn(), vault: fakeVault(new Uint8Array()) });

      expect(result).toMatchObject({ reopenedFeePages: 1, reopenedBansLifted: 1, reopenedLinksRestored: 1 });
      const unban = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE institution_source_profiles"));
      expect(unban).toEqual(expect.arrayContaining([url, 42, JSON.stringify([{ url }])]));
      const relink = db.mock.calls.find((call) => templateText(call[0]).includes("rescue_status = 'rescued'"));
      expect(templateText(relink?.[0])).toContain("NULLIF(btrim(inst.fee_schedule_url), '') IS NULL");
      expect(templateText(relink?.[0])).toContain("locked_by_correction IS TRUE");
      const attempts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts") && call.includes("read.reopen"));
      expect(attempts.map((call) => call.find((value: unknown) => value === "ok" || value === "rejected"))).toEqual(["ok", "rejected"]);
    });

    it("lets a reopened rejection be read once more and voids the old permanent rejection", async () => {
      const db = vaultDb([]);

      await runRosettaRead({ runId: 611, db: asReadDb(db), fetchImpl: vi.fn(), vault: fakeVault(new Uint8Array()) });

      const query = String(db.unsafe.mock.calls.find((call) => String(call[0]).includes("FROM source_documents"))?.[0]);
      expect(query).toContain("adt.status = 'wrong_document'");
      expect(query).toContain("SELECT MAX(reopen.created_at) FROM pipeline_attempts reopen");
      expect(query).toContain("after_reopen.created_at >");
      expect(query).toContain("AND pa.created_at > COALESCE(");
    });

    it("gives a reopened page that is the current copy of its page its read even when the bank has a newer document", async () => {
      const db = vaultDb([]);
      const base = db.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;
      db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        if (templateText(strings).includes("column_name = 'superseded_by_id'")) return Promise.resolve([{ ready: true }]);
        return base(strings, ...values);
      });

      await runRosettaRead({ runId: 612, db: asReadDb(db), fetchImpl: vi.fn(), vault: fakeVault(new Uint8Array()) });

      const query = String(db.unsafe.mock.calls.find((call) => String(call[0]).includes("FROM source_documents cr"))?.[0]);
      expect(query).toMatch(/FROM source_documents newer[\s\S]*\)\s+OR \(\s+cr\.superseded_by_id IS NULL/);
      expect(query).toContain("after_reopen.input_fingerprint = cr.content_hash");
      const reopen = String(db.unsafe.mock.calls.find((call) => String(call[0]).includes("FROM agent_source_texts adt"))?.[0]);
      // An older copy of a page is not reopened: its page's current copy is judged on its own.
      expect(reopen).toContain("doc.superseded_by_id IS NULL");
    });
  });

  describe("pass 2 specialists", () => {
    const feeLines = ["SCHEDULE OF FEES", "OVERDRAFT FEE | $33.00", "STOP PAYMENT | $31.00", "MONTHLY MAINTENANCE FEE | $9.00"];

    function specialistDb(rows: Array<Record<string, unknown>>): DbMock {
      const db = vi.fn((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("vault_schema_ready")) return Promise.resolve([{ vault_schema_ready: true }]);
        if (text.includes("rosetta_text_columns_ready")) return Promise.resolve([{ rosetta_text_columns_ready: true }]);
        if (text.includes("INSERT INTO agent_source_texts")) return Promise.resolve([{ id: 901 }]);
        if (text.includes("UPDATE institution_sources inst")) return Promise.resolve([{ id: 42 }]);
        return Promise.resolve([]);
      }) as DbMock;
      db.unsafe = vi.fn((query: string) => Promise.resolve(query.includes("FROM source_documents") ? rows : []));
      return db;
    }

    function attempts(db: DbMock): Array<[string, string]> {
      return db.mock.calls
        .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
        .map((call) => [call[4] as string, call[7] as string]);
    }

    function ocrReader(text: string, confidence = 90) {
      return {
        read: vi.fn(async () => ({ text, pages: [text], pageCount: 1, imagePages: 1, confidence })),
        close: vi.fn(async () => undefined),
      };
    }

    const scan = { ...htmlCandidate, document_url: "https://testbank.example/scan.pdf" };
    const pdfFetch = () => vi.fn().mockResolvedValueOnce(response(new TextEncoder().encode("%PDF-1.4 scan"), "application/pdf"));
    const noText = () => vi.fn().mockResolvedValueOnce({ totalPages: 1, text: "" });

    it("escalates a scan to free OCR in the same read and stores its table rows", async () => {
      const db = specialistDb([scan]);
      const reader = ocrReader(feeLines.join("\n"));

      const result = await runRosettaRead({ runId: 701, db: asReadDb(db), fetchImpl: pdfFetch(), pdfTextExtractor: noText(), scannedPdfReader: reader });

      expect(reader.read).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ completed: 1, needsOcr: 0, ocrRead: 1, outcomes: { scanned_pdf: 1, ok: 1 } });
      expect(result.results[0]).toMatchObject({ status: "completed", reader: "read.ocr_tesseract", format: "pdf_scanned" });
      expect(result.results[0].rows.map((row) => row.cells)).toEqual([
        ["OVERDRAFT FEE", "$33.00"],
        ["STOP PAYMENT", "$31.00"],
        ["MONTHLY MAINTENANCE FEE", "$9.00"],
      ]);
      expect(attempts(db)).toEqual([
        ["read.pdf_layout", "scanned_pdf"],
        ["read.ocr_tesseract", "ok"],
        ["read.table_rows", "ok"],
        ["read.page_check", "ok"],
      ]);
      const update = db.mock.calls.find((call) => templateText(call[0]).includes("SET table_rows ="));
      expect(update).toBeDefined();
      const stored = JSON.parse(update![1] as string);
      expect(stored.version).toBe(1);
      expect(stored.rows[0]).toMatchObject({ origin: "ocr_layout", cells: ["OVERDRAFT FEE", "$33.00"] });
      expect(update![2]).toBe("read.ocr_tesseract");
      // The caller owns an injected reader; the run does not close it.
      expect(reader.close).not.toHaveBeenCalled();
    });

    it("leaves an unreliable OCR result for the paid pass", async () => {
      const db = specialistDb([scan]);

      const result = await runRosettaRead({
        runId: 702,
        db: asReadDb(db),
        fetchImpl: pdfFetch(),
        pdfTextExtractor: noText(),
        scannedPdfReader: ocrReader(feeLines.join("\n"), 31),
      });

      expect(result).toMatchObject({ completed: 0, needsOcr: 1 });
      expect(result.results[0].error).toContain("OCR confidence 31");
      expect(attempts(db)).toEqual([
        ["read.pdf_layout", "scanned_pdf"],
        ["read.ocr_tesseract", "rejected"],
      ]);
    });

    it("defers scans past this run's OCR allowance without writing anything", async () => {
      const db = specialistDb([scan]);
      const reader = ocrReader("unused");

      const result = await runRosettaRead({
        runId: 703,
        db: asReadDb(db),
        fetchImpl: pdfFetch(),
        pdfTextExtractor: noText(),
        scannedPdfReader: reader,
        ocrDocumentsPerRun: 0,
      });

      expect(result).toMatchObject({ deferred: 1, needsOcr: 0 });
      expect(reader.read).not.toHaveBeenCalled();
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).not.toContain("INSERT INTO agent_source_texts");
      expect(attempts(db)).toEqual([]);
    });

    describe("when a text's fees did not hold up", () => {
      const filler = "This schedule applies to personal deposit accounts opened at any branch. ".repeat(6);
      const layoutText = [filler, "SCHEDULE OF FEES", "OVERDRAFT FEE | $33.00", "Charges may apply to some services."].join("\n");
      const textPdf = { ...htmlCandidate, document_url: "https://testbank.example/fees.pdf", last_reader: "read.pdf_layout", last_text_lost: true };
      const layout = () => vi.fn().mockResolvedValueOnce({ totalPages: 1, text: layoutText });

      it("never sends a text PDF to free OCR, which reads only page images; the paid pass takes it", async () => {
        const db = specialistDb([textPdf]);
        const reader = ocrReader(feeLines.join("\n"));

        const result = await runRosettaRead({ runId: 720, db: asReadDb(db), fetchImpl: pdfFetch(), pdfTextExtractor: layout(), scannedPdfReader: reader });

        expect(reader.read).not.toHaveBeenCalled();
        expect(result).toMatchObject({ completed: 1, readerEscalations: 0, deferred: 0 });
        expect(result.results[0]).toMatchObject({ reader: "read.pdf_layout", escalation: null });
        expect(attempts(db).map((attempt) => attempt[0])).not.toContain("read.ocr_tesseract");
      });

      it("reads a web page with the JavaScript fallbacks too, and keeps the richer text", async () => {
        const page = `<html><body><p>${filler}</p><table><tr><td>Overdraft fee</td><td>$35.00</td></tr></table>
          <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: { fees: [{ name: "Overdraft fee", amount: "$35.00" }, { name: "Stop payment fee", amount: "$30.00" }, { name: "NSF fee", amount: "$35.00" }, { name: "Wire fee", amount: "$25.00" }] },
          })}</script></body></html>`;
        const db = specialistDb([{ ...htmlCandidate, last_reader: "read.html_dom", last_text_lost: true }]);
        const fetchImpl = vi.fn().mockResolvedValueOnce(response(page));

        const result = await runRosettaRead({ runId: 723, db: asReadDb(db), fetchImpl });

        expect(result.results[0]).toMatchObject({ reader: "read.js_fallback", escalation: { to: "read.js_fallback", used: true } });
        expect(attempts(db).slice(0, 2)).toEqual([
          ["read.html_dom", "ok"],
          ["read.js_fallback", "ok"],
        ]);
      });

      it("keeps a lost text whose re-read is thinner, and never sends that bank back to Magellan", async () => {
        const stored = [layoutText, "STOP PAYMENT | $31.00", "WIRE TRANSFER FEE | $25.00", "NSF FEE | $35.00"].join("\n");
        const db = specialistDb([{ ...textPdf, last_reader: "legacy.pdf", last_lost_text: stored }]);

        const result = await runRosettaRead({ runId: 726, db: asReadDb(db), fetchImpl: pdfFetch(), pdfTextExtractor: layout() });

        expect(result.results[0]).toMatchObject({ status: "completed", reader: "read.pdf_layout", escalation: null });
        const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
        expect(sqlText).not.toContain("INSERT INTO agent_source_texts");
        expect(sqlText).not.toContain("SET fee_schedule_url = NULL");
        expect(attempts(db)[0]).toEqual(["read.pdf_layout", "ok"]);
      });

      it("replaces a lost text with a re-read that lists at least as many fees", async () => {
        const db = specialistDb([{ ...textPdf, last_reader: "legacy.pdf", last_lost_text: "OVERDRAFT FEE $40" }]);

        await runRosettaRead({ runId: 727, db: asReadDb(db), fetchImpl: pdfFetch(), pdfTextExtractor: layout() });

        const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
        expect(sqlText).toContain("INSERT INTO agent_source_texts");
      });

      it("scores texts once a day and selects lost texts for one read a rung up", async () => {
        const db = specialistDb([]);
        const base = db.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;
        db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
          const text = templateText(strings);
          if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
          if (text.includes("AS fresh")) return Promise.resolve([{ fresh: true }]);
          return base(strings, ...values);
        });

        const result = await runRosettaRead({ runId: 725, db: asReadDb(db), fetchImpl: vi.fn() });

        expect(result.textSurvivalRefreshed).toBe(false);
        const selection = db.unsafe.mock.calls.find((call) => String(call[0]).includes("FROM source_documents"));
        const query = String(selection?.[0]);
        expect(query).toContain("lost.evidence->>'text_hash' = adt.text_hash");
        expect(query).toContain("adt.reader = $");
        expect(query).not.toContain("CASE WHEN adt.reader =");
        expect(query).toContain("AS last_reader");
        expect(query).toContain("AS last_text_lost");
        expect(query).toContain("AS reader_record");
        expect(selection?.[1]).toEqual(expect.arrayContaining(["rosetta.text_survival", "read.html_dom", "read.js_fallback"]));
        // OCR is no rung for a lost text: its only use here is the one re-read of a scan an
        // older OCR version gave up on.
        expect((selection?.[1] as unknown[]).filter((value) => value === "read.ocr_tesseract")).toHaveLength(1);
        expect(query).toContain("old_ocr.strategy_version < $");
        expect(query).toContain("adt.status = 'needs_ocr' AND");
        expect(selection?.[1]).toEqual(expect.arrayContaining([ROSETTA_OCR_VERSION, ["rejected", "empty"]]));
      });

      it("starts a bank's new web page on the JavaScript fallbacks when its DOM texts keep losing fees", async () => {
        const page = `<html><body><p>${filler}</p><table><tr><td>Overdraft fee</td><td>$35.00</td></tr></table></body></html>`;
        const db = specialistDb([{ ...htmlCandidate, last_reader: null, last_text_lost: false, reader_record: { "read.html_dom": { held: 0, lost: 2 } } }]);

        const result = await runRosettaRead({ runId: 724, db: asReadDb(db), fetchImpl: vi.fn().mockResolvedValue(response(page)) });

        expect(result.results[0].escalation).toMatchObject({ to: "read.js_fallback" });
      });
    });

    it("reads a JavaScript page from the data it embeds", async () => {
      const db = specialistDb([htmlCandidate]);
      const shell = `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { fees: [{ name: "Overdraft fee", amount: 35 }, { name: "Stop payment fee", amount: 30 }, { name: "NSF fee", amount: 35 }] },
      })}</script></body></html>`;
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(shell));

      const result = await runRosettaRead({ runId: 704, db: asReadDb(db), fetchImpl });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ completed: 1, jsFallbackRead: 1, outcomes: { js_required: 1, ok: 1 } });
      expect(result.results[0]).toMatchObject({ reader: "read.js_fallback", format: "html_js" });
      expect(JSON.stringify(db.mock.calls)).toContain("Overdraft fee | $35.00");
      expect(attempts(db).slice(0, 2)).toEqual([
        ["read.html_dom", "js_required"],
        ["read.js_fallback", "ok"],
      ]);
    });

    it("follows a JavaScript page's link to its PDF version", async () => {
      const db = specialistDb([htmlCandidate]);
      const shell = `<div id="root"></div><noscript>Please enable JavaScript</noscript><a href="/docs/fee-schedule.pdf">Fee schedule (PDF)</a>`;
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response(shell))
        .mockResolvedValueOnce(response(new TextEncoder().encode("%PDF-1.4 text"), "application/pdf"));
      const pdfText = ["Schedule of Fees", "Overdraft fee | $35.00", "NSF fee | $35.00", "Stop payment | $30.00", "x".repeat(300)].join("\n");
      const pdfTextExtractor = vi.fn().mockResolvedValueOnce({ totalPages: 1, text: pdfText, pages: [pdfText] });

      const result = await runRosettaRead({ runId: 705, db: asReadDb(db), fetchImpl, pdfTextExtractor });

      expect(fetchImpl.mock.calls[1][0]).toBe("https://testbank.example/docs/fee-schedule.pdf");
      expect(result).toMatchObject({ completed: 1, jsFallbackRead: 1 });
      expect(result.results[0]).toMatchObject({ sourceUrl: "https://testbank.example/docs/fee-schedule.pdf" });
      expect(result.results[0].rows.map((row) => row.origin)).toEqual(["pdf_layout", "pdf_layout", "pdf_layout"]);
    });

    it("follows the PDF link on a fee page whose static text is only menus", async () => {
      const db = specialistDb([htmlCandidate]);
      // No app-shell marker and more than a shell's worth of text: menus, no amounts.
      const menus = Array.from({ length: 120 }, (_, i) => `<li><a href="/p${i}">Menu item ${i}</a></li>`).join("");
      const page = `<html><body><nav><ul>${menus}</ul></nav><h1>Fee Schedule</h1><a href="/docs/fees.pdf">Schedule of fees</a></body></html>`;
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response(page))
        .mockResolvedValueOnce(response(new TextEncoder().encode("%PDF-1.4 text"), "application/pdf"));
      const pdfText = ["Schedule of Fees", "Overdraft fee | $35.00", "NSF fee | $35.00", "Stop payment | $30.00", "x".repeat(300)].join("\n");
      const pdfTextExtractor = vi.fn().mockResolvedValueOnce({ totalPages: 1, text: pdfText, pages: [pdfText] });

      const result = await runRosettaRead({ runId: 707, db: asReadDb(db), fetchImpl, pdfTextExtractor });

      expect(fetchImpl.mock.calls[1][0]).toBe("https://testbank.example/docs/fees.pdf");
      expect(result).toMatchObject({ completed: 1, wrongDocuments: 0, jsFallbackRead: 1, sentBackToMagellan: 0 });
      expect(result.results[0]).toMatchObject({ sourceUrl: "https://testbank.example/docs/fees.pdf" });
    });

    it("still rejects a menus-only page whose link does not name a fee page", async () => {
      const db = specialistDb([{ ...htmlCandidate, document_url: "https://testbank.example/about-us" }]);
      const menus = Array.from({ length: 120 }, (_, i) => `<li><a href="/p${i}">Menu item ${i}</a></li>`).join("");
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(`<html><body><nav><ul>${menus}</ul></nav><h1>About us</h1></body></html>`));

      const result = await runRosettaRead({ runId: 708, db: asReadDb(db), fetchImpl });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ completed: 0, wrongDocuments: 1, jsFallbackRead: 0 });
    });

    it("hands a JavaScript page with no free route to Magellan's paid finder", async () => {
      const db = specialistDb([htmlCandidate]);
      const fetchImpl = vi.fn(async (url: string) =>
        url === htmlCandidate.document_url ? response("<div id=app></div>") : response("missing", "text/html", 404),
      );

      const result = await runRosettaRead({ runId: 706, db: asReadDb(db), fetchImpl: fetchImpl as unknown as typeof fetch });

      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(result).toMatchObject({ skipped: 1, empty: 0, handedToMagellan: 1, sentBackToMagellan: 0 });
      expect(result.results[0]).toMatchObject({ status: "skipped", handoff: "magellan_paid_find", attemptOutcome: "js_required" });
      expect(attempts(db)).toEqual([
        ["read.html_dom", "js_required"],
        ["read.js_fallback", "js_required"],
      ]);
      const values = JSON.stringify(db.mock.calls);
      expect(values).toContain("rosetta_js_required");
      expect(values).toContain('"browser_render"');
    });
  });
});
