// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findTierGaps,
  recheckTierCompleteness,
  TIER_COMPLETENESS_TAKEDOWN_LIVE,
  tierCompletenessDetail,
  type TierCompletenessRow,
} from "@/lib/agents/darwin/tier-completeness-check";
import { unscopedTierRead } from "@/lib/agents/darwin/tier-scope";
import { DARWIN_REASON_TEXT, verificationReasonCode, type RawFeeRow } from "@/lib/agents/darwin/verify";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { MOOSE_LAKE_OVERDRAFT } from "@/lib/tiered-price.fixtures";

// #1110: the prod dry run of Nov 3 (read-only), with five of its rows as the check's SQL selected them.
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/tier-completeness-live-2026-11-03.json", import.meta.url), "utf8")) as {
  checked: number; tiered: number; matched: number; institutions: number; by_kind: Record<string, number>;
  matches: Array<{ fee_published_id: number }>; rows: TierCompletenessRow[];
};

const raw = (feeName: string, amount: number, excerpt: string): RawFeeRow => ({
  fee_raw_id: 1, institution_id: 3457, source_url: "https://www.firstmooselake.com/resources/disclosures/fee-schedule/",
  document_r2_key: null, extraction_confidence: 0.92, fee_name: feeName, amount, frequency: "per_item",
  outlier_flags: ["canonical_hint:overdraft"], conditions: `Knox deterministic extraction from Rosetta artifact #33778. excerpt="${excerpt}"`,
  source_document_id: 35684,
});
const LOW = "$30.00 or less – Overdraft fee per item per presentment. | $15.00 per item";
const HIGH = "More than $30.00 – Overdraft fee per item per presentment. | $30.00 per item";

describe("Darwin judges a tier read on its whole row (#1110)", () => {
  it("accepts Knox v183's scoped Moose Lake tiers and still refuses raw 760358's cut name", () => {
    expect(checkFeeCategory("overdraft", "Overdraft fee per item per presentment (overdraft balance $30.00 or less)", { amount: 15 }).ok).toBe(true);
    expect(verificationReasonCode(raw("Overdraft fee per item per presentment (overdraft balance $30.00 or less)", 15, LOW), "overdraft")).toBeNull();
    expect(verificationReasonCode(raw("Overdraft fee per item per presentment (overdraft balance more than $30.00)", 30, HIGH), "overdraft")).toBeNull();
    // Raw 760358 as Knox wrote it on Oct 16: no figure, so no tier scope; the guard's waiver words still refuse it.
    expect(verificationReasonCode(raw("or less – Overdraft fee per item per presentment", 15, LOW), "overdraft")).toBe("category_mismatch");
    // A waiver threshold in a bracket is never a tier scope.
    expect(checkFeeCategory("overdraft", "Overdraft fee (waived if overdrawn $5 or less)", { amount: 30 }).ok).toBe(false);
  });

  it("holds raw 760359's unscoped $30 tier, and not the scoped ones", () => {
    const held = unscopedTierRead({ feeName: "Overdraft fee per item per presentment", canonicalFeeKey: "overdraft", amount: 30, excerpt: HIGH, documentText: MOOSE_LAKE_OVERDRAFT });
    expect(held?.tier.condition).toBe("More than $30.00");
    expect(held?.group.tiers.map((tier) => tier.price)).toEqual([15, 30]);
    expect(unscopedTierRead({ feeName: "Overdraft fee per item per presentment (overdraft balance more than $30.00)", canonicalFeeKey: "overdraft", amount: 30, excerpt: HIGH, documentText: MOOSE_LAKE_OVERDRAFT })).toBeNull();
    // Not a tier: the cap sentence, a monthly maintenance waiver, a fee on a line of its own.
    expect(unscopedTierRead({ feeName: "Overdraft fee", canonicalFeeKey: "overdraft", amount: 150, excerpt: "A maximum of $150 in overdraft", documentText: MOOSE_LAKE_OVERDRAFT })).toBeNull();
    expect(unscopedTierRead({ feeName: "Monthly service charge", canonicalFeeKey: "monthly_maintenance", amount: 10, excerpt: "Balance below $1,000 | $10.00", documentText: "Balance below $100 | $1.00\nBalance below $1,000 | $10.00" })).toBeNull();
    expect(DARWIN_REASON_TEXT.tier_unscoped).toMatch(/held for a person/);
  });
});

describe("Darwin's live tier completeness re-check (#1110)", () => {
  it("ships off", () => {
    expect(TIER_COMPLETENESS_TAKEDOWN_LIVE).toBe(false);
  });

  it("matches the Nov 3 dry run's rows: Moose Lake's $30 unscoped, Abacus's incoming wire one tier short", () => {
    const found = findTierGaps(fixture.rows);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind, fee.reason])).toEqual([
      [68550, "incomplete", "tier_incomplete: incomplete, 1 of 2 tiers live"],
      [68551, "unscoped", "tier_incomplete: unscoped, 1 of 2 tiers live"],
      [116685, "unscoped", "tier_incomplete: unscoped, 0 of 2 tiers live"],
      [127659, "unscoped", "tier_incomplete: unscoped, 1 of 2 tiers live"],
      [127660, "incomplete", "tier_incomplete: incomplete, 1 of 2 tiers live"],
    ]);
    expect(found.matches.find((fee) => fee.feePublishedId === 116685)?.tiers).toEqual([
      { condition: "$30.00 or less", price: 15, live: false },
      { condition: "More than $30.00", price: 30, live: false },
    ]);
    // The whole dry run, as recorded.
    expect([fixture.checked, fixture.tiered, fixture.matched, fixture.institutions]).toEqual([2981, 88, 50, 35]);
    expect(fixture.by_kind).toEqual({ unscoped: 31, incomplete: 19 });
    expect(fixture.matches.map((fee) => fee.fee_published_id)).toContain(116685);
  });

  it("keeps a group whose tiers are all live and scoped", () => {
    const [row] = fixture.rows.filter((candidate) => Number(candidate.fee_published_id) === 116685);
    const scoped = {
      ...row,
      fee_name: "Overdraft fee per item per presentment (overdraft balance more than $30.00)",
      siblings: [
        { fee_name: "Overdraft fee per item per presentment (overdraft balance $30.00 or less)", amount: 15 },
        { fee_name: "Overdraft fee per item per presentment (overdraft balance more than $30.00)", amount: 30 },
      ],
    };
    expect(findTierGaps([scoped]).matched).toBe(0);
    expect(findTierGaps([{ ...scoped, canonical_fee_key: "monthly_maintenance" }]).tiered).toBe(0);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const db = ((strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return Promise.resolve(strings.join("").includes("published_fee_records fp") ? fixture.rows : []);
    }) as unknown as Parameters<typeof recheckTierCompleteness>[0];
    const result = await recheckTierCompleteness(db, { runId: 1, stepId: 2, dryRun: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(5);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|pipeline_feedback/.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(tierCompletenessDetail(result)).toMatchObject({ check: "darwin.tier_completeness", switch_live: false, matched: 5, taken_down: [] });
  });
});
