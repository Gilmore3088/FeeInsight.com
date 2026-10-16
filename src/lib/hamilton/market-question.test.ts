import { describe, expect, it } from "vitest";
import { MARKET_BRIEF_CATEGORIES, marketBriefHref, parseMarketQuestion } from "./market-question";

describe("parseMarketQuestion", () => {
  it("answers the replayed Florida question with the three topics it asked, not an overdraft fallback", () => {
    const market = parseMarketQuestion("talk to me about $5B and up in florida. fee pricing, revenue, complaints");
    expect(market?.selection.scope).toEqual({ kind: "state", stateCode: "FL" });
    expect(market?.lenses).toEqual(["fees", "financials", "complaints"]);
    expect(market?.selection.categories).toEqual(MARKET_BRIEF_CATEGORIES);
    expect(market?.segment?.minAssets).toBe(5_000_000);
  });

  it("keeps a named fee and charter, and covers every lens when no topic is named", () => {
    const fee = parseMarketQuestion("How do credit unions in Texas price wire transfer fees?");
    expect(fee?.selection.charter).toBe("credit_union");
    expect(fee?.selection.categories[0]).toBe("wire_domestic_outgoing");
    expect(parseMarketQuestion("Tell me about Ohio")?.lenses).toHaveLength(5);
    expect(parseMarketQuestion("What is happening nationally with complaints?")?.selection.scope).toEqual({ kind: "national" });
  });

  it("leaves own-institution, price, list, opinion and follow-up questions to the Ask engine", () => {
    for (const q of [
      "How does our overdraft fee compare in Florida?",
      "What if overdraft were $35 in Florida?",
      "Which credit unions in Florida charge the most?",
      "Should Florida banks raise wire fees?",
      "How does the overdraft fee compare?",
      "How does that compare nationally?",
    ]) expect(parseMarketQuestion(q)).toBeNull();
  });

  it("links to the brief without carrying a parsed selection", () => {
    expect(marketBriefHref(" Tell me about Ohio ", "42")).toBe("/pro/analyze?brief=Tell+me+about+Ohio&instId=42");
  });

  it("leaves a list of institutions, or a follow-up to one, to the peer list (#1538, #1539)", () => {
    expect(parseMarketQuestion("Florida institutions with assets above 5 billion.")).toBeNull();
    expect(parseMarketQuestion("Florida institutions with assets above $5,000M.")).toBeNull();
    expect(parseMarketQuestion("Only show the California ones.")).toBeNull();
    expect(parseMarketQuestion("Tell me about Ohio")).not.toBeNull();
  });

  it("keeps market questions that mention an asset size or a list word (#1604 review)", () => {
    for (const q of [
      "What does the market look like for Texas banks?",
      "Give me a brief on Ohio credit unions over $500M",
      "Tell me about Texas credit unions over $1B",
      "How are Texas banks above $1B doing?",
      "What's happening with California credit unions?",
      "Only overdraft in Texas",
    ]) expect(parseMarketQuestion(q), q).not.toBeNull();
  });
});
