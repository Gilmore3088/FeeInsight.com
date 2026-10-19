import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import type { MarketIncome } from "@/lib/hamilton/workspace/types";
import { FilingExhibits } from "./filing-exhibits";

function row(source: "fdic" | "ncua", quarter: string, total: number): MarketIncome {
  return { financialSource: source, measureDefinition: { ...financialMeasureDefinition(source), unit: "USD" },
    quarter, total, banks: source === "fdic" ? total : 0, creditUnions: source === "ncua" ? total : 0,
    institutions: 25, yoyPct: null, sourceRef: { label: `${source} canonical filers` } };
}

describe("FilingExhibits national income meaning", () => {
  it.each([["fdic", false, "banks", "credit unions", "Deposit service charge income"], ["ncua", true, "credit unions", "banks", "Broad credit-union fee income"]] as const)("charts only the supplied %s financial measure", (source, credit, kind, otherKind, label) => {
    const national = [row(source, "2026-Q2", 3e8), row(source, "2026-Q1", 2e8)];
    // Malformed mixed payloads must not add an opposite-charter chart or a combined total.
    national.push(row(source === "fdic" ? "ncua" : "fdic", "2026-Q2", 99e9));
    const html = renderToStaticMarkup(<FilingExhibits own={null} national={national} revenueLine={null} name="Synthetic institution" credit={credit} />);
    expect(html).toContain(`${label}, ${kind} nationwide`);
    expect(html).toContain(`aria-label="All ${kind} on file by quarter"`);
    expect(html).not.toContain(`All ${otherKind}`);
    expect(html).not.toContain("Banks and credit unions together");
    expect(html).not.toContain("99.0B");
    expect(html).toContain(`Reporting ${kind}`);
    expect(html).toContain("Same source and quarter");
  });

  it("withholds national charts from older payloads without measure lineage", () => {
    const legacy = { ...row("ncua", "2026-Q2", 300), financialSource: undefined, measureDefinition: undefined };
    const html = renderToStaticMarkup(<FilingExhibits own={null} national={[legacy]} revenueLine={null} name="Synthetic CU" credit />);
    expect(html).not.toContain("nationwide");
    expect(html).not.toContain("by quarter");
  });
});
