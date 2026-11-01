import { describe, expect, it } from "vitest";
import { cacheLatestMessage, cachedSystem, compactToolResult, HISTORY_FLOOR, ledgerUsage, TOOL_RESULT_MAX_CHARS, withCompactResults } from "./tool-output";
import { writtenAnswerFeeEvidence } from "@/lib/hamilton/written-answer-binding";
import { collectFeeRefs, writtenAnswerFeeRefs } from "@/lib/saved-output-corrections";
import type { LanguageModelUsage, ModelMessage } from "ai";

const fee = (i: number) => ({ fee_name: `Fee ${i}`, amount: i, conditions: "x".repeat(200), source_url: `https://bank.example/fees/${i}` });

describe("compactToolResult", () => {
  it("returns a small result unchanged", () => {
    const small = { identity: { id: 1 }, fees: [fee(1)] };
    expect(compactToolResult(small)).toBe(small);
  });

  it("shortens the largest list until the result fits, and says which list and by how much", () => {
    const big = { summary: { id: 1, name: "Bank" }, fees: { verified: Array.from({ length: 200 }, (_, i) => fee(i)), provisional: [fee(1)] } };
    const out = compactToolResult(big, 12_000) as Record<string, unknown> & { fees: { verified: unknown[]; provisional: unknown[] } };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(12_000 + 300);
    expect(out.summary).toEqual({ id: 1, name: "Bank" });
    expect(out.fees.provisional).toHaveLength(1);
    expect(out.fees.verified.length).toBeLessThan(200);
    expect(out.fees.verified[0]).toEqual(fee(0));
    expect(out._shortened).toContain(`fees.verified: first ${out.fees.verified.length} of 200`);
    // The caller's object is not modified.
    expect(big.fees.verified).toHaveLength(200);
  });

  it("preserves both financial measure groups and their metadata while shortening their rows", () => {
    const groups = ["fdic", "ncua"].map((source) => ({
      financial_source: source,
      comparison: { report_date: "2026-06-30", subject_included: false, sample_size: 80, period_basis: "standalone_quarter", definition: `${source} own measure` },
      data: Array.from({ length: 80 }, (_, i) => fee(i)),
    }));
    const out = compactToolResult({ financial_groups: groups }, 4_000) as { financial_groups: typeof groups; _shortened: string };
    expect(out.financial_groups.map((group) => group.financial_source)).toEqual(["fdic", "ncua"]);
    expect(out.financial_groups[0].comparison).toEqual(groups[0].comparison);
    expect(out.financial_groups[1].comparison).toEqual(groups[1].comparison);
    expect(out.financial_groups.every((group) => group.data.length > 0 && group.data.length < 80)).toBe(true);
    expect(out._shortened).not.toContain("financial_groups: first");
    expect(out._shortened).toContain("financial_groups[1].data:");
    expect(JSON.stringify(out).length).toBeLessThan(4_400);
  });

  it("handles a top-level array and a result with no lists", () => {
    const rows = compactToolResult(Array.from({ length: 300 }, (_, i) => fee(i)), 5_000) as { _shortened: string; rows: unknown[] };
    expect(rows.rows.length).toBeLessThan(300);
    expect(rows._shortened).toContain("rows: first");
    const text = compactToolResult({ note: "y".repeat(20_000) }, 5_000) as { _shortened: string; text: string };
    expect(text.text).toHaveLength(5_000);
  });
});

// An institution profile as getInstitution returns it, Capital City Bank's shape (#1077, defect 9):
// 60 catalog rows sorted by fee name, so the overdraft rows sit past the first half.
const CATEGORIES = ["account_research", "check_printing", "coin_counting", "safe_deposit_box", "money_order", "check_image", "notary_fee", "night_deposit"];
function capitalCityProfile() {
  const rows = Array.from({ length: 58 }, (_, i) => ({ name: `${String.fromCharCode(65 + (i % 26))}${String(i).padStart(2, "0")} Service Fee`, category: CATEGORIES[i % CATEGORIES.length] }));
  rows.push({ name: "Overdraft Item Fee", category: "overdraft" }, { name: "Overdraft Daily Fee", category: "continuous_od" });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const verified = rows.map((row, i) => ({
    fee_name: row.name,
    fee_category: row.category,
    display_name: row.name,
    amount: row.category === "overdraft" ? 36 : 5 + i,
    frequency: "per_item",
    conditions: `Charged per item. ${"Waived for accounts enrolled in the program. ".repeat(5)}`,
    status: "verified",
    extraction_confidence: 0.93,
    source_url: "https://www.ccbg.example/disclosures/schedule-of-fees.pdf",
    record_id: 70_000 + i,
    source_document_id: 4_400,
  }));
  const quarter = (q: number) => ({ quarter: `2026-Q${q}`, service_charge_income: 1000 + q, total_revenue: 50_000 + q, fee_income_ratio: 0.02, yoy_change_pct: 1.5, source: "fdic", units: "thousands of dollars", field_units: { fee_income_ratio: "fraction", yoy_change_pct: "percent" } });
  return {
    identity: { id: 5501, name: "Capital City Bank", state: "FL", city: "Tallahassee", charter_type: "bank", asset_size: 4_200_000 },
    public_fee_status: { status: "published", verified_fee_count: verified.length, provisional_fee_count: 0 },
    fees: { verified, provisional: [] as typeof verified },
    financials: { units: "thousands", latest: quarter(2), records: [1, 2, 3, 4, 1, 2, 3, 4].map(quarter) },
    revenue_trend: [1, 2, 3, 4, 1, 2, 3, 4].map(quarter),
    quality: { label: "verified", status: "ok", signals: ["a", "b"] },
  };
}

describe("compactToolResult on an institution profile (#1077, Cycle A defect 9)", () => {
  const factIds = (output: unknown) => (writtenAnswerFeeEvidence([output])?.evidence.facts ?? []).map((fact) => fact.id);
  const factUrls = (output: unknown) => (writtenAnswerFeeEvidence([output])?.evidence.facts ?? []).map((fact) => fact.source.urls);

  it("keeps every fee row's record when trimming fields is enough, and marks the rows complete", () => {
    // Fee rows only: the filing history keeps its own floor (next tests).
    const { financials: _financials, revenue_trend: _trend, ...profile } = capitalCityProfile();
    expect(JSON.stringify(profile).length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
    const out = compactToolResult(profile) as ReturnType<typeof capitalCityProfile> & { _shortened: string; _fee_rows_complete?: boolean };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 600);
    expect(out.fees.verified).toHaveLength(60);
    expect(out.fees.verified.find((row) => row.fee_category === "overdraft")).toMatchObject({ amount: 36, record_id: expect.any(Number), source_document_id: 4_400 });
    expect(out._fee_rows_complete).toBe(true);
    expect(out._shortened).toContain("Every fee row is kept.");
    // The binding and the answer gate see the same fee records, with the same source URL.
    expect(factIds(out)).toEqual(factIds(profile));
    expect(factUrls(out)).toEqual(factUrls(profile));
    // The subject's fee refs are saved, since no row was dropped.
    const refs = collectFeeRefs(out);
    expect(refs).toHaveLength(60);
    expect(writtenAnswerFeeRefs(refs, 5501, [out])).toEqual(refs);
  });

  it("drops fee rows only after the other lists and the conditions, keeping spotlight and core fee types first", () => {
    const profile = capitalCityProfile();
    const out = compactToolResult(profile, 5_000) as ReturnType<typeof capitalCityProfile> & { _shortened: string; _fee_rows_complete?: boolean };
    expect(out.fees.verified.length).toBeLessThan(60);
    expect(out.fees.verified.some((row) => row.fee_category === "overdraft")).toBe(true);
    // A filing history keeps a year-over-year window before any fee row is dropped.
    expect(out.revenue_trend).toHaveLength(HISTORY_FLOOR);
    expect(out.financials.records).toHaveLength(HISTORY_FLOOR);
    expect(out.fees.verified.every((row) => !("conditions" in row))).toBe(true);
    expect(out._fee_rows_complete).toBeUndefined();
    expect(out._shortened).toContain("fees.verified:");
    expect(out._shortened).toContain("Say so if the answer depends on the fee rows left out.");
    // Every surviving row keeps the fact id it had before compaction.
    const before = new Set(factIds(profile));
    expect(factIds(out).every((id) => before.has(id))).toBe(true);
    expect(factIds(out)).toContain("fee:published:" + profile.fees.verified.find((row) => row.fee_category === "overdraft")!.record_id);
    // Rows were dropped, so the subject keeps its institution match instead of partial refs.
    expect(writtenAnswerFeeRefs(collectFeeRefs(out), 5501, [out])).toEqual([]);
  });

  it("keeps the whole filing history when dropping conditions is enough (review of #2635)", () => {
    const base = capitalCityProfile();
    const profile = { ...base, fees: { verified: base.fees.verified.slice(0, 40), provisional: [] as typeof base.fees.verified } };
    expect(JSON.stringify(profile).length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
    const out = compactToolResult(profile) as ReturnType<typeof capitalCityProfile> & { _fee_rows_complete?: boolean };
    expect(out.fees.verified).toHaveLength(40);
    expect(out.financials.records).toHaveLength(8);
    expect(out.revenue_trend).toHaveLength(8);
    expect(out._fee_rows_complete).toBe(true);
  });

  it("never cuts a profile to plain text", () => {
    // One fee row and no list to halve: before the fix this became `{ _shortened, text }`, with no record left.
    const base = capitalCityProfile();
    const profile = {
      identity: base.identity,
      public_fee_status: { status: "published", confidence_summary: "y".repeat(20_000) },
      fees: { verified: base.fees.verified.filter((row) => row.fee_category === "overdraft"), provisional: [] },
    };
    const out = compactToolResult(profile) as { identity?: { id: number }; fees?: { verified: unknown[] }; text?: unknown };
    expect(out.text).toBeUndefined();
    expect(out.identity?.id).toBe(5501);
    expect(factIds(out).length).toBeGreaterThan(0);
  });
});

describe("withCompactResults", () => {
  it("wraps execute and keeps the tool's other fields", async () => {
    const tools = withCompactResults({ t: { description: "d", execute: async () => ({ rows: Array.from({ length: 500 }, (_, i) => fee(i)) }) } } as never, 4_000);
    const t = (tools as Record<string, { description: string; execute: () => Promise<{ rows: unknown[]; _shortened: string }> }>).t;
    expect(t.description).toBe("d");
    const out = await t.execute();
    expect(out.rows.length).toBeLessThan(500);
    expect(out._shortened).toBeTruthy();
  });
});

describe("prompt caching", () => {
  it("marks the system prompt and the newest message as cache points", () => {
    expect(cachedSystem("s").providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    const messages: ModelMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    const marked = cacheLatestMessage(messages);
    expect(marked[0]).toBe(messages[0]);
    expect(marked[1].providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(messages[1].providerOptions).toBeUndefined();
  });

  it("records cache reads and writes apart from uncached input", () => {
    const usage = {
      inputTokens: 100_000,
      outputTokens: 2_000,
      inputTokenDetails: { noCacheTokens: 10_000, cacheReadTokens: 80_000, cacheWriteTokens: 10_000 },
    } as unknown as LanguageModelUsage;
    expect(ledgerUsage(usage)).toEqual({ inputTokens: 10_000, outputTokens: 2_000, cacheReadInputTokens: 80_000, cacheCreationInputTokens: 10_000 });
    expect(ledgerUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
  });
});
