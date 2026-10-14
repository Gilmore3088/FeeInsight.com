import { readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SAMPLE_REPORT_PAGE_COUNT } from "./home-stats";
import { SAMPLE_PAGES } from "./home-report";
import { SAMPLE_REPORT_PDF_HREF } from "./sample-report-form";
import { WALKTHROUGH_VIDEO } from "./hero-video";

const PUBLIC = join(process.cwd(), "public");
const SAMPLE_PDF = join(PUBLIC, "reports/sample-competitive-fee-position.pdf");
/** The hero video must stay small enough to play on a phone connection. */
const VIDEO_BYTE_LIMIT = 5 * 1024 * 1024;

describe("homepage assets", () => {
  it("states the sample report's real page count", async () => {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(SAMPLE_PDF)));
    expect(pdf.numPages).toBe(SAMPLE_REPORT_PAGE_COUNT);
  });

  it("offers the same bytes as the sample report for download", () => {
    const served = readFileSync(join(PUBLIC, SAMPLE_REPORT_PDF_HREF));
    expect(served.equals(readFileSync(SAMPLE_PDF))).toBe(true);
  });

  it("ships pages 1 to 3 of the sample as AVIF and WebP", () => {
    expect(SAMPLE_PAGES).toHaveLength(3);
    for (const page of SAMPLE_PAGES) {
      for (const ext of ["avif", "webp"]) {
        expect(statSync(join(PUBLIC, `${page.stem}.${ext}`)).size).toBeGreaterThan(0);
      }
    }
  });

  it("ships the walkthrough video, poster and captions, with the video under 5 MB", () => {
    expect(statSync(join(PUBLIC, WALKTHROUGH_VIDEO.src)).size).toBeLessThan(VIDEO_BYTE_LIMIT);
    expect(statSync(join(PUBLIC, WALKTHROUGH_VIDEO.poster)).size).toBeGreaterThan(0);
    expect(readFileSync(join(PUBLIC, WALKTHROUGH_VIDEO.captions), "utf8")).toMatch(/^WEBVTT/);
  });
});
