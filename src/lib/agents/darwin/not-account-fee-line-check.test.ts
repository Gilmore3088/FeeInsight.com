// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findNotAccountFeeLines,
  NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE,
  notAccountFeeLineDetail,
  ONLINE_SECTION_SQL,
  recheckNotAccountFeeLines,
  type NotAccountFeeLineRow,
} from "@/lib/agents/darwin/not-account-fee-line-check";
import { DIVIDEND_THRESHOLD_SQL } from "@/lib/dividend-threshold";
import { currentVariant } from "@/lib/agents/deming/shadow-lab/variants";
import type { StageFee } from "@/lib/agents/deming/shadow-lab/types";

/** Knox v170 (backlog dry run 3): the live rows the Nov 2 dry run matched, with their stored lines. */
const PENINSULA_LINE = "If your average daily balance is below $100.00 ($5.00 for accounts held by those under 18 years of age), no dividends are earned";
const UVA_TEXT = "Online Banking\n\nPersonal Online Banking Fees\n\n| Monthly fee | No charge |\n|---|---|\n| Bill Pay | No charge |\n| Stop payment fee | $32.00 |";
const ACCOUNT_TEXT = "Free Online Banking\n\nEveryday Checking\n\n$5.00 monthly maintenance fee*";

const TEXTS = new Map<number, string>([[34948, UVA_TEXT], [50001, ACCOUNT_TEXT]]);

const row = (id: number, artifact: number | null, key: string, name: string, amount: number, line: string): NotAccountFeeLineRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: 4447, fee_name: name, amount, canonical_fee_key: key,
  source_line: `Knox deterministic extraction from Rosetta artifact #${artifact}. canonical_hint=${key}; excerpt="${line}"`, artifact_id: artifact,
});

const ROWS: NotAccountFeeLineRow[] = [
  row(73916, 16457, "minimum_balance", "If your average daily balance is below (", 5, PENINSULA_LINE),
  row(152003, 34948, "monthly_maintenance", "Monthly fee", 0, "| Monthly fee | No charge |"),
  // A fee its own sentence charges beside the lost interest (live 128240): stays.
  row(128240, null, "monthly_maintenance", "Service charge", 10, "If balance falls below $2,500.00, no interest will be earned, and a $10.00 Service Charge will be charged."),
  // An account's own monthly fee under a feature line: stays.
  row(50002, 50001, "monthly_maintenance", "monthly maintenance fee", 5, "$5.00 monthly maintenance fee*"),
];

function fakeDb(calls: string[]) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("published_fee_records fp") && text.includes("SELECT")) return Promise.resolve(ROWS);
    if (text.includes("FROM agent_source_texts WHERE id = ANY")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ id, normalized_text })));
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof recheckNotAccountFeeLines>[0];
}

describe("Darwin's not-an-account-fee line re-check (Knox v170, live 73916 and 152003)", () => {
  it("is off by default", () => {
    expect(NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE).toBe(false);
  });

  it("takes the dividend threshold and the online banking section's monthly fee, and keeps the account fees", () => {
    const found = findNotAccountFeeLines(ROWS, TEXTS);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind])).toEqual([[73916, "dividend_threshold"], [152003, "online_service_monthly"]]);
    expect(found.checked).toBe(4);
    expect(found.noText).toBe(1);
    expect(found.matches[1].reason).toBe('online_service_monthly: "Monthly fee" under "Personal Online Banking Fees"');
  });

  it("selects the rows by their stored line and their text's section title", () => {
    const dividend = new RegExp(DIVIDEND_THRESHOLD_SQL, "i");
    expect(dividend.test(ROWS[0].source_line ?? "")).toBe(true);
    expect(dividend.test("Stop Payment | $30.00")).toBe(false);
    // Postgres reads the embedded (?n) flag; here each line is tested alone.
    const section = new RegExp(ONLINE_SECTION_SQL.replace("(?n)", ""), "i");
    expect(section.test("Personal Online Banking Fees")).toBe(true);
    expect(section.test("Online Fees")).toBe(true);
    expect(section.test("Electronic Services:")).toBe(true);
    expect(section.test("Free Online Banking")).toBe(false);
    expect(section.test("Online and Mobile Banking")).toBe(false);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const result = await recheckNotAccountFeeLines(fakeDb(calls), { runId: 1, stepId: 2, dryRun: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(2);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|pipeline_feedback|second_look/i.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(notAccountFeeLineDetail(result)).toMatchObject({ check: "darwin.not_account_fee_line", switch_live: false, matched: 2, dividend_threshold: 1, online_service_monthly: 1, taken_down: [] });
  });

  it("writes nothing on a dry run, even switched on", async () => {
    const calls: string[] = [];
    const result = await recheckNotAccountFeeLines(fakeDb(calls), { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(2);
    expect(calls.some((call) => /UPDATE|INSERT/.test(call))).toBe(false);
  });
});

describe("Darwin's verify refuses the same reads (shadow lab, as verify.ts does)", () => {
  it("refuses Peninsula's dividend threshold although the shared check calls it a tiered fee", () => {
    const text = `N/A | Dividend Rate | Annual Percentage Yield\n\nRates effective as of July 13, 2026 ${PENINSULA_LINE}. A minimum of $5.00 is required to open and maintain an account.`;
    const fee: StageFee = { canonicalFeeKey: "minimum_balance", feeName: "If your average daily balance is below (", amountCents: 500, frequency: null, excerpt: PENINSULA_LINE, reason: null };
    expect(currentVariant.verify(fee, text)).toEqual({ ok: false, reason: "dividend_threshold" });
  });

  it("refuses Cinfed's online service monthly fee as monthly maintenance", () => {
    const text = "Online Fees\n\nRates as of Apr 15, 2026 ET.\n\nFee\n\nOnline Banking Monthly Service Fee | FREE\n\nCinfed Connection Monthly Service Fee | FREE";
    const fee: StageFee = { canonicalFeeKey: "monthly_maintenance", feeName: "Cinfed Connection Monthly Service Fee", amountCents: 0, frequency: null, excerpt: "Cinfed Connection Monthly Service Fee | FREE", reason: null };
    expect(currentVariant.verify(fee, text)).toEqual({ ok: false, reason: "online_service_monthly" });
  });
});
