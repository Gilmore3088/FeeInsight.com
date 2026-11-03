// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractPdfDocumentText } from "@/lib/agents/rosetta/pdf-document-text";
import { loadSourceBytes, readSourceManifest, SOURCE_BYTES_DIR } from "./source-bytes";

/**
 * `PDF_COLUMN_READING_LIVE` is inert while off (#1092): every PDF among the answer-key documents'
 * source bytes reads to exactly the text main read before the switch existed (sha256 recorded from
 * main d5771aa66 in `pdf-text-main-sha256.json`), with the switch held off and at its code default.
 */

const HASHES = join(process.cwd(), SOURCE_BYTES_DIR, "pdf-text-main-sha256.json");
const READ_TIMEOUT_MS = 180_000;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("PDF_COLUMN_READING_LIVE off", () => {
  it(
    "should_read_every_replay_pdf_byte_for_byte_as_main_did",
    async () => {
      const recorded = (JSON.parse(readFileSync(HASHES, "utf8")) as { sha256: Record<string, string> }).sha256;
      const pdfs = readSourceManifest().accepted.filter((entry) => entry.reader === "read.pdf_layout");
      expect(pdfs.map((entry) => entry.caseKey).sort()).toEqual(Object.keys(recorded).sort());
      for (const entry of pdfs) {
        const bytes = loadSourceBytes(entry);
        const switchedOff = await extractPdfDocumentText(bytes, { columnReading: false });
        const byDefault = await extractPdfDocumentText(bytes);
        expect(sha256(switchedOff.text), entry.caseKey).toBe(recorded[entry.caseKey]);
        expect(byDefault.text, entry.caseKey).toBe(switchedOff.text);
      }
    },
    READ_TIMEOUT_MS,
  );
});
