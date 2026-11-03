// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { insertCandidate, insertHeldCandidate, SERVICE_MAINTENANCE_HOLD_FLAG, type KnoxTextRow } from "./extract";

/**
 * Knox v171 (#1092, state key 5608): a monthly maintenance read whose row sits under a service's
 * heading is written held as a range for review, $0 and priced alike, never flagged for Darwin. The
 * account's own row beside it takes its usual path. No database: the fake records each statement.
 */
const RIVER_CITY = [
  "Consumer Online Banking Services and Mobile Banking Fees",
  "",
  "Set Up Fee | No charge",
  "",
  "Monthly Maintenance Fee | No charge",
  "",
  "Online Banking Monthly Statement | $2.00",
  "",
  "Personal Checking",
  "",
  "Monthly Service Charge | $8.00",
].join("\n");

function textRow(text: string): KnoxTextRow {
  return {
    document_text_id: 41, source_document_id: 42, institution_id: 43, institution_name: "River City Bank",
    source_url: "https://bank.example/fees", normalized_text: text,
    text_hash: createHash("sha256").update(text).digest("hex"),
  } as KnoxTextRow;
}

interface Call { sql: string; values: unknown[] }
function fakeDb(calls: Call[]) {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    calls.push({ sql, values });
    return Promise.resolve(/INSERT INTO raw_fee_observations/.test(sql) ? [{ fee_raw_id: 1 }] : []);
  }) as unknown as Parameters<typeof insertCandidate>[0];
}

/** The flags of the one raw row written. */
function writtenFlags(calls: Call[]): string[] {
  const insert = calls.find((call) => /INSERT INTO raw_fee_observations/.test(call.sql));
  if (!insert) throw new Error("no raw row written");
  const json = insert.values.find((value) => typeof value === "string" && value.startsWith("[")) as string;
  return JSON.parse(json) as string[];
}

const candidate = (name: string, amount: number, excerpt: string) => ({
  feeName: name, amount, canonicalHint: "monthly_maintenance", excerpt, frequency: "monthly", confidence: 0.9, waivable: false,
});

describe("Knox v171: a monthly maintenance read under a service's heading is held (#1092)", () => {
  it("holds the $0 read as a range, never for Darwin", async () => {
    const calls: Call[] = [];
    await insertHeldCandidate(fakeDb(calls), { runId: 1, row: textRow(RIVER_CITY), held: {
      shape: "zero", feeName: "Monthly Maintenance Fee", amount: 0, amountMax: null, percent: null, frequency: "monthly",
      canonicalHint: "monthly_maintenance", excerpt: "Monthly Maintenance Fee | No charge" } });
    const flags = writtenFlags(calls);
    expect(flags).toContain("knox_review:range");
    expect(flags).toContain(`${SERVICE_MAINTENANCE_HOLD_FLAG}:online_banking+mobile_banking`);
    expect(flags).not.toContain("needs_darwin_verification");
  });

  it("holds the priced read the same way", async () => {
    const text = RIVER_CITY.replace("Monthly Maintenance Fee | No charge", "Monthly Maintenance Fee | $4.95");
    const calls: Call[] = [];
    await insertCandidate(fakeDb(calls), { runId: 1, row: textRow(text),
      candidate: candidate("Monthly Maintenance Fee", 4.95, "Monthly Maintenance Fee | $4.95") });
    const flags = writtenFlags(calls);
    expect(flags).toContain("knox_review:range");
    expect(flags).toContain(`${SERVICE_MAINTENANCE_HOLD_FLAG}:online_banking+mobile_banking`);
    expect(flags).not.toContain("needs_darwin_verification");
  });

  it("sends the account's own monthly fee to Darwin as before", async () => {
    const calls: Call[] = [];
    await insertCandidate(fakeDb(calls), { runId: 1, row: textRow(RIVER_CITY),
      candidate: candidate("Monthly Service Charge", 8, "Monthly Service Charge | $8.00") });
    const flags = writtenFlags(calls);
    expect(flags).toContain("needs_darwin_verification");
    expect(flags.some((flag) => flag.startsWith(SERVICE_MAINTENANCE_HOLD_FLAG))).toBe(false);
  });

  it("sends a $0 account row to Darwin as before", async () => {
    const text = "Free Checking\n\nMonthly Maintenance Fee | No charge\n\nOnline Banking\n\nBill Pay | Free";
    const calls: Call[] = [];
    await insertHeldCandidate(fakeDb(calls), { runId: 1, row: textRow(text), held: {
      shape: "zero", feeName: "Monthly Maintenance Fee", amount: 0, amountMax: null, percent: null, frequency: "monthly",
      canonicalHint: "monthly_maintenance", excerpt: "Monthly Maintenance Fee | No charge" } });
    const flags = writtenFlags(calls);
    expect(flags).toContain("needs_darwin_verification");
    expect(flags.some((flag) => flag.startsWith(SERVICE_MAINTENANCE_HOLD_FLAG))).toBe(false);
  });
});
