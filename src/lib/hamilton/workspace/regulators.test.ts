import { describe, expect, it } from "vitest";
import { buildRegulatoryContext, type StateRule } from "../regulatory-context";
import type { ComplaintBenchmark } from "@/lib/data-store/complaints";
import { complaintBenchmarkFact, regulatorSentence, regulatoryFacts } from "./regulators";

// Invented institutions and counts for tests only; the state rule below is a test fixture, not law.
const testStateRule: StateRule = {
  id: "zz_test_rule",
  name: "Test state overdraft rule",
  citation: "Test Code 1-2-3",
  date: "2026",
  status: "binding_law",
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

describe("regulator and complaint lines fit a storyline line (#1076)", () => {
  const long = "First Federal Savings and Loan Association of Greater Example County";
  const wordsIn = (t: string) => t.split(/\s+/).length;

  it("keeps the institution's name and shortens the wording when the full sentence runs past 20 words", () => {
    const fdic = regulatorSentence({ primaryRegulator: "FDIC", charterAgency: "State", source: "fdic" }, "TN", "bank", "Example Community Bank of Middle Tennessee")!;
    expect(fdic).toBe("Example Community Bank of Middle Tennessee has a state charter; the FDIC is its primary federal regulator.");
    expect(wordsIn(fdic)).toBeLessThanOrEqual(20);
    const longest = regulatorSentence({ primaryRegulator: "Federal Reserve", charterAgency: "State", source: "fdic" }, "TN", "bank", long)!;
    expect(longest).toBe(`${long} has a state charter; the Federal Reserve is its primary federal regulator.`);
    const cu = regulatorSentence({ primaryRegulator: "NCUA", charterAgency: "State", source: "ncua" }, "TN", "credit_union", long)!;
    expect(cu.startsWith(long)).toBe(true);
    expect(wordsIn(cu)).toBeLessThanOrEqual(20);
  });

  it("keeps the second person throughout when no name is given", () => {
    const ca = regulatorSentence({ primaryRegulator: "Federal Reserve", charterAgency: "State", source: "fdic" }, "CA", "bank")!;
    expect(ca).toMatch(/^Your charter is from the /);
    expect(ca).not.toMatch(/\bits\b/);
    expect(ca.split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it("keeps a short name's full sentence unchanged", () => {
    expect(regulatorSentence({ primaryRegulator: "FDIC", charterAgency: "State", source: "fdic" }, "TN", "bank", "Example Bank")).toBe(
      "Example Bank's charter is from the Tennessee Department of Financial Institutions, and the FDIC is Example Bank's primary federal regulator.",
    );
  });

  it("shortens the complaint benchmark for a long name, keeping both rates", () => {
    const bench: ComplaintBenchmark = {
      institution_id: 1, institution_name: long, year: "2025", match_status: "matched",
      total_complaints: 40, fee_complaints: 12, deposits_thousands: 3_500_000, fee_complaints_per_billion: 3.4,
      peer_level: "state", peer_label: "NH", peer_count: 42, eligible_peer_count: 300, peer_coverage: "verified", peers_with_fee_complaints: 9, peer_median_per_billion: 0.8,
      peer_median_fee_complaints: 0, peer_fee_complaints_total: 30, sub_issues_loaded: true, summary: "",
    };
    const text = complaintBenchmarkFact(bench, "Example Community Bank of Middle Tennessee")!.text;
    expect(wordsIn(text)).toBeLessThanOrEqual(20);
    expect(text).toContain("34 per $10B of deposits");
    expect(text).toBe("Example Community Bank of Middle Tennessee's 2025 CFPB fee complaints equal 34 per $10B of deposits; peers' median is 8.");
    expect(text.startsWith("Example Community Bank of Middle Tennessee's")).toBe(true);
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
      "FDIC instruction on accurate consumer disclosures, FDIC FIL-15-2026",
      "Overdraft and NSF fee risk controls, Federal UDAP and UDAAP prohibitions (Prudent practice; the underlying laws still apply)",
      "CFPB circular on surprise overdraft fees, CFPB Circular 2022-06 (Withdrawn on May 12, 2025; history only, not a current rule)",
      "CFPB large-bank overdraft rule, CFPB final rule, December 2024; disapproved under the Congressional Review Act (Disapproved by Congress in May 2025; history only, not a current rule)",
      "FDIC BankFind institution records",
      "CFPB Consumer Complaint Database",
    ]);
    expect(facts.map((f) => f.source.kind)).toEqual([undefined, "rule_practice", "rule_withdrawn", "rule_withdrawn", undefined, undefined]);
    expect(facts[0].text).toBe(
      "The FDIC continues to instruct institutions to keep consumer disclosures accurate, reflecting actual practices and applicable laws.",
    );
    expect(facts[1].text).toBe(
      "Withdrawn guidance does not repeal federal bans on unfair or deceptive practices; re-presentment controls and avoiding unexpected fees remain prudent.",
    );
    expect(facts[2].text).toBe("The CFPB circular on surprise overdraft fees was withdrawn on May 12, 2025; it is history, not a current rule.");
    expect(facts[3].text).toBe("The CFPB large-bank overdraft rule was disapproved by Congress in May 2025; it is history, not a current rule.");
    expect(facts[5].text).toBe("The CFPB recorded 42 complaints about Example Bank in 2025, 9 about fees or low funds.");
    for (const f of facts) expect(f.text.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(facts.map((f) => f.text).join(" ")).not.toMatch(/should|recommend|raise your|lower your/i);
  });

  it("never states withdrawn or rescinded guidance as a current rule (#2525)", () => {
    const args = { institutionName: "Example Bank", stateCode: "TN", charterType: "bank", regulators: null, complaints: [] };
    const nsf = regulatoryFacts({ ...args, feeCategory: "nsf" });
    const fdic = nsf.find((f) => f.source.label.includes("FIL-40-2022"))!;
    // 2022 guidance, rescinded in 2023; its 2023 replacement rescinded in 2026.
    expect(fdic.text).toBe("The FDIC guidance on re-presented NSF items was rescinded on June 16, 2023; it is history, not a current rule.");
    expect(fdic.source.label).toContain("replaced by FDIC FIL-32-2023, itself rescinded effective April 10, 2026 (FDIC FIL-15-2026)");
    expect(fdic.text).not.toMatch(/risks|is an unfair|can be an unfair/i);
    const overdraft = regulatoryFacts({ ...args, feeCategory: "overdraft" });
    const circular = overdraft.find((f) => f.source.label.includes("Circular 2022-06"))!;
    expect(circular.text).toMatch(/withdrawn on May 12, 2025; it is history, not a current rule\.$/);
    expect(circular.text).not.toMatch(/can be an unfair practice/);
    // Risk context stays, and never says a fee is now lawful.
    const all = [...nsf, ...overdraft].map((f) => f.text).join(" ");
    expect(all).toMatch(/does not repeal federal bans on unfair or deceptive practices/);
    expect(all).not.toMatch(/\b(now )?(legal|lawful|illegal|allowed)\b/i);
    expect(all).not.toMatch(/not a legal requirement/);
    // In force first, so history never crowds a current item out of a short list.
    expect(overdraft.findIndex((f) => f.source.label.includes("history only"))).toBeGreaterThan(
      overdraft.findIndex((f) => f.source.label.includes("Prudent practice")),
    );
    expect(overdraft.findIndex((f) => f.source.label.includes("Prudent practice"))).toBeGreaterThan(
      overdraft.findIndex((f) => f.source.label.includes("FIL-15-2026")),
    );
  });

  it("says so when the complaint total is for the year still being counted (A5)", () => {
    const facts = regulatoryFacts({
      institutionName: "Example Bank",
      feeCategory: "wire_transfer",
      stateCode: "NH",
      charterType: "bank",
      regulators: null,
      complaints: [{ year: "2026", total_complaints: 42, fee_related_complaints: 9 }, { year: "2025", total_complaints: 50, fee_related_complaints: 11 }],
      now: new Date("2026-10-27T00:00:00Z"),
    });
    const line = facts.find((f) => f.source.table === "institution_complaint_records")!;
    expect(line.text).toBe("The CFPB recorded 42 complaints about Example Bank so far in 2026, 9 about fees or low funds.");
  });

  it("says one complaint, not \"1 complaints\"", () => {
    const facts = regulatoryFacts({
      institutionName: "Example Bank",
      feeCategory: "wire_transfer",
      stateCode: "NH",
      charterType: "bank",
      regulators: null,
      complaints: [{ year: "2025", total_complaints: 1, fee_related_complaints: 0 }],
      now: new Date("2026-10-27T00:00:00Z"),
    });
    const line = facts.find((f) => f.source.table === "institution_complaint_records")!;
    expect(line.text).toBe("The CFPB recorded 1 complaint about Example Bank in 2025, 0 about fees or low funds.");
  });

  it("sets fee complaints beside peers' as a rate per $10B of deposits, only for a confirmed CFPB match", () => {
    const bench: ComplaintBenchmark = {
      institution_id: 1, institution_name: "Example Bank", year: "2025", match_status: "matched",
      total_complaints: 40, fee_complaints: 12, deposits_thousands: 3_500_000, fee_complaints_per_billion: 3.4,
      peer_level: "state", peer_label: "NH", peer_count: 42, eligible_peer_count: 300, peer_coverage: "verified", peers_with_fee_complaints: 9, peer_median_per_billion: 0.8,
      peer_median_fee_complaints: 0, peer_fee_complaints_total: 30, sub_issues_loaded: true, summary: "",
    };
    const fact = complaintBenchmarkFact(bench)!;
    expect(fact.text).toBe("Your 12 CFPB fee complaints in 2025 equal 34 per $10B of deposits; 42 New Hampshire peers' median is 8.");
    expect(fact).toMatchObject({ sampleSize: 42, source: { table: "institution_complaint_records", asOf: "2025-12-31" } });
    expect(complaintBenchmarkFact({ ...bench, peer_level: "fed_district", peer_label: "Fed District 1" })!.text).toContain("42 District 1 peers' median is 8.");
    expect(complaintBenchmarkFact({ ...bench, peer_level: "national", peer_label: "nationwide" })!.text).toContain("42 peers' median nationwide is 8.");
    expect(complaintBenchmarkFact({ ...bench, fee_complaints: 0, fee_complaints_per_billion: 0 })!.text).toBe(
      "You had no CFPB fee complaints in 2025; 9 of 42 New Hampshire peers had any.",
    );
    expect(complaintBenchmarkFact({ ...bench, fee_complaints: 1, fee_complaints_per_billion: 0.04, peer_median_per_billion: 0 })!.text).toBe(
      "Your CFPB fee complaint in 2025 equals under 1 per $10B of deposits; 42 New Hampshire peers' median is 0.",
    );
    expect(complaintBenchmarkFact({ ...bench, match_status: "none" })).toBeNull();
    expect(complaintBenchmarkFact({ ...bench, match_status: "unconfirmed", fee_complaints: null })).toBeNull();
    const thin = complaintBenchmarkFact({ ...bench, peer_level: "national", peer_label: "nationwide", peer_count: 6, eligible_peer_count: 1210, peer_coverage: "insufficient", peer_median_per_billion: null })!;
    expect(thin.text).toBe("Only 6 of 1,210 similar institutions have a verified CFPB match, too few to compare fee complaint rates.");
    expect(thin.text).not.toMatch(/median|per \$10B/);
    expect(thin.text.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(complaintBenchmarkFact({ ...bench, peer_count: 0, eligible_peer_count: 0, peer_coverage: "insufficient", peer_median_per_billion: null })).toBeNull();
    expect(thin).toMatchObject({ sampleSize: 6, source: { table: "institution_identity_links" } });
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
