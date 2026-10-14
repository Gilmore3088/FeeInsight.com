import { describe, expect, it } from "vitest";
import { topicsBearOn } from "@/lib/regulatory/fee-topics";
import { words } from "./four-roles";
import { isWireFact, statePostFacts, wireFacts, type WireActionRow, type WireBillRow, type WireRuleRow } from "./wire";

// Rows shaped like the stored Wire items; titles, parties and dates are for tests only.
const today = new Date("2026-10-14T12:00:00Z");

const rule = (over: Partial<WireRuleRow> = {}): WireRuleRow => ({
  kind: "final_rule",
  title: "National Bank Non-Interest Charges and Fees",
  agencies: ["Treasury Department", "OCC"],
  topics: ["fees"],
  published_on: "2026-04-29",
  comments_close_on: "2026-05-29",
  effective_on: "2026-06-30",
  url: "https://www.federalregister.gov/d/2026-0001",
  ...over,
});

const bill = (over: Partial<WireBillRow> = {}): WireBillRow => ({
  state_code: "IL",
  identifier: "HB 4474",
  title: "Banks-Overdraft Fee Ban",
  stage_label: "In committee",
  stage_on: "2026-03-18",
  topics: ["fees", "overdraft_nsf"],
  url: "https://openstates.org/il/bills/hb4474",
  ...over,
});

const action = (over: Partial<WireActionRow> = {}): WireActionRow => ({
  agency: "OCC",
  agency_label: "OCC",
  party_name: "Example National Bank",
  party_state: "OH",
  action_type: "Civil Money Penalty (CMP)",
  start_date: "2025-12-19",
  url: "https://apps.occ.gov/EASearch/",
  ...over,
});

const scope = (over: Partial<Parameters<typeof wireFacts>[1]> = {}) => ({
  feeCategory: "overdraft",
  stateCode: "IL",
  primaryRegulator: "OCC",
  today,
  ...over,
});

describe("fee topics", () => {
  it("a fee-wide topic bears on every fee; an overdraft topic only on the overdraft family", () => {
    expect(topicsBearOn(["fees"], "wire_domestic_outgoing")).toBe(true);
    expect(topicsBearOn(["overdraft_nsf"], "overdraft")).toBe(true);
    expect(topicsBearOn(["overdraft_nsf"], "monthly_maintenance")).toBe(false);
    expect(topicsBearOn([], "overdraft")).toBe(false);
  });
});

describe("Regulatory Wire lines for a regulation answer (#1090)", () => {
  it("lists a rule, a bill and an action in turn, each with its date and link", () => {
    const facts = wireFacts({ rules: [rule()], bills: [bill()], actions: [action()] }, scope());
    expect(facts.map((f) => f.source.table)).toEqual(["reg_tracker_items", "reg_tracker_items", "institution_enforcement_actions"]);
    expect(facts.map((f) => f.text)).toEqual([
      'OCC final rule "National Bank Non-Interest Charges and Fees", published April 29, 2026, effective June 30, 2026.',
      'Illinois bill HB 4474 "Banks-Overdraft Fee Ban": in committee, last action March 18, 2026.',
      'OCC "Civil Money Penalty (CMP)" against "Example National Bank" (OH), December 19, 2025; its subjects include consumer law.',
    ]);
    for (const f of facts) {
      expect(f.source.url).toBeTruthy();
      expect(f.source.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(isWireFact(f)).toBe(true);
      expect(words(f.text)).toBeLessThanOrEqual(20);
    }
  });

  it("takes federal rules only from the bank's own federal regulator and the CFPB", () => {
    const ncua = rule({ title: "Federal Credit Union Non-Interest Charges and Fees", agencies: ["NCUA"] });
    const cfpb = rule({ title: "Overdraft Lending", agencies: ["CFPB"], topics: ["overdraft_nsf"], published_on: "2026-02-01", effective_on: null });
    const rows = { rules: [rule(), ncua, cfpb], bills: [], actions: [] };
    expect(wireFacts(rows, scope({ primaryRegulator: "NCUA" })).map((f) => f.text)).toEqual([
      'NCUA final rule "Federal Credit Union Non-Interest Charges and Fees", published April 29, 2026, effective June 30, 2026.',
      'CFPB final rule "Overdraft Lending", published February 1, 2026.',
    ]);
    // A state agency's bank still sees the CFPB's rules.
    expect(wireFacts(rows, scope({ primaryRegulator: "State" })).map((f) => f.text)).toEqual([
      'CFPB final rule "Overdraft Lending", published February 1, 2026.',
    ]);
  });

  it("names an open comment period and a future effective date as such", () => {
    const proposed = rule({ kind: "proposed_rule", published_on: "2026-09-01", comments_close_on: "2026-11-02", effective_on: "2027-01-01" });
    expect(wireFacts({ rules: [proposed], bills: [], actions: [] }, scope())[0].text).toBe(
      'OCC proposed rule "National Bank Non-Interest Charges and Fees", published September 1, 2026, comments close November 2, 2026, takes effect January 1, 2027.',
    );
  });

  it("leaves out items that do not bear on the fee, are out of date, or have no link", () => {
    const rows = {
      rules: [rule({ topics: ["funds_availability"] }), rule({ published_on: "2024-01-05", comments_close_on: "2024-02-05", effective_on: "2024-06-01" }), rule({ url: null })],
      bills: [bill({ topics: ["electronic_transfers"] }), bill({ stage_on: "2024-01-01" }), bill({ url: null })],
      actions: [action({ start_date: "2022-01-01" }), action({ url: null })],
    };
    expect(wireFacts(rows, scope())).toEqual([]);
  });

  it("keeps bills to the bank's state, and actions to its federal regulator or its state", () => {
    const rows = {
      rules: [],
      bills: [bill(), bill({ state_code: "NY", identifier: "A 117" })],
      actions: [
        action(),
        action({ agency: "FRB", agency_label: "Federal Reserve", party_name: "Example State Bank", party_state: "IL", start_date: "2026-01-10" }),
        action({ agency: "FRB", agency_label: "Federal Reserve", party_name: "Elsewhere Bank", party_state: "TX", start_date: "2026-02-10" }),
      ],
    };
    const texts = wireFacts(rows, scope()).map((f) => f.text);
    expect(texts.filter((t) => t.includes(" bill "))).toHaveLength(1);
    expect(texts.some((t) => t.includes("Elsewhere Bank"))).toBe(false);
    expect(texts.filter((t) => t.includes("consumer law"))).toHaveLength(2);
    // A bank with no state on file gets its federal regulator's actions and no bills.
    expect(wireFacts(rows, scope({ stateCode: null })).map((f) => f.source.table)).toEqual(["institution_enforcement_actions"]);
  });

  it("lists the state regulator's own fee posts from the last year, newest first", () => {
    const posts = [
      { state_code: "IL", agency: "Illinois state regulator", title: "Overdraft fees at state banks", link: "https://idfpr.illinois.gov/a", published_at: "2026-05-01T00:00:00.000Z" },
      { state_code: "IL", agency: "Illinois state regulator", title: "Old bank fee notice", link: "https://idfpr.illinois.gov/b", published_at: "2024-05-01T00:00:00.000Z" },
      { state_code: "NY", agency: "New York state regulator", title: "Overdraft fee guidance", link: "https://dfs.ny.gov/c", published_at: "2026-06-01T00:00:00.000Z" },
    ];
    const facts = statePostFacts(posts, { stateCode: "IL", today });
    expect(facts).toEqual([
      {
        text: 'Illinois state regulator post "Overdraft fees at state banks", May 1, 2026.',
        source: { label: "Illinois state regulator release", table: "reg_articles", url: "https://idfpr.illinois.gov/a", asOf: "2026-05-01" },
      },
    ]);
  });
});
