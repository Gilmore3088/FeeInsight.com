import { describe, expect, it } from "vitest";
import {
  buildAskResponse,
  feeCategoriesIn,
  buildOpinion,
  clarifyAgain,
  institutionFactsFrom,
  matchFeeCategory,
  parseAsk,
  parseObjective,
  pricesIn,
  scenariosFor,
} from "./ask";
import { evaluateFourRoles } from "./four-roles";
import { overdraftResearch } from "./test-fixtures";
import type { MemoryFact } from "./types";

const fact = (fieldKey: string, value: unknown, createdAt = "2026-10-06T08:00:00.000Z"): MemoryFact => ({
  id: `f-${fieldKey}-${createdAt}`,
  institutionId: 1,
  fieldKey,
  value,
  givenBy: "Pat (CFO)",
  source: "answer",
  createdAt,
});

const ask = (question: string, extra: Partial<Parameters<typeof buildAskResponse>[0]> = {}) =>
  buildAskResponse({ question, intent: parseAsk(question), research: overdraftResearch(), memory: [], ...extra });

describe("reading the question", () => {
  it("finds the fee by its longest name or synonym", () => {
    expect(matchFeeCategory("How does our overdraft fee compare?")).toBe("overdraft");
    expect(matchFeeCategory("what about the overdraft protection transfer?")).toBe("od_protection_transfer");
    expect(matchFeeCategory("Our NSF charge")).toBe("nsf");
    expect(matchFeeCategory("bounced check fees")).toBe("nsf");
    expect(matchFeeCategory("outgoing international wire")).toBe("wire_intl_outgoing");
    expect(matchFeeCategory("cashier’s check")).toBe("cashiers_check");
    expect(matchFeeCategory("how is the weather")).toBeNull();
  });

  it("reads the prices a question names, and eliminating as $0", () => {
    expect(pricesIn("What if we charged $25 or 30 dollars?")).toEqual([25, 30]);
    expect(pricesIn("Model $32.50")).toEqual([32.5]);
    expect(pricesIn("What happens if we eliminate it?")).toEqual([0]);
    expect(pricesIn("How do we compare?")).toEqual([]);
  });

  it("tells an opinion ask, a competitor ask and a trend ask apart", () => {
    expect(parseAsk("What would you do with our overdraft fee?").wantsOpinion).toBe(true);
    expect(parseAsk("How does our overdraft fee compare?").wantsOpinion).toBe(false);
    expect(parseAsk("What should I know about our garnishment/levy fee against Florida?").wantsOpinion).toBe(false);
    expect(parseAsk("What should we charge for overdraft?").wantsOpinion).toBe(true);
    expect(parseAsk("Overdraft at local competitors").focus).toBe("competitors");
    expect(parseAsk("Overdraft income over time").focus).toBe("trend");
    expect(parseAsk("just compare it", "nsf").feeCategory).toBe("nsf");
  });

  it("reads an objective from plain words", () => {
    expect(parseObjective("Revenue")).toBe("revenue");
    expect(parseObjective("treating members fairly")).toBe("customer_treatment");
    expect(parseObjective("stay in line with the market")).toBe("competitive_position");
    expect(parseObjective("dunno")).toBeNull();
  });
});

describe("the Ask response", () => {
  it("answers a research question with the four-roles answer", () => {
    const res = ask("How does our overdraft fee compare?");
    expect(res.kind).toBe("research");
    expect(res.shortAnswer).toBe(res.answer?.headline);
    expect(res.pageChange).toEqual({ screen: "research", feeCategory: "overdraft", section: "position" });
    expect(res.question?.fieldKey).toBe("fee.overdraft.annual_items");
    expect(evaluateFourRoles(res.answer!).pass).toBe(true);
  });

  it("asks which fee when the question names none", () => {
    const res = buildAskResponse({ question: "hello", intent: parseAsk("hello"), research: null, memory: [] });
    expect(res).toMatchObject({ kind: "clarifying_question", question: { fieldKey: "ask.fee_category" } });
  });

  it("models the prices a question names", () => {
    const res = ask("What if our overdraft fee were $25?");
    expect(res.kind).toBe("scenario");
    expect(res.pageChange).toEqual({ screen: "model", feeCategory: "overdraft", tested: [25] });
    expect(res.scenario).toMatchObject({ current: 32, tested: 25, evidenceLevel: "market", positionBefore: 75 });
    expect(res.shortAnswer).toBe(
      "At $25, your overdraft fee would sit at the 19th percentile of 16 peers; today it sits at the 75th percentile. Every 1,000 items charged would bring $7 thousand less in fee income, based on market data only.",
    );
    expect(res.question?.fieldKey).toBe("fee.overdraft.annual_items");
  });

  it("moves a scenario to the bank's own evidence once it has given its figures", () => {
    const memory = [fact("fee.overdraft.annual_items", 12_000), fact("fee.overdraft.waiver_rate", 10)];
    const res = ask("What if our overdraft fee were $25?", { memory });
    expect(res.scenario).toMatchObject({ evidenceLevel: "institution", revenueEffect: { low: -75_600, high: -75_600 } });
    expect(res.scenario?.provenance.clientFacts.map((c) => c.givenBy)).toEqual(["Pat (CFO)", "Pat (CFO)"]);
    expect(res.shortAnswer).toContain("That is $75.6 thousand a year less in fee income, based on the figures you gave.");
    expect(res.question).toBeUndefined();
  });

  it("asks for an objective before giving an opinion", () => {
    const res = ask("What would you do with our overdraft fee?");
    expect(res).toMatchObject({ kind: "clarifying_question", question: { fieldKey: "decision.objective" } });
    expect(res.opinion).toBeUndefined();
  });

  it("asks which prices to compare when none were tested", () => {
    const res = ask("What would you do with our overdraft fee?", { objective: "revenue" });
    expect(res.question?.fieldKey).toBe("fee.overdraft.tested_prices");
  });

  it("gives an opinion only with an objective, over the prices the reader tested, naming the objective", () => {
    const res = ask("What would you do with our overdraft fee?", { objective: "competitive_position", priorTested: [25, 30, 35] });
    expect(res.kind).toBe("opinion");
    expect(res.opinion).toMatchObject({ assumedObjective: "competitive_position", scenariosCompared: [25, 30, 35] });
    expect(res.shortAnswer).toMatch(/^For competitive position, here is how the 3 prices you tested for the overdraft fee measure up\./);
    expect(res.shortAnswer).toContain("Hamilton does not pick a price; the decision stays with you.");
    expect(res.scenario?.tested).toBe(25);
  });

  it("asks for the bank's fee before modeling when its schedule has none, then uses the stated one", () => {
    const research = overdraftResearch({ current: null, ownRows: [] });
    const asked = buildAskResponse({ question: "$25?", intent: parseAsk("overdraft at $25"), research, memory: [] });
    expect(asked.question?.fieldKey).toBe("fee.overdraft.current_amount");
    const res = buildAskResponse({
      question: "overdraft at $25",
      intent: parseAsk("overdraft at $25"),
      research,
      memory: [fact("fee.overdraft.current_amount", 30)],
    });
    expect(res.scenario).toMatchObject({ current: 30, tested: 25 });
  });

  it("asks again when an answer cannot be read", () => {
    expect(clarifyAgain("fee.overdraft.annual_items").question?.fieldKey).toBe("fee.overdraft.annual_items");
    expect(clarifyAgain("decision.objective").question?.fieldKey).toBe("decision.objective");
  });
});

describe("the bank's figures and the opinion", () => {
  it("takes the newest value per key and reads a percent waiver rate", () => {
    const facts = institutionFactsFrom(
      [fact("fee.overdraft.annual_items", 9_000, "2026-10-01T00:00:00Z"), fact("fee.overdraft.annual_items", "12,000"), fact("fee.overdraft.waiver_rate", "8%")],
      "overdraft",
    );
    expect(facts).toMatchObject({ annualItems: 12_000, waiverRate: 0.08 });
  });

  it("measures every tested price against the objective and never picks one", () => {
    const scenarios = scenariosFor(overdraftResearch(), 32, [35, 25], null);
    for (const objective of ["customer_treatment", "revenue", "competitive_position"] as const) {
      const opinion = buildOpinion(scenarios, objective)!;
      expect(opinion.opinion).toContain("At $35:");
      expect(opinion.opinion).toContain("At $25:");
      expect(opinion.opinion).not.toMatch(/strongest|best|recommend|should/i);
      expect(opinion.chosen.tested).toBe(35);
    }
  });
});

describe("a question that names no fee (#1077)", () => {
  it("is never given a fee: a segment question keeps no fee instead of overdraft", () => {
    const intent = parseAsk("talk to me about all institutison above 10billion");
    expect(intent.segment).not.toBeNull();
    expect(intent.feeCategory).toBeNull();
    expect(parseAsk("How does our NSF fee compare with banks over $10 billion?").feeCategory).toBe("nsf");
    const res = buildAskResponse({ question: "talk to me about $5B and up in florida", intent: parseAsk("talk to me about $5B and up in florida"), research: null, memory: [] });
    expect(res.kind).toBe("clarifying_question");
    expect(res.pageChange).toEqual({ screen: "none" });
  });

  it("lists every fee a question names", () => {
    expect(feeCategoriesIn("Which banks have both verified NSF and monthly maintenance rows?").sort()).toEqual(["monthly_maintenance", "nsf"]);
    expect(feeCategoriesIn("talk to me about all 10B and up instititions for od fees")).toEqual(["overdraft"]);
    expect(feeCategoriesIn("talk to me about all institutison above 10billion")).toEqual([]);
  });
});
