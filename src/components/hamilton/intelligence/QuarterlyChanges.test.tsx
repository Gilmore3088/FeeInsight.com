import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuarterlyChanges } from "./QuarterlyChanges";

// Invented changes for tests only.
const diff = (count: number, fromPeerLabel = "Texas banks") => ({
  kind: "diff" as const,
  diff: {
    institutionId: 1,
    fromQuarter: "2026-Q4",
    toQuarter: "2027-Q1",
    fromGeneratedAt: "2026-10-07T00:00:00Z",
    toGeneratedAt: "2027-01-07T00:00:00Z",
    fromPeerLabel,
    toPeerLabel: "Texas banks",
    changes: Array.from({ length: count }, (_, i) => ({ kind: "own_price" as const, feeCategory: "overdraft", text: `Change ${i + 1}.` })),
  },
});

describe("QuarterlyChanges (#1083)", () => {
  it("shows nothing until a quarterly copy is stored", () => {
    expect(renderToStaticMarkup(<QuarterlyChanges changes={null} />)).toBe("");
  });

  it("with one copy, says when the first comparison comes", () => {
    const html = renderToStaticMarkup(<QuarterlyChanges changes={{ kind: "first", quarter: "2026-Q4" }} />);
    expect(html).toContain("Since last quarter");
    expect(html).toContain("Hamilton saved this briefing for Q4 2026. From Q1 2027, this");
  });

  it("lists what changed, folding the rest under More", () => {
    const html = renderToStaticMarkup(<QuarterlyChanges changes={diff(8)} />);
    expect(html).toContain("Since Q4 2026");
    expect(html).toContain("Q4 2026 briefing compared with Q1 2027, both read against Texas banks.");
    expect(html).toContain("Change 1.");
    expect(html).toContain("2 more changes");
    expect(html).toContain("Change 8.");
  });

  it("says so when nothing changed, naming the peer group", () => {
    const html = renderToStaticMarkup(<QuarterlyChanges changes={diff(0)} />);
    expect(html).toContain("Nothing in this briefing changed between Q4 2026 and Q1 2027.");
    expect(html).toContain("Q4 2026 briefing compared with Q1 2027, both read against Texas banks.");
  });

  it("names each peer group when they differ", () => {
    const html = renderToStaticMarkup(<QuarterlyChanges changes={diff(1, "US banks")} />);
    expect(html).toContain("the Q4 2026 copy read against US banks, the Q1 2027 copy against Texas banks");
    expect(html).not.toContain("both read against");
  });
});
