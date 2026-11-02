import { describe, expect, it, vi } from "vitest";

import {
  PUBLISH_REPOINT_CURRENT_COPY_LIVE,
  currentCopyIsNewer,
  currentCopyRepointFingerprint,
  liveFeeSourceFailure,
  rowLineNamesLive,
  rowNameMismatch,
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
    current_text: "First Example Bank fee schedule\nOverdraft Fee | $25.00 per item\nStop Payment | $30.00",
    current_crawled_at: "2026-10-20T00:00:00Z",
    prior_crawled_at: "2026-02-17T00:00:00Z",
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
    const plan = planCurrentCopyRepoints([candidate({
      fee_name: "Wire Transfer Fee",
      current_text: "First Example Bank fee schedule\nWire Transfer Fee (Overdraft Fee) | $25.00",
    })]);
    expect(plan.repoint).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("category_guard");
  });

  const dormant = (extra: Partial<CurrentCopyRepointCandidate>) => candidate({
    canonical_fee_key: "dormant_account", prior_canonical_fee_key: "dormant_account", frequency: "quarterly",
    prior_fee_name: "Inactive Example Savings Account",
    current_text: "First Example Bank fee schedule\nInactive Example Savings Account | $25.00 per quarter\nInactive Checking | $25.00 per quarter",
    ...extra,
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

  it("accepts another name when one's words sit inside the other's", () => {
    expect(namesRelated("Overdraft Fee", "Overdraft charge")).toBe(true);
    expect(namesRelated("Copy of Check", "SHARE AND SHAREDRAFT FEES: Copy of Check")).toBe(true);
    expect(namesRelated("Money Order", "Cashier's Check")).toBe(false);
  });

  // v2 rule 1: the row itself must name the live line; the live name printed elsewhere is not enough.
  const atm = (extra: Partial<CurrentCopyRepointCandidate>) => candidate({
    canonical_fee_key: "atm_non_network", prior_canonical_fee_key: "atm_non_network", frequency: "per_transaction",
    amount: "1.50", prior_amount: "1.50", fee_name: "Foreign ATM Withdrawals", prior_fee_name: "Balance Inquiry", ...extra,
  });

  it("never moves a live fee onto another line just because its name is printed elsewhere on the page (name_unrelated)", () => {
    const text = "Sample Valley Credit Union fees\nForeign ATM Withdrawals | $1.50\nBalance Inquiry | $1.50";
    expect(rowLineNamesLive(text, atm({}))).toBe(false);
    const plan = planCurrentCopyRepoints([atm({ current_text: text })]);
    expect(plan.repoint).toEqual([]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(["name_unrelated"]);
  });

  it("never takes a line that prints the live name at another of its prices", () => {
    const text = "Sample Valley Credit Union fees\nForeign ATM Withdrawals $1.50 Balance Inquiry $1.50";
    expect(rowLineNamesLive(text, atm({}))).toBe(false);
  });

  it("accepts a row whose own line prints the live name at the price", () => {
    const text = "Sample Valley Credit Union fees\nForeign ATM Withdrawals (Balance Inquiry) | $1.50 each";
    expect(rowLineNamesLive(text, atm({}))).toBe(true);
    expect(rowNameMismatch(text, atm({}))).toBeNull();
    expect(planCurrentCopyRepoints([atm({ current_text: text })]).repoint).toHaveLength(1);
  });

  it("never moves a live fee onto another printed line whose name shares its words (another_line)", () => {
    const copy = (text: string) => candidate({
      canonical_fee_key: "cashiers_check", prior_canonical_fee_key: "cashiers_check", frequency: "per_item",
      amount: "2.00", prior_amount: "2.00", fee_name: "Cashier Check Copy fee", prior_fee_name: "Cashier Check fee",
      current_text: text,
    });
    const text = "Sample Ridge Credit Union fees\nCashier Check fee | $2.00 per item\nCounter checks | Free\nCashier Check Copy fee | $2.00 per item";
    expect(namesRelated("Cashier Check fee", "Cashier Check Copy fee")).toBe(true);
    expect(rowNameMismatch(text, copy(text))).toBe("another_line");
    expect(planCurrentCopyRepoints([copy(text)]).skipped).toMatchObject([{ reason: "name_unrelated", detail: "another_line" }]);
  });

  it("never moves a fragment of a name the page prints under two lines at the price (ambiguous)", () => {
    const fragment = (feeName: string, text: string) => candidate({
      fee_name: feeName, prior_fee_name: "per paid overdraft item", amount: "20.00", prior_amount: "20.00", current_text: text,
    });
    const two = "Sample Ridge Credit Union fees\nOverdraft for ATM and Debit Card Transactions $20.00 per paid overdraft item\nOverdraft Privilege $20.00 per paid overdraft item";
    expect(rowNameMismatch(two, fragment("Overdraft for ATM and Debit Card Transactions", two))).toBe("ambiguous");
    expect(planCurrentCopyRepoints([fragment("Overdraft Privilege", two)]).repoint).toEqual([]);
    const one = "Sample Ridge Credit Union fees\nOverdraft Privilege $20.00 per paid overdraft item\nStop Payment | $30.00";
    expect(rowNameMismatch(one, fragment("Overdraft Privilege", one))).toBeNull();
  });

  // v2 rule 2: the current copy must be strictly newer than the copy the live fee cites.
  it.each([
    ["older", "2026-01-05T00:00:00Z"],
    ["the same time", "2026-02-17T00:00:00Z"],
    ["unknown", null],
  ])("leaves a pair alone when the current copy was crawled at %s (copy_not_newer)", (_label, crawledAt) => {
    expect(currentCopyIsNewer({ current_crawled_at: crawledAt, prior_crawled_at: "2026-02-17T00:00:00Z" })).toBe(false);
    const plan = planCurrentCopyRepoints([candidate({ current_crawled_at: crawledAt })]);
    expect(plan.repoint).toEqual([]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(["copy_not_newer"]);
  });

  it("accepts Date values for the crawl times", () => {
    expect(currentCopyIsNewer({ current_crawled_at: new Date("2026-10-20T00:00:00Z"), prior_crawled_at: new Date("2026-10-19T23:59:00Z") })).toBe(true);
  });

  // v2 rule 3: the live fee must pass the shared source check on the current copy's stored text.
  it("never gives fresh provenance to a live fee its current copy does not print (source_check_failed)", () => {
    const wire = (text: string) => candidate({
      canonical_fee_key: "wire_domestic_outgoing", prior_canonical_fee_key: "wire_domestic_outgoing", frequency: "per_item",
      amount: "50.00", prior_amount: "50.00", fee_name: "Outgoing wire transfer fee", prior_fee_name: "Outgoing wire transfer fee",
      current_text: text,
    });
    const missing = planCurrentCopyRepoints([wire("Example Prairie Bank fees\nStop Payment | $30.00")]);
    expect(missing.repoint).toEqual([]);
    expect(missing.skipped).toMatchObject([{ reason: "source_check_failed", detail: "name_not_in_text" }]);
    const none = planCurrentCopyRepoints([candidate({ current_text: null })]);
    expect(none.skipped).toMatchObject([{ reason: "source_check_failed", detail: "no_source_text" }]);
    expect(liveFeeSourceFailure("Overdraft Fee | $25.00 per item", candidate())).toBeNull();
  });

  it("re-checks the live fee's own amount, not the row's", () => {
    const text = "First Example Bank fee schedule\nOverdraft Fee | $35.00 per item";
    expect(liveFeeSourceFailure(text, candidate())).not.toBeNull();
    expect(planCurrentCopyRepoints([candidate({ current_text: text })]).skipped[0]?.reason).toBe("source_check_failed");
  });

  it("never re-points onto a row publish's name hold would hold", () => {
    const cut = candidate({
      canonical_fee_key: "early_closure", prior_canonical_fee_key: "early_closure", frequency: null,
      fee_name: "If the account is closed within 90 days of opening, a", prior_fee_name: "Early Account Closure Fee",
      current_text: "First Example Bank fee schedule\nIf the account is closed within 90 days of opening, a (Early Account Closure Fee) $25.00 fee",
    });
    const plan = planCurrentCopyRepoints([cut]);
    expect(plan.repoint).toEqual([]);
    expect(plan.skipped).toMatchObject([{ reason: "name_hold", detail: "cutoff_name" }]);
  });

  it("fingerprints one check per pair", () => {
    expect(currentCopyRepointFingerprint(501, 9801)).toBe("v2:501:9801");
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
