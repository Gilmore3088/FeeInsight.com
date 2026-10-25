// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocumentProxy } from "unpdf";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { layoutPageText } from "./pdf-layout";
import { extractPdfDocumentText } from "./pdf-document-text";
import { PdfTextIntegrityError } from "./pdf-text-integrity";

const fixture = () => new Uint8Array(readFileSync(join(process.cwd(), "src/lib/agents/rosetta/test-fixtures/reliance-unicode-loss.pdf")));

describe("#2598: the original schedule's Unicode map", () => {
  it("reproduces U+FFFD before layout or whitespace normalization, on the exact captured bytes", async () => {
    const bytes = fixture();
    const digest = () => createHash("sha256").update(bytes).digest("hex");
    expect(digest()).toBe("e1468b1d3f3eacf88e447b1089a901d8531d10bdb925a105b914b86d8e712617");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const page = await pdf.getPage(1);
      for (const disableNormalization of [false, true]) {
        const content = await page.getTextContent({ disableNormalization });
        const items = content.items.filter((item) => "str" in item);
        expect(items.some((item) => item.str === "Wire Interna\uFFFDonal Transfer-Remote Outgoing")).toBe(true);
        // The same replacement also stands for another pair of letters ("ft").
        expect(items.some((item) => item.str.includes("overdra\uFFFDs"))).toBe(true);
        expect(layoutPageText(items)).toContain("Wire Interna\uFFFDonal Transfer-Remote Outgoing");
      }
      expect(digest()).toBe("e1468b1d3f3eacf88e447b1089a901d8531d10bdb925a105b914b86d8e712617");
    } finally { await pdf.destroy(); }
  });

  it("refuses the real damaged text rather than manufacturing a corrected schedule", async () => {
    await expect(extractPdfDocumentText(fixture())).rejects.toThrow(PdfTextIntegrityError);
  });

  it("checks source and category separately for a visually verified transcription", () => {
    // Printed on the rendered fixture, not inferred from U+FFFD or from the price.
    // This is a verification contract, not a replacement of stored production text.
    const name = "Wire International Transfer-Remote Outgoing";
    const sourceLine = `${name} ..$70.00*`;
    expect(checkFeeAgainstSource(sourceLine, name, 70, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(sourceLine, name, 40, ".").ok).toBe(false);
    expect(checkFeeCategory("wire_domestic_outgoing", name).ok).toBe(false);
    expect(refileCategory("wire_domestic_outgoing", name)).toBe("wire_intl_outgoing");
    expect(checkFeeCategory("wire_intl_outgoing", name).ok).toBe(true);
  });
});
