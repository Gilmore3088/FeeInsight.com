import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextUsed } from "./ContextUsed";

describe("ContextUsed (#1895)", () => {
  it("shows the institution, peers and fee the answer used, and that follow-ups keep them", () => {
    const html = renderToStaticMarkup(
      <ContextUsed
        context={{
          subject: { name: "Example Valley Credit Union", from: "manual" },
          peers: { label: "Credit unions, $300M to $1B in assets, Tennessee", n: 14, asOf: "2026-09-30" },
          fee: { category: "overdraft", from: "page" },
        }}
      />,
    );
    expect(html).toContain("Context used");
    expect(html).toContain("Example Valley Credit Union");
    expect(html).toContain("your workspace institution");
    expect(html).toContain("14 publish this fee on schedules read through Sep 30, 2026");
    expect(html).toContain("Overdraft");
    expect(html).toContain("from the page you came from");
    expect(html).toContain("Follow-ups keep this context.");
    expect(html).not.toContain("—");
  });
});
