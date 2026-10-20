import { describe, expect, it, vi } from "vitest";

import {
  MOVED_PAGE_DAYS,
  REFRESH_COPY_REASON_PREFIX,
  selectMovedPageDocuments,
  moveRowsToIdenticalCopy,
  planRefreshes,
  refreshCopyFingerprint,
  refreshFeesFromCurrentCopy,
  type RefreshCopyCandidate,
} from "./refresh-copy";
import type { FeeAudience } from "@/lib/fee-audience";
import { LIVE_SOURCE_REFETCH_DAYS, LIVE_SOURCE_REFETCH_STRATEGY } from "@/lib/agents/magellan/live-source-refetch";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function candidate(extra: Partial<RefreshCopyCandidate> = {}): RefreshCopyCandidate {
  return {
    fee_verified_id: 9801,
    fee_raw_id: 9701,
    institution_id: 42,
    source_url: "https://testbank.example/fees",
    document_r2_key: null,
    extraction_confidence: "0.9200",
    canonical_fee_key: "overdraft",
    variant_type: null,
    outlier_flags: ["agentic_darwin_verified"],
    verified_by_agent_event_id: "00000000-0000-4000-8000-000000009801",
    fee_name: "Overdraft Fee",
    amount: "35.00",
    frequency: "per_item",
    raw_agent_event_id: "00000000-0000-4000-8000-000000009701",
    source_document_id: 900,
    prior_fee_published_id: 501,
    prior_fee_name: "Overdraft fee",
    prior_amount: "35.00",
    prior_source_document_id: 500,
    prior_lineage_ref:601,published_state:"snapshot501",identity_raw_id:501,identity_product:"",
    ...extra,
  };
}

function createDb(rows: RefreshCopyCandidate[]): DbMock {
  let nextId = 7001;
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("WITH stale AS MATERIALIZED")) return Promise.resolve(rows);
    if (text.includes("INSERT INTO published_fee_records")) return Promise.resolve([{ fee_published_id: nextId++ }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 501 }]);
    return Promise.resolve([]);
  });
  Object.assign(db,{ unsafe:(text:string) => text.startsWith("SELECT fp.fee_published_id")
    ? Promise.resolve(rows.map((r) => ({...r,fee_published_id:r.prior_fee_published_id}))) : text });
  return db;
}

function asDb(db: DbMock): Parameters<typeof refreshFeesFromCurrentCopy>[0] {
  if (!("unsafe" in db)) Object.assign(db,{unsafe:(text:string) => text});
  return db as unknown as Parameters<typeof refreshFeesFromCurrentCopy>[0];
}

function writes(db: DbMock): string[] {
  return db.mock.calls.map((call) => templateText(call[0])).filter((text) => /INSERT INTO|UPDATE /.test(text));
}

describe("planRefreshes", () => {
  const audiences: FeeAudience[] = ["consumer", "business", "both", "unknown"];

  it.each(audiences.flatMap((prior) => audiences.map((current) => [prior, current] as const)))(
    "refreshes %s to %s only when the audience identity is unchanged (#2109)", (prior, current) => {
      const row = candidate({ prior_fee_audience: prior, fee_audience: current });
      const plan = planRefreshes([row]);
      expect(plan.refresh).toEqual(prior === current ? [row] : []);
      expect(plan.skipped).toEqual(prior === current ? [] : [{ candidate: row, reason: "audience_differs" }]);
    },
  );

  it("normalizes missing legacy audience to unknown, without treating it as a wildcard", () => {
    expect(planRefreshes([candidate({ prior_fee_audience: null, fee_audience: "unknown" })]).refresh).toHaveLength(1);
    expect(planRefreshes([candidate({ prior_fee_audience: "unknown", fee_audience: undefined })]).refresh).toHaveLength(1);
    expect(planRefreshes([candidate({ prior_fee_audience: null, fee_audience: "consumer" })]).skipped[0].reason).toBe("audience_differs");
    expect(planRefreshes([candidate({ prior_fee_audience: "business", fee_audience: undefined })]).skipped[0].reason).toBe("audience_differs");
  });

  it("moves a live fee the current copy states under the same name and amount", () => {
    const plan = planRefreshes([candidate()]);
    expect(plan.refresh).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves a fee whose current-copy row has another name (a separate line)", () => {
    const plan = planRefreshes([candidate({ fee_name: "Overdraft Fee - Business" })]);
    expect(plan.refresh).toEqual([]);
    expect(plan.skipped[0].reason).toBe("name_differs");
  });

  it("never treats a rate and a dollar amount as the same value", () => {
    const plan = planRefreshes([
      candidate({
        canonical_fee_key: "card_foreign_txn",
        fee_name: "Foreign Transaction Fee",
        prior_fee_name: "Foreign Transaction Fee",
        amount: null,
        amount_kind: "percent",
        rate_percent: "1",
        prior_amount: "1.00",
      }),
    ]);
    expect(plan.skipped[0].reason).toBe("value_differs");
  });

  it("applies today's publish rules to the current-copy row", () => {
    const plan = planRefreshes([candidate({ extraction_confidence: "0.5" })]);
    expect(plan.skipped[0]).toMatchObject({ reason: "publish_rule", detail: "Below publish confidence threshold" });
  });

  it("never moves a product page's $0 benefit to its page's new copy (55986, Oct 9)", () => {
    const benefit = { amount: "0.00", prior_amount: "0.00", free_read: true, document_url: "https://www.paccrest.com/personal-banking/" };
    const plan = planRefreshes([candidate(benefit)]);
    expect(plan.skipped[0]).toMatchObject({ reason: "publish_rule", detail: "Read from a product page's benefits, not a fee schedule" });
  });

  it("selects what the product-page rule reads", async () => {
    const db = createDb([]);
    await refreshFeesFromCurrentCopy(asDb(db), { runId: 1, batchId: "b", dryRun: true });
    const text = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(text).toContain("AS free_read");
    expect(text).toContain("AS document_url");
    expect(text).toContain("COALESCE(fp.fee_audience, 'unknown') AS fee_audience");
    expect(text).toContain("COALESCE(nv.fee_audience, 'unknown') AS fee_audience");
    expect(text).toContain("stale.fee_audience AS prior_fee_audience");
    expect(text).toContain("AND COALESCE(nv.fee_audience, 'unknown') = stale.fee_audience");
  });

  it("uses each live fee and each current-copy row once", () => {
    const plan = planRefreshes([
      candidate(),
      candidate({ fee_verified_id: 9802 }),
      candidate({ prior_fee_published_id: 502 }),
    ]);
    expect(plan.refresh.map((row) => [row.prior_fee_published_id, row.fee_verified_id])).toEqual([[501, 9801]]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(["pair_taken", "pair_taken"]);
  });
});

describe("refreshFeesFromCurrentCopy", () => {
  it("moves the live fee to the current copy's row in place, with no new row, closure or price change (v2, #1068)", async () => {
    const db = createDb([candidate()]);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: false });
    expect(result).toMatchObject({ checked: 1, refreshed: 1 });
    // The live fee keeps its id.
    expect(result.samples[0]).toMatchObject({ priorFeePublishedId: 501, feePublishedId: 501 });
    const statements = writes(db);
    expect(statements.some((text) => text.includes("INSERT INTO published_fee_records"))).toBe(false);
    expect(statements.some((text) => text.includes("rolled_back_at = NOW()"))).toBe(false);
    expect(statements.some((text) => text.includes("fee_change_records"))).toBe(false);
    const moveCall = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"))!;
    const moveText = templateText(moveCall[0]);
    expect(moveText).toContain("SET lineage_ref = ");
    expect(moveText).toContain("AND rolled_back_at IS NULL");
    expect(moveText).toContain("AND quarantined_at IS NULL");
    expect(moveText).toContain("AND COALESCE(fee_audience, 'unknown') = ");
    expect(moveText).toContain("AND COALESCE(current_verified.fee_audience, 'unknown') = ");
    expect(moveCall).toContain(9801);
    expect(moveCall).toContain(501);
    expect(moveCall).not.toContain(`${REFRESH_COPY_REASON_PREFIX}501`);
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toContain(refreshCopyFingerprint(501, 9801));
  });

  it("leaves the fee where it was when its live row was closed or held meanwhile", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("WITH stale AS MATERIALIZED")) return Promise.resolve([candidate()]);
      return Promise.resolve([]);
    }) as unknown as DbMock;
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: false });
    expect(result).toMatchObject({ checked: 1, refreshed: 0 });
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb([candidate()]);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: true });
    expect(result).toMatchObject({ checked: 1, refreshed: 1 });
    expect(writes(db)).toEqual([]);
  });

  it.each([true, false])("leaves cross-audience lineage untouched in dryRun=%s", async (dryRun) => {
    const db = createDb([candidate({ prior_fee_audience: "consumer", fee_audience: "business" })]);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun });
    expect(result).toMatchObject({ checked: 1, refreshed: 0, skipped: { audience_differs: 1 } });
    expect(writes(db).some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    if (dryRun) expect(writes(db)).toEqual([]);
    else expect(db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts")))
      .toContain(refreshCopyFingerprint(501, 9801));
  });

  it("records skipped pairs so they are not checked again, and changes no fee", async () => {
    const db = createDb([candidate({ fee_name: "Overdraft Fee - Business" })]);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: false });
    expect(result).toMatchObject({ checked: 1, refreshed: 0, skipped: { name_differs: 1 } });
    const statements = writes(db);
    expect(statements.some((text) => text.includes("published_fee_records"))).toBe(false);
    expect(statements.some((text) => text.includes("INSERT INTO pipeline_attempts"))).toBe(true);
  });
});

describe("moved pages (#1200)", () => {
  function movedDb(rows: RefreshCopyCandidate[], moved: number[]) {
    const db = createDb(rows);
    const base = db.getMockImplementation() as (...args: unknown[]) => unknown;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (templateText(strings).includes("WITH cited AS MATERIALIZED")) return Promise.resolve(moved.map((id) => ({ id })));
      return base(strings, ...values);
    });
    return db;
  }

  it("waits the same window as Magellan's live-source pass and needs that pass to have tried the page", async () => {
    expect(MOVED_PAGE_DAYS).toBe(LIVE_SOURCE_REFETCH_DAYS);
    const db = movedDb([], []);
    await selectMovedPageDocuments(asDb(db), {});
    const call = db.mock.calls.find((c) => templateText(c[0]).includes("WITH cited AS MATERIALIZED"))!;
    const text = templateText(call[0]);
    expect(text).toContain("sd.superseded_by_id IS NULL");
    expect(text).toContain("sd.companion_source_id IS NULL");
    expect(text).toContain("fp.rolled_back_at IS NULL");
    expect(text).toContain("COALESCE(copy.last_checked_at, copy.crawled_at) >= NOW() - make_interval(days => ");
    expect(text).toContain("pa.detail->>'live_page' = cited.page");
    expect(text).toContain(`pa.strategy = '${LIVE_SOURCE_REFETCH_STRATEGY.strategy}'`);
    expect(call).toContain(MOVED_PAGE_DAYS);
  });

  it("pairs a moved page's live fees with the bank's newer current documents, newest first", async () => {
    const db = movedDb([], [2547]);
    await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "b", dryRun: true });
    const call = db.mock.calls.find((c) => templateText(c[0]).includes("WITH stale AS MATERIALIZED"))!;
    const text = templateText(call[0]);
    expect(call.slice(1)).toContainEqual([2547]);
    expect(text).toContain("sd.superseded_by_id IS NULL AND sd.id = ANY(");
    expect(text).toContain("JOIN raw_fee_observations nr ON nr.source_document_id = targets.document_id");
    expect(text).toContain("nd.crawled_at > stale.document_crawled_at");
    expect(text).toContain("nd.superseded_by_id IS NULL");
    expect(text).toContain("ORDER BY nd.crawled_at DESC, nd.id DESC");
    expect(text).toContain("ORDER BY stale.fee_published_id, targets.rank, nv.fee_verified_id");
  });

  it("moves a moved page's fee in place like a superseded copy's and counts it", async () => {
    const db = movedDb([candidate({ moved_page: true })], [500]);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "b", dryRun: false });
    expect(result).toMatchObject({ checked: 1, refreshed: 1, movedPage: 1 });
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))!;
    expect(attempt).toContain(refreshCopyFingerprint(501, 9801));
    expect(JSON.stringify(attempt)).toContain('\\"moved_page\\":true');
    expect(JSON.stringify(attempt)).toContain('\\"prior_lineage_ref\\":601');
  });

  it("holds a moved page's fee to the same line rules (name, audience, value)", () => {
    const plan = planRefreshes([
      candidate({ moved_page: true, fee_name: "Overdraft Fee - Business" }),
      candidate({ moved_page: true, prior_fee_published_id: 502, fee_verified_id: 9802, prior_fee_audience: "consumer", fee_audience: "unknown" }),
    ]);
    expect(plan.refresh).toEqual([]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(["name_differs", "audience_differs"]);
  });

  it("selects no moved page when none qualifies", async () => {
    const db = movedDb([], []);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "b", dryRun: true });
    expect(result).toMatchObject({ checked: 0, refreshed: 0, movedPage: 0 });
  });
});

describe("moveRowsToIdenticalCopy", () => {
  function identicalDb(pairs: unknown[]) {
    return vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("old_text.hash = current_text.hash")) return Promise.resolve(pairs);
      if (text.includes("UPDATE raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 1 }, { fee_raw_id: 2 }]);
      return Promise.resolve([]);
    });
  }

  it("moves the superseded copy's rows to the identical current copy", async () => {
    const db = identicalDb([{ older_id: 500, current_id: 900, rows: 2 }]);
    expect(await moveRowsToIdenticalCopy(asDb(db), { runId: 9, dryRun: false })).toEqual({ documents: 1, rowsMoved: 2 });
    const statements = writes(db);
    expect(statements.some((text) => text.includes("UPDATE raw_fee_observations"))).toBe(true);
    expect(statements.some((text) => /INSERT INTO published_fee_records/.test(text))).toBe(false);
    // #1347: the moved rows take the current copy's link at every tier; nothing else on a live row changes.
    const relink = statements.filter((text) => /UPDATE published_fee_records/.test(text));
    expect(relink).toHaveLength(1);
    expect(relink[0]).toContain("SET source_url = target.url");
    expect(relink[0]).not.toMatch(/rolled_back|amount|canonical_fee_key/);
  });

  it("changes nothing in a dry run or when no copy is identical", async () => {
    const dry = identicalDb([{ older_id: 500, current_id: 900, rows: 2 }]);
    expect(await moveRowsToIdenticalCopy(asDb(dry), { runId: 9, dryRun: true })).toEqual({ documents: 1, rowsMoved: 2 });
    expect(writes(dry)).toEqual([]);
    const none = identicalDb([]);
    expect(await moveRowsToIdenticalCopy(asDb(none), { runId: 9, dryRun: false })).toEqual({ documents: 0, rowsMoved: 0 });
    expect(writes(none)).toEqual([]);
  });
});
