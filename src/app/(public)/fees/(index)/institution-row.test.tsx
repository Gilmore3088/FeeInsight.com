import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstitutionRow, type ListedPrice } from "./institution-row";
import { countedAs, institutionsFor } from "./index-view";

const category = "money_order";
const rows = [11, 12, 13, 14].map((id) => ({ id, institution_id: 1, institution_name: "Example Bank", amount: 5, charter_type: "bank", state_code: "TX" }));
const inst = institutionsFor(rows, category, null, "all")[0];

function detail(id: number, account: string | null) {
  const url = `https://example.test/${id}.pdf`;
  return {
    fee_name: "Money order", amount: 5, frequency: "per_item", account,
    conditions: "Available only to existing account holders.", document_url: url, source_url: url, read_on: "2026-10-01",
    fee_audience: "consumer", fee_treatment: "standard", variant_type: null, amount_kind: "flat",
    rate_percent: null, rate_min_amount: null, rate_max_amount: null, rate_basis: null,
    context: { version: 1 as const, stamp: String(id).padStart(64, "0"), publishedId: id, institutionId: 1, category, amount: 5, verifiedId: id + 100, rawId: id + 200, sourceDocumentId: id + 300, documentUrl: url, sourceUrl: url },
  };
}

function fixture(): ListedPrice[] {
  return ["Alpha", "Beta", null, " alpha "].map((account, i) => ({ id: i + 11, amount: 5, detail: detail(i + 11, account), evidence: null }));
}
function render(prices = fixture()) {
  return renderToStaticMarkup(<InstitutionRow {...{ inst, prices, category, counted: countedAs(category) }} />);
}

describe("public fee-index applicability (#2207)", () => {
  it("keeps same-price Alpha, Beta and unassigned applicability, and every true-copy source", () => {
    const html = render();
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("Account/product not recorded");
    for (const id of [11, 12, 13, 14]) expect(html).toContain(`https://example.test/${id}.pdf`);
    expect(html).toContain("1 price");
  });

  it("keeps recorded ownership and conditions instead of an ambiguous same-price heading", () => {
    const price = fixture()[0];
    price.evidence = { line: "Money order | $5", heading: "Beta", condition: "Waived for Beta only", basis: "traced" };
    const html = render([price]);
    expect(html).toContain("Alpha");
    expect(html).toContain("Available only to existing account holders.");
    expect(html).not.toContain("Condition: Waived for Beta only");
    expect(html).not.toContain(" · verified");
  });

  it("treats old cached quote shapes as unknown context without erasing recorded applicability", () => {
    const price = fixture()[0];
    price.evidence = { line: "Old quote | $5", heading: "Generic Terms", basis: "traced" };
    const html = render([price]);
    expect(html).toContain("Alpha");
    expect(html).not.toContain("Old quote");
    expect(html).toContain("Stored price context unavailable");
  });

  it("does not describe the publication date as a source-read date", () => {
    const html = render([fixture()[0]]);
    expect(html).toContain("Recorded publication");
    expect(html).not.toContain(" · read ");
    expect(html).not.toContain("Read Oct");
  });

  it("preserves ordinary one-price, zero and empty numerical values", () => {
    expect(render([fixture()[0]])).toContain("$5");
    const zero = { ...fixture()[0], amount: 0, detail: { ...detail(11, "Alpha"), amount: 0 } };
    const freeInst = { ...inst, value: 0 };
    expect(renderToStaticMarkup(<InstitutionRow {...{ inst: freeInst, prices: [zero], category, counted: countedAs(category) }} />)).toContain("$0");
    expect(render([])).toContain("$5");
  });
});
