// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findServiceMaintenance,
  recheckServiceMaintenance,
  SERVICE_MAINTENANCE_TAKEDOWN_LIVE,
  SERVICE_MAINTENANCE_TEXT_PREFILTER,
  serviceMaintenanceDetail,
  type ServiceMaintenanceLiveRow,
} from "@/lib/agents/darwin/service-maintenance-check";

/**
 * #1092: River City Bank's online banking section (state key 5608) as a table read pairs its rows,
 * the same section priced, and the account rows beside them that are the bank's own monthly fees.
 */
const RIVER_CITY = [
  "The Transfer Fee will not be charged if there are not enough funds in the savings account to cover the entire overdraft amount.",
  "",
  "Consumer Online Banking Services and Mobile Banking Fees",
  "",
  "Set Up Fee | No charge",
  "",
  "Monthly Maintenance Fee | No charge",
].join("\n");
const TEXTS = new Map<number, string>([
  [1, RIVER_CITY],
  [2, "Wire Transfer - Outgoing | $25.00\n\nBill Pay\n\nMonthly Maintenance Fee | $4.95\n\nExpedited Payment | $9.95"],
  // The account's own row, with an online banking section after it.
  [3, "Personal Checking\n\nMonthly Maintenance Fee | $8.00\n\nOnline Banking\n\nBill Pay | Free"],
  // An account's features printed as lines over its own monthly fee.
  [4, "Premier Checking\n\nFree Online Banking\n\nMobile Banking\n\nMonthly Maintenance Fee | $10.00"],
]);

const row = (id: number, artifact: number | null, amount: number, name: string, line: string): ServiceMaintenanceLiveRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: 100 + (artifact ?? 0), fee_name: name, amount,
  source_line: `Knox read a free fee from Rosetta artifact #${artifact}. canonical_hint=monthly_maintenance; excerpt="${line}"`, artifact_id: artifact,
});

const ROWS: ServiceMaintenanceLiveRow[] = [
  row(5608, 1, 0, "Monthly Maintenance Fee", "Monthly Maintenance Fee | No charge"),
  row(7001, 2, 4.95, "Monthly Maintenance Fee", "Monthly Maintenance Fee | $4.95"),
  row(7002, 3, 8, "Monthly Maintenance Fee", "Monthly Maintenance Fee | $8.00"),
  row(7003, 4, 10, "Monthly Maintenance Fee", "Monthly Maintenance Fee | $10.00"),
  // A text that is gone (or prints no service word): not judged.
  row(9, null, 0, "Monthly Maintenance Fee", "Monthly Maintenance Fee | No charge"),
];

function fakeDb(calls: string[]) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("published_fee_records fp") && text.includes("SELECT")) return Promise.resolve(ROWS);
    if (text.includes("FROM agent_source_texts")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ id, normalized_text })));
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof recheckServiceMaintenance>[0];
}

describe("Darwin's service-heading monthly maintenance re-check (#1092)", () => {
  it("is off by default", () => {
    expect(SERVICE_MAINTENANCE_TAKEDOWN_LIVE).toBe(false);
  });

  it("reads the $0 and the priced service rows, and keeps the accounts' own rows", () => {
    const found = findServiceMaintenance(ROWS, TEXTS);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.services])).toEqual([
      [5608, ["online_banking", "mobile_banking"]],
      [7001, ["bill_pay"]],
    ]);
    expect(found).toMatchObject({ checked: 5, noText: 1, matched: 2, institutions: 2, free: 1, priced: 1 });
    expect(found.matches[0]).toMatchObject({
      reason: 'service_maintenance_heading: online_banking+mobile_banking, "Consumer Online Banking Services and Mobile Banking Fees"',
      tracedLine: "Monthly Maintenance Fee | No charge",
    });
  });

  it("selects texts by a prefilter that passes each service text", () => {
    const prefilter = new RegExp(SERVICE_MAINTENANCE_TEXT_PREFILTER, "i");
    for (const text of TEXTS.values()) expect(prefilter.test(text)).toBe(true);
    expect(prefilter.test("Basic Checking\n\nMonthly Maintenance Fee | $5.00")).toBe(false);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const result = await recheckServiceMaintenance(fakeDb(calls), { runId: 1, stepId: 2, dryRun: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(2);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|pipeline_feedback|second_look/i.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(serviceMaintenanceDetail(result)).toMatchObject({ check: "darwin.service_maintenance_heading", switch_live: false, matched: 2, taken_down: [] });
  });

  it("writes nothing on a dry run, even switched on", async () => {
    const calls: string[] = [];
    const result = await recheckServiceMaintenance(fakeDb(calls), { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(2);
    expect(calls.some((call) => /UPDATE|INSERT/.test(call))).toBe(false);
  });
});
