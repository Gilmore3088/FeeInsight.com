import { describe, expect, it } from "vitest";
import * as registry from "../src/lib/agents/learning/feedback-kinds";
import { gapLine, liveBatchGapSql, liveBatchMisses, parseCsv, tagLiveBatch, toCsv } from "./live-batch-gaps.mjs";

const HEADER = "institution_id,institution,fee_name_on_site,category_on_site,amount_on_site,audience_on_site,source_url,schedule_effective_date,schedule_amount,schedule_quote,verdict,error_type,correct_category_or_amount,notes";
const csv = [
  HEADER,
  `1,Bank,Overdraft Fee,overdraft,$35,consumer,u,,$35,,MATCH,,,"record_id=10"`,
  `1,Bank,"Research, hourly",account_research,$25,consumer,u,,$25/hr,"quote with ""marks""",WRONG_AMOUNT,wrong amount,$25 per hour,"record_id=11; note"`,
  `1,Bank,Stop Pay,stop_payment,$30,consumer,u,,,,WRONG_CATEGORY,wrong category,,record_id=12`,
  `1,Bank,Wire,wire_domestic_outgoing,$20,consumer,u,,,,WRONG_DOCUMENT,,,record_id=13`,
  `2,Other's Bank,Late Payment,late_fee,$5,consumer,u,,,,BAD_NAME,garbled name,,no id here`,
  `2,Other's Bank,,nsf,,,,,,,MISSING,missing core fee,,`,
  `2,Other's Bank,Coin,coin,$4,consumer,u,,,,CANT_VERIFY,,,record_id=14`,
].join("\n");

describe("weekly live-check loop gaps (#2066)", () => {
  const rows = parseCsv(csv);

  it("reads quoted fields and keeps only judged misses, with the step each blames", () => {
    expect(rows[1].fee_name_on_site).toBe("Research, hourly");
    expect(rows[1].schedule_quote).toBe('quote with "marks"');
    const misses = liveBatchMisses(rows);
    expect(misses.map((m: { row: number; step: string; feeId: number | null }) => [m.row, m.step, m.feeId])).toEqual([
      [1, "extract", 11], [2, "extract", 12], [3, "discover", 13], [4, "extract", null], [5, "extract", null],
    ]);
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("writes one read-only SELECT that looks up fees by id, or by name and amount when the row has none", () => {
    const sql = liveBatchGapSql(liveBatchMisses(rows), "2026-10-19");
    expect(sql).toMatch(/^-- Read-only/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/);
    expect(sql).toContain("(1, 11::bigint, NULL::bigint, NULL::text, NULL::numeric)");
    expect(sql).toContain("(4, NULL::bigint, 2, 'Late Payment', 5::numeric)");
    expect(sql).not.toContain("(5,"); // A missing fee has nothing to look up.
    expect(() => liveBatchGapSql([], "Oct 19")).toThrow();
  });

  it("tags each miss: routed when the blamed step's agent reads a row, not routed, not caught, or unresolved", () => {
    const summary = tagLiveBatch(rows, [
      // Read by Knox's lessons at extract.
      [1, 11, ["wrong_category|extract|hamilton.category_guard|t"]],
      // An unread kind and a record: caught, never routed.
      [2, 12, ["frequency_filled|extract|darwin.hourly_frequency_check|", "knox_reread_resolved|extract|knox.reread_feedback|"]],
      // A record alone is not a catch.
      [3, 13, ["category_fold|publish|hamilton.taxonomy_fold|"]],
      [4, null, []],
    ], registry);
    expect(summary.tagged.map((m: { row: number; tag: string }) => [m.row, m.tag])).toEqual([
      [1, "caught_routed"], [2, "caught_not_routed"], [3, "not_caught"], [4, "unresolved"], [5, "not_caught"],
    ]);
    expect(summary.counts).toEqual({ caught_routed: 1, caught_not_routed: 1, not_caught: 2, unresolved: 1 });
    expect(gapLine(summary)).toBe("5 misses: 2 not caught (gaps), 1 caught but not routed to the step that made them, 1 caught and routed, 1 unresolved.");
  });

  it("counts a discover miss as routed only when Magellan reads the row", () => {
    const misses = [[3, 13, ["audit_miss|discover|hamilton.article_page|"]]];
    expect(tagLiveBatch(rows, misses, registry).tagged.find((m: { row: number }) => m.row === 3)?.tag).toBe("caught_routed");
    const knoxOnly = [[3, 13, ["wrong_category|extract|hamilton.category_guard|t"]]];
    expect(tagLiveBatch(rows, knoxOnly, registry).tagged.find((m: { row: number }) => m.row === 3)?.tag).toBe("caught_not_routed");
  });
});
