import { describe, expect, it } from "vitest";
import {
  decodeLandingResearch, encodeLandingResearch, landingResearchHref, localRequestFromLanding,
  parseLandingResearch, RESEARCH_STATE_CODES,
} from "./landing-research-handoff";

const base = { version: 1, task: "compare", scope: { kind: "national" }, charter: "all" };
const four = ["cashiers_check", "paper_statement", "money_order", "stop_payment"];

describe("homepage research handoff (transport, not permission to execute)", () => {
  it("uses all four approved defaults without overdraft or NSF", () => {
    expect(parseLandingResearch(base).categories).toEqual(four);
  });
  it("contains exactly all 50 states plus DC", () => {
    expect(new Set(RESEARCH_STATE_CODES).size).toBe(51);
    expect(RESEARCH_STATE_CODES).toContain("DC");
  });
  it.each(RESEARCH_STATE_CODES)("preserves %s through nested login and subscription returns", (stateCode) => {
    const selection = { ...base, scope: { kind: "state", stateCode }, charter: "credit_union", categories: ["paper_statement", "money_order"] };
    const target = landingResearchHref(selection);
    const subscribe = `/subscribe?${new URLSearchParams({ from: target, reason: "pro_required" })}`;
    const login = new URL(`/login?${new URLSearchParams({ from: subscribe })}`, "https://example.test");
    const afterLogin = new URL(login.searchParams.get("from")!, login.origin);
    const restored = new URL(afterLogin.searchParams.get("from")!, login.origin);
    expect(decodeLandingResearch(restored.searchParams.get("research"))).toEqual(selection);
    expect(restored.pathname).toBe("/pro/analyze");
    expect(restored.searchParams.has("send")).toBe(false);
  });
  it("passes only the explicit subject and categories to the existing local API", () => {
    expect(localRequestFromLanding({ ...base, scope: { kind: "local", institutionId: 101 }, categories: ["paper_statement"] }))
      .toEqual({ institutionId: 101, categories: ["paper_statement"] });
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648, "101", null])("rejects invalid local subject %s", (institutionId) => {
    expect(() => parseLandingResearch({ ...base, scope: { kind: "local", institutionId } })).toThrow();
  });
  it.each([[], ["not_a_fee"], [null], new Array(2), Array(51).fill("paper_statement"), "paper_statement"].map((categories) => ({ categories })))("rejects malformed category selections %#", ({ categories }) => {
    expect(() => parseLandingResearch({ ...base, categories })).toThrow();
  });
  it("deduplicates categories without reordering or mutating input", () => {
    const categories = ["money_order", "paper_statement", "money_order"];
    expect(parseLandingResearch({ ...base, categories }).categories).toEqual(["money_order", "paper_statement"]);
    expect(categories).toHaveLength(3);
  });
  it.each([
    { ...base, version: 2 }, { ...base, task: "send_email" }, { ...base, charter: "consumer" },
    { ...base, isPro: true }, { ...base, evidencePolicy: "provisional" }, { ...base, snapshot: "trusted" },
    { ...base, from: "https://example.invalid" }, { ...base, question: "arbitrary prompt" },
    { ...base, scope: { kind: "national", institutionId: 101 } },
    { ...base, scope: { kind: "state", stateCode: "WA", institutionId: 101 } },
    { ...base, scope: { kind: "state", stateCode: "XX" } },
    { ...base, scope: { kind: "state", stateCode: "wa" } },
    { ...base, scope: { kind: "local" } },
    { ...base, scope: { kind: "local", institutionId: 101, stateCode: "WA" } },
    null, [],
  ].map((input) => ({ input })))("rejects unsupported or ambiguous requests %#", ({ input }) => {
    expect(() => parseLandingResearch(input)).toThrow();
  });
  it.each(["", "{", "null", "[]", "x".repeat(4097), ["duplicate", "query"], 1].map((input) => ({ input })))("rejects malformed encoded payload %#", ({ input }) => {
    expect(() => decodeLandingResearch(input)).toThrow();
  });
  it("does not treat missing handoff as a request to execute defaults", () => {
    expect(decodeLandingResearch(undefined)).toBeNull();
    expect(decodeLandingResearch(null)).toBeNull();
  });
  it("rejects inherited input and prototype keys", () => {
    expect(() => parseLandingResearch(Object.create(base))).toThrow();
    expect(() => decodeLandingResearch(JSON.stringify(base).replace('"version":1', '"version":1,"__proto__":{}'))).toThrow();
  });
  it.each([
    base, { ...base, scope: { kind: "state", stateCode: "WA" } },
    { ...base, scope: { kind: "local", institutionId: 101 }, charter: "bank" },
    { ...base, scope: { kind: "local", institutionId: 101 }, task: "board_report" },
  ])("never silently routes unsupported selection %# to local comparison", (input) => {
    expect(() => localRequestFromLanding(input)).toThrow();
  });
  it("preserves report scope without requesting automatic report execution", () => {
    const request = { ...base, task: "board_report", scope: { kind: "state", stateCode: "WA" }, categories: ["money_order"], charter: "bank" };
    const url = new URL(landingResearchHref(request), "https://example.test");
    expect(url.pathname).toBe("/pro/reports");
    expect(decodeLandingResearch(url.searchParams.get("research"))).toEqual(request);
    expect([...url.searchParams.keys()]).toEqual(["research"]);
    expect(encodeLandingResearch(request)).not.toContain("auto");
  });
});
