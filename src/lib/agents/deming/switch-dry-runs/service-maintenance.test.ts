// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ServiceMaintenanceLiveRow } from "@/lib/agents/darwin/service-maintenance-check";
import { onlineServiceMonthlyFee } from "@/lib/service-monthly-charge";
import { addServiceMaintenanceRows, emptyServiceMaintenanceSummary } from "./service-maintenance";

/**
 * Review of #2953 at 0bdf675: section 9 counts as "would take down" only the fees this switch alone would
 * take down. A match main's online-services rule (#2963, `onlineServiceMonthlyFee`) also matches is
 * covered by `NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE` and reported apart.
 */
const RIVER_CITY = "Consumer Online Banking Services and Mobile Banking Fees\n\nSet Up Fee | No charge\n\nMonthly Maintenance Fee | No charge";
const ONLINE_FEES = "Wire Transfers\n\nOutgoing Domestic Wire | $25.00\n\nOnline Banking Fees\n\nMonthly Maintenance Fee | $3.00";
const TEXTS = new Map([[41, RIVER_CITY], [42, ONLINE_FEES]]);

const row = (id: number, artifact: number, amount: number, line: string): ServiceMaintenanceLiveRow => ({
  fee_published_id: id, fee_verified_id: id + 1, institution_id: 100 + artifact, fee_name: "Monthly Maintenance Fee", amount,
  source_line: `Knox deterministic extraction from Rosetta artifact #${artifact}. excerpt="${line}"`, artifact_id: artifact,
});

describe("dry-run section 9: fees main's online-services rule already covers (#2953 review)", () => {
  it("counts only River City's fee as this switch's takedown, and the online-fees one apart", () => {
    // Both rules read the second text; only this PR's reads River City's two-service heading.
    expect(onlineServiceMonthlyFee("Monthly Maintenance Fee", "Monthly Maintenance Fee | $3.00", ONLINE_FEES)).not.toBeNull();
    expect(onlineServiceMonthlyFee("Monthly Maintenance Fee", "Monthly Maintenance Fee | No charge", RIVER_CITY)).toBeNull();
    const summary = emptyServiceMaintenanceSummary();
    addServiceMaintenanceRows(summary, new Set(), [
      row(5608, 41, 0, "Monthly Maintenance Fee | No charge"),
      row(9001, 42, 3, "Monthly Maintenance Fee | $3.00"),
    ], TEXTS, 10);
    expect(summary).toMatchObject({ checked: 2, wouldTakeDown: 1, alsoNotAccountFeeLine: 1, free: 1, priced: 0, institutions: 1 });
    expect(summary.samples.map((fee) => fee.feePublishedId)).toEqual([5608]);
  });
});
