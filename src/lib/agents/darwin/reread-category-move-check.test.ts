import { describe, expect, it } from "vitest";
import cases from "@/lib/agents/hamilton/__fixtures__/reread-category-move-cases.json";
import {
  REREAD_CATEGORY_MOVE_ROWS_SQL,
  findRereadCategoryMoves,
  rereadCategoryMoveDetail,
  type RereadCategoryMovePairRow,
} from "./reread-category-move-check";

type Case = (typeof cases)[number];

/** A scan pair as Darwin reads it once both rows are live: the live fee is the earlier read, the re-read the later. */
function pair(c: Case, newerId = 900000 + c.live_id): RereadCategoryMovePairRow {
  return {
    institution_id: 1, amount: c.amount,
    older_id: c.live_id, older_verified_id: 1, older_key: c.old_key, older_name: c.live_name, older_product: c.live_product,
    older_frequency: c.live_freq, older_document_id: c.live_doc, older_url: c.live_url, older_stream: c.live_stream,
    older_crawled_at: c.live_crawled_at, older_read_at: c.live_read_at, older_excerpt: c.live_excerpt,
    newer_id: newerId, newer_key: c.new_key, newer_name: c.new_name, newer_product: c.new_product,
    newer_frequency: c.new_freq, newer_document_id: c.new_doc, newer_url: c.new_url, newer_stream: c.new_stream,
    newer_crawled_at: c.new_crawled_at, newer_read_at: c.new_read_at, newer_excerpt: c.new_excerpt,
  };
}

const texts = new Map(cases.map((c) => [String(c.new_doc), c.text]));
const judged = (kind: string) => cases.filter((c) => c.judged === kind);

describe("Darwin's re-read category move re-check", () => {
  it("takes down the same earlier reads publish would supersede, and none of the convention or false pairs", () => {
    // One pair per text document at a time: several cases share a document, each with its own window.
    const down = (list: Case[]) => list.filter((c) => findRereadCategoryMoves([pair(c)], new Map([[String(c.new_doc), c.text]])).matched === 1)
      .map((c) => c.live_id).sort((a, b) => a - b);
    expect(down(judged("new"))).toEqual([31273, 35781, 36460, 37115, 43968, 55012, 63736, 64789, 94582, 109197, 120582, 124105, 131024, 137555, 143685]);
    expect(down(judged("convention"))).toEqual([]);
    expect(down(judged("false_pair"))).toEqual([]);
    expect(down(judged("doubtful"))).toEqual([]);
  });

  it("archives the earlier read as a same-line duplicate of the later one, and never keeps a fee behind one going down", () => {
    const c = cases.find((each) => each.live_id === 64789)!;
    const found = findRereadCategoryMoves([pair(c)], texts);
    expect(found.matches.map((match) => [match.feePublishedId, match.keptFeePublishedId, match.reason]))
      .toEqual([[64789, 964789, "same_line_duplicate: live fee #964789"]]);
    expect(found.passing).toEqual([964789]);
    // A chain: 964789 itself comes down behind a third read, so 64789 waits for the next pass.
    const chain = { ...pair(c), older_id: 964789, newer_id: 2, older_key: c.new_key, newer_key: "late_payment", older_read_at: "2026-11-03T12:00:00Z", newer_read_at: "2026-11-04T00:00:00Z" };
    const both = findRereadCategoryMoves([pair(c), chain], texts);
    expect(both.matches.map((match) => match.feePublishedId)).toEqual([964789]);
    expect(both.passing.sort((a, b) => a - b)).toEqual([2, 64789]);
    const detail = rereadCategoryMoveDetail({ ...both, live: false, dryRun: true, flagged: 0, waiting: 0, cleared: 0, takenDown: [] });
    expect(detail).toMatchObject({ check: "darwin.reread_category_move", version: 1, switch_live: false, matched: 1 });
  });

  it("judges nothing without the later read's document text", () => {
    const c = cases.find((each) => each.live_id === 64789)!;
    expect(findRereadCategoryMoves([pair(c)], new Map()).matched).toBe(0);
  });

  it("reads only live dollar pairs of one bank, amount and product across categories, earlier read first", () => {
    expect(REREAD_CATEGORY_MOVE_ROWS_SQL).toContain("n.key <> o.key");
    expect(REREAD_CATEGORY_MOVE_ROWS_SQL).toContain("o.read_at < n.read_at");
    expect(REREAD_CATEGORY_MOVE_ROWS_SQL).toContain("n.product_key = o.product_key");
    expect(REREAD_CATEGORY_MOVE_ROWS_SQL).toContain("fp.rolled_back_at IS NULL");
    expect(REREAD_CATEGORY_MOVE_ROWS_SQL).toContain("fp.rate_percent IS NULL");
  });
});
