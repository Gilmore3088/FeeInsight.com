import { describe, expect, it, vi } from "vitest";

import {
  PUBLISH_REPOINT_CURRENT_COPY_LIVE,
  currentCopyRepointFingerprint,
  nameAffinity,
  namesRelated,
  planCurrentCopyRepoints,
  repointLiveFeesToCurrentCopy,
  type CurrentCopyRepointCandidate,
} from "./current-copy-repoint";

/** First Example Bank: its live $25 "Overdraft Fee" (fee 501) was read from a superseded copy (document 500). */
function candidate(extra: Partial<CurrentCopyRepointCandidate> = {}): CurrentCopyRepointCandidate {
  return {
    fee_verified_id: 9801,
    fee_raw_id: 9701,
    institution_id: 42,
    source_url: "https://firstexample.example/fees",
    document_r2_key: null,
    extraction_confidence: "0.9200",
    canonical_fee_key: "overdraft",
    variant_type: null,
    outlier_flags: ["agentic_darwin_verified"],
    verified_by_agent_event_id: "00000000-0000-4000-8000-000000009801",
    fee_name: "Overdraft charge",
    amount: "25.00",
    frequency: "per_item",
    raw_agent_event_id: "00000000-0000-4000-8000-000000009701",
    source_document_id: 900,
    fee_audience: "consumer",
    product_name: null,
    prior_fee_published_id: 501,
    prior_fee_name: "Overdraft Fee",
    prior_canonical_fee_key: "overdraft",
    prior_amount: "25.00",
    prior_source_document_id: 500,
    prior_fee_audience: "consumer",
    prior_product_name: null,
    prior_lineage_ref: 601,
    published_state: "snapshot501",
    identity_raw_id: 501,
    identity_product: "",
    chain_depth: 1,
    ...extra,
  };
}

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDb(rows: CurrentCopyRepointCandidate[]) {
  const calls: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    calls.push(text);
    if (text.includes("WITH RECURSIVE stale AS MATERIALIZED")) return Promise.resolve(rows);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 501 }]);
    return Promise.resolve([]);
  });
  Object.assign(db, {
    unsafe: (text: string) => text.startsWith("SELECT fp.fee_published_id")
      ? Promise.resolve(rows.map((row) => ({ ...row, fee_published_id: row.prior_fee_published_id })))
      : text,
  });
  return { db, calls };
}

type Db = Parameters<typeof repointLiveFeesToCurrentCopy>[0];
const options = { runId: 7, stepId: 70, batchId: "agentic-run-7" };

describe("current-copy re-point plan (#1200)", () => {
  it("is off by default", () => {
    expect(PUBLISH_REPOINT_CURRENT_COPY_LIVE).toBe(false);
  });

  it("re-points a live fee publish skipped the current copy's row as identical to, under another name", () => {
    const plan = planCurrentCopyRepoints([candidate()]);
    expect(plan.repoint).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  it.each([
    ["product_differs", { product_name: "Premium Checking" }],
    ["audience_differs", { fee_audience: "unknown" as const }],
    ["category_differs", { prior_canonical_fee_key: "nsf" }],
    ["value_differs", { prior_amount: "30.00" }],
    ["publish_rule", { extraction_confidence: "0.40" }],
  ])("leaves a pair alone when %s", (reason, extra) => {
    const plan = planCurrentCopyRepoints([candidate(extra)]);
    expect(plan.repoint).toEqual([]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual([reason]);
  });

  it("never re-points onto a row whose name the category guard rejects", () => {
    const plan = planCurrentCopyRepoints([candidate({ fee_name: "Wire Transfer Fee", prior_name_on_current_copy: true })]);
    expect(plan.repoint).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("category_guard");
  });

  const dormant = (extra: Partial<CurrentCopyRepointCandidate>) => candidate({
    canonical_fee_key: "dormant_account", prior_canonical_fee_key: "dormant_account", frequency: "quarterly",
    prior_fee_name: "Inactive Example Savings Account", ...extra,
  });

  it("gives each live fee the row whose name reads like its own, and each row one live fee", () => {
    const savings = dormant({ fee_verified_id: 9802, fee_raw_id: 9702, fee_name: "Inactive Example Savings" });
    const savingsAgain = dormant({ fee_verified_id: 9803, fee_raw_id: 9703, fee_name: "Inactive Example Savings Account Fee" });
    const plan = planCurrentCopyRepoints([savingsAgain, savings]);
    expect(plan.repoint.map((pair) => Number(pair.fee_verified_id))).toEqual([9803]);
    expect(plan.skipped).toMatchObject([{ reason: "pair_taken", candidate: { fee_verified_id: 9802 } }]);
    expect(nameAffinity("Overdraft Fee", "Overdraft fee")).toBeGreaterThan(nameAffinity("Overdraft Fee", "Overdraft charge"));
  });

  it("never moves a live fee onto another line at the same price (name_unrelated)", () => {
    // The savings line is gone from the current copy; only the checking line prints $15.
    const checking = dormant({ fee_verified_id: 9800, fee_raw_id: 9700, fee_name: "Inactive Checking" });
    const plan = planCurrentCopyRepoints([checking]);
    expect(plan.repoint).toEqual([]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(["name_unrelated"]);
    expect(namesRelated("Inactive Example Savings Account", "Inactive Checking")).toBe(false);
  });

  it("accepts another name when one's words sit inside the other's, or the live name is printed on the current copy", () => {
    expect(namesRelated("Overdraft Fee", "Overdraft charge")).toBe(true);
    expect(namesRelated("Copy of Check", "SHARE AND SHAREDRAFT FEES: Copy of Check")).toBe(true);
    expect(namesRelated("Money Order", "Cashier's Check")).toBe(false);
    const printed = dormant({ fee_name: "Inactive Checking", prior_name_on_current_copy: true });
    expect(planCurrentCopyRepoints([printed]).repoint).toHaveLength(1);
  });

  it("never re-points onto a row publish's name hold would hold", () => {
    const cut = candidate({
      canonical_fee_key: "early_closure", prior_canonical_fee_key: "early_closure", frequency: null,
      fee_name: "If the account is closed within 90 days of opening, a", prior_fee_name: "Early Account Closure Fee",
      prior_name_on_current_copy: true,
    });
    const plan = planCurrentCopyRepoints([cut]);
    expect(plan.repoint).toEqual([]);
    expect(plan.skipped).toMatchObject([{ reason: "name_hold", detail: "cutoff_name" }]);
  });

  it("fingerprints one check per pair", () => {
    expect(currentCopyRepointFingerprint(501, 9801)).toBe("v1:501:9801");
  });
});

describe("repointLiveFeesToCurrentCopy", () => {
  it("in shadow (switch off) logs the count on the run ledger and changes no fee", async () => {
    const { db, calls } = createDb([candidate()]);
    const result = await repointLiveFeesToCurrentCopy(db as unknown as Db, { ...options, dryRun: false });
    expect(result).toMatchObject({ live: false, checked: 1, eligible: 1, repointed: 0 });
    expect(result.samples).toEqual([{ feePublishedId: 501, feeVerifiedId: 9801, institutionId: 42, feeName: "Overdraft Fee", priorSourceDocumentId: 500, currentSourceDocumentId: 900 }]);
    expect(calls.some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(calls.some((text) => text.includes("INSERT INTO pipeline_attempts"))).toBe(false);
    expect(calls.filter((text) => text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
  });

  it("in a dry run reads and writes nothing", async () => {
    const { db, calls } = createDb([candidate()]);
    const result = await repointLiveFeesToCurrentCopy(db as unknown as Db, { ...options, dryRun: true, live: true });
    expect(result).toMatchObject({ live: true, eligible: 1, repointed: 0 });
    expect(calls.filter((text) => /INSERT|UPDATE/.test(text))).toEqual([]);
  });

  it("live, moves the fee in place, records the pair once and the run event", async () => {
    const { db, calls } = createDb([candidate()]);
    const result = await repointLiveFeesToCurrentCopy(db as unknown as Db, { ...options, dryRun: false, live: true });
    expect(result).toMatchObject({ live: true, eligible: 1, repointed: 1 });
    const update = calls.find((text) => text.includes("UPDATE published_fee_records")) ?? "";
    // Lineage, link, file and events move; the fee's name, amount and category are not written.
    expect(update).toContain("SET lineage_ref =");
    const set = update.slice(update.indexOf("SET"), update.indexOf("WHERE"));
    expect(set).not.toMatch(/\b(fee_name|amount|canonical_fee_key|published_at|fee_audience) =/);
    expect(calls.filter((text) => text.includes("INSERT INTO pipeline_attempts"))).toHaveLength(1);
    expect(calls.filter((text) => text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
  });

  it("returns nothing when the read fails, so publishing is never blocked", async () => {
    const db = vi.fn(() => Promise.reject(new Error("read failed")));
    Object.assign(db, { unsafe: (text: string) => text });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await repointLiveFeesToCurrentCopy(db as unknown as Db, { ...options, dryRun: false, live: true });
    expect(result).toMatchObject({ checked: 0, repointed: 0 });
    error.mockRestore();
  });
});
