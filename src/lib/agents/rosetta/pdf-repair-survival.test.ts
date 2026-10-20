// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfDocumentText } from "./pdf-document-text";
import { conservedLayoutTokens, losslessStackedRecovery, textSha256 } from "./pdf-repair-survival";
import { normalizeWhitespace, rungTextNotWorse } from "./read";

const before = readFileSync(join(__dirname, "test-fixtures/oakwood-interleaved.txt"), "utf8");

describe("source-bound stacked repair survival", () => {
  it("proves the real Oakwood geometry keeps every price, word, unit and qualifier", async () => {
    const bytes = readFileSync(join(__dirname, "test-fixtures/oakwood-fees.pdf"));
    const extracted = await extractPdfDocumentText(bytes);
    const after = normalizeWhitespace(extracted.text);
    const receipt = { ...extracted.stackedGeometry!, textHash: textSha256(after) };
    expect(receipt.stackedPages).toEqual([2]);
    expect(rungTextNotWorse(after, before)).toBe(false);
    expect(conservedLayoutTokens(before, after)).toMatchObject({ conserved: true, lost: 0, added: 0 });
    expect(losslessStackedRecovery(before, after, receipt.sourceHash, receipt)).toBe(true);
  });

  it.each([
    ["$35 fee unless waived", "$30 fee unless waived"],
    ["$35 fee unless waived", "$35 fee"],
    ["$35 fee", "$35 fee for consumers"],
    ["$35 per hour", "$35 per item"],
    ["$35 Fee", "$35 fee"],
    ["$35 $35 Fee", "$35 Fee"],
    ["", ""],
  ])("refuses changed literal tokens: %s", (oldText, newText) => {
    expect(conservedLayoutTokens(oldText, newText).conserved).toBe(false);
  });

  it("requires actual detector, source and output binding even for conserved tokens", () => {
    const oldText = "Fee | $35.00 unless waived";
    const newText = "Fee\n$35.00 unless waived";
    const receipt = { sourceHash: "source", textHash: textSha256(newText), stackedPages: [1] };
    expect(losslessStackedRecovery(oldText, newText, "source", receipt)).toBe(true);
    expect(losslessStackedRecovery(oldText, newText, "other", receipt)).toBe(false);
    expect(losslessStackedRecovery(oldText, newText, "source", { ...receipt, textHash: "stale" })).toBe(false);
    expect(losslessStackedRecovery(oldText, newText, "source", { ...receipt, stackedPages: [] })).toBe(false);
    expect(losslessStackedRecovery(oldText, newText, "source", undefined)).toBe(false);
  });
});
