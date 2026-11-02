// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findZeroWaiverRows,
  recheckZeroWaiverRows,
  ZERO_WAIVER_ROW_PREFILTER,
  ZERO_WAIVER_ROW_TAKEDOWN_LIVE,
  zeroWaiverRowDetail,
  type ZeroWaiverRowLiveRow,
} from "@/lib/agents/darwin/zero-waiver-row-check";

/**
 * #1092: the live $0s the shadow lab found among its known-wrong publications (adversarial fixture,
 * `not_a_fee` cases, frozen texts), and the live $0s beside them that are the bank's own rows.
 */
const TEXTS = new Map<number, string>([
  [1, "Cornerstone Checking:\n\n2 Boxes Personal Checks Free per Year\n\nNo Fee for Cashier's Checks\n\nCornerstone Plus:"],
  [2, "\nNo Fee for Elite Checks\nOne package per order.\n\nNo Fee for Cashier’s Checks\n\nNo Fee for Stop Payments\n\n$1,000 Overdraft Service"],
  [3, "Cornerstone Plus:\nNo\n\nFeature:\nMinimum Balance required to avoid a Service Charge\n\nFREE REWARD Checking:"],
  [4, "Business Plus\n\nAverage daily balance to avoid monthly service charge | $0.00\n\nMonthly Service Charge | $0.00"],
  [5, "Minimum Balance (opening) | $100.00\n\nMinimum Balance Required to avoid service charge | None\n\nService Charge | None"],
  [6, "Notary Service\n\nNo charge for notarization of Bank documents.\n\n$10 per signature for notarization of non-Bank documents"],
]);

const row = (id: number, artifact: number | null, key: string, name: string, line: string): ZeroWaiverRowLiveRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: 100 + (artifact ?? 0), fee_name: name, canonical_fee_key: key,
  source_line: `Knox read a free fee from Rosetta artifact #${artifact}. canonical_hint=${key}; excerpt="${line}"`, artifact_id: artifact,
});

const ROWS: ZeroWaiverRowLiveRow[] = [
  row(56853, 1, "cashiers_check", "Cashier's Checks", "No Fee for Cashier's Checks"),
  row(64330, 2, "cashiers_check", "Cashier’s Checks", "No Fee for Cashier’s Checks"),
  row(64331, 2, "stop_payment", "Stop Payments", "No Fee for Stop Payments"),
  row(102158, 3, "monthly_maintenance", "Service Charge", "Minimum Balance required to avoid a Service Charge / FREE"),
  // The bank's own $0 rows, which the shared check traces to the balance row above them: kept.
  row(75618, 4, "monthly_maintenance", "Monthly Service Charge", "Monthly Service Charge | $0.00"),
  row(23743, 5, "monthly_maintenance", "Service Charge", "Service Charge | None"),
  // A no-charge sentence under its fee's own heading: the bank's $0 notary fee (state key 5608's line).
  row(5608, 6, "notary_fee", "notarization of Bank documents", "No charge for notarization of Bank documents."),
  // A text that is gone: not judged.
  row(9, null, "stop_payment", "Stop Payments", "No Fee for Stop Payments"),
];

function fakeDb(calls: string[]) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("published_fee_records fp") && text.includes("SELECT")) return Promise.resolve(ROWS);
    if (text.includes("FROM agent_source_texts")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ id, normalized_text })));
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof recheckZeroWaiverRows>[0];
}

describe("Darwin's waiver-row $0 re-check (#1092)", () => {
  it("is off by default", () => {
    expect(ZERO_WAIVER_ROW_TAKEDOWN_LIVE).toBe(false);
  });

  it("reads the lab fees whose list names its account, and keeps the bank's own $0 rows", () => {
    const found = findZeroWaiverRows(ROWS, TEXTS);
    // 64330 and 64331's frozen text names no account or package above the list: kept (a known miss).
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind])).toEqual([
      [56853, "no_fee_sentence"],
      [102158, "waiver_requirement"],
    ]);
    expect(found.checked).toBe(8);
    expect(found.noText).toBe(1);
    expect(found.institutions).toBe(2);
    expect(found.byKind).toEqual({ no_fee_sentence: 1, waiver_requirement: 1 });
    expect(found.matches.find((fee) => fee.feePublishedId === 102158)).toMatchObject({
      reason: 'zero_waiver_row: waiver_requirement, "Minimum Balance required to avoid a Service Charge"',
      tracedLine: "Minimum Balance required to avoid a Service Charge | FREE REWARD Checking:",
    });
  });

  it("selects by a prefilter that passes each lab line and leaves the bank's table rows", () => {
    const prefilter = new RegExp(ZERO_WAIVER_ROW_PREFILTER.replace(/\\m|\\M/g, "\\b"), "i");
    for (const fee of ROWS.slice(0, 4)) expect(prefilter.test(fee.source_line ?? "")).toBe(true);
    expect(prefilter.test('excerpt="Monthly Service Charge | $0.00"')).toBe(false);
    expect(prefilter.test('excerpt="Stop Payment | $0.00"')).toBe(false);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const result = await recheckZeroWaiverRows(fakeDb(calls), { runId: 1, stepId: 2, dryRun: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(2);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|pipeline_feedback|second_look/i.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(zeroWaiverRowDetail(result)).toMatchObject({ check: "darwin.zero_waiver_row", switch_live: false, matched: 2, taken_down: [] });
  });

  it("writes nothing on a dry run, even switched on", async () => {
    const calls: string[] = [];
    const result = await recheckZeroWaiverRows(fakeDb(calls), { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(2);
    expect(calls.some((call) => /UPDATE|INSERT/.test(call))).toBe(false);
  });
});
