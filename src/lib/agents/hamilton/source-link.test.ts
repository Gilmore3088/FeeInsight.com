import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import { publishSkipReason, type VerifiedFeeRow } from "./publish";
import {
  DRIFTED_LINK_FEES_SQL,
  fillSourceLinks,
  findResourceDocument,
  linkOpensOwnDocument,
  planLinkDrift,
  repairLinkDrift,
  SOURCE_LINK_DRIFT_LIVE,
  type DriftedLinkRow,
  NO_SOURCE_DOCUMENT_REASON,
  NO_SOURCE_LINK_REASON,
  planSourceLinkRepair,
  planSourceLinkResource,
  publishSourceLink,
  repairSourceLinks,
  resourceSourceLinks,
  SOURCE_LINK_FILL_ON,
  SOURCE_LINK_RESOURCE_ON,
  type InstitutionDocumentText,
  type ResourceCandidateRow,
  type UnlinkedLiveFeeRow,
} from "./source-link";

const verified: VerifiedFeeRow = {
  fee_verified_id: 1,
  fee_raw_id: 2,
  institution_id: 3,
  source_url: "https://bank.example/fees.pdf",
  document_r2_key: null,
  extraction_confidence: 0.95,
  canonical_fee_key: "nsf",
  variant_type: null,
  outlier_flags: ["agentic_darwin_verified"],
  verified_by_agent_event_id: "00000000-0000-0000-0000-000000000001",
  fee_name: "NSF Fee",
  amount: "30.00",
  frequency: null,
  raw_agent_event_id: null,
  source_document_id: 9,
  document_url: "https://bank.example/fees.pdf",
};

describe("publish refuses a fee it cannot link to the bank's document", () => {
  it("refuses a row with no document, or a stored file key and no link, and links from the document", () => {
    expect(publishSkipReason(verified, 0.85)).toBeNull();
    expect(publishSkipReason({ ...verified, source_document_id: null }, 0.85)).toBe(NO_SOURCE_DOCUMENT_REASON);
    expect(publishSkipReason({ ...verified, source_url: null, document_url: null, document_r2_key: "docs/9.pdf" }, 0.85)).toBe(NO_SOURCE_LINK_REASON);
    expect(publishSkipReason({ ...verified, source_url: null }, 0.85)).toBeNull();
    expect(publishSourceLink({ source_url: " ", document_url: "https://bank.example/fees.pdf" })).toBe("https://bank.example/fees.pdf");
    expect(publishSourceLink({ source_url: "fees.pdf", document_url: null })).toBeNull();
  });
});

const unlinked = (id: number, overrides: Partial<UnlinkedLiveFeeRow> = {}): UnlinkedLiveFeeRow => ({
  fee_published_id: id,
  fee_verified_id: id + 100,
  fee_raw_id: id + 200,
  institution_id: 3,
  canonical_fee_key: "nsf",
  amount: "30.00",
  source_document_id: 9,
  document_institution_id: 3,
  document_url: "https://bank.example/fees.pdf",
  document_r2_key: "docs/9.pdf",
  fee_r2_key: null,
  verified_blank: true,
  ...overrides,
});

const rows = [
  unlinked(1),
  unlinked(2, { fee_r2_key: "docs/9.pdf" }),
  unlinked(3, { source_document_id: null, document_institution_id: null, document_url: null, document_r2_key: null }),
  unlinked(4, { document_institution_id: 44 }),
  unlinked(5, { fee_r2_key: "docs/other.pdf" }),
];

function createDb() {
  const calls: string[] = [];
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("UPDATE published_fee_records")) {
      return Promise.resolve((values.find(Array.isArray) as number[]).map((id) => ({ fee_published_id: id })));
    }
    return Promise.resolve([]);
  });
  const unsafe = vi.fn((text: string) => {
    calls.push(text);
    return Promise.resolve(rows);
  });
  Object.assign(tag, { unsafe });
  return { db: tag as unknown as Parameters<typeof repairSourceLinks>[0], calls };
}

describe("source link repair", () => {
  it("fills from the fee's own document only when it is the institution's and the same file", () => {
    const plan = planSourceLinkRepair(rows);
    expect(plan.fills.map((fee) => [fee.feePublishedId, fee.url])).toEqual([
      [1, "https://bank.example/fees.pdf"],
      [2, "https://bank.example/fees.pdf"],
    ]);
    expect(plan.takedowns.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [3, "source_link_untraceable: no source document"],
      [4, "source_link_untraceable: source document belongs to another institution"],
      [5, "source_link_untraceable: stored file differs from the source document's"],
    ]);
  });

  it("writes nothing on a dry run, and on a live run writes each change with its rollback record", async () => {
    const dry = createDb();
    const preview = await repairSourceLinks(dry.db, { runId: 7, batchId: "agentic-run-7", dryRun: true });
    expect([preview.scanned, preview.fills.length, preview.takedowns.length]).toEqual([5, 2, 3]);
    expect(dry.calls.filter((text) => /UPDATE|INSERT/.test(text))).toEqual([]);

    const live = createDb();
    const result = await repairSourceLinks(live.db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect([result.fills.length, result.takedowns.length]).toEqual([2, 3]);
    const written = live.calls.join("\n");
    expect(written).toContain("SET source_url = v.url");
    expect(written).toContain("UPDATE verified_fee_observations");
    expect(written).toContain("rolled_back_reason = v.reason");
    expect(written).toContain("INSERT INTO pipeline_feedback");
    expect(written).toContain("'hamilton.source_link_repair'");
  });

  it("fails the step when the live write fails, instead of reporting 0 linked (#1349)", async () => {
    const live = createDb();
    const tag = live.db as unknown as ReturnType<typeof vi.fn>;
    const ok = tag.getMockImplementation()! as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    tag.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("UPDATE published_fee_records")
        ? Promise.reject(new Error("permission denied for table published_fee_records"))
        : ok(strings, ...values));
    await expect(repairSourceLinks(live.db, { runId: 7, batchId: "agentic-run-7", dryRun: false }))
      .rejects.toThrow(/source link repair write failed: permission denied for table published_fee_records/);
  });
});

describe("source link fill in every publish step (#1342 follow-up)", () => {
  it("is on, and on a dry run lists the fills and writes nothing", async () => {
    expect(SOURCE_LINK_FILL_ON).toBe(true);
    const dry = createDb();
    const preview = await fillSourceLinks(dry.db, { runId: 7, batchId: "agentic-run-7", dryRun: true });
    expect([preview.scanned, preview.fills.length, preview.untraceable]).toEqual([5, 2, 3]);
    expect(dry.calls.filter((text) => /UPDATE|INSERT/.test(text))).toEqual([]);
  });

  it("links each fee its own document can link, takes nothing down, and records each fill", async () => {
    const live = createDb();
    const result = await fillSourceLinks(live.db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect(result.fills.map((fee) => [fee.feePublishedId, fee.url])).toEqual([
      [1, "https://bank.example/fees.pdf"],
      [2, "https://bank.example/fees.pdf"],
    ]);
    expect(result.untraceable).toBe(3);
    const written = live.calls.join("\n");
    expect(written).toContain("SET source_url = v.url");
    expect(written).toContain("INSERT INTO pipeline_feedback");
    expect(written).toContain("'hamilton.source_link_fill'");
    // Never a takedown: an untraceable fee stays live for the repair or the re-source pass.
    expect(written).not.toContain("rolled_back_at = NOW()");
    expect(written).not.toContain("rolled_back_reason = v.reason");
  });

  it("keeps the publish step going when the write fails", async () => {
    const live = createDb();
    const tag = live.db as unknown as ReturnType<typeof vi.fn>;
    const ok = tag.getMockImplementation()! as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    tag.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("UPDATE published_fee_records")
        ? Promise.reject(new Error("permission denied for table published_fee_records"))
        : ok(strings, ...values));
    const result = await fillSourceLinks(live.db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect(result.fills).toEqual([]);
    expect(result.error).toMatch(/permission denied/);
  });
});

// #1342 re-source: the text of Alliance Niagara's schedule as stored (doc 17763), and another
// institution's page printing the same fee.
const STORED = "Fee Schedule\nStop Payment | $20.00\nReturned Deposit | $20.00\nCopy of Statement | $5.00";
const OTHER_BANK = "Fees\nStop Payment | $20.00";

const candidate = (id: number, overrides: Partial<ResourceCandidateRow> = {}): ResourceCandidateRow => ({
  fee_published_id: id,
  fee_verified_id: id + 100,
  fee_raw_id: id + 200,
  institution_id: 6288,
  canonical_fee_key: "stop_payment",
  fee_name: "Stop Payment",
  amount: "20.00",
  amount_kind: "flat",
  rate_percent: null,
  source: "migration_v10",
  source_document_id: null,
  fee_r2_key: null,
  document_institution_id: null,
  document_url: null,
  document_r2_key: null,
  taken_down: true,
  rolled_back_reason: "source_link_untraceable: no source document",
  verified_blank: true,
  raw_url_blank: true,
  taken_document_ids: [],
  same_fee_live: false,
  ...overrides,
});

const stored = (id: number, overrides: Partial<InstitutionDocumentText> = {}): InstitutionDocumentText => ({
  source_document_id: id,
  institution_id: 6288,
  document_url: "https://allianceniagara.com/fee-schedule/",
  document_r2_key: "93/935d",
  superseded: false,
  status: "completed",
  normalized_text: STORED,
  ...overrides,
});

describe("source link re-source (#1342)", () => {
  it("is on, so rollback is one line", () => {
    expect(SOURCE_LINK_RESOURCE_ON).toBe(true);
  });

  it("finds a completed document of the fee's own institution that prints the fee at its amount", () => {
    expect(findResourceDocument(candidate(5808), [stored(17763)])).toEqual({
      sourceDocumentId: 17763,
      url: "https://allianceniagara.com/fee-schedule/",
      sourceLine: "Stop Payment | $20.00",
    });
    // Newest document first.
    expect(findResourceDocument(candidate(5808), [stored(3635), stored(17763)])).toMatchObject({ sourceDocumentId: 17763 });
  });

  it("never matches another institution's document, another amount, or a document that is not completed", () => {
    expect(findResourceDocument(candidate(5808), [stored(40001, { institution_id: 999, normalized_text: OTHER_BANK })])).toEqual({ why: "no_stored_document" });
    expect(findResourceDocument(candidate(5808, { amount: "25.00" }), [stored(17763)])).toEqual({ why: "not_in_stored_documents:amount_not_the_fee" });
    for (const status of ["wrong_document", "failed", "pending"]) {
      expect(findResourceDocument(candidate(5808), [stored(17763, { status })])).toEqual({ why: "no_stored_document" });
    }
    expect(findResourceDocument(candidate(5808), [stored(17763, { superseded: true })])).toEqual({ why: "no_stored_document" });
    expect(findResourceDocument(candidate(5808), [stored(17763, { document_url: null })])).toEqual({ why: "no_stored_document" });
    expect(findResourceDocument(candidate(5808, { taken_document_ids: [17763] }), [stored(17763)])).toEqual({ why: "document_holds_same_name_import" });
    expect(findResourceDocument(candidate(5808, { source: "knox" }), [stored(17763)])).toEqual({ why: "knox_fee" });
    expect(findResourceDocument(candidate(5808, { fee_r2_key: "other/file" }), [stored(17763)])).toEqual({ why: "no_stored_document" });
  });

  it("restores a takedown, links a live fee with no traceable document, and leaves the repair's fills alone", () => {
    const plan = planSourceLinkResource(
      [
        candidate(5808),
        candidate(5810, { fee_name: "Returned Deposit", canonical_fee_key: "deposited_item_return" }),
        candidate(11764, { taken_down: false, rolled_back_reason: null, fee_name: "Copy of Statement", canonical_fee_key: "document_reproduction", amount: "5.00" }),
        // Its own document gives it a link: the repair's fill, not a re-source.
        candidate(7315, { taken_down: false, rolled_back_reason: null, source_document_id: 17763, document_institution_id: 6288, document_url: "https://allianceniagara.com/fee-schedule/" }),
        candidate(146, { fee_name: "Fax Services", canonical_fee_key: "document_reproduction", amount: "2.00" }),
        candidate(9001, { same_fee_live: true }),
        // Two fees of one name never take one document (the import's unique key).
        candidate(9002),
      ],
      [stored(17763)],
    );
    expect(plan.resources.map((fee) => [fee.feePublishedId, fee.restore, fee.sourceDocumentId])).toEqual([
      [5808, true, 17763],
      [5810, true, 17763],
      [11764, false, 17763],
    ]);
    expect(plan.misses.map((fee) => [fee.feePublishedId, fee.why])).toEqual([
      [146, "not_in_stored_documents:name_not_in_text"],
      [9001, "same_fee_live"],
      [9002, "document_holds_same_name_import"],
    ]);
  });

  it("writes nothing on a dry run; a live run moves the raw row, restores, queues the source check and records each change", async () => {
    const candidates = [candidate(5808), candidate(11764, { taken_down: false, rolled_back_reason: null, fee_name: "Copy of Statement", canonical_fee_key: "document_reproduction", amount: "5.00" })];
    const resourceDb = (failOn?: string) => {
      const calls: string[] = [];
      const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?");
        calls.push(text);
        if (failOn && text.includes(failOn)) return Promise.reject(new Error("permission denied"));
        if (text.includes("UPDATE raw_fee_observations")) {
          return Promise.resolve((values[0] as number[]).map((id) => ({ fee_raw_id: id })));
        }
        if (text.includes("UPDATE published_fee_records")) {
          return Promise.resolve((values[0] as number[]).map((id) => ({ fee_published_id: id, institution_id: 6288 })));
        }
        return Promise.resolve([]);
      });
      const unsafe = vi.fn((text: string) => {
        calls.push(text);
        return Promise.resolve(text.includes("taken_document_ids") ? candidates : [stored(17763)]);
      });
      Object.assign(tag, { unsafe });
      return { db: tag as unknown as Parameters<typeof resourceSourceLinks>[0], calls };
    };

    const dry = resourceDb();
    const preview = await resourceSourceLinks(dry.db, { runId: 7, batchId: "agentic-run-7", dryRun: true });
    expect(preview.resources.map((fee) => fee.feePublishedId)).toEqual([5808, 11764]);
    expect(dry.calls.filter((text) => /UPDATE|INSERT/.test(text))).toEqual([]);

    const live = resourceDb();
    const result = await resourceSourceLinks(live.db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect([result.linked, result.restored, result.error]).toEqual([1, 1, null]);
    const written = live.calls.join("\n");
    expect(written).toContain("UPDATE raw_fee_observations");
    expect(written).toContain("SET rolled_back_at = NULL");
    expect(written).toContain("INSERT INTO pipeline_attempts");
    expect(written).toContain("INSERT INTO pipeline_feedback");
    expect(written).toContain("'hamilton.source_link_resource'");

    // A failed write is reported, not thrown: the publish step carries on without the pass.
    const failing = resourceDb("UPDATE raw_fee_observations");
    const failed = await resourceSourceLinks(failing.db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect([failed.linked, failed.restored]).toEqual([0, 0]);
    expect(failed.error).toMatch(/source link re-source write failed: permission denied/);
  });
});

describe("link drift: a live link that opens another page than the fee's own document (#1347)", () => {
  // Live on prod (read-only, Oct 17): imported fees whose raw row was moved to another document
  // kept the old document's link.
  const drifted = (id: number, overrides: Partial<DriftedLinkRow> = {}): DriftedLinkRow => ({
    fee_published_id: id,
    lineage_ref: id + 100,
    fee_verified_id: id + 100,
    fee_raw_id: id + 200,
    institution_id: 8485,
    source: "migration_v10",
    source_document_id: 15882,
    canonical_fee_key: "check_image",
    fee_name: "Receipt Copy Fee",
    amount: "2.00",
    link: "https://firstcu.net/about/disclosures-and-agreements/",
    fp_url: "https://firstcu.net/about/disclosures-and-agreements/",
    fv_url: "https://firstcu.net/about/disclosures-and-agreements/",
    raw_url: "https://firstcu.net/about/disclosures-and-agreements/",
    document_institution_id: 8485,
    target_url: "https://firstcu.net/wp-content/uploads/2025/01/Service-Charges-FirstCU-1.2.2025.pdf",
    ...overrides,
  });
  const text = {
    source_document_id: 15882,
    normalized_text: "Receipt Copy............................... $2.00/Item\nStop Payment .............................................. $20.00/Occurrence",
  };
  const driftRows = [
    drifted(150),
    // Not in its own document's text at that price: a second look, never a re-point.
    drifted(151, { fee_name: "Stop Payment", canonical_fee_key: "stop_payment", amount: "35.00" }),
    drifted(152, { document_institution_id: 44 }),
  ];

  it("keeps a link to the page the document's text was read from, and to the same page written another way", () => {
    // A schedule PDF the stored landing page links to is the fee's real source.
    expect(linkOpensOwnDocument(
      "https://www.pncu.com/wp-content/uploads/2025/08/Fee-Schedule-7.2025.pdf",
      "https://www.pncu.com/fee-schedule/",
      "https://www.pncu.com/wp-content/uploads/2025/08/Fee-Schedule-7.2025.pdf",
    )).toBe(true);
    expect(linkOpensOwnDocument("https://www.foxvalleycu.com/pdf/fee-schedule.pdf", "https://www.foxvalleycu.com:443/pdf/fee-schedule.pdf", null)).toBe(true);
    expect(linkOpensOwnDocument(
      "https://www.pinnaclebank.com/wp-content/uploads/2026/01/Schedule-of-Fees-2026-1-1.pdf",
      "https://vallant.bank/wp-content/uploads/2026/01/Schedule-of-Fees-2026-1-1.pdf",
      "https://vallant.bank/wp-content/uploads/2026/01/Schedule-of-Fees-2026-1-1.pdf",
    )).toBe(false);
  });

  it("re-points a fee that traces in its own document, sends one that does not to the second look, skips another bank's document", () => {
    const plan = planLinkDrift(driftRows, [text]);
    expect(plan.repoints.map((fee) => [fee.feePublishedId, fee.to, fee.traced])).toEqual([
      [150, "https://firstcu.net/wp-content/uploads/2025/01/Service-Charges-FirstCU-1.2.2025.pdf", true],
    ]);
    expect(plan.failing.map((fee) => fee.feePublishedId)).toEqual([151]);
    expect(plan.failing[0].reason).toMatch(/^source_link_drift: not in own document #15882 \(/);
    expect(plan.skipped).toEqual([{ feePublishedId: 152, why: "document_of_another_institution" }]);
    expect(DRIFTED_LINK_FEES_SQL).toContain("AS target_url");
    expect(DRIFTED_LINK_FEES_SQL).toContain("LEFT JOIN agent_source_texts ast ON ast.source_document_id = sd.id");
  });

  const driftDb = (pending: Array<{ fee_published_id: number; kind: string; evidence: Record<string, unknown> }> = []) => {
    const calls: string[] = [];
    const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sqlText = strings.join("?");
      calls.push(sqlText);
      if (sqlText.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (sqlText.includes("FROM pipeline_feedback")) return Promise.resolve(pending);
      if (sqlText.includes("UPDATE published_fee_records")) {
        return Promise.resolve((values.find(Array.isArray) as number[]).map((id) => ({ fee_published_id: id })));
      }
      return Promise.resolve([]);
    });
    const unsafe = vi.fn((sqlText: string) => {
      calls.push(sqlText);
      return Promise.resolve(sqlText.includes("AS target_url") ? driftRows : [text]);
    });
    Object.assign(tag, { unsafe });
    return { db: tag as unknown as Parameters<typeof repairLinkDrift>[0], calls };
  };

  it("is live; a dry run writes nothing; a live run re-points every tier and archives only on the second look", async () => {
    expect(SOURCE_LINK_DRIFT_LIVE).toBe(true);
    const dry = driftDb();
    const preview = await repairLinkDrift(dry.db, { runId: 7, batchId: "agentic-run-7", dryRun: true });
    expect([preview.scanned, preview.repoints.length, preview.flagged, preview.archived.length]).toEqual([3, 1, 1, 0]);
    expect(dry.calls.filter((sqlText) => /UPDATE|INSERT/.test(sqlText))).toEqual([]);

    const first = driftDb();
    const firstLook = await repairLinkDrift(first.db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect([firstLook.repoints.length, firstLook.flagged, firstLook.archived.length, firstLook.error]).toEqual([1, 1, 0, null]);
    const written = first.calls.join("\n");
    expect(written).toContain("UPDATE verified_fee_observations fv");
    expect(written).toContain("UPDATE raw_fee_observations fr");
    expect(written).not.toContain("rolled_back_reason = v.reason");
    expect(written).toContain("'hamilton.source_link_drift'");

    // Flagged 13 hours earlier by another run: archived, never deleted.
    const flaggedAt = new Date(Date.now() - 13 * 60 * 60_000).toISOString();
    const second = driftDb([{ fee_published_id: 151, kind: "takedown_pending", evidence: { flag_run_id: 6, flagged_at: flaggedAt, reason: "x" } }]);
    const secondLook = await repairLinkDrift(second.db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect(secondLook.archived.map((fee) => fee.feePublishedId)).toEqual([151]);
    const archivedSql = second.calls.join("\n");
    expect(archivedSql).toContain("rolled_back_reason = v.reason");
    expect(archivedSql).not.toMatch(/DELETE FROM/);
  });
});
