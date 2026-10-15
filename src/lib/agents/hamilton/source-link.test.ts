import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import { publishSkipReason, type VerifiedFeeRow } from "./publish";
import {
  NO_SOURCE_DOCUMENT_REASON,
  NO_SOURCE_LINK_REASON,
  planSourceLinkRepair,
  publishSourceLink,
  repairSourceLinks,
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
});
