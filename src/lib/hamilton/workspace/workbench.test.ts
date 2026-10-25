import { describe, expect, it } from "vitest";
import { buildAskResponse, parseAsk, pageFeeFor } from "./ask";
import { answerLimitations, askContextUsed, blockAnchor, contextFeeParam, contextRows, RESULT_BLOCKS, standardNextSteps } from "./workbench";

describe("the standard result blocks (#1895)", () => {
  it("reads Summary, Key figures, Charts, Evidence, Limitations, Next steps, in that order", () => {
    expect(RESULT_BLOCKS.map((b) => b.title)).toEqual(["Summary", "Key figures", "Charts", "Evidence", "Limitations", "Next steps"]);
    expect(blockAnchor("next_steps")).toBe("answer-next-steps");
  });
});

describe("the fee of the page Ask was opened from (#1895)", () => {
  it("answers a comparison question that names no fee for the page's fee", () => {
    for (const q of [
      "How do we compare with peers?",
      "Where do we stand?",
      "What if we charged $30?",
      "Is $35 too high?",
      "Is our price higher than the market?",
      "What are local competitors charging?",
      "How do we compare with Navy Federal?",
      "Which peers charge more?",
      "Are we cheaper than Chase?",
      "How do we compare with credit unions in Florida?",
      "What do competitors in our state charge?",
      "Are we competitive?",
      "Are we priced right?",
      "Are we above the median?",
      "Are we in line with peers?",
      "What do others charge?",
      "Is it too much?",
      "How do we compare with similar credit unions?",
      "What's our percentile?",
    ]) {
      expect(parseAsk(q, null, "overdraft"), q).toMatchObject({ feeCategory: "overdraft", feeFrom: "page" });
    }
  });

  it("keeps a fee the question names, and says the question named it", () => {
    expect(parseAsk("How does our NSF fee compare with peers?", null, "overdraft")).toMatchObject({ feeCategory: "nsf", feeFrom: "question" });
  });

  it("reads the informal names a reader uses for a fee, so they never fall to the page's fee", () => {
    expect(parseAsk("What are peers charging for wires?", null, "overdraft")).toMatchObject({ feeCategory: "wire_domestic_outgoing", feeFrom: "question" });
    expect(parseAsk("How do incoming wires compare?", null, "overdraft").feeCategory).toBe("wire_domestic_incoming");
    expect(parseAsk("What do peers charge for stop payments?", null, "overdraft").feeCategory).toBe("stop_payment");
    expect(parseAsk("How does our statement fee compare?", null, "overdraft").feeCategory).toBe("paper_statement");
    expect(parseAsk("What do peers charge for a replacement card?", null, "overdraft").feeCategory).toBe("card_replacement");
    expect(parseAsk("What do peers charge for ATM fees?", null, "overdraft").feeCategory).toBe("atm_non_network");
  });

  it("tests a price for the page's fee", () => {
    expect(parseAsk("What if we charged $30?", null, "overdraft")).toMatchObject({ feeCategory: "overdraft", feeFrom: "page", tested: [30] });
  });

  it("lists the page fee's peers for a list question", () => {
    expect(parseAsk("List our peers' fees", null, "overdraft")).toMatchObject({ feeCategory: "overdraft", list: true });
  });

  it("never puts the page's fee in place of another subject, so can't-answer stands (#1077, #2575)", () => {
    for (const q of [
      "Which credit unions run a fee share below 4%?",
      "How does our service charge income compare with peers?",
      "Where do we stand on every fee?",
      "How do our fees compare?",
      "Talk to me about institutions above $10B",
      "What's new this week?",
      // Other measures and subjects (review of #1895).
      "What's our ROA versus peers?",
      "How do we rank on efficiency ratio against peers?",
      "How do our deposit rates compare?",
      "What is the national average deposit size?",
      "What are the market trends?",
      "Who are our competitors?",
      "How do our peers' fee shares compare?",
      // A price on every fee or on fee income is not a price for the page's fee.
      "What if every fee went up $5?",
      "What if we cut all our fees by $5?",
      "What if our fee income rose by $50,000?",
      "What if we charged $30 across our whole schedule?",
      // A fee the parser can't place is never read as the page's fee.
      "What are peers charging for transfers?",
      "How do our card fees compare?",
      // Any word that is not a price, position or subject word keeps no page fee (re-review).
      "How does our CD pricing compare?",
      "What do peers charge for mortgages?",
      "How do peers price their checking?",
      "How do we compare on interchange?",
      "How do we compare on early closure?",
      "How do our prices compare?",
      "How do our fees stack up?",
      // A capitalized product is not an institution's name (second re-review).
      "What do peers charge for Zelle?",
      "How do we compare on Zelle?",
      "How do we compare on Interchange?",
      "How does our Checking compare?",
      "How do we compare on Mortgage Rates?",
      "Are we more expensive than peers on Credit Cards?",
    ]) {
      // The same reading as with no page fee at all.
      expect(parseAsk(q, null, "overdraft"), q).toEqual(parseAsk(q));
      expect(parseAsk(q, null, "overdraft").feeCategory, q).not.toBe("overdraft");
    }
    const offTopic = parseAsk("What's new this week?", null, "overdraft");
    expect(buildAskResponse({ question: "What's new this week?", intent: offTopic, research: null, memory: [] }).shortAnswer).toMatch(/^Hamilton can't answer that from the data it holds/);
  });

  it("ignores a page fee that is not a fee in the taxonomy", () => {
    expect(pageFeeFor("How do we compare?", "not_a_fee")).toBeNull();
    expect(contextFeeParam("overdraft")).toBe("overdraft");
    expect(contextFeeParam("../etc")).toBeNull();
    expect(contextFeeParam("constructor")).toBeNull();
    expect(contextFeeParam(undefined)).toBeNull();
  });

  it("marks a carried follow-up as coming from the conversation", () => {
    expect(parseAsk("Should we raise it?", "overdraft")).toMatchObject({ feeCategory: "overdraft", feeFrom: "conversation" });
  });
});

describe("the context an answer used (#1895)", () => {
  const context = askContextUsed({
    subjectName: "Example Valley Credit Union",
    selectionSource: "url",
    provenance: { peerGroup: { label: "Credit unions, $300M to $1B in assets, Tennessee", n: 12 }, dataAsOf: { fees: "2026-09-30" } },
    peerLabel: null,
    feeCategory: "overdraft",
    feeFrom: "page",
  });

  it("names the institution, peers and fee, each with where it came from", () => {
    expect(contextRows(context)).toEqual([
      { label: "Institution", value: "Example Valley Credit Union", note: "from the page you came from" },
      { label: "Peers", value: "Credit unions, $300M to $1B in assets, Tennessee", note: "12 publish this fee on schedules read through Sep 30, 2026" },
      { label: "Fee", value: "Overdraft (OD)", note: "from the page you came from" },
    ]);
  });

  it("shows no peer count without a fee, and no note for an unknown selection source", () => {
    const rows = contextRows(askContextUsed({ subjectName: "Example Bank", selectionSource: "artifact", provenance: null, peerLabel: "National index", feeCategory: null, feeFrom: null }));
    expect(rows).toEqual([
      { label: "Institution", value: "Example Bank", note: null },
      { label: "Peers", value: "National index", note: null },
    ]);
  });

  it("says when Hamilton opened the fee furthest from its median", () => {
    const rows = contextRows({ ...context, fee: { category: "nsf", from: "furthest" } });
    expect(rows.at(-1)?.note).toBe("the fee furthest from its peer median, opened in detail");
  });
});

describe("limitations and next steps (#1895)", () => {
  it("lists each assumption once, a modeled price's first", () => {
    expect(answerLimitations({ provenance: { assumptions: ["One value per institution.", "Peers are one group."] }, scenario: { assumptions: ["Volume holds.", "One value per institution."] } }))
      .toEqual(["Volume holds.", "One value per institution.", "Peers are one group."]);
    expect(answerLimitations({})).toEqual([]);
  });

  it("offers compare peers, try a price, review assumptions and add to board brief, carrying the context", () => {
    const steps = standardNextSteps({ feeCategory: "overdraft", savedAnalysisId: "a 1", researchHref: "/pro/research?fee=overdraft&instId=1", simulateHref: "/pro/simulate?fee=overdraft&instId=1" });
    expect(steps.map((s) => [s.label, s.href])).toEqual([
      ["Compare peers", "/pro/research?fee=overdraft&instId=1"],
      ["Try a price", "/pro/simulate?fee=overdraft&instId=1"],
      ["Review assumptions", "#answer-limitations"],
      ["Add to board brief", "/pro/reports?from_analysis=a%201"],
    ]);
  });

  it("drops the steps it cannot carry: no fee, no saved answer", () => {
    expect(standardNextSteps({ feeCategory: null, savedAnalysisId: null, researchHref: null, simulateHref: null }).map((s) => s.label)).toEqual(["Review assumptions"]);
  });
});
