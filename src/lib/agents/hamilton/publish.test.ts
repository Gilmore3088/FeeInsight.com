import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PUBLISH_MIN_ROWS_PER_STEP, ARTICLE_PAGE_RESELECT_SQL, ARTICLE_PAGE_SKIP_REASON, CATALOG_DEPTH_LIVE_SQL, decidePriorFee, HAMILTON_PUBLISH_MIN_INSTITUTION_FEES, HAMILTON_PUBLISH_STRATEGY, linesApartOnPage, listsBothPrices, qualifiedLines, namesShareReading, newerCopyPrintsLine, otherBalanceLine, publishedFeeName, publishNameHold, publishSkipReason, runHamiltonPublish, selectListedFeeLines, sameLineDuplicateOf, sentenceFragmentName, separateLines } from "./publish";
import { feePageKey } from "./page-key";
import { PUBLISH_REFUSE_SWEEP_RULES_LIVE, publishSweepRefusals } from "./publish-sweep-rules";

type DbMock = ReturnType<typeof vi.fn<(strings: TemplateStringsArray, ...params: unknown[]) => Promise<unknown[]>>> & {
  unsafe: ReturnType<typeof vi.fn<(query: string, params: unknown[]) => Promise<unknown[]>>>;
};

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

/** Three live catalog fees per institution, so the fee minimum passes by default. */
function deepInstitutionRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const ids = Array.from(new Set(rows.map((row) => row.institution_id)));
  return ids.flatMap((institution_id) =>
    ["monthly_maintenance", "nsf", "wire_domestic_outgoing"].map((canonical_fee_key) => ({
      depth_source: "published",
      institution_id,
      canonical_fee_key,
    })),
  );
}

function createDbMock(
  rows: Array<Record<string, unknown>>,
  priorPublishedRows: Array<Record<string, unknown>> = [],
  depthRows: Array<Record<string, unknown>> = deepInstitutionRows(rows),
  movementEvidence: Array<Record<string, unknown>> = [],
  /** What the sweeps' own reads (#1069 step 2) return for the rows about to publish. */
  sweepRows: { otherBank?: unknown[]; unconfirmedHost?: unknown[]; business?: unknown[]; owner?: unknown[] } = {},
): DbMock {
  let nextPublishedId = 1201;
  const db = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
    const text = templateText(strings);
    if (text.includes("agent_source_texts")) return Promise.resolve(movementEvidence);
    if (text.includes("INSERT INTO published_fee_records")) {
      return Promise.resolve([{ fee_published_id: nextPublishedId++ }]);
    }
    if (text.includes("UPDATE published_fee_records")) {
      return Promise.resolve(priorPublishedRows.slice(0, 1).map((row) => ({ fee_published_id: row.fee_published_id })));
    }
    // No admin hold in these fixtures (publish.admin-hold.test.ts covers one).
    if (text.includes("left(quarantine_reason")) return Promise.resolve([]);
    if (text.includes("fr.source_document_id <>")) {
      // The page-copy SQL only returns same-price rows from another document. A prior
      // price or this very document is not a live copy requiring its own metadata read.
      return Promise.resolve(priorPublishedRows.filter((prior) =>
        Number(prior.amount) === Number(params[3]) && Number(prior.source_document_id) !== Number(params[4])));
    }
    if (text.includes("FROM published_fee_records")) {
      return Promise.resolve(priorPublishedRows);
    }
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => {
    if (query.includes("institution_fee_depth")) return Promise.resolve(depthRows);
    if (query.includes("consumer_fee_id")) return Promise.resolve(sweepRows.business ?? []);
    if (query.includes("own_label")) return Promise.resolve(sweepRows.unconfirmedHost ?? []);
    if (query.includes("names_own_bank")) return Promise.resolve(sweepRows.otherBank ?? []);
    if (query.includes("named_other_id")) return Promise.resolve(sweepRows.owner ?? []);
    if (query.includes("FROM verified_fee_observations")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
  return db;
}

/** Statements that change data: inserts and updates, signals excluded. */
function writes(db: DbMock): string[] {
  return db.mock.calls
    .map((call) => templateText(call[0]))
    .filter((text) => /INSERT INTO|UPDATE /.test(text) && !text.includes("hamilton_signals"));
}

function asPublishDb(db: DbMock): NonNullable<Parameters<typeof runHamiltonPublish>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runHamiltonPublish>[0]["db"]>;
}

const verifiedFee = {
  fee_verified_id: 801,
  fee_raw_id: 701,
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  document_r2_key: null,
  extraction_confidence: "0.9200",
  canonical_fee_key: "overdraft",
  fee_audience: "consumer" as const,
  variant_type: null,
  outlier_flags: ["agentic_darwin_verified"],
  verified_by_agent_event_id: "00000000-0000-4000-8000-000000000801",
  fee_name: "Overdraft fee",
  amount: "35.00",
  frequency: "per_item",
  raw_agent_event_id: "00000000-0000-4000-8000-000000000701",
  source_document_id: 77,
  document_crawled_at: "2026-10-01T00:00:00.000Z",
};

const priorPublishedFee = {
  fee_published_id: 601,
  amount: "30.00",
  fee_name: "Overdraft fee",
  published_at: "2026-07-01T00:00:00.000Z",
  source_url: "https://testbank.example/fees",
  source_document_id: 12,
  document_crawled_at: "2026-07-01T00:00:00.000Z",
};

describe("Hamilton agentic publish", () => {
  it("stops the row loop at its deadline after the minimum rows, and leaves the rest undecided (2026-10-17)", async () => {
    // 70 distinct rows at 70 banks; a deadline already past.
    const rows = Array.from({ length: 70 }, (_, index) => ({
      ...verifiedFee, fee_verified_id: 5000 + index, fee_raw_id: 6000 + index, institution_id: 7000 + index, source_document_id: 8000 + index,
    }));
    const boxed = await runHamiltonPublish({ runId: 1700, db: asPublishDb(createDbMock(rows)), deadlineAt: Date.now() - 1, stateCode: "TX" });
    expect(boxed.processedVerifiedFees).toBe(PUBLISH_MIN_ROWS_PER_STEP);
    expect(boxed.timeBox).toEqual({ stopped: true, rowsLeft: 70 - PUBLISH_MIN_ROWS_PER_STEP, topUpSkipped: true });
    // The top-up has its own, later deadline: a step past the row deadline still tops up.
    const toppedUp = await runHamiltonPublish({ runId: 1702, db: asPublishDb(createDbMock(rows)), deadlineAt: Date.now() - 1, topUpDeadlineAt: Date.now() + 60_000, stateCode: "TX" });
    expect(toppedUp.timeBox.topUpSkipped).toBe(false);
    // The rows it did not reach get no attempt: the next step selects them again.
    const free = await runHamiltonPublish({ runId: 1701, db: asPublishDb(createDbMock(rows)) });
    expect(free.processedVerifiedFees).toBe(70);
    expect(free.timeBox).toEqual({ stopped: false, rowsLeft: 0, topUpSkipped: false });
  });

  it("rejects verified rows filed under the wrong category instead of publishing them", async () => {
    const db = createDbMock([
      { ...verifiedFee, fee_name: "Continuous Overdraft Fee (per day)", amount: "3.00" },
    ]);

    const result = await runHamiltonPublish({ runId: 105, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(0);
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("Category guard (name_contradicts)"),
    });
    const writes = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(writes).not.toContain("INSERT INTO published_fee_records");
    expect(writes).toContain("UPDATE verified_fee_observations");
    expect(JSON.stringify(db.mock.calls)).toContain("category_guard:name_contradicts");
  });

  it("holds a row whose name is not a fee's or carries another price (UAT, Oct 9 re-queued rows)", async () => {
    const held = [
      // A waiver sentence at $0 and a no-fee sentence are the eval's not_a_fee rules, applied before publish.
      { ...verifiedFee, fee_verified_id: 811, canonical_fee_key: "monthly_maintenance", fee_name: "To avoid the monthly service charge, keep", amount: "0.00", hold: "publish_hold:name_rule:waiver_sentence" },
      { ...verifiedFee, fee_verified_id: 812, canonical_fee_key: "stop_payment", fee_name: "No fee for stop payments placed online", amount: "0.00", hold: "publish_hold:name_rule:no_fee_sentence" },
      // The price printed in the name is the fee; the stored amount is the next column's rent.
      { ...verifiedFee, fee_verified_id: 813, canonical_fee_key: "overdraft", fee_name: "Courtesy Pay (Paid Overdraft) Fee…..…….…….….$35.005 | 3x10…………………………………", amount: "50.00", hold: "publish_hold:price_in_name" },
    ];
    for (const { hold, ...row } of held) {
      const db = createDbMock([row]);
      const result = await runHamiltonPublish({ runId: 118, db: asPublishDb(db) });
      expect(result.publishedFees, row.fee_name).toBe(0);
      expect(result.results[0].status, row.fee_name).toBe("skipped");
      const writes = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(writes).not.toContain("INSERT INTO published_fee_records");
      expect(JSON.stringify(db.mock.calls), row.fee_name).toContain(hold);
    }
    // An add-on price and a sentence fragment with no repaired form are held too.
    expect(publishNameHold("Research Fee (plus", "account_research", 1)?.code).toBe("price_is_addon");
    expect(publishNameHold("GUASFCU charges a", "check_image", 2)?.code).toBe("cutoff_name");
    expect(publishNameHold("Our overdraft fee of", "overdraft", 35)).toBeNull(); // repairs to "Overdraft fee"
    expect(publishNameHold("Fax Fee (incoming and outgoing)", "account_research", 2)).toBeNull();
    // #2032: a clause saying what the fee covers, or the legal cap, comes off; the fee publishes (Beacon).
    expect(publishNameHold("Stop Payment, all items including ACH and bill pay", "stop_payment", 30)).toBeNull();
    expect(publishedFeeName("Stop Payment, all items including ACH and bill pay", "stop_payment")).toBe("Stop Payment");
    expect(publishNameHold("Legal Process Fee, per occurrence, or such lesser rate as may be set by law", "legal_process", 125)).toBeNull();
    expect(publishedFeeName("Legal Process Fee, per occurrence, or such lesser rate as may be set by law", "legal_process")).toBe("Legal Process Fee, per occurrence");
    // Any other clause may be the fee's condition, and a line cut mid-sentence has no name: both stay held.
    expect(publishNameHold("ATM Withdrawal Fees, out of Network (Surcharge Fees, fees accessed by other ATM proprietors, may still apply.)", "atm_non_network", 0)?.code).toBe("cutoff_name");
    expect(publishNameHold("Any replacement cards whether lost, stolen, or damaged will be charged a", "card_replacement", 5)?.code).toBe("cutoff_name");
    expect(publishedFeeName("Wire Transfer Outgoing, including international", "wire_domestic_outgoing")).not.toBe("Wire Transfer Outgoing");
    // The same price in the name as the amount is only glue: the name is cut before it and the fee publishes.
    expect(publishNameHold("Courtesy Pay Fee…..$35.005", "overdraft", 35)).toBeNull();
    expect(publishedFeeName("Courtesy Pay (Paid Overdraft) Fee…..…….…….….$35.005 | 3x10…………………………………", "overdraft")).toBe("Courtesy Pay (Paid Overdraft) Fee");
    expect(publishedFeeName("ATM Balance Inquiry (at non-Wildfire ATM) .........................", "atm_non_network")).toBe("ATM Balance Inquiry (at non-Wildfire ATM)");
    expect(publishedFeeName("paper statement fee is waived if enrolled in eStatements", "paper_statement")).toBe("Paper statement fee");
    expect(publishNameHold("paper statement fee is waived if enrolled in eStatements", "paper_statement", 5)).toBeNull();
    // A threshold inside the name's parenthesis is not a glued price (102976 went live as "...falls below").
    expect(publishedFeeName("Service charge (daily balance falls below $500)", "minimum_balance")).toBe("Service charge (daily balance falls below $500)");
    expect(publishedFeeName("Classic Money Market Account (balance below $1,000)", "minimum_balance")).toBe("Classic Money Market Account (balance below $1,000)");
    expect(publishedFeeName("Wire Transfer Fee $25", "wire_domestic_outgoing")).toBe("Wire Transfer Fee");
  });

  it("publishes a twin of a rules re-check takedown only when today's rules read it from its own document", async () => {
    const twin = { ...verifiedFee, twin_recheck: true };
    const schedule = (text: string) => [{ source_document_id: 77, normalized_text: text }];

    // The twin's own document no longer prints a $35 overdraft fee: the reason its twin came down applies to it.
    const failing = createDbMock([twin], [], undefined, schedule("Fee Schedule\nOverdraft fee (per item) $30.00\nStop payment fee $30.00"));
    const failed = await runHamiltonPublish({ runId: 119, db: asPublishDb(failing) });
    expect(failed.publishedFees).toBe(0);
    expect(failed.results[0]).toMatchObject({ status: "skipped", reason: expect.stringContaining("Rules re-check") });
    expect(writes(failing).join("\n")).not.toContain("INSERT INTO published_fee_records");
    expect(JSON.stringify(failing.mock.calls)).toContain("rules_recheck_unreproduced");

    // No text for the document fails too.
    const textless = createDbMock([twin], [], undefined, []);
    expect((await runHamiltonPublish({ runId: 120, db: asPublishDb(textless) })).publishedFees).toBe(0);

    // A twin today's rules read from its own document publishes.
    const passing = createDbMock([twin], [], undefined, schedule("Fee Schedule\nOverdraft fee (per item) $35.00\nStop payment fee $30.00"));
    expect((await runHamiltonPublish({ runId: 121, db: asPublishDb(passing) })).publishedFees).toBe(1);

    // A row that is not a twin never needs the re-check.
    const plain = createDbMock([verifiedFee], [], undefined, []);
    expect((await runHamiltonPublish({ runId: 122, db: asPublishDb(plain) })).publishedFees).toBe(1);
  });

  it("skips a $0 benefit read from a product page only once the product-page check is on", async () => {
    const benefit = {
      ...verifiedFee,
      canonical_fee_key: "overdraft",
      fee_name: "Overdraft Fees",
      amount: "0.00",
      outlier_flags: ["agentic_darwin_verified", "free_fee_verified"],
      free_read: true,
      document_url: "https://www.pnc.com/en/personal-banking/banking/checking/simple-checking.html",
    };
    const reason = "Read from a product page's benefits, not a fee schedule";
    expect(publishSkipReason(benefit, 0.85, false)).not.toBe(reason);
    expect(publishSkipReason(benefit, 0.85, true)).toBe(reason);
    expect(publishSkipReason({ ...benefit, document_url: "https://www.pnc.com/content/dam/pnc-com/pdf/personal/fee-schedule.pdf" }, 0.85, true)).not.toBe(reason);
    expect(publishSkipReason({ ...benefit, free_read: false }, 0.85, true)).not.toBe(reason);
  });

  it("skips a product-page $0 benefit with the switch as shipped (on since Oct 9), and nothing else", async () => {
    const benefit = {
      ...verifiedFee,
      canonical_fee_key: "overdraft",
      fee_name: "Overdraft Fees",
      amount: "0.00",
      outlier_flags: ["agentic_darwin_verified", "free_fee_verified"],
      free_read: true,
      document_url: "https://www.pnc.com/en/personal-banking/banking/checking/simple-checking.html",
    };
    const plain = { ...benefit, free_read: false };
    const withSwitch = await runHamiltonPublish({ runId: 123, db: asPublishDb(createDbMock([benefit])) });
    const without = await runHamiltonPublish({ runId: 124, db: asPublishDb(createDbMock([plain])) });
    expect(withSwitch.results[0].reason).toBe("Read from a product page's benefits, not a fee schedule");
    expect(without.results[0].reason).not.toBe("Read from a product page's benefits, not a fee schedule");
  });

  it("holds a twin whose name is a sentence fragment even when its own document reproduces it (101941)", async () => {
    const twin = { ...verifiedFee, canonical_fee_key: "nsf", fee_name: "withdrawals or other means. The NSF fee", amount: "29.00", twin_recheck: true };
    const text = [{ source_document_id: 77, normalized_text: "Fee Schedule\nNSF fee (per item) $29.00\nStop payment fee $30.00" }];
    const db = createDbMock([twin], [], undefined, text);
    const result = await runHamiltonPublish({ runId: 125, db: asPublishDb(db) });
    expect(result.publishedFees).toBe(0);
    expect(result.results[0].reason).toContain("Rules re-check");
    expect(sentenceFragmentName("Non-Sufficient Fund (NSF) fee")).toBe(false);
    expect(sentenceFragmentName("PERSONAL CHECKING: Monthly Cycle Service Charge")).toBe(false);
  });

  it("never publishes a row read from an article page", async () => {
    const db = createDbMock([{ ...verifiedFee, source_url: "https://www.sccu.com/articles/personal-finance/common-checking-account-fees-to-avoid" }]);

    const result = await runHamiltonPublish({ runId: 117, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(0);
    expect(result.results[0]).toMatchObject({ status: "skipped", reason: "Read from an article page, not a fee schedule" });
  });

  it("never publishes a row whose document is a learning article, whatever its own link (#1774)", async () => {
    const db = createDbMock([{
      ...verifiedFee,
      source_url: null,
      document_url: "https://www.td.com/us/en/personal-banking/learning/money-management/types-of-checking-accounts",
    }]);

    const result = await runHamiltonPublish({ runId: 118, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(0);
    expect(result.results[0]).toMatchObject({ status: "skipped", reason: ARTICLE_PAGE_SKIP_REASON });
  });

  it("only reports category rejections on a dry run", async () => {
    const db = createDbMock([{ ...verifiedFee, fee_name: "Stop Payment Fee" }]);

    const result = await runHamiltonPublish({ runId: 106, dryRun: true, db: asPublishDb(db) });

    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("Category guard (name_unsupported)"),
    });
    expect(db).not.toHaveBeenCalled();
  });

  it("publishes eligible Darwin-verified rows to published_fee_records", async () => {
    const db = createDbMock([verifiedFee]);

    const result = await runHamiltonPublish({
      runId: 101,
      limit: 500,
      db: asPublishDb(db),
    });

    expect(result).toMatchObject({
      selectedVerifiedFees: 1,
      processedVerifiedFees: 1,
      publishedFees: 1,
      skippedFees: 0,
      limit: 500,
      minConfidence: 0.8,
      dryRun: false,
      batchId: "agentic-run-101",
    });
    expect(result.results[0]).toMatchObject({
      feeVerifiedId: 801,
      institutionId: 42,
      canonicalFeeKey: "overdraft",
      status: "published",
      feePublishedId: 1201,
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("FROM verified_fee_observations");
    expect(unsafeSql).toContain("JOIN raw_fee_observations");
    expect(unsafeSql).toContain("NOT EXISTS");
    expect(unsafeSql).toContain("published_fee_records");

    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).toContain("INSERT INTO published_fee_records");
    expect(insertSql).toContain("INSERT INTO hamilton_signals");
    expect(insertSql).toContain("batch_id");
    expect(insertSql).toContain("ON CONFLICT DO NOTHING");
    expect(insertSql).not.toContain("promote_to_tier3");
    expect(insertSql).not.toContain("agent_events");
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton_publication_completed");
    expect(JSON.stringify(db.mock.calls)).toContain("published_public_ready");
    expect(JSON.stringify(db.mock.calls)).toContain("refresh_recommended");
    expect(JSON.stringify(db.mock.calls)).toContain("consumer_canonical_fee_keys");
  });

  it("emits a fee movement signal when a published amount changes from the prior live catalog row", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee], undefined, [
      { fee_published_id: 601, fee_name: "Overdraft fee", source_url: "https://testbank.example/fees", document_text: "Overdraft fee $30.00\nWire transfer $25.00" },
      { fee_published_id: 1201, fee_name: "Overdraft fee", source_url: "https://testbank.example/fees", document_text: "Overdraft fee $35.00\nWire transfer $25.00" },
    ]);

    const result = await runHamiltonPublish({
      runId: 106,
      db: asPublishDb(db),
    });

    expect(result.publishedFees).toBe(1);
    expect(result.results[0]).toMatchObject({
      previousFeePublishedId: 601,
      previousAmount: 30,
      amountDelta: 5,
      movementDirection: "increase",
    });

    const selectSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(selectSql).toContain("FROM published_fee_records");
    expect(selectSql).toContain("COALESCE(fp.variant_type");
    expect(selectSql).toContain("COALESCE(fp.frequency");
    expect(selectSql).toContain("rolled_back_at IS NULL");

    const callsJson = JSON.stringify(db.mock.calls);
    expect(callsJson).toContain("hamilton_publication_completed");
    expect(callsJson).toContain("hamilton_fee_movement_detected");
    expect(callsJson).toContain("published_fee_movement");
    expect(callsJson).toContain("amount_delta");
    expect(callsJson).toContain("fee_audience");
    expect(callsJson).toContain("consumer");
    expect(callsJson).toContain(":5");
  });

  it("keeps business publication and movement applicability out of consumer signal keys", async () => {
    const business = { ...verifiedFee, fee_audience: "business" };
    const db = createDbMock([business], [priorPublishedFee], undefined, [
      { fee_published_id: 601, fee_name: "Overdraft fee", source_url: "https://testbank.example/fees", document_text: "Overdraft fee $30.00" },
      { fee_published_id: 1201, fee_name: "Overdraft fee", source_url: "https://testbank.example/fees", document_text: "Overdraft fee $35.00" },
    ]);

    await runHamiltonPublish({ runId: 206, db: asPublishDb(db) });

    const callsJson = JSON.stringify(db.mock.calls);
    expect(callsJson).toContain('consumer_canonical_fee_keys\\":[]');
    expect(callsJson).toContain('fee_audience\\":\\"business');
  });

  it("keeps a movement the bank's texts do not confirm off the watcher alert", async () => {
    // A second reading of the same edition: both texts state the same prices, so the
    // $30 to $35 "move" is a fee paired with a neighbouring price, not a change.
    const sameEdition = "Overdraft fee $30.00 $35.00\nWire transfer $25.00";
    const db = createDbMock([verifiedFee], [priorPublishedFee], undefined, [
      { fee_published_id: 601, fee_name: "Overdraft fee", source_url: "https://testbank.example/fees", document_text: sameEdition },
      { fee_published_id: 1201, fee_name: "Overdraft fee", source_url: "https://testbank.example/fees", document_text: sameEdition },
    ]);

    const result = await runHamiltonPublish({ runId: 116, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(1);
    expect(result.results[0]).toMatchObject({ previousFeePublishedId: 601, movementDirection: "increase" });
    const callsJson = JSON.stringify(db.mock.calls);
    expect(callsJson).toContain("hamilton_publication_completed");
    expect(callsJson).not.toContain("hamilton_fee_movement_detected");
    expect(callsJson).toContain('unconfirmed_movement_count\\":1');
    expect(callsJson).not.toContain("hamilton_priority_alerts");
  });

  it("skips re-verified rows whose content is already live in the catalog", async () => {
    const db = createDbMock([verifiedFee], [{ ...priorPublishedFee, amount: "35.00" }]);

    const result = await runHamiltonPublish({
      runId: 107,
      db: asPublishDb(db),
    });

    expect(result.publishedFees).toBe(0);
    expect(result.skippedFees).toBe(1);
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: "Identical fee already published",
      feePublishedId: null,
      previousFeePublishedId: 601,
      previousAmount: 35,
    });

    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).not.toContain("INSERT INTO published_fee_records");
  });

  it("keeps dry runs read-only while still reporting publishable rows", async () => {
    const db = createDbMock([verifiedFee]);

    const result = await runHamiltonPublish({
      runId: 102,
      dryRun: true,
      db: asPublishDb(db),
    });

    expect(result.publishedFees).toBe(1);
    expect(result.results[0]).toMatchObject({ status: "published", feePublishedId: null });
    // The selection, the depth read, the three sweep-rule reads (#1069 step 2) and the
    // document-owner verdict read, all SELECTs.
    expect(db.unsafe.mock.calls.filter(([query]) => /SELECT|WITH/.test(query))).toHaveLength(6);
    expect(writes(db)).toEqual([]);
  });

  // #1069 step 2: a row the other-bank, unconfirmed-host or business-schedule sweep would take
  // down once live is counted, and refused only while the switch is on.
  const sweepFixture = {
    otherBank: [{ fee_verified_id: 801, document_host: "peoplesbank-wa.com", names_own_bank: false }],
    unconfirmedHost: [],
    business: [],
  };

  it("counts a row a sweep would take down but still publishes it while the switch is off", async () => {
    const db = createDbMock([verifiedFee], [], undefined, [], sweepFixture);

    const result = await runHamiltonPublish({ runId: 131, refuseSweepRulesLive: false, db: asPublishDb(db) });

    expect(result.sweepCheck).toMatchObject({ live: false, wouldRefuse: 1, refused: 0, byRule: { other_bank_document: 1 }, error: null });
    expect(result.results[0]).toMatchObject({
      status: "published",
      sweepRule: { rule: "other_bank_document", sweepReason: "other_bank_document: peoplesbank-wa.com" },
    });
    const sweepReads = db.unsafe.mock.calls.filter((call) => String(call[0]).includes("fv.fee_verified_id = ANY($1::bigint[])"));
    expect(sweepReads).toHaveLength(4);
    for (const call of sweepReads) expect(call[1][0]).toEqual([801]);
  });

  it("refuses a row a sweep would take down when the switch is on", async () => {
    const db = createDbMock([verifiedFee], [], undefined, [], sweepFixture);

    const result = await runHamiltonPublish({ runId: 132, refuseSweepRulesLive: true, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(0);
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: "Refused at publish, a sweep would take it down: other_bank_document: peoplesbank-wa.com",
    });
    expect(result.sweepCheck).toMatchObject({ live: true, wouldRefuse: 1, refused: 1 });
    expect(writes(db).join("\n")).not.toContain("INSERT INTO published_fee_records");
  });

  it("leaves a row the sweeps pass alone, and a row already skipped is not counted", async () => {
    const passing = {
      otherBank: [{ fee_verified_id: 801, document_host: "sister.example", names_own_bank: true }],
      unconfirmedHost: [{ fee_verified_id: 801, document_host: "newdomain.example", names_own_bank: "t" }],
      business: [{ fee_verified_id: 801, consumer_fee_id: null }],
    };
    const passed = await runHamiltonPublish({ runId: 133, refuseSweepRulesLive: true, db: asPublishDb(createDbMock([verifiedFee], [], undefined, [], passing)) });
    expect(passed.results[0]).toMatchObject({ status: "published" });
    expect(passed.sweepCheck.wouldRefuse).toBe(0);

    const lowConfidence = { ...verifiedFee, extraction_confidence: "0.5000" };
    const skipped = await runHamiltonPublish({ runId: 134, db: asPublishDb(createDbMock([lowConfidence], [], undefined, [], sweepFixture)) });
    expect(skipped.results[0]).toMatchObject({ status: "skipped", reason: "Below publish confidence threshold" });
    expect(skipped.sweepCheck.wouldRefuse).toBe(0);
  });

  it("defers publication when an enabled sweep read is unavailable", async () => {
    const db = createDbMock([verifiedFee]);
    const base = db.unsafe as (query: string, params: unknown[]) => Promise<unknown[]>;
    db.unsafe = vi.fn((query: string, params: unknown[]) =>
      query.includes("consumer_fee_id") ? Promise.reject(new Error("statement timeout")) : base(query, params),
    );

    const result = await runHamiltonPublish({ runId: 135, refuseSweepRulesLive: true, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(0);
    expect(result.results[0]).toMatchObject({ status: "skipped" });
    expect(result.sweepCheck.error).toBe("Publication evidence unavailable: business_schedule");
    expect(result.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: ["business_schedule"] });
    expect(result.evidenceCheck).toMatchObject({ readState: "unavailable", deferred: 1, unavailableByCheck: { business_schedule: 1 } });
    expect(writes(db).join("\n")).not.toMatch(/INSERT INTO published_fee_records|UPDATE published_fee_records|UPDATE verified_fee_observations|INSERT INTO pipeline_attempts/);
  });

  it.each([
    ["other_bank_document", "COALESCE(o.id, 0)"],
    ["unconfirmed_document_host", "own_label"],
    ["document_owner", "named_other_id"],
  ])("defers when required %s evidence is unavailable", async (check, marker) => {
    const db = createDbMock([verifiedFee]);
    const base = db.unsafe.getMockImplementation()!;
    db.unsafe.mockImplementation((query: string, params: unknown[]) =>
      query.includes(marker) ? Promise.reject(new Error("secret SQL/source detail")) : base(query, params));
    const result = await runHamiltonPublish({ runId: 136, db: asPublishDb(db) });
    expect(result.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: [check] });
    expect(result.publishedFees).toBe(0);
    expect(result.supersededFees).toBe(0);
    expect(JSON.stringify(result)).not.toContain("secret SQL/source detail");
  });

  function unavailableTaggedRead(db: DbMock, marker: string) {
    const base = db.getMockImplementation()!;
    let attempted = 0;
    db.mockImplementation((strings: TemplateStringsArray, ...params: unknown[]) => {
      if (templateText(strings).includes(marker)) {
        attempted += 1;
        return Promise.reject(new Error("private exception with SQL, URL and stack"));
      }
      return base(strings, ...params);
    });
    return () => attempted;
  }

  it.each([
    ["live_prior", "ORDER BY fp.published_at DESC"],
    ["exact_duplicate", "lower(btrim(fp.fee_name))"],
  ])("keeps a pending row after %s failure", async (check, marker) => {
    const db = createDbMock([verifiedFee]);
    const attempted = unavailableTaggedRead(db, marker);
    const result = await runHamiltonPublish({ runId: 137, db: asPublishDb(db) });
    expect(attempted()).toBe(1);
    expect(result.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: [check] });
    expect(result.publishedFees).toBe(0);
    expect(writes(db).join("\\n")).not.toContain("INSERT INTO published_fee_records");
    expect(JSON.stringify(result)).not.toContain("private exception");
  });

  it("does not supersede a legitimate existing price when its coexistence read fails", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee]);
    const attempted = unavailableTaggedRead(db, "SELECT source_document_id, fee_name, amount");
    const result = await runHamiltonPublish({ runId: 138, db: asPublishDb(db) });
    expect(attempted()).toBe(1);
    expect(result.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: ["listed_fee_lines"] });
    expect(result.publishedFees).toBe(0);
    expect(result.supersededFees).toBe(0);
    expect(writes(db).join("\\n")).not.toMatch(/INSERT INTO published_fee_records|UPDATE published_fee_records/);
  });

  it("does not settle a provisional older-document outcome when its exception text read fails", async () => {
    const db = createDbMock([verifiedFee], [{ ...priorPublishedFee, document_crawled_at: "2026-10-02T00:00:00Z" }]);
    const attempted = unavailableTaggedRead(db, "SELECT normalized_text FROM agent_source_texts");
    const result = await runHamiltonPublish({ runId: 139, db: asPublishDb(db) });
    expect(attempted()).toBe(1);
    expect(result.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: ["document_text"] });
    expect(result.publishedFees).toBe(0);
  });

  it.each(["page_copy_live", "page_copy_document", "page_copy_text", "page_copy_document_missing", "page_copy_text_missing"])("defers a failed %s prerequisite", async (check) => {
    const db = createDbMock([verifiedFee]);
    const base = db.getMockImplementation()!;
    const witnesses: string[] = [];
    const expectedCheck = check.replace("_missing", "");
    db.mockImplementation((strings: TemplateStringsArray, ...params: unknown[]) => {
      const text = templateText(strings);
      let stage: string | null = null;
      if (text.includes("fr.source_document_id <>")) stage = "page_copy_live";
      else if (text.includes("FROM source_documents") && text.includes("GREATEST(last_checked_at")) stage = "page_copy_document";
      else if (text.includes("SELECT DISTINCT ON (source_document_id)") && text.includes("normalized_text")) stage = "page_copy_text";
      if (!stage) return base(strings, ...params);
      witnesses.push(stage);
      if (stage === expectedCheck) return check.endsWith("_missing")
        ? Promise.resolve([]) : Promise.reject(new Error("private source/read failure"));
      if (stage === "page_copy_live") return Promise.resolve([{
        fee_published_id: 601, institution_id: 42, source_document_id: 12,
        document_url: "https://testbank.example/fees?print=1", crawled_at: "2026-10-02",
        canonical_fee_key: "overdraft", amount: 35, fee_name: "Overdraft fee", frequency: "per_item", fee_audience: "consumer",
      }]);
      if (stage === "page_copy_document") return Promise.resolve([{ document_url: "https://testbank.example/fees", crawled_at: "2026-10-01", superseded: false, superseded_by_id: null }]);
      return Promise.resolve([]);
    });
    const result = await runHamiltonPublish({ runId: 140, db: asPublishDb(db) });
    expect(witnesses).toContain(expectedCheck);
    expect(result.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: [expectedCheck] });
    expect(result.publishedFees).toBe(0);
    expect(result.supersededFees).toBe(0);
  });

  it.each([null, "", " \t", "not a URL", "https://testbank.example/%E0%A4%A"])("leaves publication pending for required unknown own page URL %j", async (document_url) => {
    const db = createDbMock([verifiedFee]);
    const base = db.getMockImplementation()!;
    db.mockImplementation((strings: TemplateStringsArray, ...params: unknown[]) => {
      const text = templateText(strings);
      if (text.includes("fr.source_document_id <>")) return Promise.resolve([{
        fee_published_id: 601, institution_id: 42, source_document_id: 12,
        document_url: "https://testbank.example/fees?print=1", crawled_at: "2026-10-02",
        canonical_fee_key: "overdraft", amount: 35, fee_name: "Overdraft fee", frequency: "per_item", fee_audience: "consumer",
      }]);
      if (text.includes("FROM source_documents") && text.includes("GREATEST(last_checked_at")) {
        return Promise.resolve([{ document_url, crawled_at: "2026-10-01", superseded: false, superseded_by_id: null }]);
      }
      return base(strings, ...params);
    });
    const result = await runHamiltonPublish({ runId: 151, db: asPublishDb(db) });
    expect(result).toMatchObject({ publishedFees: 0, supersededFees: 0, evidenceDeferredFees: 1 });
    expect(result.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: ["page_copy_document"] });
    expect(writes(db).join("\n")).not.toMatch(/INSERT INTO published_fee_records|UPDATE published_fee_records|UPDATE verified_fee_observations|INSERT INTO pipeline_attempts/);
    expect(db.mock.calls.some(([query]) => templateText(query).includes("SELECT DISTINCT ON (source_document_id)"))).toBe(false);
  });

  it("defers the wide same-line prerequisite instead of deciding from a failed reselect", async () => {
    const db = createDbMock([{ ...verifiedFee, same_line_reselect: true }]);
    const base = db.getMockImplementation()!;
    let reads = 0;
    db.mockImplementation((strings: TemplateStringsArray, ...params: unknown[]) => {
      if (templateText(strings).includes("ORDER BY fp.published_at DESC") && ++reads === 2) {
        return Promise.reject(new Error("wide prior unavailable"));
      }
      return base(strings, ...params);
    });
    const result = await runHamiltonPublish({ runId: 145, db: asPublishDb(db) });
    expect(reads).toBe(2);
    expect(result.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: ["live_prior"] });
    expect(result.publishedFees).toBe(0);
  });

  it("requires text only when the prior-line branch needs it to distinguish two fees", async () => {
    const row = { ...verifiedFee, fee_name: "ACH OD Fee" };
    const prior = { ...priorPublishedFee, source_document_id: 77, fee_name: "Courtesy Pay Fee", amount: "35.00" };
    expect(separateLines(row, prior)).toBe(true);
    const missing = await runHamiltonPublish({ runId: 147, db: asPublishDb(createDbMock([row], [prior])) });
    expect(missing.results[0]).toMatchObject({ evidenceDeferred: true, unavailableEvidence: ["document_text"] });
    const text = "ACH OD Fee $35.00\nCourtesy Pay Fee $35.00\nStop Payment Fee $30.00";
    const complete = await runHamiltonPublish({ runId: 148, db: asPublishDb(createDbMock([row], [prior], undefined, [{ normalized_text: text }])) });
    expect(complete.publishedFees).toBe(1);
    const noPrior = createDbMock([verifiedFee]);
    expect((await runHamiltonPublish({ runId: 149, db: asPublishDb(noPrior) })).publishedFees).toBe(1);
    expect(noPrior.mock.calls.some(([query]) => templateText(query).includes("SELECT normalized_text"))).toBe(false);
  });

  it("retains a proved older outcome after a successful required text read despite unrelated unavailable sweep evidence", async () => {
    const prior = { ...priorPublishedFee, document_crawled_at: "2026-10-02T00:00:00Z" };
    const db = createDbMock([verifiedFee], [prior], undefined, [{ normalized_text: "Overdraft fee $30.00\nStop Payment fee $30.00" }]);
    const base = db.unsafe.getMockImplementation()!;
    db.unsafe.mockImplementation((query: string, params: unknown[]) => query.includes("consumer_fee_id")
      ? Promise.reject(new Error("unrelated unavailable sweep")) : base(query, params));
    const result = await runHamiltonPublish({ runId: 150, db: asPublishDb(db) });
    expect(result.results[0].reason).toBe("Older document than the live price");
    expect(result.results[0].evidenceDeferred).toBeUndefined();
    expect(result.publishedFees).toBe(0);
  });

  it("preserves historical shared-read fallbacks without inventing a duplicate or coexistence witness", async () => {
    const listed = createDbMock([]);
    unavailableTaggedRead(listed, "SELECT source_document_id, fee_name, amount");
    expect(await selectListedFeeLines(asPublishDb(listed), [77])).toEqual([]);
    await expect(selectListedFeeLines(asPublishDb(listed), [77], { required: true }))
      .rejects.toThrow("Publication evidence unavailable: listed_fee_lines");
    const prior = createDbMock([], [priorPublishedFee]);
    unavailableTaggedRead(prior, "ORDER BY fp.published_at DESC");
    expect(await sameLineDuplicateOf(asPublishDb(prior), verifiedFee, 1201)).toBeNull();
  });

  it("bounds availability receipt samples while retaining the total affected count", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ ...verifiedFee, fee_verified_id: 900 + i, institution_id: 50 + i }));
    const db = createDbMock(rows);
    unavailableTaggedRead(db, "ORDER BY fp.published_at DESC");
    const result = await runHamiltonPublish({ runId: 146, db: asPublishDb(db) });
    expect(result.evidenceDeferredFees).toBe(25);
    expect(result.evidenceCheck?.unavailableByCheck).toEqual({ live_prior: 25 });
    expect(result.evidenceCheck?.samples).toHaveLength(20);
    expect(result.publishedFees).toBe(0);
  });

  it("preserves a proved identical outcome despite an unrelated failed batch sweep", async () => {
    const db = createDbMock([verifiedFee], [{ ...priorPublishedFee, amount: "35.00" }]);
    const base = db.unsafe.getMockImplementation()!;
    db.unsafe.mockImplementation((query: string, params: unknown[]) =>
      query.includes("consumer_fee_id") ? Promise.reject(new Error("timeout")) : base(query, params));
    const result = await runHamiltonPublish({ runId: 141, db: asPublishDb(db) });
    expect(result.results[0]).toMatchObject({ status: "skipped", reason: "Identical fee already published" });
    expect(result.evidenceDeferredFees).toBe(0);
    expect(result.evidenceCheck).toMatchObject({ readState: "unavailable", deferred: 0 });
  });

  it("keeps a known sweep refusal when another required check is unavailable", async () => {
    const db = createDbMock([verifiedFee], [], undefined, [], sweepFixture);
    unavailableTaggedRead(db, "lower(btrim(fp.fee_name))");
    const result = await runHamiltonPublish({ runId: 142, db: asPublishDb(db) });
    expect(result.results[0].reason).toContain("Refused at publish, a sweep would take it down");
    expect(result.evidenceDeferredFees).toBe(0);
    expect(result.publishedFees).toBe(0);
    expect(result.evidenceCheck).toMatchObject({ readState: "unavailable", deferred: 0 });
  });

  it("keeps disabled refusal reads diagnostic and does not activate their policy", async () => {
    const db = createDbMock([verifiedFee]);
    unavailableTaggedRead(db, "lower(btrim(fp.fee_name))");
    const base = db.unsafe.getMockImplementation()!;
    db.unsafe.mockImplementation((query: string, params: unknown[]) =>
      query.includes("consumer_fee_id") ? Promise.reject(new Error("timeout")) : base(query, params));
    const result = await runHamiltonPublish({ runId: 143, db: asPublishDb(db), refuseDuplicatesLive: false, refuseSweepRulesLive: false });
    expect(result.publishedFees).toBe(1);
    expect(result.evidenceDeferredFees).toBe(0);
    expect(result.evidenceCheck).toMatchObject({ readState: "unavailable", deferred: 0 });
  });

  it("still publishes independent rows whose own evidence is available", async () => {
    const db = createDbMock([verifiedFee, { ...verifiedFee, fee_verified_id: 802, institution_id: 43 }]);
    const base = db.getMockImplementation()!;
    db.mockImplementation((strings: TemplateStringsArray, ...params: unknown[]) =>
      templateText(strings).includes("lower(btrim(fp.fee_name))") && params[0] === 42
        ? Promise.reject(new Error("one row only")) : base(strings, ...params));
    const result = await runHamiltonPublish({ runId: 144, db: asPublishDb(db) });
    expect(result.publishedFees).toBe(1);
    expect(result.evidenceDeferredFees).toBe(1);
    expect(result.results.find((r) => r.feeVerifiedId === 801)?.evidenceDeferred).toBe(true);
    expect(result.results.find((r) => r.feeVerifiedId === 802)?.status).toBe("published");
  });

  it("files each row under one sweep: another bank's host first, then an unconfirmed host, then a business schedule", () => {
    const refusals = publishSweepRefusals(
      [
        { fee_verified_id: 1, document_host: "otherbank.example", names_own_bank: false },
        { fee_verified_id: 2, document_host: "sister.example", names_own_bank: "true" },
      ],
      [
        { fee_verified_id: 1, document_host: "otherbank.example", names_own_bank: false },
        { fee_verified_id: 3, document_host: "cdnless.example", names_own_bank: null },
      ],
      [
        { fee_verified_id: 3, consumer_fee_id: 9001 },
        { fee_verified_id: 4, consumer_fee_id: "9002" },
        { fee_verified_id: 5, consumer_fee_id: null },
      ],
    );
    expect(Object.fromEntries(refusals)).toEqual({
      1: { rule: "other_bank_document", sweepReason: "other_bank_document: otherbank.example" },
      3: { rule: "unconfirmed_document_host", sweepReason: "unconfirmed_document_host: cdnless.example" },
      4: { rule: "business_schedule", sweepReason: "business_schedule: consumer fee #9002" },
    });
    expect(PUBLISH_REFUSE_SWEEP_RULES_LIVE).toBe(true);
  });

  it("refuses a row whose pair Darwin judged another bank's document, after the three sweeps", async () => {
    const refusals = publishSweepRefusals(
      [{ fee_verified_id: 1, document_host: "otherbank.example", names_own_bank: false }],
      [],
      [],
      [
        { fee_verified_id: 1, named_other_id: 77 },
        { fee_verified_id: 2, named_other_id: "4521" },
        { fee_verified_id: 3, named_other_id: null },
      ],
    );
    expect(Object.fromEntries(refusals)).toEqual({
      1: { rule: "other_bank_document", sweepReason: "other_bank_document: otherbank.example" },
      2: { rule: "document_owner", sweepReason: "document_owner: names institution 4521" },
    });

    const db = createDbMock([verifiedFee], [], undefined, [], { owner: [{ fee_verified_id: 801, named_other_id: 4521 }] });
    const result = await runHamiltonPublish({ runId: 136, refuseSweepRulesLive: true, db: asPublishDb(db) });
    expect(result.publishedFees).toBe(0);
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: "Refused at publish, a sweep would take it down: document_owner: names institution 4521",
    });
    expect(result.sweepCheck).toMatchObject({ byRule: { document_owner: 1 }, refused: 1 });
  });

  it("refuses a fee read from a loan or brokerage document that Darwin's non-deposit re-check would take down", () => {
    const loanFee = {
      ...verifiedFee,
      canonical_fee_key: "late_payment",
      fee_name: "Late Payment Fee",
      document_url: "https://www.example-bank.com/docs/home-equity-line-of-credit-disclosure.pdf",
    };
    const reason = publishSkipReason(loanFee, 0.85, true);
    expect(reason).toMatch(/^Refused at publish, Darwin's re-check would take it down: /);
    expect(publishSkipReason({ ...verifiedFee, document_url: "https://www.example-bank.com/docs/fee-schedule.pdf" }, 0.85, true) ?? "").not.toMatch(
      /Darwin's re-check/,
    );
  });

  it("skips rows below the publish confidence threshold", async () => {
    const db = createDbMock([
      {
        ...verifiedFee,
        extraction_confidence: "0.7100",
      },
    ]);

    const result = await runHamiltonPublish({
      runId: 103,
      db: asPublishDb(db),
    });

    expect(result).toMatchObject({
      selectedVerifiedFees: 1,
      processedVerifiedFees: 1,
      publishedFees: 0,
      skippedFees: 1,
    });
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: "Below publish confidence threshold",
    });
    expect(writes(db)).toEqual([]);
  });

  it("skips rows with blocking review flags", async () => {
    const db = createDbMock([
      {
        ...verifiedFee,
        outlier_flags: ["agentic_darwin_verified", "needs_human"],
      },
    ]);

    const result = await runHamiltonPublish({
      runId: 104,
      db: asPublishDb(db),
    });

    expect(result.publishedFees).toBe(0);
    expect(result.skippedFees).toBe(1);
    expect(result.results[0].reason).toBe("Blocking flag: needs_human");
    expect(writes(db)).toEqual([]);
  });

  it("filters publish candidates by state lane", async () => {
    const db = createDbMock([]);

    await runHamiltonPublish({
      runId: 105,
      stateCode: "CA",
      db: asPublishDb(db),
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("JOIN institution_sources inst ON inst.id = fv.institution_id");
    expect(unsafeSql).toContain("upper(btrim(inst.state_code))");
  });

  it("counts each institution's fees once, in one grouped read scoped like the selection", async () => {
    const db = createDbMock([]);
    await runHamiltonPublish({ runId: 120, stateCode: "CA", limit: 10, db: asPublishDb(db) });

    const selects = db.unsafe.mock.calls.filter((call) => String(call[0]).includes("WITH deep AS MATERIALIZED"));
    expect(selects).toHaveLength(2);
    const [state, national] = selects.map((call) => String(call[0]));
    // Correlated per verified row, the count ran 164k times in the national fill (17 Oct 2026).
    for (const text of [state, national]) {
      expect(text).toContain("GROUP BY depth.institution_id");
      expect(text).toContain("AND fv.institution_id IN (SELECT deep.institution_id FROM deep)");
      expect(text).not.toContain("WHERE fp.institution_id = fv.institution_id");
    }
    expect(state).toContain("AND fp.institution_id IN (SELECT scope.id FROM institution_sources scope");
    expect(state).toContain("AND pv.institution_id IN (SELECT scope.id FROM institution_sources scope");
    expect(national).not.toContain("institution_sources scope");
  });

  it("fills a state lane's short publish batch with the oldest eligible rows from any state", async () => {
    const other = { ...verifiedFee, fee_verified_id: 802, fee_raw_id: 702, institution_id: 43 };
    const db = createDbMock([]);
    db.unsafe = vi.fn((query: string, params: unknown[]) => {
      if (query.includes("institution_fee_depth")) return Promise.resolve(deepInstitutionRows([verifiedFee, other]));
      if (!query.includes("FROM verified_fee_observations")) return Promise.resolve([]);
      // The lane's own state has one row; the fill (no state param) finds another.
      return Promise.resolve(params.includes("CA") ? [verifiedFee] : [verifiedFee, other]);
    });

    const result = await runHamiltonPublish({ runId: 118, stateCode: "CA", limit: 10, db: asPublishDb(db) });

    const selects = db.unsafe.mock.calls.filter((call) => String(call[0]).includes(" eligible AS ("));
    expect(selects).toHaveLength(2);
    expect(selects[0][1]).toContain("CA");
    expect(selects[1][1]).not.toContain("CA");
    expect(selects[1][1][0]).toBe(9); // limit minus the lane's own row
    expect(result.results.map((entry) => entry.feeVerifiedId).sort()).toEqual([801, 802]);
  });

  it("keeps a single bank's read scoped to that bank", async () => {
    const db = createDbMock([]);
    await runHamiltonPublish({ runId: 119, stateCode: "CA", institutionId: 42, db: asPublishDb(db) });
    const selects = db.unsafe.mock.calls.filter((call) => String(call[0]).includes(" eligible AS ("));
    expect(selects).toHaveLength(1);
  });

  it("closes the prior live row and records the change when an amount moves", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee]);

    const result = await runHamiltonPublish({ runId: 108, db: asPublishDb(db) });

    expect(result).toMatchObject({ publishedFees: 1, supersededFees: 1 });
    expect(result.results[0]).toMatchObject({
      feePublishedId: 1201,
      supersededFeePublishedId: 601,
      changeRecorded: true,
    });

    const update = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"));
    expect(templateText(update?.[0])).toContain("rolled_back_at = NOW()");
    expect(templateText(update?.[0])).toContain("rolled_back_at IS NULL");
    expect(update?.slice(1)).toEqual(expect.arrayContaining(["agentic-run-108", "superseded by #1201", 601]));

    const change = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO fee_change_records"));
    expect(change?.slice(1)).toEqual(expect.arrayContaining([42, "overdraft", 30, 35, "increase"]));
  });

  it("records a price change when each copy of the page lists the fee at one price", async () => {
    // Shape taken from prod rows (MFCU 7383, 9 Oct). The real live 54570 at $5 was a misread:
    // both copies state $10 for the non-member cashier's check and $5 for on-us check cashing
    // on the next line, so MFCU did not raise this price. Kept as the price-change case.
    const newer = {
      ...verifiedFee,
      fee_verified_id: 81480,
      institution_id: 7383,
      canonical_fee_key: "cashiers_check",
      fee_name: "Non-Member Cashier's Check Fee",
      amount: "10.00",
      source_url: "https://www.mfcu.net/Fees",
      document_url: "https://www.mfcu.net/Fees",
      source_document_id: 16105,
      document_crawled_at: "2026-10-05T19:30:49.176Z",
    };
    const live = {
      fee_published_id: 54570,
      amount: "5.00",
      fee_name: "Non-Member Cashier's Check Fee",
      published_at: "2026-10-06T00:45:47.296Z",
      source_url: "https://www.mfcu.net/Fees",
      document_url: "https://www.mfcu.net/Fees",
      source_document_id: 2253,
      document_crawled_at: "2026-02-17T09:37:03.000Z",
    };
    const lines = [
      { source_document_id: 2253, fee_name: "Non-Member Cashier's Check Fee", amount: "5.00" },
      { source_document_id: 16105, fee_name: "Non-Member Cashier's Check Fee", amount: "10.00" },
    ];
    expect(listsBothPrices(lines, newer, live)).toBe(false);

    const db = createDbMock([newer], [live]);
    const result = await runHamiltonPublish({ runId: 120, db: asPublishDb(db) });

    expect(result.results[0]).toMatchObject({ supersededFeePublishedId: 54570, changeRecorded: true });
    const change = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO fee_change_records"));
    expect(change?.slice(1)).toEqual(expect.arrayContaining([7383, "cashiers_check", 5, 10, "increase", 54570, true]));
  });

  it("publishes a second price from the same document as its own fee line", async () => {
    const sameDocumentPrior = { ...priorPublishedFee, fee_name: "Stop payment (ACH)", source_document_id: 77 };
    const db = createDbMock([{ ...verifiedFee, source_document_id: 77 }], [sameDocumentPrior]);

    const result = await runHamiltonPublish({ runId: 111, db: asPublishDb(db) });

    expect(result).toMatchObject({ publishedFees: 1, supersededFees: 0 });
    expect(result.results[0]).toMatchObject({
      status: "published",
      supersededFeePublishedId: null,
      movementDirection: null,
      changeRecorded: false,
    });
    const text = writes(db).join("\n");
    expect(text).not.toContain("UPDATE published_fee_records");
    expect(text).not.toContain("INSERT INTO fee_change_records");
  });

  it("runs insert and supersede inside a savepoint when given a transaction", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee]);
    const savepoint = vi.fn((work: (scope: unknown) => Promise<unknown>) => work(db));
    Object.assign(db, { savepoint });

    await runHamiltonPublish({ runId: 109, db: asPublishDb(db) });

    // Prior-row read, insert + supersede, change record, and each signal.
    expect(savepoint.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("reports the supersede in a dry run without writing", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee]);

    const result = await runHamiltonPublish({ runId: 110, dryRun: true, db: asPublishDb(db) });

    expect(result.results[0]).toMatchObject({
      status: "published",
      feePublishedId: null,
      supersededFeePublishedId: 601,
      movementDirection: "increase",
    });
    expect(writes(db)).toEqual([]);
  });

  it("publishes a free fee Darwin verified as $0", async () => {
    const db = createDbMock([
      { ...verifiedFee, canonical_fee_key: "paper_statement", fee_name: "Paper Statement", amount: "0.00", outlier_flags: ["agentic_darwin_verified", "zero_fee"] },
    ]);

    const result = await runHamiltonPublish({ runId: 111, db: asPublishDb(db) });

    expect(result).toMatchObject({ publishedFees: 1, zeroFeesPublished: 1 });
  });

  it("does not publish $0 without the free-fee flag, or an amount outside its category's range", async () => {
    const db = createDbMock([
      { ...verifiedFee, amount: "0.00" },
      { ...verifiedFee, fee_verified_id: 802, amount: "350.00" },
    ]);

    const result = await runHamiltonPublish({ runId: 112, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(0);
    expect(result.results.map((row) => row.reason)).toEqual([
      "Missing or invalid amount",
      "Amount outside the category's plausible range",
    ]);
  });

  it("records Darwin's verification event as the publish handshake id", async () => {
    const db = createDbMock([verifiedFee]);

    await runHamiltonPublish({ runId: 113, db: asPublishDb(db) });

    const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO published_fee_records"));
    // Darwin's event id lands in both verified_by_agent_event_id and the handshake column.
    const values = insert?.slice(1) ?? [];
    expect(values.filter((value) => value === verifiedFee.verified_by_agent_event_id)).toHaveLength(2);
  });

  describe("institution fee minimum", () => {
    const pendingRow = (fee_verified_id: number, canonical_fee_key: string, extra: Record<string, unknown> = {}) => ({
      ...verifiedFee,
      fee_verified_id,
      canonical_fee_key,
      depth_source: "pending",
      ...extra,
    });

    it("holds every row for an institution with fewer than three fees", async () => {
      const db = createDbMock([verifiedFee], [], [pendingRow(801, "overdraft"), pendingRow(802, "nsf")]);

      const result = await runHamiltonPublish({ runId: 601, db: asPublishDb(db) });

      expect(result).toMatchObject({
        selectedVerifiedFees: 1,
        processedVerifiedFees: 0,
        publishedFees: 0,
        heldFees: 1,
        minInstitutionFees: 3,
        heldInstitutions: [{ institutionId: 42, feeCount: 2, heldRows: 1 }],
      });
      expect(writes(db)).toEqual([]);
      const selectSql = String(db.unsafe.mock.calls[0][0]);
      expect(selectSql).toContain("COUNT(DISTINCT depth.canonical_fee_key)");
      // Whole source documents move together.
      expect(selectSql).toContain("AS batch_document_key");
      expect(selectSql).toContain("WHERE rows_before < $1");
    });

    it("counts pending rows outside the batch, but not ones a publish rule would skip", async () => {
      const deep = [
        { depth_source: "published", institution_id: 42, canonical_fee_key: "monthly_maintenance" },
        pendingRow(801, "overdraft"),
        pendingRow(802, "nsf"),
      ];
      const published = await runHamiltonPublish({ runId: 602, db: asPublishDb(createDbMock([verifiedFee], [], deep)) });
      expect(published).toMatchObject({ publishedFees: 1, heldFees: 0 });

      const shallow = [...deep.slice(1), pendingRow(803, "monthly_maintenance", { extraction_confidence: "0.4" })];
      const held = await runHamiltonPublish({ runId: 603, db: asPublishDb(createDbMock([verifiedFee], [], shallow)) });
      expect(held).toMatchObject({ publishedFees: 0, heldInstitutions: [{ feeCount: 2 }] });
    });

    it("publishes single fees when the minimum is set to one", async () => {
      const db = createDbMock([verifiedFee], [], []);

      const result = await runHamiltonPublish({ runId: 604, minInstitutionFees: 1, db: asPublishDb(db) });

      expect(result).toMatchObject({ publishedFees: 1, heldFees: 0, minInstitutionFees: 1 });
      expect(db.unsafe.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain("institution_fee_depth");
    });
  });

  describe("with the learning core", () => {
    function learningDb(
      rows: Array<Record<string, unknown>>,
      prior: Array<Record<string, unknown>> = [],
      depthRows?: Array<Record<string, unknown>>,
    ): DbMock {
      const db = createDbMock(rows, prior, depthRows);
      const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
      db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        if (templateText(strings).includes("learning_schema_ready")) {
          return Promise.resolve([{ learning_schema_ready: true }]);
        }
        return base(strings, ...values);
      });
      return db;
    }

    function attemptValues(db: DbMock): unknown[][] {
      return db.mock.calls
        .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
        .map((call) => call.slice(1));
    }

    it("logs each decision so skipped rows are never selected again", async () => {
      const db = learningDb([
        verifiedFee,
        { ...verifiedFee, fee_verified_id: 803, extraction_confidence: "0.5" },
      ]);

      const result = await runHamiltonPublish({ runId: 501, stepId: 7, db: asPublishDb(db) });

      expect(result).toMatchObject({ learning: true, outcomes: { ok: 1, rejected: 1 } });
      // The two rows share a collapse line, so the step may decide them in either order (#1069).
      const attempts = attemptValues(db);
      const attemptFor = (fingerprint: string) => attempts.find((values) => values.includes(fingerprint));
      expect(attempts).toHaveLength(2);
      expect(attemptFor("verified:801")).toEqual(expect.arrayContaining([42, "publish", HAMILTON_PUBLISH_STRATEGY.strategy, "verified:801", "ok", 501, 7]));
      expect(attemptFor("verified:803")).toEqual(expect.arrayContaining(["publish", "verified:803", "rejected"]));

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("FROM pipeline_attempts pa");
      expect(query).toContain("'verified:' || fv.fee_verified_id::text");
      expect(query).toContain("pa.detail->>'same_line_check' IS NULL");
      expect(JSON.stringify(db.mock.calls)).toContain("same_line_check");
      expect(params).toEqual(expect.arrayContaining([HAMILTON_PUBLISH_STRATEGY.strategy, HAMILTON_PUBLISH_STRATEGY.version]));
    });

    it("counts the 3 fees as the catalog does: live and not quarantined, plus rows not yet decided (#1072)", async () => {
      const db = learningDb([verifiedFee]);

      await runHamiltonPublish({ runId: 505, db: asPublishDb(db) });

      const depthCall = db.unsafe.mock.calls.find((call) => String(call[0]).includes("institution_fee_depth")) as [string, unknown[]];
      const [query, params] = depthCall;
      // Live means what the view means.
      expect(query).toContain("fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL");
      // A pending row this rule version already rejected, or published and saw taken down, no
      // longer counts: the same filter the selection uses.
      expect(query).toContain("JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id");
      expect(query).toContain("FROM pipeline_attempts pa");
      expect(query).toContain("'verified:' || fv.fee_verified_id::text");
      expect(params).toEqual(expect.arrayContaining([HAMILTON_PUBLISH_STRATEGY.strategy, HAMILTON_PUBLISH_STRATEGY.version]));
      const select = String(db.unsafe.mock.calls[0][0]);
      expect(select).toContain("AND fp.quarantined_at IS NULL");
    });

    it("lets a row Darwin re-filed after a takedown publish again under its new category", async () => {
      const db = learningDb([verifiedFee]);

      await runHamiltonPublish({ runId: 504, db: asPublishDb(db) });

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("pa.detail->>'canonical_fee_key' IS DISTINCT FROM fv.canonical_fee_key");
      expect(params).toContain("darwin_schedule_refiled");
      // A guard rejection recorded before the guard re-queue step passed the row does not count.
      expect(query).toContain("pa.detail->>'reason' LIKE 'Category guard%'");
      expect(query).toContain("flag LIKE 'category_guard_requeued:%'");
    });

    it("selects again a row skipped as identical to a live fee the rules re-check took down", async () => {
      const db = learningDb([verifiedFee]);

      await runHamiltonPublish({ runId: 505, db: asPublishDb(db) });

      const [query] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("pa.outcome = 'unchanged'");
      expect(query).toContain("NULLIF(pa.detail->>'previous_fee_published_id', '')::bigint");
      expect(query).toContain("prev.rolled_back_reason = 'rules_recheck_unreproduced'");
    });

    it("selects again a row skipped as identical to a live fee the article-page check took down (#1774)", async () => {
      const db = learningDb([verifiedFee]);

      await runHamiltonPublish({ runId: 506, db: asPublishDb(db) });

      const [query] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain(ARTICLE_PAGE_RESELECT_SQL);
      expect(query).toContain("art_prev.rolled_back_reason LIKE 'article_page:%'");
    });

    it("does not log held rows, so they publish once the institution has enough fees", async () => {
      const db = learningDb([verifiedFee], [], [{ ...verifiedFee, depth_source: "pending" }]);

      const result = await runHamiltonPublish({ runId: 503, db: asPublishDb(db) });

      expect(result).toMatchObject({ heldFees: 1, outcomes: {} });
      expect(attemptValues(db)).toEqual([]);
    });

    it("logs an identical re-verified row as unchanged", async () => {
      const db = learningDb([verifiedFee], [{ ...priorPublishedFee, amount: "35.00" }]);

      const result = await runHamiltonPublish({ runId: 502, db: asPublishDb(db) });

      expect(result.outcomes).toEqual({ unchanged: 1 });
    });
  });
});

describe("decidePriorFee", () => {
  const row = { ...verifiedFee };
  const live = (overrides: Record<string, unknown>) => ({ ...priorPublishedFee, ...overrides });

  it("treats a fee with no live row as new", () => {
    expect(decidePriorFee(row, [])).toEqual({ kind: "new" });
  });

  it("skips an amount already live on any line", () => {
    const match = live({ fee_published_id: 602, amount: "35.00" });
    expect(decidePriorFee(row, [live({ source_document_id: 77 }), match])).toEqual({ kind: "identical", prior: match });
  });

  it("publishes a second line of the same document at the same price under another name (Wildfire 8019, 9 Oct)", () => {
    const inquiry = { ...row, fee_verified_id: 8019, canonical_fee_key: "atm_non_network", amount: "5.00", fee_name: "ATM Balance Inquiry (at non-Wildfire ATM) ........................." };
    const adjustment = live({ fee_published_id: 14754, amount: "5.00", source_document_id: 77, fee_name: "ATM Adjustment ......................................" });
    expect(decidePriorFee(inquiry, [adjustment], (prior) => prior === adjustment)).toEqual({ kind: "additional_line" });
    // Without the page check saying the two lines sit apart, the price alone still decides.
    expect(decidePriorFee(inquiry, [adjustment])).toEqual({ kind: "identical", prior: adjustment });
    // Another read of the same line, or the same price from another document, is still identical.
    const reread = live({ fee_published_id: 14755, amount: "5.00", source_document_id: 77, fee_name: "ATM Balance Inquiry" });
    expect(decidePriorFee(inquiry, [reread])).toEqual({ kind: "identical", prior: reread });
    const elsewhere = live({ fee_published_id: 14756, amount: "5.00", source_document_id: 12, fee_name: "Foreign ATM fee" });
    expect(decidePriorFee(inquiry, [elsewhere])).toEqual({ kind: "identical", prior: elsewhere });
  });

  it("tells same-priced lines of one document apart only by their names (20-row source spot check, 9 Oct)", () => {
    const pair = (rowName: string, priorName: string) =>
      separateLines({ ...row, fee_name: rowName }, live({ source_document_id: 77, fee_name: priorName }));
    // Separate lines.
    expect(pair("ACH OD Fee", "Courtesy Pay Fee")).toBe(true);
    expect(pair("ACH Origination Item — Debit", "ACH Origination Item — Credit ………………")).toBe(true);
    expect(pair("Monthly service charge (if daily balance falls below $1,000 minimum)", "Monthly service charge – Prestige Checking")).toBe(true);
    // One fee, named twice.
    expect(pair("Check Copies", "Check Copy")).toBe(false);
    expect(pair("Money Orders", "per Money Order")).toBe(false);
    expect(pair("Legal | Legal Document Processing", "Legal Process")).toBe(false);
    expect(pair("Mailed Statement Fee (Business and Public Value $3.00)", "Consumer Additional Mailed Statement Fee")).toBe(false);
    expect(pair("Overdraft Protection Plans designed to avoid the above fees are available either by linking to another deposit account o", "Overdraft Protection Sweep Fee")).toBe(false);
    expect(pair("RUSH DELIVERY (2-3 BUSINESS: MONEY ORDER", "MONEY ORDER")).toBe(false);
    expect(pair("Paid NSF Item < $30 (Courtesy Pay)", "(Courtesy Pay)")).toBe(false);
    expect(pair("The cost to purchase a prepaid travel card is", "Acadia Prepaid Travel Card")).toBe(false);
    expect(pair("There is a Replacement Card Fee", "ATM/Debit Card Replacement Fee")).toBe(false);
    expect(pair("Monthly Maintenance Charge", "/month{{d832 }} with an average daily balance of or more per monthly service charge cycle")).toBe(false);
    expect(pair("Transfers: Photocopy of Documents, per copy", "SCHEDULE OF FEES AND SERVICES 1-855-TERRABK www.terrabank.com SERVICE FEE Photocopy of Doc")).toBe(false);
    // A cut-off sentence is not set aside, so these two stay one line (as before the check).
    expect(pair("per mailed statement", "Paper Statement Fee")).toBe(false);
    expect(pair("Check Cashing Fee- Members (Only applies to members who do not have $100 in any combination of accounts or a loan with a", "Check Cashing Fee- Third Party")).toBe(false);
    // Still separate.
    expect(pair("ATM/ITM Inquiries (per instance; FREE at Service 1 FCU & Co-Op Network machines)", "ATM/ITM Transfers (per instance; FREE at Service 1 FCU & Co-Op Network machines)")).toBe(true);
  });

  it("finds both lines apart on the page, each with the price (fresh 20-row source spot checks, 9 Oct)", () => {
    const page = "ATM FEES ATM Balance Inquiry (at non-Wildfire ATM) ........ $5.00 ATM Adjustment ........ $5.00 Wire Transfer Outgoing $25";
    expect(linesApartOnPage(page, "ATM Balance Inquiry (at non-Wildfire ATM) ......", "ATM Adjustment ......", "5.00")).toBe(true);
    // A name not on the current copy of the page.
    expect(linesApartOnPage(page, "ATM Balance Inquiry", "Foreign ATM fee", "5.00")).toBe(false);
    // The price does not follow one of the names.
    expect(linesApartOnPage(page, "ATM Adjustment", "Wire Transfer Outgoing", "5.00")).toBe(false);
    // A sentence about the table line ("charge of $25") is the same fee read twice.
    const nsf = "Insufficient Funds Fee $25.00 per item. A nonsufficient funds (NSF) charge of $25.00 applies to each item.";
    expect(linesApartOnPage(nsf, "Insufficient Funds Fee", "A nonsufficient funds (NSF) charge", "25")).toBe(false);
    // One name inside the other line ("Inactive Checking" in "Inactive Checking3").
    const inactive = "Inactive Checking3 $5.00 per month";
    expect(linesApartOnPage(inactive, "Inactive Checking3", "Inactive Checking", "5")).toBe(false);
    // Cents must match.
    expect(linesApartOnPage("Check Copy $2.50 Stop Payment $2.00", "Check Copy", "Stop Payment", "2.50")).toBe(false);
  });

  // #1314 dry run (prod pages, read-only, Oct 15): a pass needs a place of one name clear of every
  // place of the other, and a price that is not another field's value.
  it("needs the shorter name printed at the price clear of every place of the longer (#1314)", () => {
    // 125157: the plain line is printed on its own as well as inside the ACH line: two fees.
    const two = "Check Orders | $10.00-$35.00 | Varies Stop Payment | $35.00 | Per item Overdraft (NSF) Fee | $30.00 ACH Stop Payment | $35.00 | Per item";
    expect(linesApartOnPage(two, "Stop Payment", "ACH Stop Payment", "35")).toBe(true);
    expect(linesApartOnPage(two, "ACH Stop Payment", "Stop Payment", "35")).toBe(true);
    // 105388: one line printed twice is one fee, however its places pair up.
    const twice = "● Less than Minimum Balance Fee $10.00/year ... LESS THAN MINIMUM BALANCE FEE $10.00/year";
    expect(linesApartOnPage(twice, "Minimum Balance Fee", "Less than Minimum Balance Fee", "10")).toBe(false);
    // 127609: the shorter name only ever sits inside the longer lines.
    const inside = "Non-Sufficient Funds (NSF) | $25.00 Bill Payment Non-Sufficient\nFunds (NSF) | $25.00";
    expect(linesApartOnPage(inside, "Funds (NSF)", "Non-Sufficient Funds (NSF)", "25")).toBe(false);
    // 105072: "Order" is only the end of a "Money Order" heading and unit, so one $2 line.
    const heading = "Release of Account Hold\n\n/Occurrence\n\n$5.00\n\n(negative)\n\nMoney Order\n\n/Money Order\n\n$2.00\n\nNon-Automated Phone Account Inquiry";
    expect(linesApartOnPage(heading, "Order", "Money Order", "2")).toBe(false);
    expect(linesApartOnPage(heading, "Money Order", "Order", "2")).toBe(false);
  });

  it("never reads another field's value as the price (133183, #1314)", () => {
    const page = "See Demo Simply Elite Monthly Fee $10 Initial Deposit $1,000 Simply Student Monthly Fee: $0 Initial Deposit: $10 "
      + "Simply More Money Market Monthly Fee $25 Initial Deposit $10,000";
    expect(linesApartOnPage(page, "Simply Elite Monthly Fee", "Monthly Fee", "10")).toBe(false);
    // "$10,000" is not $10.
    expect(linesApartOnPage("Daily Wire Limit $10,000 Outgoing Wire Fee $25 Incoming Wire Fee $10", "Daily Wire Limit", "Incoming Wire Fee", "10")).toBe(false);
  });

  it("puts a name with a qualifier word in front to the page check (doc 17371, #1303)", () => {
    const pair = (rowName: string, priorName: string) =>
      qualifiedLines({ ...row, fee_name: rowName }, live({ source_document_id: 77, fee_name: priorName }));
    expect(pair("ACH Stop Payment", "Stop Payment")).toBe(true);
    expect(pair("Insufficient Funds", "ACH Insufficient Funds")).toBe(true);
    // A carried-in heading, a filler word or a number qualifies nothing.
    expect(pair("Debit Cards: Stop Payment", "Stop Payment")).toBe(false);
    expect(pair("Wire Transfers - Outgoing: Outgoing Wire Fee", "Outgoing Wire Fee")).toBe(false);
    expect(pair("An Overdraft Transfer", "Overdraft Transfer")).toBe(false);
    expect(pair("00 Official check", "Official check")).toBe(false);
    expect(pair("RUSH DELIVERY (2-3 BUSINESS: MONEY ORDER", "MONEY ORDER")).toBe(false);
    // The page check then decides: a second printed line, or one line read twice.
    expect(linesApartOnPage("Stop Payment | $35.00\nACH Stop Payment | $35.00", "ACH Stop Payment", "Stop Payment", "35")).toBe(true);
    expect(linesApartOnPage("Wire | $10.00\nACH Stop Payment | $35.00", "ACH Stop Payment", "Stop Payment", "35")).toBe(false);
  });

  it("reads box sizes, footnote marks and two-price tables as lines (CBB and source spot checks, 9 Oct)", () => {
    const pair = (rowName: string, priorName: string) =>
      separateLines({ ...row, fee_name: rowName }, live({ source_document_id: 77, fee_name: priorName }));
    // Box sizes are lines of their own, not the same "x" line.
    expect(pair("5 x 10", "6 x 10")).toBe(true);
    expect(pair("3 x 5", "SAFE DEPOSIT BOX: 2.5 x 10")).toBe(true);
    expect(pair("3x5 box", "Safe Deposit Box Fee - 3x5")).toBe(false);
    // A cut-off sentence ("GUASFCU charges a") says nothing about which line it is.
    expect(pair("Inactivity Fees: N/A Draft Photocopy", "GUASFCU charges a")).toBe(false);
    const boxes = [
      "SAFE DEPOSIT BOX BOX SIZES | FORMER FEES | NEW FEES",
      "2.5 x 10 | $45.00 per year | $70.00 per year",
      "5 x 10 | $150.00 per year | $110.00 per year",
      "6 x 10 | $200.00 per year | $110.00 per year",
    ].join("\n");
    // "5 x 10" also sits inside "2.5 x 10"; the new-fee column follows the former one.
    expect(linesApartOnPage(boxes, "5 x 10", "6 x 10", "110.00")).toBe(true);
    expect(linesApartOnPage(boxes, "5 x 10", "6 x 10", "120.00")).toBe(false);
    // A box of another size the page does not print is another line; one printed without
    // this price is a price-first table, where the price after a name is the next line's.
    expect(linesApartOnPage("3 x 5 | $50.00 per year | $45.00 per year", "3 x 5", "SAFE DEPOSIT BOX: 2.5 x 10", "45")).toBe(true);
    const priceFirst = "$ 25.00 Safe Deposit Box 3x5/per year* $ 35.00 Safe Deposit Box 5x5/per year* $ 40.00 Safe Deposit Box 3x10/per year*";
    expect(linesApartOnPage(priceFirst, "Safe Deposit Box 3x5/per year", "Safe Deposit Box 5x5/per year", "35")).toBe(false);
    // A footnote mark glued to the name ("fee2") is still the name.
    const od = "Insufficient funds fee - paid2 ........ $30.00/each\nPremium overdraft fee2……...$30.00/each";
    expect(linesApartOnPage(od, "Premium overdraft fee", "Insufficient funds fee - paid", "30")).toBe(true);
    // Another document's line repeats this one only when one name reads as the other.
    expect(namesShareReading("Wire Transfers - Outgoing: Outgoing Wire Fee", "Outgoing Wire Fee")).toBe(true);
    expect(namesShareReading("Return Mail/ Bad Address", "Excessive Transaction Fee")).toBe(false);
    expect(namesShareReading("Service Charge", "Service Charge Assessed Each Month Balance Falls Below Minimum")).toBe(true);
    // A live line that names a balance is another fee when this row names another balance, or,
    // from another document, when this row's page never prints that balance (SCCU, 9 Oct).
    const moneyMarket = live({ source_document_id: 13776, fee_name: "Money Market Savings Account (below $2,500)" });
    const lowBalance = { ...row, source_document_id: 23995, fee_name: "Monthly Low Balance Fee" };
    expect(otherBalanceLine(lowBalance, moneyMarket, "Minimum Daily Balance | $1,500 Monthly Low Balance Fee | $15/mo")).toBe(true);
    expect(otherBalanceLine(lowBalance, moneyMarket, "Money Market below $2,500 Monthly Low Balance Fee | $15/mo")).toBe(false);
    expect(otherBalanceLine(lowBalance, moneyMarket, null)).toBe(false);
    expect(otherBalanceLine({ ...row, fee_name: "Minimum Balance Fee (if Balance is Below $7,500)" }, live({ fee_name: "Minimum Balance Fee (if Balance is Below $1,000)" }), null)).toBe(true);
    expect(otherBalanceLine({ ...row, fee_name: "Minimum Balance Fee (average below $1000)" }, live({ fee_name: "Minimum Balance Fee (average below $1,000)" }), null)).toBe(false);
    // A box size never takes a following digit as its footnote ("3 x 5" is not "3 x 50").
    expect(linesApartOnPage("3 x 50 $20.00 4 x 5 $20.00", "3 x 5", "4 x 5", "20")).toBe(false);
  });

  it("keeps lines from the same document side by side", () => {
    expect(decidePriorFee(row, [live({ source_document_id: 77 })])).toEqual({ kind: "additional_line" });
  });

  it("replaces the same-named line from an older document", () => {
    const other = live({ fee_published_id: 603, fee_name: "Overdraft - business" });
    const named = live({ fee_published_id: 604, fee_name: "Overdraft Fee ......" });
    expect(decidePriorFee(row, [other, named])).toEqual({ kind: "supersede", prior: named });
  });

  it("replaces a line published under an older untidy name (table cells, list markers)", () => {
    const untidy = live({ fee_published_id: 611, fee_name: "Per Item | b. Overdraft Fee" });
    expect(decidePriorFee(row, [untidy])).toEqual({ kind: "supersede", prior: untidy });
  });

  it("adds a differently named line from a newer document instead of calling it a change", () => {
    const other = live({ fee_published_id: 605, fee_name: "Returned item" });
    expect(decidePriorFee(row, [other])).toEqual({ kind: "additional_line" });
  });

  it("never lets an older document replace a newer live price", () => {
    const newer = live({ fee_published_id: 606, document_crawled_at: "2026-10-04T00:00:00.000Z" });
    expect(decidePriorFee(row, [newer])).toEqual({ kind: "older_document", prior: newer });
  });

  it("keeps each companion page's line: one account's page never replaces or outdates another's", () => {
    const freedom = { ...row, fee_name: "Monthly service fee", document_stream: "41" };
    const value = live({ fee_published_id: 607, fee_name: "Monthly service fee", document_stream: "42" });
    const valueNewer = live({ fee_published_id: 608, fee_name: "Monthly service fee", document_stream: "42", document_crawled_at: "2026-10-04T00:00:00.000Z" });
    expect(decidePriorFee(freedom, [value])).toEqual({ kind: "additional_line" });
    expect(decidePriorFee(freedom, [valueNewer])).toEqual({ kind: "additional_line" });
    // Nor does a companion page touch the main fee link's line, or the other way round.
    expect(decidePriorFee(freedom, [live({ fee_published_id: 609, fee_name: "Monthly service fee" })])).toEqual({ kind: "additional_line" });
    expect(decidePriorFee({ ...row, fee_name: "Monthly service fee" }, [value])).toEqual({ kind: "additional_line" });
  });

  it("still replaces the same page's older line", () => {
    const freedom = { ...row, document_stream: "41" };
    const earlier = live({ fee_published_id: 610, document_stream: "41" });
    expect(decidePriorFee(freedom, [earlier])).toEqual({ kind: "supersede", prior: earlier });
  });

  it("never lets one schedule replace or outdate another schedule's price (Tidemark, Opportunity Bank)", () => {
    const consumer = {
      ...row,
      fee_name: "Cashier’s Check",
      amount: "5.00",
      document_url: "https://www.tidemarkfcu.org/wp-content/uploads/2026/05/Truth-in-Savings-Disclosure-2026.05.05.pdf",
    };
    const business = live({
      fee_published_id: 612,
      fee_name: "Cashier’s Check",
      amount: "8.00",
      document_url: "https://www.tidemarkfcu.org/wp-content/uploads/2025/10/Business Rate and Fee Schedule 2025.10.30.pdf",
    });
    expect(decidePriorFee(consumer, [business])).toEqual({ kind: "additional_line" });
    const newerBusiness = { ...business, document_crawled_at: "2026-10-04T00:00:00.000Z" };
    expect(decidePriorFee(consumer, [newerBusiness])).toEqual({ kind: "additional_line" });
    // A line whose page is unknown is never replaced either.
    expect(decidePriorFee(row, [live({ source_url: null })])).toEqual({ kind: "additional_line" });
  });

  it("replaces the line from an older dated copy of the same schedule", () => {
    const current = { ...row, document_url: "https://nhfcu.org/wp-content/uploads/2026/07/NHFCU.Fee_.Schedule.-08.15.2026-final.pdf" };
    const older = live({ fee_published_id: 613, document_url: "https://nhfcu.org/wp-content/uploads/2024/08/NHFCU.Fee_.Schedule.Oct_.1.2024.pdf" });
    expect(decidePriorFee(current, [older])).toEqual({ kind: "supersede", prior: older });
  });

  it("does not record a change when either document's date is unknown", () => {
    expect(decidePriorFee({ ...row, document_crawled_at: null }, [live({})])).toEqual({ kind: "additional_line" });
    expect(decidePriorFee(row, [live({ document_crawled_at: null })])).toEqual({ kind: "additional_line" });
  });
});

describe("feePageKey", () => {
  it("treats dated copies and URL spellings of one page as the same page", () => {
    expect(feePageKey("https://www.ccuky.org/assets/files/DSnXlX1j/43405479_5-22-2025_savings_rate_and_fee_disclosure.pdf")).toBe(
      feePageKey("https://ccuky.org/assets/files/DSnXlX1j/r/43405479_10-1-2026_savings_rate_and_fee_disclosure.pdf"),
    );
    expect(feePageKey("http://www.cpfcu.com:443/Fees/")).toBe(feePageKey("https://cpfcu.com/fees"));
  });

  it("keeps business and consumer schedules apart", () => {
    expect(feePageKey("https://opportunitybank.com/content/files/BUSINESS-FEE-SCHEDULE.pdf")).not.toBe(
      feePageKey("https://opportunitybank.com/content/files/Consumer-Fee-Schedule.pdf"),
    );
    expect(feePageKey(null)).toBeNull();
    expect(feePageKey("not a url")).toBeNull();
  });
});

describe("listsBothPrices", () => {
  const prior = { ...priorPublishedFee, fee_name: verifiedFee.fee_name };
  const line = (source_document_id: unknown, amount: unknown, fee_name: string = verifiedFee.fee_name) =>
    ({ source_document_id, fee_name, amount }) as Parameters<typeof listsBothPrices>[0][number];

  it("is not a change when the newer page still lists the old price for the same name", () => {
    const lines = [line(verifiedFee.source_document_id, prior.amount)];
    expect(listsBothPrices(lines, verifiedFee, prior)).toBe(true);
  });

  it("is not a change when the older page already listed the new price for the same name", () => {
    const lines = [line(prior.source_document_id, verifiedFee.amount)];
    expect(listsBothPrices(lines, verifiedFee, prior)).toBe(true);
  });

  it("is a change when each page lists the name at one price", () => {
    const lines = [line(verifiedFee.source_document_id, verifiedFee.amount), line(prior.source_document_id, prior.amount)];
    expect(listsBothPrices(lines, verifiedFee, prior)).toBe(false);
  });
});

describe("publishedFeeName", () => {
  it("shows a cut-off or doubled name repaired, keeping the name the category rests on", () => {
    expect(publishedFeeName("Account Research Research", "account_research")).toBe("Account Research");
    expect(publishedFeeName("Early Account Closure (by Extraco – no", "early_closure")).toBe("Early Account Closure");
    expect(publishedFeeName(" Overdraft Fee", "overdraft")).toBe("Overdraft Fee");
    expect(publishedFeeName("Early Account Closure (by customer)", "early_closure")).toBe("Early Account Closure (by customer)");
  });

  it("drops a footnote number from a read made before the Knox tidy stripped it", () => {
    expect(publishedFeeName("ATM Inquiry1", "atm_non_network")).toBe("ATM Inquiry");
    expect(publishedFeeName("Safe Deposit Box 10x10", "safe_deposit_box")).toBe("Safe Deposit Box 10x10");
  });

  it("publishes the tidied name when only the untidied one fails the category guard", () => {
    expect(publishedFeeName("per order | Returned Items", "deposited_item_return")).toBe("Returned Items");
    expect(publishedFeeName("Return Item . . . . .", "deposited_item_return")).toBe("Return Item");
  });
});

describe("glued cells at publish (run 3467, 9 Oct)", () => {
  it("holds a name that would show only a condition", () => {
    expect(publishNameHold("(balance falls below $1,000) $15.00 Copy of Check $3.00 (in house)", "check_image", 15)?.code).toBe("condition_only_name");
    expect(publishNameHold("Service charge (daily balance falls below $500)", "minimum_balance", 5)).toBeNull();
  });

  it("drops another line's leading parenthetical cell and a box size's footnote number", () => {
    expect(publishedFeeName("(Members over Age 60 are exempt.): Statement Copy fee", "document_reproduction")).toBe("Statement Copy fee");
    // The rest must name the fee's own category: a rental late fee reads as late_payment, and a
    // bare "Wire Transfer Fee" names no category, so both keep the name for the retidy.
    expect(publishedFeeName("(Fee depends on style of check selected): Rental Late Fee (Past Due 30 Days)", "safe_deposit_box")).toBe("(Fee depends on style of check selected): Rental Late Fee (Past Due 30 Days)");
    expect(publishedFeeName("(after two years): Wire Transfer Fee", "garnishment_levy")).toBe("(after two years): Wire Transfer Fee");
    expect(publishedFeeName("3x10” 8", "safe_deposit_box")).toBe("3x10”");
    expect(publishedFeeName("17 x 11 3/8", "safe_deposit_box")).toBe("17 x 11 3/8");
    expect(publishedFeeName("(P3) An Inactivity Fee", "dormant_account")).toBe("(P3) An Inactivity Fee");
  });

  it("reads a balance line the newer copy still prints as current", () => {
    const row = { fee_name: "Minimum Balance Fee (if Balance is Below $7,500)", amount: "15.00" };
    expect(newerCopyPrintsLine(row, "Minimum Balance Fee (if Balance is Below $7,500):\n\n$15\n\nExcessive")).toBe(true);
    expect(newerCopyPrintsLine(row, "Minimum Balance Fee (if Balance is Below $7,500):\n\n$20\n\n")).toBe(false);
    expect(newerCopyPrintsLine(row, "Minimum Balance Fee (if Balance is Below $1,000):\n\n$15\n\n")).toBe(false);
    expect(newerCopyPrintsLine({ fee_name: "Stop Payment", amount: "15.00" }, "Stop Payment $15")).toBe(false);
  });
});

describe("publishedFeeName keeps a line's own condition (107240, 9 Oct)", () => {
  it("does not take a repair that drops the balance", () => {
    expect(publishedFeeName("Minimum Balance Fee (if Balance is Below $7,500)", "minimum_balance")).toBe("Minimum Balance Fee (if Balance is Below $7,500)");
  });
});

describe("one 3-fee count for publishing and the catalog view (#1072)", () => {
  /** The newest migration that defines `published_fee_catalog`, as Supabase applies them in order. */
  function latestCatalogView(): string {
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .filter((file) => /CREATE (?:OR REPLACE )?VIEW (?:public\.)?published_fee_catalog\b/i.test(readFileSync(join(dir, file), "utf8")));
    const text = readFileSync(join(dir, files[files.length - 1]), "utf8");
    const start = text.search(/CREATE (?:OR REPLACE )?VIEW (?:public\.)?published_fee_catalog\b/i);
    const end = text.indexOf(";", text.indexOf("HAVING", start));
    return text.slice(start, end);
  }

  it("uses the publish minimum and the same live test as Hamilton's count", () => {
    const view = latestCatalogView().replace(/\s+/g, " ");
    expect(view).toContain(`HAVING count(DISTINCT deep.canonical_fee_key) >= ${HAMILTON_PUBLISH_MIN_INSTITUTION_FEES}`);
    const depth = view.slice(view.indexOf("SELECT deep.institution_id"), view.indexOf("HAVING"));
    for (const clause of CATALOG_DEPTH_LIVE_SQL("deep").split(" AND ")) expect(depth).toContain(clause);
    // Any other condition on the view's count would split the two counts again.
    expect(depth.match(/deep\.\w+/g)?.filter((column) => !["deep.institution_id", "deep.rolled_back_at", "deep.quarantined_at"].includes(column))).toEqual([]);
  });
});
