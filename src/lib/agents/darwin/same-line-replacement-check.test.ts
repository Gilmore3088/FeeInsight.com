import { describe, expect, it, vi } from "vitest";
import {
  SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE,
  findSameLineReplacements,
  recheckSameLineReplacements,
  sameLineReplacementDetail,
  type SameLineReplacementRow,
} from "./same-line-replacement-check";

function row(id: number, institution: number, name: string, amount: number, key: string, frequency: string | null, replacement: [number, string, string | null] | null): SameLineReplacementRow {
  return {
    fee_published_id: id, fee_verified_id: id + 1_000_000, institution_id: institution, fee_name: name, amount, canonical_fee_key: key,
    frequency, variant_type: null, older_fee_published_id: null,
    replacement_fee_published_id: replacement?.[0] ?? null, replacement_fee_name: replacement?.[1] ?? null,
    replacement_frequency: replacement?.[2] ?? null, replacement_variant_type: null,
  };
}

// The prod dry run's 17 rows, 2026-10-25 22:14 UTC (read-only).
const PROD: SameLineReplacementRow[] = [
  row(14458, 6999, "ACH, one-time from Credit Card, Debit Card, or Non-Workers Savings or Checking Account, each occurrence Night Deposit Ba", 10, "night_deposit", "one_time", null),
  row(15109, 2580, "for each check requested for stop payment.", 19.95, "stop_payment", "per_item", [141864, "Stop Payment Fee - Check", "per_item"]),
  row(66618, 5102, "Re-presented overdraft items may be charged", 28, "overdraft", "per_item", [26395, "Overdraft", null]),
  row(99504, 8232, "Statement Copy fee", 5, "document_reproduction", "per_item", null),
  row(104580, 148, "Minimum Balance Fee", 20, "minimum_balance", "monthly", null),
  row(104581, 148, "Minimum Balance Fee", 35, "minimum_balance", "daily", null),
  row(104688, 7143, "Cashier's Check: Cashier's Check Fee", 3, "cashiers_check", "per_item", null),
  row(104751, 6191, "Courtesy Pay Fee", 32, "overdraft", null, [150871, "Courtesy Pay NSF", "per_item"]),
  row(104796, 7941, "Stop Payment on Lost Check/Money Order", 25, "stop_payment", "per_item", null),
  row(104866, 4610, "Request: Replacement Card", 5, "card_replacement", "per_item", [149020, "Replacement Card", "per_item"]),
  row(104891, 62, "Minimum balance requirements. A maintenance fee", 12, "monthly_maintenance", "monthly", null),
  row(104940, 81, "Inactive Money Market Account", 10, "dormant_account", "monthly", null),
  row(105019, 6482, "Copy of checks request via email/phone with MSR", 2, "check_image", "per_item", null),
  row(105031, 8058, "Checking/Savings Account Fees: Outgoing Wire Transfer", 25, "wire_domestic_outgoing", "per_item", [146002, "Outgoing Wire Transfer", "per_item"]),
  row(105032, 8058, "Month or Quarter: Check Cashing", 5, "check_cashing", null, [146006, "Check Cashing", null]),
  row(105033, 8058, "Request: Dormant Account", 10, "dormant_account", "quarterly", [146009, "Dormant Account", "quarterly"]),
  row(105034, 8058, "Request: Garnishment", 30, "garnishment_levy", "per_item", [146010, "Garnishment", "per_item"]),
];

describe("findSameLineReplacements (#1673)", () => {
  it("matches the 8 prod copies beside their older line's live replacement, and keeps the other 9", () => {
    const found = findSameLineReplacements(PROD);
    expect(found).toMatchObject({ checked: 17, withReplacement: 8, matched: 8, institutions: 5 });
    expect(found.matches.map((match) => [match.feePublishedId, match.replacementFeePublishedId])).toEqual([
      [15109, 141864], [66618, 26395], [104751, 150871], [104866, 149020],
      [105031, 146002], [105032, 146006], [105033, 146009], [105034, 146010],
    ]);
    expect(found.matches[0].reason).toBe("same_line_duplicate: live fee #141864");
    expect(found.passing).toHaveLength(9);
  });

  it("keeps a copy whose name names another item, or whose frequency differs", () => {
    const found = findSameLineReplacements([
      row(1, 1, "Official Check Stop Payment", 30, "stop_payment", "per_item", [2, "Stop Payment", "per_item"]),
      row(3, 1, "Dormant Account", 10, "dormant_account", "monthly", [4, "Dormant Account", "quarterly"]),
      row(5, 1, "Dormant Account", 10, "dormant_account", "monthly", [5, "Dormant Account", "monthly"]),
    ]);
    expect(found).toMatchObject({ checked: 3, withReplacement: 2, matched: 0 });
    expect(found.passing).toEqual([1, 3, 5]);
  });
});

describe("recheckSameLineReplacements", () => {
  type Db = Parameters<typeof recheckSameLineReplacements>[0] & ReturnType<typeof vi.fn>;
  function createDb(rows: SameLineReplacementRow[], read: () => Promise<unknown> = () => Promise.resolve(rows)): Db {
    const db = Object.assign(vi.fn(() => Promise.resolve([])), { unsafe: vi.fn(read) });
    return db as unknown as Db;
  }
  const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join(" "));

  it("ships with its switch off: it reports the matches and takes nothing down", async () => {
    expect(SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE).toBe(false);
    const db = createDb(PROD);
    const result = await recheckSameLineReplacements(db, { runId: 9, dryRun: false });
    expect(result).toMatchObject({ live: false, checked: 17, matched: 8, flagged: 0, takenDown: [] });
    expect(writes(db).some((text) => /UPDATE|pipeline_feedback/.test(text))).toBe(false);
    expect(writes(db).filter((text) => text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(sameLineReplacementDetail(result)).toMatchObject({ check: "darwin.same_line_replacement", version: 1, switch_live: false, matched: 8 });
  });

  it("writes nothing on a dry run, even with the switch on", async () => {
    const db = createDb(PROD);
    const result = await recheckSameLineReplacements(db, { runId: 9, dryRun: true, live: true });
    expect(result.matched).toBe(8);
    expect(db.mock.calls).toHaveLength(0);
  });

  it("reports nothing checked when the read fails", async () => {
    const db = createDb([], () => Promise.reject(new Error("boom")));
    const result = await recheckSameLineReplacements(db, { runId: 9, dryRun: false });
    expect(result).toMatchObject({ checked: 0, matched: 0 });
  });
});
