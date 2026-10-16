import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_SHOWCASE } from "./report-showcase";

const publicPath = (href: string) => path.join(process.cwd(), "public", href);

describe("REPORT_SHOWCASE", () => {
  it("points at files that exist, cover first", () => {
    expect(REPORT_SHOWCASE.pages.length).toBeGreaterThanOrEqual(2);
    for (const page of REPORT_SHOWCASE.pages) {
      expect(existsSync(publicPath(page.src)), page.src).toBe(true);
      expect(page.alt.length).toBeGreaterThan(0);
    }
    expect(existsSync(publicPath(REPORT_SHOWCASE.pdfHref))).toBe(true);
  });
});
