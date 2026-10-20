import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queries: [] as string[], replies: [] as unknown[][] }));
vi.mock("./connection", () => {
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(parts.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ""), ""));
    return state.replies.shift() ?? [];
  }), { unsafe: vi.fn((text: string) => text) });
  return { sql, getSql: () => sql };
});
import { getCustomReportMarketData } from "./custom-report-market";
import { institutionValue } from "@/lib/fee-institution-value";
import { buildAmountEvidence } from "@/lib/custom-report/evidence";

beforeEach(() => { state.queries.length = 0; state.replies.length = 0; });

describe("competitive report consumer boundary", () => {
  it("applies audience/source eligibility before source validation without weakening cap or price guards", async () => {
    state.replies.push(
      [{ id: 47, institution_name: "Test Subject", city: "Nashville", state_code: "TN", charter_type: "bank", cert_number: "123", asset_size: null }],
      [{ city: "NASHVILLE" }],
      [{ county_fips: "47037", city: "Nashville", state: "TN", year: 2026, basis: "branch_counties" }],
      [{ kind: "branch", state: "TN", city: "NASHVILLE" }],
      [{ institution_id: 50, institution_name: "Test Peer", city: "Nashville", state_code: "TN", charter_type: "bank", market_deposits: "100", line: null, amount: null, fee_name: null, source_url: null, source_document_id: null, updated_at: null, takedown_pending: null }],
    );
    const result = await getCustomReportMarketData(47);
    const query = state.queries.find((text) => text.includes("FROM published_fee_catalog c"));
    expect(query).toContain("c.source_document_id IS NOT NULL");
    expect(query).toContain("c.fee_audience IN ('consumer', 'both', 'unknown')");
    expect(query).toContain("COALESCE(c.is_fee_cap, false) = false");
    expect(query).toContain("c.fee_name ~* r.inc AND c.fee_name !~* r.exc");
    expect(query).toContain("c.amount = 0 AND r.allow_zero");
    expect(query).toContain("pf.kind = 'takedown_pending'");
    expect(result?.lines).toEqual([]);
    expect(result?.competitors[0].market_deposits).toBe(100000);
    // The subject, its city spellings, its counties, the market cities, the fees.
    expect(state.queries).toHaveLength(5); // No alternate institution document is fetched to invent missing fees.
  });
});

describe("the subject's records the source check could not match", () => {
  // A stored checking page that states the Carefree price but not the Everyday one, so the
  // Everyday record cannot be matched to a line of it.
  const TEXT = [
    "Carefree Checking", "Features and benefits:", "No minimum balance", "$7.95 monthly service charge", "Only $50 minimum opening deposit",
    "Everyday Checking", "Features and benefits:", "Free e-statements**",
  ].join("\n\n");
  const fee = (institution_id: number, fee_id: number, fee_name: string, amount: string, excerpt: string) => ({
    institution_id, institution_name: institution_id === 323 ? "Capital City Bank" : "Rival Bank", city: "Tallahassee", state_code: "FL", charter_type: "bank",
    market_deposits: "100", line: "monthly_maintenance", fee_id, amount, fee_name, source_url: "https://www.ccbg.com/checking", updated_at: "2026-10-12",
    source_document_id: institution_id === 323 ? "31376" : "999", takedown_pending: false, conditions: `Knox extraction. excerpt="${excerpt}"`,
  });

  it("keeps the subject's eligible record that failed the check, and never a competitor's", async () => {
    state.replies.push(
      [{ id: 323, institution_name: "Capital City Bank", city: "Tallahassee", state_code: "FL", charter_type: "bank", cert_number: "9622", asset_size: null }],
      [{ city: "TALLAHASSEE" }],
      [{ county_fips: "12073", city: "Tallahassee", state: "FL", year: 2026, basis: "branch_counties" }],
      [{ kind: "branch", state: "FL", city: "TALLAHASSEE" }],
      [
        fee(323, 140263, "Carefree Checking Monthly service charge", "7.95", "$7.95 monthly service charge"),
        fee(323, 140267, "Monthly service charge (Everyday Checking)", "8.95", "No monthly service charge with either 20 debit card transactions* OR a minimum daily balance of $1,500; otherwise, $8.95 per month"),
        fee(50, 1, "Monthly service charge (Rival Checking)", "9.00", "otherwise, $9.00 per month"),
      ],
      [
        { source_document_id: "31376", institution_id: 323, source_url: "https://www.ccbg.com/checking", normalized_text: TEXT, read_on: "2026-10-12" },
        { source_document_id: "999", institution_id: 50, source_url: null, normalized_text: "Nothing about fees here.", read_on: "2026-10-12" },
      ],
    );
    const result = await getCustomReportMarketData(323);
    expect(result?.lines.map((l) => [l.institution_id, l.id, l.amount])).toEqual([[323, 140263, 7.95]]);
    expect(result?.unmatchedOwn).toEqual([
      expect.objectContaining({ line: "monthly_maintenance", id: 140267, amount: 8.95, fee_name: "Monthly service charge (Everyday Checking)" }),
    ]);
  });

  it("reads both of Capital City's checking prices from its stored page, as its profile shows them", async () => {
    // Capital City Bank's checking page as stored (agent_source_texts 29133, read Oct 12). The
    // profile (/institution/323) shows $7.95 and $8.95 and compares at their median, $8.45; the
    // report reads the same two records through the shared source check and the same
    // institutionValue rule, so neither page drops the Everyday Checking price.
    const STORED = [
      "Carefree Checking", "Features and benefits:", "No minimum balance", "$7.95 monthly service charge", "Only $50 minimum opening deposit",
      "Everyday Checking", "Features and benefits:",
      "No monthly service charge with either 20 debit card transactions* OR a minimum daily balance of $1,500; otherwise, $8.95 per month",
      "Free e-statements**",
      "Performance Checking", "Features and benefits:", "No monthly service charge with a minimum daily balance of $4,000; otherwise, $8.95 per month",
    ].join("\n\n");
    state.replies.push(
      [{ id: 323, institution_name: "Capital City Bank", city: "Tallahassee", state_code: "FL", charter_type: "bank", cert_number: "9622", asset_size: null }],
      [{ city: "TALLAHASSEE" }],
      [{ county_fips: "12073", city: "Tallahassee", state: "FL", year: 2026, basis: "branch_counties" }],
      [{ kind: "branch", state: "FL", city: "TALLAHASSEE" }],
      [
        fee(323, 140263, "Carefree Checking Monthly service charge", "7.95", "$7.95 monthly service charge"),
        fee(323, 140267, "Monthly service charge (Everyday Checking)", "8.95", "No monthly service charge with either 20 debit card transactions* OR a minimum daily balance of $1,500; otherwise, $8.95 per month"),
      ],
      [{ source_document_id: "31376", institution_id: 323, source_url: "https://www.ccbg.com/checking", normalized_text: STORED, read_on: "2026-10-12" }],
    );
    const result = await getCustomReportMarketData(323);
    expect(result?.unmatchedOwn).toEqual([]);
    expect(result?.lines).toHaveLength(1);
    const line = result!.lines[0];
    expect(line.institution_id).toBe(323);
    expect(line.amount).toBe(institutionValue("monthly_maintenance", [7.95, 8.95]));
    expect(line.amount).toBeCloseTo(8.45, 10);
    expect(line.tiers?.map((t) => [t.id, t.amount])).toEqual([[140263, 7.95], [140267, 8.95]]);
    // The report's evidence step keeps both records, so the page compares at $8.45, not $7.95.
    const evidence = buildAmountEvidence(line);
    expect(evidence.excluded).toEqual([]);
    expect(evidence.records.map((r) => r.amount)).toEqual([7.95, 8.95]);
    expect(evidence.amount).toBeCloseTo(8.45, 10);
  });
});

describe("Capital City's ATM and incoming wire fees on its other-services page (#1835)", () => {
  // agent_source_texts 1418 (source_document_id 13900, read Oct 3): each price printed under its
  // fee's name, so "Wire Transfers" sits six lines above "Incoming Domestic Fee".
  const OLDER_READ = [
    "Wire Transfers", "Outgoing Domestic Fee", "$35", "Outgoing International Fee", "$75",
    "Incoming Domestic Fee", "$25", "Incoming International Fee", "$25", "Returned Wire Fee", "$25",
    "Wire Transfer Confirmation Fee", "$5",
    "Wire Transfer Investigation Fee (plus fee from intermediary and receiving banks)", "$25",
    "Collection Services", "Incoming Domestic Item Fee", "$20", "Incoming International Item Fee", "$20",
  ].join("\n\n");
  // agent_source_texts 35159 (source_document_id 37072, read Oct 17): the same page as table rows.
  const NEWER_READ = [
    "Debit Cards", "Debit Card Replacement Fee | $10", "Expedited Card Delivery Fee | $35",
    "ATM Network Usage Fee, for each inquiry, transfer or withdrawal at non-Capital City Bank ATM | $3",
    "International Transaction Fee+ | 3% of U.S. dollar amount of transaction",
    "Overdraft & Insufficient Funds", "Insufficient Item Fee* | $35",
  ].join("\n\n");
  const URL = "https://www.ccbg.com/personal/other-services-and-fees";
  const row = (line: string, fee_id: number, fee_name: string, amount: string, source_document_id: string, excerpt: string) => ({
    institution_id: 323, institution_name: "Capital City Bank", city: "Tallahassee", state_code: "FL", charter_type: "bank",
    market_deposits: "100", line, fee_id, amount, fee_name, source_url: URL, updated_at: "2026-10-17",
    source_document_id, takedown_pending: false, conditions: `Knox deterministic extraction. excerpt="${excerpt}"`,
  });

  it("brings the $3 out-of-network ATM fee and the $25 incoming domestic wire into the report", async () => {
    state.replies.push(
      [{ id: 323, institution_name: "Capital City Bank", city: "Tallahassee", state_code: "FL", charter_type: "bank", cert_number: "9622", asset_size: null }],
      [{ city: "TALLAHASSEE" }],
      [{ county_fips: "12073", city: "Tallahassee", state: "FL", year: 2026, basis: "branch_counties" }],
      [{ kind: "branch", state: "FL", city: "TALLAHASSEE" }],
      [
        row("atm_non_network", 97777, "ATM Network Usage Fee, for each inquiry, transfer or withdrawal at non-Capital City Bank ATM", "3.00", "37072",
          "ATM Network Usage Fee, for each inquiry, transfer or withdrawal at non-Capital City Bank ATM | $3"),
        row("wire_domestic_outgoing", 69698, "Wire Transfers: Outgoing Domestic Fee", "35.00", "13900", "Outgoing Domestic Fee / $35"),
        row("wire_domestic_incoming", 69700, "Wire Transfers: Incoming Domestic Fee", "25.00", "13900", "Incoming Domestic Fee / $25"),
      ],
      [
        { source_document_id: "13900", institution_id: 323, source_url: URL, normalized_text: OLDER_READ, read_on: "2026-10-03" },
        { source_document_id: "37072", institution_id: 323, source_url: URL, normalized_text: NEWER_READ, read_on: "2026-10-17" },
      ],
    );
    const result = await getCustomReportMarketData(323);
    expect(result?.unmatchedOwn).toEqual([]);
    expect(result?.dropped).toEqual({});
    expect(result?.lines.map((l) => [l.line, l.id, l.amount, l.source_line])).toEqual([
      ["atm_non_network", 97777, 3, "ATM Network Usage Fee, for each inquiry, transfer or withdrawal at non-Capital City Bank ATM | $3"],
      ["wire_domestic_outgoing", 69698, 35, "Outgoing Domestic Fee | $35"],
      ["wire_domestic_incoming", 69700, 25, "Incoming Domestic Fee | $25"],
    ]);
    // The report's evidence step keeps each record, so neither line reads "not found in your schedule".
    for (const line of result!.lines) {
      const evidence = buildAmountEvidence(line);
      expect(evidence.excluded).toEqual([]);
      expect(evidence.amount).toBe(line.amount);
    }
  });
});
