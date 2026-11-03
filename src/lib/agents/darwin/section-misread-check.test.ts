// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findSectionMisreads,
  FRONT_MATTER_NAME_SQL,
  recheckSectionMisreads,
  SECTION_MISREAD_TAKEDOWN_LIVE,
  sectionMisreadDetail,
  WAIVER_ADVICE_NAME_SQL,
  WIRE_SUBSCRIPTION_NAME_SQL,
  type SectionMisreadRow,
} from "@/lib/agents/darwin/section-misread-check";

/** Knox v177 (backlog dry run 8): live rows the Nov 3 dry run read, by their published names. */
const IRA_TEXT = "Late Fee (6 days or more past due) Up to $35.00\nINDIVIDUAL RETIREMENT ACCOUNT (IRA) FEES\nAccount Closure Fee $25.00\nLOAN FEES";
const OTHER_TEXT = "IRA ACCOUNT FEES\n\nTransfer/Rollover/Premature Closing | $25.00/Item\n\nOTHER SERVICE FEES\n\nAccount Closure | $5.00 if closed within 90 days";

const TEXTS = new Map<number, string>([[2504, IRA_TEXT], [22731, OTHER_TEXT]]);

const row = (id: number, artifact: number | null, key: string, name: string, amount: number): SectionMisreadRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: 7534, fee_name: name, amount, canonical_fee_key: key, artifact_id: artifact,
});

const ROWS: SectionMisreadRow[] = [
  row(77750, 1, "bill_pay", "Use Online BillPay, HonorPay or Account-To-Account Transfers: Verification of Deposits", 25),
  row(68504, 1, "bill_pay", "Use Online BillPay or Account-To-Account Transfers: Gift Card", 3),
  // The right fee under a long name (Honor's 18786): stays.
  row(18786, 1, "account_verification", "Use Online BillPay, HonorPay or Account-To-Account Transfers Verification of Deposits", 25),
  row(167014, 1, "account_research", "meta-fb:pages: meta-generator: WordPress 7.1.4 meta-msapplication-TileImage: https://www.citizensbankal.com/wp-content/u", 30),
  row(152355, 1, "wire_intl_outgoing", "International Wire Module", 20),
  // A wire sent through a module: stays.
  row(43406, 1, "wire_domestic_outgoing", "Outgoing Domestic Wire through Wire Module", 10),
  // A service's own name: stays.
  row(60146, 1, "atm_non_network", "Use of Foreign ATM", 2),
  row(94053, 2504, "early_closure", "Account Closure Fee", 25),
  // Under "OTHER SERVICE FEES", after the IRA section: stays.
  row(160187, 22731, "early_closure", "Account Closure", 5),
  // Its text is gone: not judged.
  row(99999, 404, "early_closure", "Account Closure Fee", 25),
];

function fakeDb(calls: string[]) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("published_fee_records fp") && text.includes("SELECT")) return Promise.resolve(ROWS);
    if (text.includes("FROM agent_source_texts WHERE id = ANY")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ id, normalized_text })));
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof recheckSectionMisreads>[0];
}

describe("Darwin's section misread re-check (Knox v177)", () => {
  it("is off by default", () => {
    expect(SECTION_MISREAD_TAKEDOWN_LIVE).toBe(false);
  });

  it("matches the waiver column names, the front-matter name, the wire module and the IRA closing, and keeps the rest", () => {
    const found = findSectionMisreads(ROWS, TEXTS);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind])).toEqual([
      [68504, "waiver_column_name"],
      [77750, "waiver_column_name"],
      [94053, "ira_section_closing"],
      [152355, "wire_subscription"],
      [167014, "front_matter_name"],
    ]);
    expect(found.checked).toBe(10);
    expect(found.noText).toBe(1);
    expect(found.byKind).toEqual({ waiver_column_name: 2, front_matter_name: 1, wire_subscription: 1, ira_section_closing: 1 });
    expect(found.matches[1].reason).toBe('waiver_column_name: "Verification of Deposits is account_verification, not bill_pay"');
  });

  it("keeps a wire's price that names its sender's package or module, and a single service's advice (review of #2973)", () => {
    const kept = [
      row(1, 1, "wire_domestic_outgoing", "Outgoing domestic wire, Business Package", 20),
      row(2, 1, "wire_intl_outgoing", "Outgoing international wire – Treasury Module", 45),
      row(3, 1, "atm_non_network", "Use Non-Network ATM", 2.5),
      row(4, 1, "paper_statement", "Switch to paper statements", 5),
    ];
    expect(findSectionMisreads(kept, TEXTS).matches).toEqual([]);
  });

  it("selects the rows by Postgres pre-filters wide enough for each rule", () => {
    expect(new RegExp(WAIVER_ADVICE_NAME_SQL, "i").test(ROWS[0].fee_name ?? "")).toBe(true);
    expect(new RegExp(FRONT_MATTER_NAME_SQL, "i").test(ROWS[3].fee_name ?? "")).toBe(true);
    expect(new RegExp(WIRE_SUBSCRIPTION_NAME_SQL, "i").test("International Wire Module")).toBe(true);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const result = await recheckSectionMisreads(fakeDb(calls), { runId: 1, stepId: 2, dryRun: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(5);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|second_look/i.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(sectionMisreadDetail(result)).toMatchObject({ check: "darwin.section_misread", switch_live: false, matched: 5, taken_down: [] });
  });

  it("writes nothing on a dry run, even switched on", async () => {
    const calls: string[] = [];
    const result = await recheckSectionMisreads(fakeDb(calls), { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(5);
    expect(calls.some((call) => /UPDATE|INSERT/.test(call))).toBe(false);
  });
});
