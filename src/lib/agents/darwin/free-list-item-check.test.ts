// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findFreeListItems,
  FREE_LIST_ITEM_PREFILTER,
  FREE_LIST_ITEM_TAKEDOWN_LIVE,
  freeListItemDetail,
  recheckFreeListItems,
  type FreeListItemLiveRow,
} from "@/lib/agents/darwin/free-list-item-check";
import { FREE_LIST_HEADING_SQL } from "@/lib/free-list-item";

/** #1092: Mountain Star FCU's text 36365 (read.pdf_layout before layout v6), around its free services list. */
const MOUNTAIN_STAR = [
  "Mailed paper | $1.00",
  "statement | Instant Issue | Other Free Services: Anytime, Notary",
  "$10.00 | Service, Signature Guarantee, Unlimited",
  "Debit Card",
  "Membership Fee $3.00 | Check Writing, Balance Inquiries,",
  "Money market | Fax Service",
  "$5.00",
  "excess check",
  "Copies | *Inactive",
  "$10.00",
  "account fee",
].join("\n");

const TEXTS = new Map<number, string>([[36365, MOUNTAIN_STAR]]);

const row = (id: number, artifact: number | null, key: string, name: string, amount: number, line: string): FreeListItemLiveRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: 4467, fee_name: name, amount, canonical_fee_key: key,
  source_line: `Knox deterministic extraction from Rosetta artifact #${artifact}. canonical_hint=${key}; excerpt="${line}"`, artifact_id: artifact,
});

const ROWS: FreeListItemLiveRow[] = [
  row(159428, 36365, "document_reproduction", "Fax Service", 5, "Money market | Fax Service / $5.00"),
  // The same layout, no list: "Inactive" over "$10.00" / "account fee" is the bank's inactive account fee.
  row(159429, 36365, "dormant_account", "Inactive", 10, "Copies | *Inactive / $10.00"),
  // A text that is gone: not judged.
  row(159430, null, "notary", "Notary", 5, "Notary / $5.00"),
];

function fakeDb(calls: string[]) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("published_fee_records fp") && text.includes("SELECT")) return Promise.resolve(ROWS);
    if (text.includes("FROM agent_source_texts WHERE id = ANY")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ id, normalized_text })));
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof recheckFreeListItems>[0];
}

describe("Darwin's free-list item re-check (#1092, live 159428)", () => {
  it("is off by default", () => {
    expect(FREE_LIST_ITEM_TAKEDOWN_LIVE).toBe(false);
  });

  it("takes Fax Service $5 and keeps the inactive account fee priced the same way", () => {
    const found = findFreeListItems(ROWS, TEXTS);
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual([159428]);
    expect(found.checked).toBe(3);
    expect(found.noText).toBe(1);
    expect(found.matches[0]).toMatchObject({
      item: "Fax Service",
      heading: "Other Free Services: Anytime, Notary",
      tracedLine: "Money market | Fax Service | $5.00",
      reason: 'free_list_item: "Fax Service" under "Other Free Services: Anytime, Notary"',
    });
  });

  it("selects stacked Knox lines on texts that print a list heading", () => {
    const prefilter = new RegExp(FREE_LIST_ITEM_PREFILTER);
    expect(prefilter.test(ROWS[0].source_line ?? "")).toBe(true);
    expect(prefilter.test('excerpt="Fax Service | $5.00"')).toBe(false);
    expect(prefilter.test('excerpt="$5.00 / Fax Service"')).toBe(false);
    const heading = new RegExp(FREE_LIST_HEADING_SQL, "i");
    expect(heading.test(MOUNTAIN_STAR)).toBe(true);
    expect(heading.test("NO CHARGE TO CUSTOMERS FOR THE FOLLOWING SERVICES:")).toBe(true);
    expect(heading.test("Stop Payment | $30.00\nWire Transfer: $25.00")).toBe(false);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const result = await recheckFreeListItems(fakeDb(calls), { runId: 1, stepId: 2, dryRun: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(1);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|pipeline_feedback|second_look/i.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(freeListItemDetail(result)).toMatchObject({ check: "darwin.free_list_item", switch_live: false, matched: 1, taken_down: [] });
  });

  it("writes nothing on a dry run, even switched on", async () => {
    const calls: string[] = [];
    const result = await recheckFreeListItems(fakeDb(calls), { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(1);
    expect(calls.some((call) => /UPDATE|INSERT/.test(call))).toBe(false);
  });
});
