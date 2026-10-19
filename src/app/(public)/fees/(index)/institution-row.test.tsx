import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstitutionRow, type ListedPrice } from "./institution-row";
import { countedAs, institutionsFor } from "./index-view";
import { listedPriceLines } from "./listed-prices";

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
function matched(price: ListedPrice) {
  return { line: "Money order | $5", heading: "Beta Checking", condition: "Waived for Beta only", basis: "traced" as const,
    context: price.detail!.context, text_artifact: { version: 1 as const, id: 411, institutionId: 1, sourceDocumentId: price.detail!.context!.sourceDocumentId!, status: "completed" as const, textHash: "f".repeat(64), recordedAt: "2026-09-01 00:00:00+00" } };
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

  it("groups true Alpha copies while retaining every own source observation", () => {
    expect(listedPriceLines(fixture(), { institutionId: 1, category }).map(l => l.observations.map(p => p.id))).toEqual([[11,14],[12],[13]]);
  });

  it.each(["ALPHA", " Alpha  ", "\tAlpha\u00a0"])("uses the existing conservative product key for %j", (name) => {
    const [a,,,b] = fixture(); b.detail!.account = name;
    expect(listedPriceLines([a,b], { institutionId:1, category })).toHaveLength(1);
  });

  it.each(["Alpha Plus", "Ålpha", "alpha\u2003"])("does not erase meaningful/unsupported product distinctions in %j", (name) => {
    const [a,,,b] = fixture(); b.detail!.account = name;
    expect(listedPriceLines([a,b], { institutionId:1, category })).toHaveLength(2);
  });

  it("distinguishes actual unassigned ownership from unavailable record context", () => {
    const [a,,unknown] = fixture(); a.detail = null;
    const html = render([a,unknown]);
    expect(html).toContain("Recorded applicability unavailable");
    expect(html).toContain("Account/product not recorded");
  });

  it("keeps unknown frequency unknown rather than borrowing a matched price-context period", () => {
    const p = fixture()[0]; p.detail!.frequency = "unknown"; p.evidence = matched(p);
    p.evidence.line = "Money order | $5 per day";
    expect(render([p])).toContain("Charging unit not recorded");
    expect(render([p])).not.toContain('class="text-ink-muted"> per day');
  });

  it.each([
    ["conditions", "Different own condition"], ["fee_audience", "business"], ["fee_treatment", "conditional"],
    ["frequency", "monthly"], ["variant_type", "tiered"], ["rate_percent", 1], ["rate_min_amount", 1],
    ["rate_max_amount", 10], ["rate_basis", "transaction_amount"], ["fee_name", "Postal money order"],
  ] as const)("preserves same-price observations with different %s", (field, value) => {
    const [a,,,b] = fixture();
    b.detail = { ...b.detail!, [field]: value };
    expect(listedPriceLines([a,b], { institutionId: 1, category })).toHaveLength(2);
  });

  it("keeps an absent detail or incomplete old detail separate rather than merging unknowns", () => {
    const [a,,,b] = fixture();
    a.detail = null;
    delete b.detail!.context;
    const lines = listedPriceLines([a,b], { institutionId: 1, category });
    expect(lines).toHaveLength(2);
    expect(lines.every(l => l.detail === null)).toBe(true);
  });

  it.each(["amount", "institution", "category", "id"])("does not attach fresh context to a stale cached index %s", (field) => {
    const p = fixture()[0];
    p.evidence = matched(p);
    if (field === "amount") { p.detail!.amount = 7; p.detail!.context!.amount = 7; p.evidence.line = "Money order | $7"; }
    if (field === "institution") p.detail!.context!.institutionId = 2;
    if (field === "category") p.detail!.context!.category = "stop_payment";
    if (field === "id") p.detail!.context!.publishedId = 99;
    const html = render([p]);
    expect(html).not.toContain("Alpha");
    expect(html).not.toContain("Beta Checking");
    expect(html).not.toContain("https://example.test/11.pdf");
    expect(html).not.toContain("$7");
    expect(html).toContain("Recorded applicability unavailable");
    expect(html).toContain("Stored price context unavailable");
  });

  it("shows a bound same-document wrong-heading match only as price context, preserving recorded applicability", () => {
    const p = fixture()[0]; p.evidence = matched(p);
    const html = render([p]);
    expect(html).toContain("Alpha");
    expect(html).toContain("Matched text heading: Beta Checking");
    expect(html).toContain("Relationship to the recorded account and conditions is not established");
    expect(html).toContain("Condition: Available only to existing account holders.");
    expect(html).not.toContain("Condition: Waived for Beta only");
    expect(html).not.toContain("verified");
  });

  it.each(["stamp", "document", "institution", "artifactVersion", "artifactHash"])("leaves a mismatched %s quote unknown", (field) => {
    const p = fixture()[0]; p.evidence = structuredClone(matched(p));
    if (field === "stamp") p.evidence.context!.stamp = "b".repeat(64);
    if (field === "document") p.evidence.text_artifact!.sourceDocumentId = 999;
    if (field === "institution") p.evidence.text_artifact!.institutionId = 999;
    if (field === "artifactVersion") Object.assign(p.evidence.text_artifact!, { version: 0 });
    if (field === "artifactHash") p.evidence.text_artifact!.textHash = "unknown";
    const html = render([p]);
    expect(html).toContain("Alpha");
    expect(html).not.toContain("Beta Checking");
    expect(html).toContain("Stored price context unavailable");
  });

  it("filters unsafe source links and escapes recorded source/application text", () => {
    const p = fixture()[0];
    p.detail!.account = '<script>alert("x")</script>';
    p.detail!.conditions = "<img src=x onerror=alert(1)>";
    p.detail!.document_url = "javascript:alert(1)";
    p.detail!.source_url = "https://name:password@example.test/secret.pdf";
    p.detail!.context = { ...p.detail!.context!, documentUrl: p.detail!.document_url, sourceUrl: p.detail!.source_url };
    const html = render([p]);
    expect(html).toContain("&lt;script&gt;"); expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>"); expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("password@example.test");
    expect(html).toContain("Source link unavailable");
  });

  it("retains recorded owner text beyond the inference-only name filter", () => {
    const p = fixture()[0];
    p.detail!.account = "A named product without checking or account words and with more than sixty characters";
    expect(render([p])).toContain(p.detail!.account);
  });

  it("keeps the original higher overdraft value and displayed price range", () => {
    const prices = [5,20,35].map((amount, i) => ({ ...fixture()[i], amount }));
    const html = renderToStaticMarkup(<InstitutionRow inst={{ ...inst, value: 35 }} prices={prices} category="overdraft" counted={countedAs("overdraft")} />);
    expect(html).toContain("$5–$35"); expect(html).toContain("Counted once, at $35");
  });
});
