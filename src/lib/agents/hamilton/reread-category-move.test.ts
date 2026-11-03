import { describe, expect, it } from "vitest";
import cases from "./__fixtures__/reread-category-move-cases.json";
import { namesShareReading } from "./publish";
import {
  REREAD_CATEGORY_MOVE_LIVE,
  combinedOverdraftNsfLine,
  rereadsLineInAnotherCategory,
  sameStatedLine,
  statedLineFold,
  type CategoryMoveSide,
} from "./reread-category-move";

/**
 * The 58 pairs of the re-read backlog scan (dry runs rb to rb10, 482 texts, Nov 3): a row the re-read
 * would publish and a live fee of the same bank at the same price under another category with a similar
 * name. 37 are one printed line read twice (`judged` new, either, old, convention, doubtful); 21 are
 * different fees at one price (`false_pair`). Each case carries the real stored lines, names and
 * documents, and the lines of the re-read's stored text around the line (the window keeps every place
 * the line is printed, so "printed once" reads as on the whole text).
 */
interface Case {
  judged: "new" | "either" | "old" | "convention" | "doubtful" | "false_pair";
  bank: string;
  live_id: number;
  old_key: string;
  new_key: string;
  amount: number;
  new_name: string;
  new_excerpt: string;
  new_freq: string | null;
  new_product: string | null;
  new_doc: number;
  new_url: string | null;
  new_stream: string | null;
  new_crawled_at: string | null;
  new_read_at: string;
  live_name: string;
  live_excerpt: string;
  live_freq: string | null;
  live_product: string | null;
  live_doc: number;
  live_url: string | null;
  live_stream: string | null;
  live_crawled_at: string | null;
  live_read_at: string;
  text_id: number;
  text: string;
}

const all = cases as Case[];

function sides(c: Case): [CategoryMoveSide, CategoryMoveSide] {
  return [
    {
      canonical_fee_key: c.new_key, fee_name: c.new_name, read_at: c.new_read_at, product_name: c.new_product, frequency: c.new_freq,
      source_document_id: c.new_doc, document_url: c.new_url, document_stream: c.new_stream, document_crawled_at: c.new_crawled_at, excerpt: c.new_excerpt,
    },
    {
      canonical_fee_key: c.old_key, fee_name: c.live_name, read_at: c.live_read_at, product_name: c.live_product, frequency: c.live_freq,
      source_document_id: c.live_doc, document_url: c.live_url, document_stream: c.live_stream, document_crawled_at: c.live_crawled_at, excerpt: c.live_excerpt,
    },
  ];
}

function supersedes(c: Case, over: { read?: Partial<CategoryMoveSide>; live?: Partial<CategoryMoveSide> } = {}): boolean {
  const [read, live] = sides(c);
  return rereadsLineInAnotherCategory({ ...read, ...over.read }, { ...live, ...over.live }, c.text, c.amount, namesShareReading(c.new_name, c.live_name));
}

const superseded = (judged: Case["judged"]) => all.filter((c) => c.judged === judged && supersedes(c)).map((c) => c.live_id).sort((a, b) => a - b);
const kept = (judged: Case["judged"]) => all.filter((c) => c.judged === judged && !supersedes(c)).map((c) => c.live_id).sort((a, b) => a - b);

describe("one printed line re-read under another category (reread-category-move.ts)", () => {
  it("holds the scan's 58 pairs: 37 one line read twice, 21 different fees at one price", () => {
    expect(all).toHaveLength(58);
    expect(all.filter((c) => c.judged !== "false_pair")).toHaveLength(37);
    expect(all.filter((c) => c.judged === "false_pair")).toHaveLength(21);
  });

  it("supersedes 15 of the 21 live fees whose new category is right, and leaves the 6 it cannot prove one line", () => {
    expect(superseded("new")).toEqual([31273, 35781, 36460, 37115, 43968, 55012, 63736, 64789, 94582, 109197, 120582, 124105, 131024, 137555, 143685]);
    // 21527, 21530: the line is printed under two or three accounts, and the re-read also named the account.
    // 119438: the re-read also named a product ("Freedom Checking"); that move is the product split's.
    // 129895: the re-read is from another page (/fee-schedule, not /fees.html). 77750: from an older, other page.
    // 146938: the live fee's stored line ("Money Orders/ Cashier's Checks Cashier's (Counter) Check | $3.00")
    // is not printed in today's copy, which heads the line apart.
    expect(kept("new")).toEqual([21527, 21530, 77750, 119438, 129895, 146938]);
  });

  it("never moves an overdraft/NSF combined line (#1513)", () => {
    expect(superseded("convention")).toEqual([]);
    expect(kept("convention")).toEqual([15964, 32093, 75981, 79677, 127643, 128768, 128776, 133257]);
    for (const c of all.filter((each) => each.judged === "convention")) {
      expect(combinedOverdraftNsfLine([c.new_key, c.old_key], [c.new_excerpt, c.live_excerpt, c.new_name, c.live_name])).toBe(true);
    }
  });

  it("never merges two different fees at one price: all 21 false pairs stay apart", () => {
    // Check copies vs statement copies, domestic vs foreign incoming wires, a box key vs a night-deposit key,
    // check vs ACH returns, a deposit item vs a deposit slip copy, consumer vs business overdraft lines.
    expect(superseded("false_pair")).toEqual([]);
  });

  it("leaves the unclear and one of the either-way pairs, and moves the other", () => {
    expect(superseded("doubtful")).toEqual([]);
    expect(superseded("either")).toEqual([32351]);
    expect(kept("either")).toEqual([161632]);
  });

  it("would replace 4 of the 5 live fees whose old category is right, so the switch stays off until Knox reads them right", () => {
    // Knox's wrong re-reads ("Returned Item Fee" as NSF on a returned deposited item list, "Box Late Fee" as a
    // loan late fee). Another change fixes the read; once it does, the re-read keeps the live category and
    // this rule never sees the pair.
    expect(superseded("old")).toEqual([99606, 99611, 128047, 141626]);
    expect(REREAD_CATEGORY_MOVE_LIVE).toBe(false);
  });

  it("acts only on a later read of the line from the same copy or a newer copy of its page", () => {
    const c = all.find((each) => each.live_id === 64789)!;
    expect(supersedes(c)).toBe(true);
    // First read, or one Knox pass reading the line twice: no earlier read of the line.
    expect(supersedes(c, { read: { read_at: c.live_read_at } })).toBe(false);
    expect(supersedes(c, { live: { read_at: "2026-12-01T00:00:00Z" } })).toBe(false);
    expect(supersedes(c, { read: { read_at: null } })).toBe(false);
    // Same category: the ordinary same-line checks own it.
    expect(supersedes(c, { read: { canonical_fee_key: c.old_key } })).toBe(false);
    // Another product, or another page.
    expect(supersedes(c, { read: { product_name: "Gold Checking" } })).toBe(false);
    expect(supersedes(c, { read: { source_document_id: 1, document_url: "https://other.example/fees.pdf", document_crawled_at: "2026-11-01T00:00:00Z" } })).toBe(false);
    // A read from an older copy never replaces a fee from a newer one.
    const copy = all.find((each) => each.live_id === 124105)!;
    expect(supersedes(copy)).toBe(true);
    expect(supersedes(copy, { read: { document_crawled_at: "2026-01-01T00:00:00Z" } })).toBe(false);
    // Frequencies that disagree are two readings, never one line.
    const yearly = all.find((each) => each.live_id === 37115)!;
    expect(supersedes(yearly, { read: { frequency: "annual" } })).toBe(false);
  });
});

describe("sameStatedLine", () => {
  it("folds spacing, leaders and whole-dollar cents", () => {
    expect(statedLineFold("Statement Copies Per Item | $1.00")).toBe(statedLineFold("Statement Copies Per Item | $1"));
    expect(sameStatedLine("Late Payment Fee | $15.00", "Late Payment Fee  ....  $15", "Box Rent\nLate Payment Fee | $15.00\nDrilling | $150")).not.toBeNull();
  });

  it("takes a line with priceless words around it (a glued heading, a neighbour's label) as the same line", () => {
    const text = "(includes Official Checks and Money Orders) | Checks, Official Checks, Money Orders, | Late Fee (past due 30 days) $10";
    expect(sameStatedLine(text, "Late Fee (past due 30 days) $10", text)).toBe("Late Fee (past due 30 days) $10");
  });

  it("refuses words around the line that carry their own price, and a line printed more than once", () => {
    const text = "Same Day ACH $10.00 VISA Return Check Fee $ 25.00";
    expect(sameStatedLine(text, "Same Day ACH $10.00", text)).toBeNull();
    expect(sameStatedLine("Returned Item Fee $5", "Returned Item Fee $5", "Returned Item Fee $5\nACH\nReturned Item Fee $5")).toBeNull();
    expect(sameStatedLine("Late Fee $10", "Late Fee $10", null)).toBeNull();
  });
});

describe("combinedOverdraftNsfLine", () => {
  it("is a move between overdraft and NSF on a line naming both, a returned item included", () => {
    expect(combinedOverdraftNsfLine(["overdraft", "nsf"], ["NSF/Overdraft/Reg D Fees | $30.00"])).toBe(true);
    expect(combinedOverdraftNsfLine(["nsf", "overdraft"], ["Overdraft/Returned Item Fee | $35.00"])).toBe(true);
    expect(combinedOverdraftNsfLine(["overdraft", "nsf"], ["Overdraft Fee | $30.00"])).toBe(false);
    expect(combinedOverdraftNsfLine(["overdraft", "od_protection_transfer"], ["Overdraft/NSF Transfer | $5"])).toBe(false);
  });
});
