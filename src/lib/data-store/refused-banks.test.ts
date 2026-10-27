import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import { getRefusedBanks, REFUSED_OUTCOMES } from "./refused-banks";
import { parseHuntCsv, parseSuppliedFileName, refusedHuntCsv, HUNT_CSV_COLUMNS } from "@/lib/agents/magellan/hand-supplied-files";

type Db = NonNullable<Parameters<typeof getRefusedBanks>[0]>["db"];

function createDb(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  });
  return { db: db as unknown as Db, calls };
}

describe("the hand-download list (fix plan step 9)", () => {
  it("lists banks with no live fees whose link or homepage still refuses us, largest deposits first", async () => {
    const { db, calls } = createDb([
      { id: 12, institution_name: "FIRST BANK, INC.", state_code: "tx ", charter_type: "bank", deposits: "5400000", asset_size: "6100000",
        website_url: "https://firstbank.example", fee_schedule_url: " https://firstbank.example/fees.pdf ", refused_by: "link", refused_outcome: "http_403" },
    ]);
    const banks = await getRefusedBanks({ db, limit: 5000 });
    expect(banks).toEqual([expect.objectContaining({ institutionId: 12, stateCode: "TX", deposits: 5_400_000, assets: 6_100_000, feeScheduleUrl: "https://firstbank.example/fees.pdf", refusedBy: "link" })]);
    const { text, values } = calls[0];
    expect(text).toContain("NOT EXISTS (SELECT 1 FROM published_fee_catalog live");
    // A paid fetch that opened the link since takes the bank off.
    expect(text).toMatch(/paid\.strategy LIKE 'fetch\.paid_web_fetch%'[\s\S]*paid\.created_at >= link_fetch\.created_at/);
    expect(text).toContain("strategy = 'discover.homepage_links'");
    expect(text).toContain("pa.detail->>'url' = btrim(linked.fee_schedule_url)");
    expect(values).toContain("supply.hand_supplied");
    expect(text).toContain("ORDER BY deposits.total_deposits DESC NULLS LAST");
    expect(values).toContainEqual([...REFUSED_OUTCOMES]);
    // Capped at 1,000.
    expect(values).toContain(1000);
  });

  it("writes a browser hunt sheet whose file names load straight back", () => {
    const csv = refusedHuntCsv([
      { institutionId: 12, name: "First Bank, Inc.", stateCode: "TX", charterType: "bank", deposits: 5_400_000, assets: 6_100_000,
        websiteUrl: "https://firstbank.example", feeScheduleUrl: "https://firstbank.example/fees.pdf", refusedBy: "link", refusedOutcome: "http_403" },
      { institutionId: 7, name: "Valley \"Home\" CU", stateCode: null, charterType: null, deposits: null, assets: null,
        websiteUrl: "https://valley.example", feeScheduleUrl: null, refusedBy: "homepage", refusedOutcome: "blocked_bot" },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(HUNT_CSV_COLUMNS.join(","));
    expect(lines[1]).toBe("1,refused_link,12,\"First Bank, Inc.\",TX,bank,6.10,https://firstbank.example,https://firstbank.example/fees.pdf,http_403,,,12__first-bank-inc__consumer.pdf,,");
    const parsed = parseHuntCsv(csv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.map((row) => [row.institutionId, row.institution, row.fileName])).toEqual([
      [12, "First Bank, Inc.", "12__first-bank-inc__consumer.pdf"],
      [7, "Valley \"Home\" CU", "7__valley-home-cu__consumer.pdf"],
    ]);
    expect(parseSuppliedFileName(parsed.rows[1].fileName)).toMatchObject({ institutionId: 7, audience: "consumer" });
  });
});
