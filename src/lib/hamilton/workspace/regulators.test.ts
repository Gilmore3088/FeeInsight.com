import { describe, expect, it } from "vitest";
import { buildRegulatoryContext, type StateRule } from "../regulatory-context";
import { regulatorSentence, regulatoryFacts } from "./regulators";

// Invented institutions and counts for tests only; the state rule below is a test fixture, not law.
const testStateRule: StateRule = {
  id: "zz_test_rule",
  name: "Test state overdraft rule",
  citation: "Test Code 1-2-3",
  date: "2026",
  applies_to: ["overdraft"],
  summary: "A test rule that exists only in this test.",
  url: null,
  state_code: "TN",
};

describe("who regulates the institution", () => {
  it("names the federal regulator and the state chartering agency", () => {
    expect(regulatorSentence({ primaryRegulator: "FDIC", charterAgency: "State", source: "fdic" }, "TN", "bank")).toBe(
      "Your charter is from the Tennessee Department of Financial Institutions, and the FDIC is your primary federal regulator.",
    );
    expect(regulatorSentence({ primaryRegulator: "OCC", charterAgency: "OCC", source: "fdic" }, "TN", "bank")).toBe(
      "The OCC charters and supervises you as a national bank.",
    );
    expect(regulatorSentence({ primaryRegulator: "NCUA", charterAgency: "NCUA", source: "ncua" }, "FL", "credit_union")).toBe(
      "NCUA charters and supervises you as a federal credit union.",
    );
    expect(regulatorSentence({ primaryRegulator: null, charterAgency: null, source: "fdic" }, "TN", "bank")).toBeNull();
  });
});

describe("regulatory facts for one fee", () => {
  it("leads with the overdraft exposure rules, then the regulators and complaints, each sourced", () => {
    const facts = regulatoryFacts({
      institutionName: "Example Bank",
      feeCategory: "overdraft",
      stateCode: "TN",
      charterType: "bank",
      regulators: { primaryRegulator: "Federal Reserve", charterAgency: "State", source: "fdic" },
      complaints: [{ year: "2025", total_complaints: 42, fee_related_complaints: 9 }],
    });
    expect(facts.map((f) => f.source.label)).toEqual([
      "CFPB circular on surprise overdraft fees, CFPB Circular 2022-06",
      "CFPB large-bank overdraft rule (disapproved), CFPB final rule, December 2024; disapproved under the Congressional Review Act",
      "FDIC BankFind institution records",
      "CFPB Consumer Complaint Database",
    ]);
    expect(facts[1].text).toBe(
      "The rule capping overdraft fees at institutions over $10 billion in assets was disapproved by Congress and never took effect.",
    );
    expect(facts[3].text).toBe("The CFPB recorded 42 complaints about Example Bank in 2025, 9 about fees or low funds.");
    for (const f of facts) expect(f.text.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(facts.map((f) => f.text).join(" ")).not.toMatch(/should|recommend|raise your|lower your/i);
  });

  it("adds the reviewed state rules it is given, and none otherwise", () => {
    const args = { institutionName: "Example Bank", feeCategory: "overdraft", stateCode: "TN", charterType: "bank", regulators: null, complaints: [] };
    expect(regulatoryFacts({ ...args, stateRules: [testStateRule] }).map((f) => f.text)).toContain("A test rule that exists only in this test.");
    expect(regulatoryFacts(args).map((f) => f.text)).not.toContain("A test rule that exists only in this test.");
  });

  it("names state rules in a report once they are reviewed", () => {
    const ctx = buildRegulatoryContext({
      institutionName: "Example Bank",
      stateCode: "TN",
      charterType: "bank",
      fees: [{ fee_category: "overdraft", institution_amount: 30 }],
      complaintYears: [],
      stateRules: [testStateRule],
    });
    expect(ctx.data.rules.map((r) => r.name)).toContain("Test state overdraft rule");
    expect(ctx.data.limits).not.toMatch(/no source of state fee laws/i);
  });

  it("says in reports that state fee laws are not yet in the data while none is reviewed", () => {
    const ctx = buildRegulatoryContext({ institutionName: "Example Bank", stateCode: "TN", charterType: "bank", fees: [], complaintYears: [] });
    expect(ctx.data.limits).toMatch(/no source of state fee laws/i);
  });
});
