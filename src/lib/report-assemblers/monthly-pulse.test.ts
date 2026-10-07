import { describe, expect, it } from "vitest";
import { confirmFeeChange, sameEdition, type RecordedChangeRow } from "./monthly-pulse";

// Lines copied from stored schedule texts (agent_source_texts), Oct 2026.
const NH_OLD = "Account Inquiry/Research/Reconciliation | $25\nTemporary Checks | $2 for 4";
const NH_NEW = "Account Inquiry/Research/Reconciliation | $50/ hour unless NHFCU\nTemporary Checks | $5.00 per sheet";
const CANYON = "Returned Deposit Fee | $10/item\nReturned Deposit Fee | $3/item";
const MOUNT_DORA = "Set-up fee $20.00;Monthly fee $32.00 (includes one module)\nSet-up fee $20.00;Monthly fee $5.00 (waived with Check Safekeeping)";

function row(over: Partial<RecordedChangeRow>): RecordedChangeRow {
  return {
    institution_name: "New Hampshire Federal Credit Union",
    state_code: "NH",
    charter_type: "credit_union",
    fee_key: "account_research",
    fee_name: "Account Inquiry/Research/Reconciliation",
    old_fee_name: "Account Inquiry/Research/Reconciliation",
    old_amount: "25",
    new_amount: 50,
    changed_at: "2026-10-05T20:25:24Z",
    source_url: "https://nhfcu.org/fee-schedule.pdf",
    new_document_text: NH_NEW,
    old_document_text: NH_OLD,
    ...over,
  };
}

describe("confirmFeeChange", () => {
  it("confirms a price the new schedule changed", () => {
    expect(confirmFeeChange(row({}))).toMatchObject({ old_amount: 25, new_amount: 50, direction: "up", changed_at: "2026-10-05" });
    expect(
      confirmFeeChange(row({ fee_key: "counter_check", fee_name: "Temporary Checks", old_fee_name: "Temporary Checks", old_amount: 2, new_amount: 5 })),
    ).toMatchObject({ display_name: expect.any(String), direction: "up" });
  });

  it("drops a page that lists both prices", () => {
    expect(
      confirmFeeChange(row({ fee_name: "Returned Deposit Fee", old_fee_name: "Returned Deposit Fee", old_amount: 3, new_amount: 10, new_document_text: CANYON, old_document_text: CANYON })),
    ).toBeNull();
    expect(
      confirmFeeChange(row({ fee_name: "Monthly fee", old_fee_name: "Monthly fee", old_amount: 5, new_amount: 32, new_document_text: MOUNT_DORA, old_document_text: MOUNT_DORA })),
    ).toBeNull();
  });

  it("drops prices read from two different pages", () => {
    expect(confirmFeeChange(row({ old_source_url: "https://nhfcu.org/business-fee-schedule.pdf" }))).toBeNull();
    expect(confirmFeeChange(row({ old_source_url: "https://www.nhfcu.org/fee-schedule.pdf#page=2" }))).not.toBeNull();
  });

  it("drops two different fees in one category", () => {
    expect(confirmFeeChange(row({ old_fee_name: "Express Checking Plus Monthly Fee" }))).toBeNull();
  });

  it("drops a change the earlier schedule never stated", () => {
    expect(confirmFeeChange(row({ old_document_text: "Account Inquiry/Research/Reconciliation | $50" }))).toBeNull();
  });

  it("drops two readings of the same schedule edition", () => {
    // Net Federal Credit Union, Oct 2026: one Feb 1, 2026 schedule read twice; the second
    // reading paired "Stop Payments" with the next column's $30.00.
    const first = "Fee Schedule | Effective February 1, 2026\nVoided/Redeposited Checks | $30.00\nStop Payments | $35.00 | Plastic Cards";
    const second = "Fee Schedule Effective February 1, 2026 Duplicate Item Fee $35.00Stop Payments $30.00 Voided/Redeposited Checks";
    expect(
      confirmFeeChange(row({ fee_key: "stop_payment", fee_name: "Stop Payments", old_fee_name: "Stop Payments", old_amount: 35, new_amount: 30, old_document_text: first, new_document_text: second })),
    ).toBeNull();
    expect(sameEdition(first, second)).toBe(true);
    expect(sameEdition(NH_OLD, NH_NEW)).toBe(false);
  });

  it("drops a change when the earlier schedule already stated the new price", () => {
    expect(confirmFeeChange(row({ old_document_text: `${NH_OLD}\nAccount Inquiry/Research/Reconciliation | $50` }))).toBeNull();
  });

  it("drops rows without both schedules' text", () => {
    expect(confirmFeeChange(row({ new_document_text: null }))).toBeNull();
    expect(confirmFeeChange(row({ old_document_text: null }))).toBeNull();
  });
});

describe("renderMonthlyPulseReport", () => {
  it("lists confirmed changes and explains why medians are not compared", async () => {
    const { renderMonthlyPulseReport } = await import("../report-templates/templates/monthly-pulse");
    const change = confirmFeeChange(row({}))!;
    const html = renderMonthlyPulseReport({
      data: {
        report_date: "2026-10-06",
        period_label: "October 2026",
        window_start: "2026-09-06",
        changes: [change],
        changes_not_confirmed: 7,
        coverage: { institutions_live: 2669, institutions_added_in_window: 1935, live_fees: 38072 },
        manifest: { queries: [], data_hash: "x", pipeline_commit: "local" },
      },
      narratives: { pulse_overview: { narrative: "One change." } as never },
    });
    expect(html).toContain("1 confirmed fee change this month");
    expect(html).toContain("New Hampshire Federal Credit Union (NH, credit union)");
    expect(html).toContain("7 recorded changes were left out");
    expect(html).toContain("1,935 institutions of 2,669 were added");
  });
});
