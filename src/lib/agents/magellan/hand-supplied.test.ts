import { describe, expect, it, vi } from "vitest";

import type { DocumentVault } from "@/lib/agents/document-vault";

import { HAND_SUPPLIED_STRATEGY, importHuntLinks, loadHandSuppliedDocument } from "./hand-supplied";
import { parseHuntCsv } from "./hand-supplied-files";
import { readHandSuppliedDocument } from "../rosetta/read";

type DbMock = ReturnType<typeof vi.fn>;
const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));
type Db = NonNullable<Parameters<typeof loadHandSuppliedDocument>[0]["db"]>;
const asDb = (db: DbMock) => db as unknown as Db;

const PDF = new TextEncoder().encode("%PDF-1.4 fee schedule bytes");
const FILE = "102__townebank__consumer.pdf";
const URL_FOUND = "https://www.townebank.com/fees.pdf";

interface DbSetup {
  institution?: string | null;
  otherBank?: { id: number; institution_name: string; state_code: string } | null;
  duplicateOf?: number | null;
  /** Whether the copy on file has a completed text (default true); its vault key. */
  duplicateRead?: boolean;
  duplicateKey?: string | null;
  companions?: Array<{ id: number; url: string; status: string; reason: string | null }>;
}

function createDb(setup: DbSetup = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const sql = text(strings);
    if (sql.includes("vault_schema_ready")) return Promise.resolve([{ vault_schema_ready: true }]);
    if (sql.includes("companion_ready")) return Promise.resolve([{ companion_ready: true }]);
    if (sql.includes("FROM institution_sources other")) return Promise.resolve(setup.otherBank ? [setup.otherBank] : []);
    if (sql.includes("SELECT institution_name")) {
      const name = setup.institution === undefined ? "TowneBank" : setup.institution;
      return Promise.resolve(name ? [{ institution_name: name, fee_schedule_url: null }] : []);
    }
    if (sql.includes("INSERT INTO agent_runs")) return Promise.resolve([{ id: 900 }]);
    if (sql.includes("INSERT INTO agent_run_steps")) return Promise.resolve([{ id: 901 }]);
    if (sql.includes("FROM source_documents d")) {
      return Promise.resolve(
        setup.duplicateOf
          ? [{ id: setup.duplicateOf, document_r2_key: setup.duplicateKey ?? null, read_ok: setup.duplicateRead ?? true }]
          : [],
      );
    }
    if (sql.includes("SELECT id, url, status, reason FROM institution_additional_sources")) return Promise.resolve(setup.companions ?? []);
    if (sql.includes("INSERT INTO institution_additional_sources")) return Promise.resolve([{ id: 77 }]);
    if (sql.includes("INSERT INTO source_documents")) return Promise.resolve([{ id: 88 }]);
    return Promise.resolve([]);
  });
}

const calls = (db: DbMock, fragment: string) => db.mock.calls.filter((call) => text(call[0]).includes(fragment));

function vault(configured = true): DocumentVault & { store: ReturnType<typeof vi.fn> } {
  return {
    configured,
    store: vi.fn(async (_bytes: Uint8Array, hash: string) => ({ status: "stored" as const, key: `documents/${hash}` })),
    read: vi.fn(),
    presign: vi.fn(),
  };
}

const fakeRead = (status = "completed") =>
  vi.fn(async () => ({ status, error: null, charCount: 1200 }) as unknown as Awaited<ReturnType<typeof readHandSuppliedDocument>>);

const load = (db: DbMock, overrides: Partial<Parameters<typeof loadHandSuppliedDocument>[0]> = {}) =>
  loadHandSuppliedDocument({
    db: asDb(db),
    fileName: FILE,
    bytes: PDF,
    sourceUrl: URL_FOUND,
    effectiveDate: "2026-01-01",
    suppliedBy: "james",
    now: new Date("2026-10-18T09:30:00Z"),
    vault: vault(),
    read: fakeRead(),
    ...overrides,
  });

describe("hand-supplied fee schedules", () => {
  it("stores the PDF as a hand-supplied consumer companion, vaults it, reads it and records one run", async () => {
    const db = createDb();
    const store = vault();
    const read = fakeRead();
    const result = await load(db, { vault: store, read });

    expect(result).toMatchObject({ outcome: "loaded", institutionId: 102, institutionName: "TowneBank", runId: 900, sourceDocumentId: 88, readStatus: "completed" });
    const [companion] = calls(db, "INSERT INTO institution_additional_sources");
    expect(text(companion[0])).toContain("'consumer_supplement', 'fetched'");
    expect(companion).toContain(HAND_SUPPLIED_STRATEGY.strategy);
    expect(companion).toContain(URL_FOUND);
    // Who and when, and where the person downloaded it.
    expect(String(companion.find((value: unknown) => typeof value === "string" && value.startsWith("Consumer fee schedule hand-supplied")))).toContain(
      "james, 2026-10-18 09:30 UTC",
    );
    const [document] = calls(db, "INSERT INTO source_documents");
    expect(document).toContain(URL_FOUND);
    expect(document).toContain(77);
    expect(store.store).toHaveBeenCalledTimes(1);
    expect(calls(db, "SET document_r2_key")).toHaveLength(1);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ sourceDocumentId: 88, runId: 900, stepId: 901, bytes: PDF }));
    expect(calls(db, "INSERT INTO pipeline_attempts")).toHaveLength(1);
    // The run is opened, and closed completed with one event.
    expect(calls(db, "INSERT INTO agent_runs")).toHaveLength(1);
    expect(calls(db, "UPDATE agent_runs")[0]).toContain("completed");
    // Nothing on file is replaced: no fee link change, no delete, no supersede of another page.
    expect(calls(db, "UPDATE institution_sources")).toHaveLength(0);
    expect(calls(db, "DELETE")).toHaveLength(0);
    expect(calls(db, "superseded_by_id")).toHaveLength(0);
  });

  it("does nothing more for the same file twice for one institution", async () => {
    const db = createDb({ duplicateOf: 55 });
    const read = fakeRead();
    const result = await load(db, { read });
    expect(result).toMatchObject({ outcome: "already_loaded", sourceDocumentId: 55, runId: 900 });
    expect(calls(db, "INSERT INTO source_documents")).toHaveLength(0);
    expect(calls(db, "INSERT INTO institution_additional_sources")).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a copy on file that was never read, from the uploaded bytes (#1754)", async () => {
    // Alliant's 2026-02 copy: same bytes, but Rosetta was refused by the bank's site (HTTP 403).
    const db = createDb({ duplicateOf: 1933, duplicateRead: false });
    const store = vault();
    const read = fakeRead();
    const result = await load(db, { vault: store, read });
    expect(result).toMatchObject({ outcome: "loaded", sourceDocumentId: 1933, readStatus: "completed", runId: 900 });
    expect(result.message).toContain("never read until now");
    expect(store.store).toHaveBeenCalledTimes(1);
    expect(calls(db, "SET document_r2_key")[0]).toContain(1933);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ sourceDocumentId: 1933, bytes: PDF }));
    expect(calls(db, "INSERT INTO source_documents")).toHaveLength(0);
    expect(calls(db, "INSERT INTO institution_additional_sources")).toHaveLength(0);
    expect(calls(db, "UPDATE agent_runs")[0]).toContain("completed");
  });

  it("keeps the vault copy of an unread copy that already has one", async () => {
    const db = createDb({ duplicateOf: 1933, duplicateRead: false, duplicateKey: "documents/abc" });
    const store = vault();
    const read = fakeRead();
    await load(db, { vault: store, read });
    expect(store.store).not.toHaveBeenCalled();
    expect(calls(db, "SET document_r2_key")).toHaveLength(0);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ sourceDocumentId: 1933 }));
  });

  it("joins a page already on file as a hand-found link, and leaves a ruled-out page alone", async () => {
    const onFile = createDb({ companions: [{ id: 12, url: "https://townebank.com/fees.pdf", status: "found", reason: "Consumer fee schedule given by j" }] });
    const joined = await load(onFile);
    expect(joined.outcome).toBe("loaded");
    expect(calls(onFile, "INSERT INTO institution_additional_sources")).toHaveLength(0);
    expect(calls(onFile, "INSERT INTO source_documents")[0]).toContain(12);

    const ruledOut = createDb({ companions: [{ id: 12, url: URL_FOUND, status: "rejected", reason: "not_consumer_fee_page" }] });
    const refused = await load(ruledOut);
    expect(refused).toMatchObject({ outcome: "refused", runId: 900 });
    expect(refused.message).toContain("ruled out");
    expect(calls(ruledOut, "INSERT INTO source_documents")).toHaveLength(0);
  });

  it("refuses files it cannot place or trust, before any run", async () => {
    const cases: Array<[Partial<Parameters<typeof loadHandSuppliedDocument>[0]>, string]> = [
      [{ fileName: "townebank.pdf" }, "must start with the institution id"],
      [{ fileName: "102__townebank__business.pdf" }, "business schedule"],
      [{ bytes: new TextEncoder().encode("<html>") }, "Not a PDF"],
      [{ sourceUrl: null }, "No source address"],
      [{ sourceUrl: "ftp://x.com/a.pdf" }, "found_url"],
      [{ vault: vault(false) }, "vault"],
    ];
    for (const [overrides, message] of cases) {
      const db = createDb();
      const result = await load(db, overrides);
      expect(result.outcome).toBe("refused");
      expect(result.message).toContain(message);
      expect(calls(db, "INSERT INTO agent_runs")).toHaveLength(0);
    }
    const otherSite = createDb({ otherBank: { id: 595, institution_name: "Other Bank", state_code: "MD" } });
    expect((await load(otherSite)).message).toContain("website of Other Bank (MD)");
    const unknown = createDb({ institution: null });
    expect((await load(unknown)).message).toContain("No institution 102");
  });

  it("closes the run failed when the store fails", async () => {
    const db = createDb();
    const broken = vault();
    broken.store.mockResolvedValueOnce({ status: "failed", key: null, error: "R2 down" } as never);
    const result = await load(db, { vault: broken });
    expect(result.outcome).toBe("refused");
    expect(result.message).toContain("R2 down");
    expect(calls(db, "UPDATE agent_runs")[0]).toContain("failed");
  });
});

describe("browser hunt CSV links", () => {
  it("adds found links with no file and reports each row", async () => {
    const parsed = parseHuntCsv(
      [
        "institution_id,institution,status,found_url,file_name",
        "102,TowneBank,FOUND_PDF,https://www.townebank.com/fees.pdf,102__townebank__consumer.pdf",
        "133,Bell,FOUND_PAGE,https://www.bell.bank/fees,",
        "118,First United,FOUND_PDF,https://mybank.com/a.pdf,",
        "41,Old National,FOUND_PDF,https://www.oldnational.com/fees.pdf,",
        "7,Nobody,FOUND_PDF,not a link,",
        "96,Beacon,BLOCKED,,",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = text(strings);
      if (sql.includes("INSERT INTO agent_runs")) return Promise.resolve([{ id: 900 }]);
      if (sql.includes("INSERT INTO agent_run_steps")) return Promise.resolve([{ id: 901 }]);
      if (sql.includes("SELECT institution_name")) return Promise.resolve([{ institution_name: `Bank ${String(values[0])}`, fee_schedule_url: null }]);
      if (sql.includes("FROM institution_sources other")) {
        return Promise.resolve(values.includes("mybank.com") ? [{ id: 595, institution_name: "First United Bank & Trust", state_code: "MD" }] : []);
      }
      // Old National's link is already a companion: the insert does nothing.
      if (sql.includes("INSERT INTO institution_additional_sources")) return Promise.resolve(values.includes(41) ? [] : [{ id: 5 }]);
      return Promise.resolve([]);
    });
    const result = await importHuntLinks({
      db: asDb(db),
      rows: parsed.rows,
      uploadedFileNames: ["102__townebank__consumer.pdf"],
      suppliedBy: "james",
      now: new Date("2026-10-18T09:30:00Z"),
    });
    expect(result.results.map((row) => row.outcome)).toEqual(["file", "added", "other_institution_site", "already_on_file", "invalid", "skipped"]);
    expect(result.counts).toMatchObject({ added: 1, already_on_file: 1, other_institution_site: 1, invalid: 1, file: 1, skipped: 1 });
    const [insert] = calls(db, "INSERT INTO institution_additional_sources").filter((call) => call.includes(133));
    expect(insert.find((value: unknown) => typeof value === "string" && value.startsWith("Consumer fee schedule given by"))).toContain("browser hunt");
    expect(calls(db, "UPDATE agent_runs")[0]).toContain("completed");
  });
});

describe("Rosetta's read of a hand-supplied copy", () => {
  it("reads the uploaded bytes and never asks the bank's site", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const db = vi.fn((strings: TemplateStringsArray) => {
      const sql = text(strings);
      if (sql.includes("FROM source_documents doc")) {
        return Promise.resolve([
          { source_document_id: 88, institution_id: 102, institution_name: "TowneBank", document_url: URL_FOUND, content_hash: "h", companion_source_id: 77 },
        ]);
      }
      return Promise.resolve([]);
    });
    // Callback-only sink; native Rosetta SQL controls prove rollback.
    Object.assign(db, {
      begin: vi.fn(async (work: (scope: typeof db) => Promise<unknown>) => work(db)),
    });
    const schedule = [
      "Schedule of Fees and Charges for Personal Deposit Accounts",
      "Overdraft fee $35.00 per item paid into overdraft",
      "Returned item (NSF) fee $35.00 per item returned unpaid",
      "Monthly maintenance fee $10.00, waived with a $500 minimum daily balance",
      "Stop payment order $30.00 each",
      "Wire transfer, outgoing domestic $25.00",
      "Cashier's check $10.00 each",
      "Paper statement fee $3.00 per month",
    ].join("\n");
    const extractor = vi.fn(async () => ({ text: schedule, totalPages: 1 }));
    const result = await readHandSuppliedDocument({
      db: db as unknown as Db,
      runId: 900,
      stepId: 901,
      sourceDocumentId: 88,
      bytes: PDF,
      contentType: "application/pdf",
      pdfTextExtractor: extractor,
      scannedPdfReader: null,
    });
    expect(result?.status).toBe("completed");
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(network).not.toHaveBeenCalled();
    const [stored] = calls(db, "INSERT INTO agent_source_texts");
    expect(JSON.stringify(stored)).toContain("Overdraft fee $35.00");
    network.mockRestore();
  });
});
