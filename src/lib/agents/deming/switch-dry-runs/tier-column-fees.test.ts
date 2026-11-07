import { describe, expect, it } from "vitest";

import { TIER_COLUMN_MAX_ROWS, tierColumnRowLimit, type TierColumnRow } from "@/lib/agents/darwin/tier-column-check";
import { tierColumnFeesSection } from "./tier-column-fees";
import { DEFAULT_SWITCH_AUDIT_OPTIONS, type SwitchAuditReader } from "./types";

const TEXT = ["PLATINUM GOLD SILVER", "Stop Payment FREE $25 $25", "Notary FREE $5 $5", "Copies $1 $1 $1"].join("\n");
const rows = (count: number): TierColumnRow[] => Array.from({ length: count }, (_, index) => ({
  fee_published_id: index + 1, fee_verified_id: index + 1, institution_id: 1, source_document_id: 1, canonical_fee_key: null,
  fee_name: "Copies", amount: 1, excerpt: "Copies $1 $1 $1", text: TEXT,
}));
/** A reader whose tier column read clamps its limit as `tierColumnRowsSql` does. */
const reader = (available: number) => ({
  tierColumnRows: async (limit: number) => rows(Math.min(available, tierColumnRowLimit(limit))),
}) as unknown as SwitchAuditReader;

describe("the switch dry-run audit's tier column section (review of #2993, S1)", () => {
  it("should_say_the_read_was_cut_off_when_it_stops_at_the_sql_clamp_below_the_row_cap", async () => {
    expect(DEFAULT_SWITCH_AUDIT_OPTIONS.rowCap).toBeGreaterThan(TIER_COLUMN_MAX_ROWS);
    const section = await tierColumnFeesSection(reader(TIER_COLUMN_MAX_ROWS + 5), DEFAULT_SWITCH_AUDIT_OPTIONS);
    expect(section.rowsRead).toEqual({ read: TIER_COLUMN_MAX_ROWS, cap: TIER_COLUMN_MAX_ROWS, truncated: true });
  });

  it("should_say_a_short_read_is_complete", async () => {
    const section = await tierColumnFeesSection(reader(3), DEFAULT_SWITCH_AUDIT_OPTIONS);
    expect(section.rowsRead).toEqual({ read: 3, cap: TIER_COLUMN_MAX_ROWS, truncated: false });
  });

  it("should_clamp_every_limit_to_the_read's_own_maximum", () => {
    expect([tierColumnRowLimit(), tierColumnRowLimit(50_000), tierColumnRowLimit(0)]).toEqual([6_000, TIER_COLUMN_MAX_ROWS, 1]);
  });
});
