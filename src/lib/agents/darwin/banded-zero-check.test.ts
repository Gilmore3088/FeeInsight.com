// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BANDED_ZERO_TAKEDOWN_LIVE, bandedZeroDetail, findBandedZeros, recheckBandedZeros, type BandedZeroRow } from "@/lib/agents/darwin/banded-zero-check";

// #1882: every live $0 overdraft, NSF and continuous overdraft fee on prod (read-only, Oct 26), as the
// check's own SQL selects it: published id, verified id, institution, Knox's name, category, Knox's
// extraction note, and the lines of the text Knox read that carry the name, each with the line after.
type FixtureRow = [number, number, number, string, string, string | null, string | null];
const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/banded-zero-live-2026-10-26.json", import.meta.url), "utf8"),
) as FixtureRow[];
const rows: BandedZeroRow[] = fixture.map(([id, verified, institution, name, key, note, lines]) => ({
  fee_published_id: id,
  fee_verified_id: verified,
  institution_id: institution,
  fee_name: name,
  canonical_fee_key: key,
  source_line: note,
  document_lines: lines,
}));

// The 18 institutions whose highest live overdraft price was $0 on Oct 26 (#1882), by live fee.
const STATED_ZERO = [28126, 50956, 107723, 23284, 115291, 93436, 85606, 56781, 78514, 152915, 34738, 139529, 84053, 153746, 139005];
const BANDED_ONLY_PRICE = [99261, 108088, 116439];

describe("Darwin's banded $0 re-check (#1882)", () => {
  it("is on since James's yes (2026-10-26)", () => {
    expect(BANDED_ZERO_TAKEDOWN_LIVE).toBe(true);
  });

  it("matches the Oct 26 dry run: 4 of 139 live $0 fees at 4 institutions", () => {
    const found = findBandedZeros(rows);
    expect(found.checked).toBe(139);
    expect(found.matched).toBe(4);
    expect(found.institutions).toBe(4);
    expect(found.byKind).toEqual({ own_cell: 2, own_row_price: 1, priced_twin_row: 1 });
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.institutionId, fee.kind, fee.price])).toEqual([
      [99261, 7374, "priced_twin_row", 19],
      [108088, 6056, "own_cell", 35],
      [116439, 7358, "own_cell", 5],
      [149658, 5667, "own_row_price", 12],
    ]);
    expect(found.matches[1].reason).toBe("banded_zero: own_cell, $35");
  });

  it("keeps the 15 overdraft $0s the schedules state, and takes the 3 band reads", () => {
    const matched = new Set(findBandedZeros(rows).matches.map((fee) => fee.feePublishedId));
    for (const id of STATED_ZERO) expect(matched.has(id), String(id)).toBe(false);
    for (const id of BANDED_ONLY_PRICE) expect(matched.has(id), String(id)).toBe(true);
    // A consumer "No Fee" beside a business "$36.00 Each", with no band words: a real free fee.
    expect(matched.has(98972)).toBe(false);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const db = ((strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return Promise.resolve(strings.join("").includes("published_fee_records fp") ? rows : []);
    }) as unknown as Parameters<typeof recheckBandedZeros>[0];
    const result = await recheckBandedZeros(db, { runId: 1, stepId: 2, dryRun: false, live: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(4);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|pipeline_feedback/.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(bandedZeroDetail(result)).toMatchObject({ check: "darwin.banded_zero", switch_live: false, matched: 4, taken_down: [] });
  });
});
