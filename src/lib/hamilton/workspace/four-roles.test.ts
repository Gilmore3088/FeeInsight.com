import { describe, expect, it } from "vitest";
import { buildFeeAnswer, economicDrivers, proseFeeName } from "./answer";
import { economicBackdrop, beigeBookExcerpt } from "./economy";
import { evaluateFourRoles, sentences } from "./four-roles";
import { economyContext, overdraftResearch } from "./test-fixtures";
import type { HamiltonAnswer } from "./types";

function failuresOf(answer: HamiltonAnswer, role: string): string[] {
  return evaluateFourRoles(answer).roles.find((r) => r.role === role)?.failures ?? [];
}

describe("four-roles eval: one overdraft answer", () => {
  const answer = buildFeeAnswer(overdraftResearch());

  it("passes all four roles", () => {
    const result = evaluateFourRoles(answer);
    expect(result.roles.flatMap((r) => r.failures)).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("writer: leads with the number in one short sentence", () => {
    expect(answer.headline).toBe("Your $32 overdraft fee is at the 75th percentile of 16 peers (median $29.50).");
  });

  it("consultant: every claim carries a number, a dated source and, for markets, the peer count", () => {
    expect(answer.claims.map((c) => c.text)).toEqual([
      "Your published overdraft fee is $32.",
      "Across 16 peers, the median is $29.50 and the middle half runs $25.75 to $32.",
      "The Tennessee median is $30 across 64 institutions.",
      "The national median is $29 across 1,840 institutions.",
      "Your fee income was $209 thousand in the year to June 30, 2026, up 4.2%.",
    ]);
    expect(answer.claims[1].sampleSize).toBe(16);
    expect(answer.claims[0].source.url).toBe("https://example.org/own-schedule.pdf");
    expect(answer.evidenceLevel).toBe("market");
  });

  it("economist: explains with prices, rates, the FOMC, jobs, the Beige Book and district research, and asks for the missing figure", () => {
    expect(answer.drivers.map((d) => d.text)).toEqual([
      "Prices for bank services rose 5.0% in the year to August 2026, faster than the 3.1% change in all consumer prices.",
      "The federal funds rate was 3.9% in August 2026, down from 4.6% a year earlier.",
      "Lower rates shrink what banks earn on deposits, so fee income carries more of the load.",
      'At its July 29, 2026 meeting, per the FOMC minutes: "In support of the Committee\'s dual-mandate goals, nine members agreed to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent."',
      "Tennessee unemployment was 4.1% in August 2026, against 3.6% nationally.",
      "A weaker job market than the nation's usually means more accounts running short.",
      'Per the Atlanta Fed\'s Beige Book of September 3, 2026: "Loan demand softened. Deposit levels were steady across the district, and credit quality held up."',
      'The Atlanta Fed published "Who Pays Overdraft Fees?" on September 15, 2026.',
    ]);
    expect(answer.question).toMatchObject({ inputKind: "number", fieldKey: "fee.overdraft.annual_items" });
  });

  it("data engineer: one fee-position exhibit with the band and state and national markers", () => {
    expect(answer.exhibit).toMatchObject({
      kind: "fee_position",
      title: "Your $32 overdraft fee against 16 peers",
      own: 32,
      band: { p25: 25.75, median: 29.5, p75: 32, n: 16 },
    });
    const markers = answer.exhibit?.kind === "fee_position" ? answer.exhibit.markers.map((m) => m.label) : [];
    expect(markers).toEqual(["Peer median", "National median", "Fed district 6 (Atlanta) median", "Tennessee median", "Credit unions, $300M to $1B in assets median"]);
  });
});

describe("four-roles eval catches each kind of failure", () => {
  const good = buildFeeAnswer(overdraftResearch());

  it("consultant: a recommendation nobody asked for", () => {
    const bad = { ...good, drivers: [...good.drivers, { ...good.drivers[0], text: "You should raise your fee to $35." }] };
    expect(failuresOf(bad, "consultant").join(" ")).toContain("Recommendation not asked for");
  });

  it("consultant: a market figure without its peer count", () => {
    const bad = { ...good, claims: good.claims.map((c) => ({ ...c, sampleSize: undefined })) };
    expect(failuresOf(bad, "consultant").join(" ")).toContain("without its peer count");
  });

  it("consultant: a cited rule or a regulator record needs a named source, not a number or peer count", () => {
    const rule = { text: "The rule capping overdraft fees at institutions over $10 billion in assets never took effect.", source: { label: "Overdraft rule, CFPB final rule, December 2024; disapproved under the Congressional Review Act" } };
    const regulator = { text: "The OCC charters and supervises you as a national bank.", source: { label: "FDIC BankFind institution records", table: "institution_sources", asOf: "2026-10-08" } };
    expect(failuresOf({ ...good, claims: [...good.claims, rule, regulator] }, "consultant")).toEqual([]);
    const undated = { ...regulator, source: { ...regulator.source, asOf: undefined } };
    expect(failuresOf({ ...good, claims: [...good.claims, undated] }, "consultant").join(" ")).toContain("no named, dated source");
    const plain = { text: "Overdraft fees can be an unfair practice.", source: { label: "A blog post", asOf: "2026-10-01" } };
    expect(failuresOf({ ...good, claims: [...good.claims, plain] }, "consultant").join(" ")).toContain("Claim has no number");
  });

  it("writer: a long sentence, a pipeline term and unformatted units", () => {
    const bad = {
      ...good,
      claims: [
        ...good.claims,
        {
          text: "Darwin verified that income was $2,640,000 and grew 4.18% which is a figure that we have taken from the filings of every credit union in the state over the last year.",
          source: good.claims[0].source,
        },
      ],
    };
    const failures = failuresOf(bad, "writer").join(" | ");
    expect(failures).toContain("-word sentence");
    expect(failures).toContain("Pipeline term");
    expect(failures).toContain("not written as millions");
    expect(failures).toContain("more than one decimal");
  });

  it("data engineer: no exhibit", () => {
    expect(failuresOf({ ...good, exhibit: null }, "data_engineer")).toEqual(["No exhibit."]);
  });

  it("economist: market-only evidence and no question", () => {
    expect(failuresOf({ ...good, question: null }, "economist").join(" ")).toContain("asks no clarifying question");
    expect(failuresOf({ ...good, drivers: [] }, "economist").join(" ")).toContain("No driver");
  });
});

describe("answer edge cases", () => {
  it("asks for the current fee when the schedule has none", () => {
    const answer = buildFeeAnswer(overdraftResearch({ current: null, ownRows: [] }));
    expect(answer.headline).toBe("Your overdraft fee is not in the index yet; 16 peers' median is $29.50.");
    expect(answer.question).toMatchObject({ fieldKey: "fee.overdraft.current_amount" });
    expect(answer.exhibit?.title).toBe("The overdraft fee across 16 peers");
  });

  it("states income in words and labels the evidence when the filing has a line for the fee", () => {
    const answer = buildFeeAnswer(
      overdraftResearch({
        revenueLine: {
          annualIncome: 1_250_000,
          label: "Overdraft fee income (NCUA 5300, IS0048)",
          quarterEnd: "2026-06-30",
          source: { label: "NCUA 5300, account IS0048", table: "institution_financial_records" },
        },
      }),
    );
    expect(answer.claims.map((c) => c.text)).toContain("Your filing reports $1.3 million in overdraft income over the four quarters to June 30, 2026.");
    expect(answer.evidenceLevel).toBe("working_estimate");
    expect(answer.question).toBeNull();
    expect(evaluateFourRoles(answer).pass).toBe(true);
  });

  it("draws local competitors when asked for that view", () => {
    const answer = buildFeeAnswer(overdraftResearch(), { focus: "competitors" });
    expect(answer.exhibit).toMatchObject({ kind: "competitor_range", items: [{ amount: 25 }, { amount: 30 }, { amount: 35 }] });
  });

  it("leaves the job-market line out for fees that do not depend on short balances", () => {
    const drivers = economicDrivers(economicBackdrop(economyContext, "Tennessee", 6, "Atlanta"), "wire_domestic_outgoing");
    expect(drivers.map((d) => d.text).join(" ")).not.toContain("accounts running short");
  });

  it("quotes the FOMC's rate decision and names the district Fed's newest research, each with its source", () => {
    const drivers = economicDrivers(economicBackdrop(economyContext, "Tennessee", 6, "Atlanta"), "overdraft");
    const fomc = drivers.find((d) => d.source?.table === "fed_fomc_minutes");
    expect(fomc?.text).toBe(
      'At its July 29, 2026 meeting, per the FOMC minutes: "In support of the Committee\'s dual-mandate goals, nine members agreed to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent."',
    );
    expect(fomc?.source?.url).toContain("fomcminutes20260729");
    const research = drivers.find((d) => d.source?.table === "fed_publications");
    expect(research?.text).toBe('The Atlanta Fed published "Who Pays Overdraft Fees?" on September 15, 2026.');
    expect(research?.source?.label).toBe("Federal Reserve Bank of Atlanta, via Fed in Print");
  });

  it("names fees in plain words", () => {
    expect(proseFeeName("overdraft")).toBe("overdraft");
    expect(proseFeeName("nsf")).toBe("NSF / returned item");
  });

  it("cuts a Beige Book excerpt at a sentence end and keeps quoted text in one sentence", () => {
    expect(beigeBookExcerpt("One. Two is longer. Three.", 12)).toBe("One.");
    expect(sentences('Per the Beige Book: "Loans fell. Deposits rose." Prices rose 2.1%.')).toEqual([
      'Per the Beige Book: "Loans fell. Deposits rose."',
      "Prices rose 2.1%.",
    ]);
  });

  it("keeps an initial such as U.S. inside its sentence", () => {
    expect(sentences("12 of 14 charge less than your $17.50; the lowest is U.S. Bank ($5). Prices rose.")).toEqual([
      "12 of 14 charge less than your $17.50; the lowest is U.S. Bank ($5).",
      "Prices rose.",
    ]);
  });
});
