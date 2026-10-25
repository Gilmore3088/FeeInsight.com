// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractPdfDocumentText } from "./pdf-document-text";
import { previewPdfUnicodeRepair } from "./pdf-unicode-preview";
import { PdfTextIntegrityError } from "./pdf-text-integrity";

const fixture = () => new Uint8Array(readFileSync(join(process.cwd(), "src/lib/agents/rosetta/test-fixtures/reliance-unicode-loss.pdf")));
const sourceSha256 = "e1468b1d3f3eacf88e447b1089a901d8531d10bdb925a105b914b86d8e712617";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("offline full-page Unicode preview on the original bank PDF", () => {
  it("uses actual glyph rendering after a text-only parse; preserves prices and withholds an incomplete incumbent", async () => {
    await expect(extractPdfDocumentText(fixture())).rejects.toThrow(PdfTextIntegrityError);
    const incumbent = "Wire Interna�onal Transfer-Remote Outgoing | $70.00*\nDomestic wire | $40.00*\noverdra�s | $30\n* keep all terms";
    const result = await previewPdfUnicodeRepair(fixture(), { expectedSourceSha256: sourceSha256, incumbent: { text: incumbent, sha256: hash(incumbent), sourceSha256 } });
    expect(result.disposition).toBe("review_required");
    expect(result.sourceSha256).toBe(sourceSha256);
    expect(result.localModelSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.pages[0].repairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "Interna�onal", to: "International" }),
      expect.objectContaining({ from: "overdra�s", to: "overdrafts" }),
    ]));
    // The complete page still has a word without two adequate witnesses.
    expect(result.complete).toBe(false);
    expect(result.pages[0].unresolved).toContain("Automa�c");
    expect(result.proposedText).toContain("Wire International Transfer-Remote Outgoing");
    expect(result.originalText.match(/\$[\d,.]+/g)).toEqual(result.proposedText.match(/\$[\d,.]+/g));
    expect(result.incumbent?.proposedText).toBeNull();
    expect(result.pages[0].renderings.map(r => r.dpi)).toEqual([240, 300]);
    expect(result.pages[0].renderings.every(r => /^[a-f0-9]{64}$/.test(r.graySha256))).toBe(true);
    // The production extractor remains gated: a preview is not a saved reading.
    await expect(extractPdfDocumentText(fixture())).rejects.toThrow(PdfTextIntegrityError);
  }, 60_000);

  it("rejects mismatched bytes and stale incumbent hashes before OCR", async () => {
    await expect(previewPdfUnicodeRepair(fixture(), { expectedSourceSha256: "0".repeat(64) })).rejects.toThrow("source hash mismatch");
    await expect(previewPdfUnicodeRepair(fixture(), { expectedSourceSha256: sourceSha256, incumbent: { text: "changed", sha256: hash("before"), sourceSha256 } })).rejects.toThrow("incumbent hash mismatch");
    await expect(previewPdfUnicodeRepair(fixture(), { expectedSourceSha256: sourceSha256, incumbent: { text: "before", sha256: hash("before"), sourceSha256: "0".repeat(64) } })).rejects.toThrow("different source bytes");
  });

  it("honors a pre-cancelled preview without a proposal", async () => {
    const controller = new AbortController(); controller.abort(new Error("operator cancelled preview"));
    await expect(previewPdfUnicodeRepair(fixture(), { expectedSourceSha256: sourceSha256, signal: controller.signal })).rejects.toThrow("operator cancelled preview");
  });

  it("cancels an in-flight visual read and terminates its engine without a proposal", async () => {
    const controller = new AbortController();
    let rejectRead!: (error: Error) => void;
    const terminate = vi.fn(async () => { rejectRead(new Error("engine stopped")); });
    await expect(previewPdfUnicodeRepair(fixture(), {
      expectedSourceSha256: sourceSha256, signal: controller.signal,
      engineFactory: () => ({ terminate, recognize: () => new Promise((_, reject) => {
        rejectRead = reject;
        queueMicrotask(() => controller.abort(new Error("operator cancelled in flight")));
      }) }),
    })).rejects.toThrow("operator cancelled in flight");
    expect(terminate).toHaveBeenCalled();
  }, 20_000);

  it("refuses network OCR model fallback before any visual read", async () => {
    vi.stubEnv("ROSETTA_OCR_LANG_PATH", "https://example.invalid/english");
    try {
      await expect(previewPdfUnicodeRepair(fixture(), { expectedSourceSha256: sourceSha256 })).rejects.toThrow("network fallback is forbidden");
    } finally { vi.unstubAllEnvs(); }
  });
});
