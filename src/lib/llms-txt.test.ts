import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "./llms-txt";

describe("buildLlmsTxt", () => {
  const text = buildLlmsTxt("https://example.test");

  it("follows the llms.txt shape: an H1, a summary quote, then link sections", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Fee Insight");
    expect(lines.find((line) => line.startsWith("> "))).toContain("Bank Fee Index");
    expect(text).toContain("## Look up fees");
  });

  it("links only to public pages on the given host", () => {
    const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(link.startsWith("https://example.test/")).toBe(true);
      expect(link).not.toMatch(/\/(admin|api|pro|pay|r)\//);
    }
  });

  it("carries no counts, so it never goes stale", () => {
    expect(text).not.toMatch(/\d{2,}/);
  });

  it("names the paid report and links Fed districts where they live now (#1167)", () => {
    expect(text).toContain("[Competitive Fee Position Report](https://example.test/reports)");
    expect(text).toContain("https://example.test/research#districts");
    expect(text).not.toContain("https://example.test/districts");
    expect(text).toContain("Hamilton is the Fee Insight Pro workspace");
  });
});
