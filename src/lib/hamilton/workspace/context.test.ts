import { describe, expect, it } from "vitest";
import { feeRegulatoryNews, feeRules, marketLayer, ruleChangeObservations } from "./context";

describe("marketLayer", () => {
  it("gives percentiles and the bank's position when at least five institutions publish the fee", () => {
    const layer = marketLayer("national", "National", [25, 30, 32, 35, 35, 36], 35, ["2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"]);
    expect(layer).toMatchObject({ scope: "national", n: 6, p25: 30.5, median: 33.5, p75: 35, asOf: "2026-10-01" });
    expect(layer.position).toBe(67);
    expect(layer.amounts).toEqual([25, 30, 32, 35, 35, 36]);
    expect(layer.bands.reduce((n, b) => n + b.count, 0)).toBe(6);
  });

  it("keeps a thin layer but leaves its percentiles empty", () => {
    const layer = marketLayer("state", "Vermont", [30, 32], 30);
    expect(layer).toMatchObject({ n: 2, p25: null, median: null, p75: null, position: null });
  });
});

describe("feeRules", () => {
  it("cites the credit union notice rule and the overdraft notices", () => {
    const labels = feeRules("overdraft", "credit_union").map((f) => f.source.label);
    expect(labels).toEqual([
      "NCUA Truth in Savings, 12 CFR 707.5(a)",
      "Reg E, 12 CFR 1005.17",
      "NCUA Truth in Savings, 12 CFR 707.11(a)",
    ]);
  });

  it("adds the Reg E change-in-terms notice for ATM fees at banks", () => {
    const labels = feeRules("atm_non_network", "bank").map((f) => f.source.label);
    expect(labels).toContain("Reg DD, 12 CFR 1030.5(a)");
    expect(labels).toContain("Reg E, 12 CFR 1005.8(a)");
  });

  it("never tells the reader what to do with the price", () => {
    const text = feeRules("nsf", "bank").map((f) => f.text).join(" ");
    expect(text).not.toMatch(/should|recommend|raise|lower/i);
  });
});

const article = (title: string, published_at: string, topic = "general") => ({
  source: "CFPB",
  title,
  link: `https://example.gov/${encodeURIComponent(title)}`,
  topic,
  published_at,
});

describe("feeRegulatoryNews and ruleChangeObservations", () => {
  const articles = [
    article("Agencies reduce exam burden for community banks", "2026-09-10T00:00:00Z"),
    article("CFPB issues rule on overdraft fees at large banks", "2026-09-20T00:00:00Z", "rulemaking_compliance"),
    article("Statement on junk fees", "2026-08-01T00:00:00Z"),
  ];

  it("lists only releases whose title names fees, newest first, with the link", () => {
    const facts = feeRegulatoryNews(articles, "overdraft");
    expect(facts.map((f) => f.text)).toEqual([
      "CFPB: CFPB issues rule on overdraft fees at large banks (2026-09-20)",
      "CFPB: Statement on junk fees (2026-08-01)",
    ]);
    expect(facts[0].source).toMatchObject({ table: "reg_articles", asOf: "2026-09-20" });
    expect(facts[0].source.url).toContain("overdraft");
  });

  it("ties a release to a fee the bank charges when the title names it", () => {
    const obs = ruleChangeObservations(articles, new Set(["overdraft", "wire_domestic_outgoing"]));
    expect(obs).toHaveLength(2);
    expect(obs.find((o) => o.headline.includes("overdraft"))).toMatchObject({ kind: "rule_change", feeCategory: "overdraft", salience: 0.8 });
    expect(obs.find((o) => o.headline.includes("junk"))).toMatchObject({ feeCategory: null, actions: ["ask"] });
  });
});
