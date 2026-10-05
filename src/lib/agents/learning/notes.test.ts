import { describe, expect, it, vi } from "vitest";

import { backfillPlaybookFormats } from "./format-backfill";
import { describePlaybook, effectiveFormat } from "./notes";
import { EMPTY_PLAYBOOK, type Playbook } from "./playbook";

function input(playbook: Partial<Playbook>, extra: Partial<Parameters<typeof describePlaybook>[0]> = {}) {
  return {
    playbook: { ...EMPTY_PLAYBOOK, ...playbook },
    sourceKind: null,
    readStrategy: null,
    lockedByCorrection: false,
    rejectedUrlCount: 0,
    ...extra,
  };
}

describe("playbook notes", () => {
  it("says a scanned PDF needs OCR and is not retried", () => {
    const notes = describePlaybook(
      input({
        format: "pdf_scanned",
        doNotRetry: [
          { stage: "read", strategy: "read.pdf_layout", version: 2, fingerprint: "abc", outcome: "scanned_pdf", at: "2026-10-04T00:00:00Z" },
        ],
      }),
    );
    expect(notes.formatLabel).toBe("Scanned PDF (image only)");
    expect(notes.nextStep).toMatch(/^Needs OCR/);
    expect(notes.lines).toContain("Not retried: 1 document where the PDF is a scan with no text.");
  });

  it("describes a working web page with its reader and expected fee count", () => {
    const notes = describePlaybook(
      input({ format: "html_static", bestStrategy: { read: "read.html_dom" }, expectedFeeCount: 24 }),
    );
    expect(notes.lines).toEqual([
      "The fee schedule is a web page.",
      "Reading works with the web page reader.",
      "A good read finds about 24 fees.",
    ]);
    expect(notes.nextStep).toBeNull();
  });

  it("falls back to the older profile columns when no format was learned", () => {
    expect(effectiveFormat(input({}, { readStrategy: "ocr" }))).toBe("pdf_scanned");
    expect(effectiveFormat(input({}, { sourceKind: "pdf", readStrategy: "pdf_text" }))).toBe("pdf_text");
    expect(effectiveFormat(input({}, { readStrategy: "browser_render" }))).toBe("html_js");
    expect(effectiveFormat(input({}))).toBeNull();
  });

  it("says when nothing has been learned and when the right page is still being found", () => {
    expect(describePlaybook(input({})).lines).toEqual([
      "Nothing learned yet: no document for this institution has been read.",
    ]);
    const searching = describePlaybook(input({}, { rejectedUrlCount: 2 }));
    expect(searching.nextStep).toBe("Still looking for the right fee schedule page.");
    expect(searching.lines[0]).toBe("2 pages were ruled out as not the fee schedule; their links are followed to find the real one.");
  });

  it("flags text that was read but yielded no fees", () => {
    const notes = describePlaybook(
      input({
        format: "pdf_text",
        strategyStats: {
          "extract:extract.rules@1": {
            stage: "extract", strategy: "extract.rules", version: 1, attempts: 2, successes: 0,
            meanYield: 0, meanCostMicrousd: 0, lastOutcome: "no_candidates", lastAt: "2026-10-04T00:00:00Z", recentYields: [],
          },
        },
      }),
    );
    expect(notes.nextStep).toMatch(/no fees were found/);
  });
});

describe("playbook format backfill", () => {
  type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
    const db = vi.fn(() => Promise.resolve([])) as DbMock;
    db.unsafe = vi.fn(() => Promise.resolve(rows));
    return db;
  }
  const asDb = (db: DbMock) => db as unknown as Parameters<typeof backfillPlaybookFormats>[0];

  it("fills only empty formats from the newest fee-schedule text and counts them", async () => {
    const db = createDbMock([{ format: "pdf_text" }, { format: "pdf_scanned" }, { format: "pdf_text" }]);
    const result = await backfillPlaybookFormats(asDb(db), { dryRun: false });

    expect(result).toEqual({ updated: 3, byFormat: { pdf_text: 2, pdf_scanned: 1 } });
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("UPDATE institution_source_profiles profile");
    expect(query).toContain("profile.format IS NULL");
    expect(query).toContain("WHEN adt.status = 'needs_ocr' THEN 'pdf_scanned'");
    expect(query).toContain("adt.status IN ('completed', 'needs_ocr', 'empty')");
    expect(query).not.toContain("'wrong_document'");
    expect(params).toEqual([500]);
  });

  it("writes nothing in a dry run and never throws", async () => {
    const db = createDbMock([{ format: "html_static" }]);
    await backfillPlaybookFormats(asDb(db), { dryRun: true, institutionId: 7 });
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).not.toContain("UPDATE");
    expect(params).toEqual([500, 7]);

    const failing = createDbMock([]);
    failing.unsafe = vi.fn(() => Promise.reject(new Error("boom")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(backfillPlaybookFormats(asDb(failing), { dryRun: false })).resolves.toEqual({ updated: 0, byFormat: {} });
    spy.mockRestore();
  });
});
