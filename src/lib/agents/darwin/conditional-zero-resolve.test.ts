import { describe, expect, it, vi } from "vitest";

import {
  CONDITIONAL_ZERO_RELEASED_FLAG,
  conditionalZeroVerdict,
  freeOnItsOwnLine,
  runDarwinConditionalZeroResolve,
} from "./conditional-zero-resolve";

const SCHEDULE = "https://bank.example/documents/Fee_Schedule_2025.pdf";
const CHECKING = "https://bank.example/personal/checking";

function held(id: number, key: string, name: string, line: string, url = SCHEDULE, twin = false) {
  return {
    fee_raw_id: id,
    institution_id: 7,
    source_url: url,
    document_r2_key: null,
    extraction_confidence: 0.9,
    fee_name: name,
    amount: "0.00",
    frequency: null,
    outlier_flags: ["needs_darwin_verification"],
    conditions: `Knox deterministic extraction from Rosetta artifact #1. excerpt="${line}"`,
    source_document_id: 9,
    document_url: url,
    canonical_fee_key: key,
    priced_twin: twin,
  };
}

// Held rows on production, Oct 13 (#1115).
describe("conditionalZeroVerdict", () => {
  it("(a) calls a $0 beside a priced verified fee in its category a duplicate", () => {
    expect(conditionalZeroVerdict(held(1, "monthly_maintenance", "Monthly Service Fee", "Monthly Service Fee | $0 | $5 | $10", CHECKING, true)).decision).toBe("duplicate");
  });

  it.each([
    ["bill_pay", "Bill Pay", "Bill Pay: | Free"],
    ["wire_domestic_incoming", "Wire Transfers: Incoming", "Wire Transfers: Incoming | No Charge"],
    ["notary_fee", "Notary Service", "if mailed | • Notary Service ..................................FREE"],
    ["notary_fee", "Notary for customer", "Notary for customer FREE"],
  ])("(c) verifies %s '%s' free on the bank's schedule", (key, name, line) => {
    expect(conditionalZeroVerdict(held(2, key, name, line))).toEqual({ decision: "verified", reason: "conditional_zero_free_on_schedule" });
  });

  it("(b) rejects a product page's $0, a sentence, another dollar figure and an account feature", () => {
    expect(conditionalZeroVerdict(held(3, "cashiers_check", "Official Checks", "No fee for Official Checks", CHECKING)).reason).toBe("conditional_zero_product_page");
    expect(conditionalZeroVerdict(held(4, "document_reproduction", "Statement copies (per statement)", "Statement copies (per statement) - Online copies are FREE")).reason).toBe("conditional_zero_reread");
    expect(conditionalZeroVerdict(held(5, "collection_item", "Foreign Check Deposit (below )", "Foreign Check Deposit (below $10,000) .................................FREE")).reason).toBe("conditional_zero_reread");
    expect(conditionalZeroVerdict(held(6, "gift_card_purchase", "Gift Cards", "Gift Cards | $ 0.00 | value only; for amounts from $10.00 to $1,000.00 | -")).reason).toBe("conditional_zero_reread");
    expect(conditionalZeroVerdict(held(7, "overdraft", "Courtesy Pay", "BluRIPPLE Checking Overdraft Paid by Courtesy Pay FREE")).reason).toBe("conditional_zero_reread");
  });

  it("reads a free word only as the line's own price", () => {
    expect(freeOnItsOwnLine("Paper Statements | Personal: FREE")).toBe(true);
    expect(freeOnItsOwnLine("Loose Coins under $10.00 | N/C")).toBe(false);
    expect(freeOnItsOwnLine("*Bill Pay Service is FREE")).toBe(false);
  });
});

describe("runDarwinConditionalZeroResolve", () => {
  const rows = [
    held(1, "monthly_maintenance", "Monthly Service Fee", "Monthly Service Fee | $0 | $5 | $10", CHECKING, true),
    held(2, "bill_pay", "Bill Pay", "Bill Pay: | Free"),
    held(3, "cashiers_check", "Official Checks", "No fee for Official Checks", CHECKING),
  ];
  function createDb() {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (text.includes("INSERT INTO verified_fee_observations")) return Promise.resolve([{ fee_verified_id: 77 }]);
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof runDarwinConditionalZeroResolve>[0]["db"] & ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve(rows));
    return db;
  }

  it("verifies the free schedule line, records every verdict and deletes nothing", async () => {
    const db = createDb();
    const result = await runDarwinConditionalZeroResolve({ runId: 5, db });
    expect(result.verdicts).toEqual({ conditional_zero_priced_twin: 1, conditional_zero_free_on_schedule: 1, conditional_zero_product_page: 1 });
    expect(result.verified).toBe(1);
    const calls = db.mock.calls.map((call) => ({ text: (call[0] as TemplateStringsArray).join("?"), values: call.slice(1) }));
    const insert = calls.find((call) => call.text.includes("INSERT INTO verified_fee_observations"));
    expect(JSON.stringify(insert?.values)).toContain(CONDITIONAL_ZERO_RELEASED_FLAG);
    expect(calls.filter((call) => call.text.includes("INSERT INTO pipeline_attempts"))).toHaveLength(3);
    expect(calls.some((call) => /\bDELETE\b/.test(call.text))).toBe(false);
  });

  it("writes nothing on a dry run", async () => {
    const db = createDb();
    const result = await runDarwinConditionalZeroResolve({ runId: 5, db, dryRun: true });
    expect(result.selected).toBe(3);
    expect(db.mock.calls.some((call) => (call[0] as TemplateStringsArray).join("?").includes("INSERT"))).toBe(false);
  });
});
