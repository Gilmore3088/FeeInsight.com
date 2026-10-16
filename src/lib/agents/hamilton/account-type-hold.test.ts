import { describe, expect, it, vi } from "vitest";
import { applyAccountTypeHold, passesWithoutAccountWords, planHolds, type HoldRow } from "./account-type-hold";
import { publishSkipReason } from "./publish";

const LIVE: HoldRow[] = [
  // Live rows, prod, Oct 16.
  { fee_published_id: 141227, fee_verified_id: 1, institution_id: 927, fee_name: "Monthly maintenance fee", product_name: "MMDA – Money Market Deposit Account – Personal", amount: "10.00" },
  { fee_published_id: 65609, fee_verified_id: 2, institution_id: 217, fee_name: "Service charge fee", product_name: "DIRECT SAVINGS ACCOUNT", amount: "2.00" },
  { fee_published_id: 126011, fee_verified_id: 3, institution_id: 2878, fee_name: "Monthly maintenance fee", product_name: "First Business Checking", amount: "10.00" },
  { fee_published_id: 999, fee_verified_id: 4, institution_id: 1, fee_name: "Monthly Service Fee", product_name: "Everyday Checking", amount: "5.00" },
  { fee_published_id: 998, fee_verified_id: 5, institution_id: 2, fee_name: "Monthly Service Fee", product_name: null, amount: "8.00" },
];

describe("account type hold (#1100 gap 1)", () => {
  it("holds a non-checking account's monthly fee and leaves checking and unstated ones", () => {
    const plan = planHolds(LIVE);
    expect(plan.typed.map((hold) => [hold.feePublishedId, hold.accountType])).toEqual([
      [141227, "money_market"], [65609, "savings"], [126011, "business"],
    ]);
    expect(plan.untyped.map((row) => row.fee_published_id)).toEqual([999, 998]);
  });

  it("brings a guard-refused row back as verified only when it is a real fee once its account words are set aside", () => {
    // Doc 362 (inst 954), prod: "Monthly Account Fee - Business Advantage Checking | $20.00" (shortened).
    const text = "Business Checking Accounts\nMonthly Account Fee - Business Advantage Checking | $20.00\nStop payment | $30.00";
    expect(passesWithoutAccountWords({ fee_verified_id: 4436, institution_id: 954, fee_name: "Monthly Account Fee - Business Advantage Checking", product_name: null, amount: 20, normalized_text: text })).toBe(true);
    // An annual IRA fee is not a monthly fee once "IRA" is set aside.
    expect(passesWithoutAccountWords({ fee_verified_id: 1, institution_id: 1, fee_name: "IRA Annual Maintenance Fee", product_name: null, amount: 10, normalized_text: "IRA Annual Maintenance Fee $10.00" })).toBe(false);
    // No stored text: stays rejected.
    expect(passesWithoutAccountWords({ fee_verified_id: 2, institution_id: 1, fee_name: "Statement Savings monthly fee", product_name: null, amount: 2, normalized_text: null })).toBe(false);
  });

  it("publish skips a held monthly maintenance row and nothing else", () => {
    const row = {
      fee_verified_id: 1, fee_raw_id: 1, institution_id: 1, source_url: "https://bank.example/fees", document_r2_key: null,
      extraction_confidence: 0.95, canonical_fee_key: "monthly_maintenance", variant_type: null,
      outlier_flags: ["agentic_darwin_verified", "account_type:savings"], verified_by_agent_event_id: "00000000-0000-4000-8000-000000000001",
      fee_name: "Monthly fee", amount: "5.00", frequency: "monthly", raw_agent_event_id: null, source_document_id: 1, fee_audience: "unknown",
      document_url: "https://bank.example/fees",
    } as unknown as Parameters<typeof publishSkipReason>[0];
    expect(publishSkipReason(row, 0.5)).toBe("Held: a savings account's monthly fee, not consumer checking");
    expect(String(publishSkipReason({ ...row, canonical_fee_key: "stop_payment" } as typeof row, 0.5))).not.toMatch(/^Held:/);
  });

  it("writes nothing on a dry run", async () => {
    const calls: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      calls.push(text);
      return Promise.resolve(text.includes("FROM published_fee_records fp") ? LIVE : []);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];
    Object.assign(db, { unsafe: vi.fn(() => Promise.resolve([])) });
    const result = await applyAccountTypeHold(db, { runId: 1, batchId: "agentic-run-1", dryRun: true });
    expect(result.heldLive).toHaveLength(3);
    expect(calls.some((text) => /UPDATE|INSERT/.test(text))).toBe(false);
  });
});
