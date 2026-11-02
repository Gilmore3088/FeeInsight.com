// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountBenefitZeroDetail,
  accountBenefitZeroLive,
  findAccountBenefitZeros,
  recheckAccountBenefitZeros,
  type AccountBenefitZeroRow,
} from "@/lib/agents/darwin/account-benefit-zero-check";

// #1397: the Nov 1 dry run (prod, read-only, this module's own SQL). The fixture keeps the 16 matches
// and 21 of the 126 live free-item $0s that stay: near misses (a customer price, a sentence, a heading,
// a list whose lead is past the window, a benefits table) and core-category rows.
const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/account-benefit-zero-live-2026-11-01.json", import.meta.url), "utf8"),
) as { population: { live_zero_fees: number; free_item_lines: number; matched: number }; matched: number[]; rows: AccountBenefitZeroRow[] };

const CORE_MATCHES = [100941, 152991, 159066];
// The whitelist walk (second review of #2894) reads 12 of the Nov 1 dry run's 16. The other 4 sit in real
// account lists whose entries it does not whitelist ("Mobile Wallet", "Home Banking" in Basic Checking's
// benefits; "Dividends above the regular share rate" in the Seniors' Savers Club's): known misses.
const WHITELIST_MATCHES = [56945, 65227, 93919, 93920, 100941, 152991, 152992, 152993, 152995, 152996, 152997, 159066];
const WHITELIST_MISSES = [56942, 56943, 141651, 141652];

describe("Darwin's account-benefit $0 re-check (#1397)", () => {
  it("is off unless DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE is true", () => {
    expect(accountBenefitZeroLive(undefined)).toBe(false);
    expect(accountBenefitZeroLive("")).toBe(false);
    expect(accountBenefitZeroLive("1")).toBe(false);
    expect(accountBenefitZeroLive(" \"True\" ")).toBe(true);
  });

  it("reads 12 of the Nov 1 dry run's 16 at 4 institutions, all 3 incoming wires", () => {
    const found = findAccountBenefitZeros(fixture.rows);
    expect(found.matched).toBe(12);
    expect(found.institutions).toBe(4);
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual(WHITELIST_MATCHES);
    expect(WHITELIST_MATCHES.every((id) => fixture.matched.includes(id))).toBe(true);
    expect(WHITELIST_MISSES.every((id) => fixture.matched.includes(id) && !WHITELIST_MATCHES.includes(id))).toBe(true);
    expect(found.byKind).toEqual({ holder_grant: 6, account_waivers: 4, feature_list: 2 });
    const core = found.matches.filter((fee) => ["overdraft", "nsf", "stop_payment"].includes(fee.canonicalFeeKey ?? "") || fee.canonicalFeeKey?.startsWith("wire_"));
    expect(core.map((fee) => [fee.feePublishedId, fee.institutionId, fee.canonicalFeeKey, fee.kind])).toEqual([
      [100941, 6914, "wire_domestic_incoming", "feature_list"],
      [152991, 8495, "wire_domestic_incoming", "holder_grant"],
      [159066, 550, "wire_domestic_incoming", "account_waivers"],
    ]);
    expect(found.matches.find((fee) => fee.feePublishedId === 152991)?.reason).toBe("account_benefit_zero: holder_grant, PremiumSpend Checking Account");
    expect(CORE_MATCHES.every((id) => fixture.matched.includes(id))).toBe(true);
  });

  it("keeps the near misses", () => {
    const matched = new Set(findAccountBenefitZeros(fixture.rows).matches.map((fee) => fee.feePublishedId));
    // "Notary Service (PBT account holder): FREE": the customer price, beside the non-customer one.
    expect(matched.has(134371)).toBe(false);
    // "Free Bill Payer is a benefit for active Bill Payer users": a sentence, not a list entry.
    expect(matched.has(142830)).toBe(false);
    // A benefits table cut into cells: not read (a known miss, filed on the issue).
    expect(matched.has(163079)).toBe(false);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const db = ((strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return Promise.resolve(strings.join("").includes("published_fee_records fp") ? fixture.rows : []);
    }) as unknown as Parameters<typeof recheckAccountBenefitZeros>[0];
    const result = await recheckAccountBenefitZeros(db, { runId: 1, stepId: 2, dryRun: false, live: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(12);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|pipeline_feedback/.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(accountBenefitZeroDetail(result)).toMatchObject({ check: "darwin.account_benefit_zero", switch_live: false, matched: 12, taken_down: [] });
  });

  it("writes nothing on a dry run", async () => {
    const calls: string[] = [];
    const db = ((strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return Promise.resolve(strings.join("").includes("published_fee_records fp") ? fixture.rows : []);
    }) as unknown as Parameters<typeof recheckAccountBenefitZeros>[0];
    const result = await recheckAccountBenefitZeros(db, { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(12);
    expect(calls.some((call) => /UPDATE|INSERT/.test(call))).toBe(false);
  });
});
