// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { locateQuote } from "./evidence-pilot";

describe("locateQuote", () => {
  const text = "Fee Schedule\n🏦 Overdraft Fee   $35.00\nper item\nStop Payment – $30.00 “each”";

  it("returns the original characters whatever the case, spacing, dash or quote style", () => {
    expect(locateQuote(text, "overdraft fee $35.00 per item")?.segment).toBe("Overdraft Fee   $35.00\nper item");
    expect(locateQuote(text, "Stop Payment - $30.00 \"each\"")?.segment).toBe("Stop Payment – $30.00 “each”");
  });

  it("counts offsets in code points, as PostgreSQL substr does", () => {
    const span = locateQuote(text, "Overdraft Fee")!;
    const chars = Array.from(text);
    expect(chars.slice(span.start, span.end).join("")).toBe("Overdraft Fee");
    expect(span.start).toBe(text.indexOf("Overdraft") - 1); // the emoji is two UTF-16 units, one code point
  });

  it("returns null for a quote that is not in the text, or an empty quote", () => {
    expect(locateQuote(text, "Overdraft Fee $36.00")).toBeNull();
    expect(locateQuote(text, "   ")).toBeNull();
  });
});
