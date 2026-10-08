import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Reference pages and the Regulatory Wire share the living-memo look of the main tabs.
const root = join(process.cwd(), "src/app/pro/(hamilton)");
const PAGES = ["categories", "districts", "market", "news", "data"] as const;
const source = (segment: string) => readFileSync(join(root, segment, "page.tsx"), "utf8");

describe("Reference pages and the Regulatory Wire", () => {
  it.each(PAGES)("%s uses the memo page and header, without its own outer padding", (segment) => {
    const src = source(segment);
    expect(src).toContain("<MemoPage>");
    expect(src).toContain("<MemoHeader");
    expect(src).not.toMatch(/max-w-7xl|px-6 py-1[04]/);
  });

  it.each(PAGES)("%s uses colour tokens and readable text sizes", (segment) => {
    const src = source(segment);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(?:bg|text|border)-(?:blue|gray|amber|emerald)-\d/);
    expect(src).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/);
    expect(src).not.toMatch(/(?:^|[\s>`])n=[{$]/m);
  });

  it("sends fee links to My fees, not Try a price", () => {
    for (const segment of ["categories", "market"]) {
      const src = source(segment);
      expect(src).toContain("/pro/research?fee=");
      expect(src).not.toContain("/pro/simulate?category=");
    }
  });

  it("keeps the wire's updated-daily mark still", () => {
    expect(source("news")).not.toContain("animate-ping");
  });
});
