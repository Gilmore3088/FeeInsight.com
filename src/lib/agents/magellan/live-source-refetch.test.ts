import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAndRecordLinkMock } = vi.hoisted(() => ({ fetchAndRecordLinkMock: vi.fn() }));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));
vi.mock("@/lib/agents/learning/attempts", () => ({ learningSchemaReady: vi.fn(async () => true), recordAttempt: vi.fn() }));
vi.mock("@/lib/agents/document-vault", () => ({
  documentVaultSchemaReady: vi.fn(async () => true),
  getDocumentVault: vi.fn(() => ({ configured: true })),
}));
vi.mock("./fetch", async () => {
  const actual = await vi.importActual<typeof import("./fetch")>("./fetch");
  return { ...actual, fetchAndRecordLink: fetchAndRecordLinkMock };
});

import {
  LIVE_SOURCE_REFETCH_DAYS,
  LIVE_SOURCE_REFETCH_LIVE,
  LIVE_SOURCE_REFETCH_STRATEGY,
  LIVE_SOURCE_RETRY_DAYS,
  liveSourceRetryDays,
  runLiveSourceRefetch,
  selectStaleLiveSources,
} from "./live-source-refetch";

type Db = Parameters<typeof runLiveSourceRefetch>[0]["db"];

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// Partner Colorado CU (#1200): 29 live fees from its fee PDF, stored Feb 17; one 403 in April and
// the PDF was never asked for again while the bank's remembered address moved to another page.
const partnerColorado = {
  id: 7515,
  institution_name: "Partner Colorado Federal Credit Union",
  fee_schedule_url: "https://www.partnercoloradocu.org/getmedia/2f5ee068/Fee-Schedule.pdf",
  asset_size: "1000",
  last_crawl_at: "2026-10-19T05:40:00Z",
  consecutive_failures: 0,
  page: "partnercoloradocu.org/getmedia/2f5ee068/fee-schedule.pdf",
  live_fees: 29,
  document_ids: ["2336"],
  newest_copy_at: "2026-02-17T00:00:00Z",
  failures: null,
};

/** A db that answers the selection with `rows` and every later query with `later`. */
function dbAnswering(rows: unknown[], later: unknown[] = []) {
  let calls = 0;
  return vi.fn(async () => (calls++ === 0 ? rows : later)) as unknown as Db & ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  fetchAndRecordLinkMock.mockReset();
});

describe("liveSourceRetryDays", () => {
  it("waits longer after each failure in a row and never gives up", () => {
    expect(liveSourceRetryDays("http_403", 1)).toBe(LIVE_SOURCE_RETRY_DAYS[0]);
    expect(liveSourceRetryDays("http_403", 2)).toBe(LIVE_SOURCE_RETRY_DAYS[1]);
    expect(liveSourceRetryDays("timeout", 3)).toBe(LIVE_SOURCE_RETRY_DAYS[2]);
    expect(liveSourceRetryDays("http_404", 40)).toBe(LIVE_SOURCE_RETRY_DAYS[3]);
    expect(liveSourceRetryDays("ok", 0)).toBe(LIVE_SOURCE_REFETCH_DAYS);
    expect(liveSourceRetryDays("unchanged", 0)).toBe(LIVE_SOURCE_REFETCH_DAYS);
  });
});

describe("selectStaleLiveSources", () => {
  it("asks for live-fee pages no fetch has stored lately, past their retry wait, oldest first", async () => {
    const db = dbAnswering([partnerColorado]);
    expect(await selectStaleLiveSources(db, 5)).toEqual([partnerColorado]);
    const text = templateText(db.mock.calls[0][0]);
    expect(text).toContain("fp.rolled_back_at IS NULL");
    expect(text).toContain("doc.companion_source_id IS NULL");
    expect(text).toContain("profile.locked_by_correction IS NOT TRUE");
    // Not the address the plain fetch asks for.
    expect(text).toContain("COALESCE(profile.canonical_source_url, inst.fee_schedule_url, '')");
    expect(text).toContain("ORDER BY newest.copy_at ASC NULLS FIRST");
    const values = db.mock.calls[0].slice(1);
    expect(values).toContain(LIVE_SOURCE_REFETCH_STRATEGY.strategy);
    expect(values).toContain(LIVE_SOURCE_REFETCH_DAYS);
  });

  it("asks for nothing with no room", async () => {
    const db = dbAnswering([partnerColorado]);
    expect(await selectStaleLiveSources(db, 0)).toEqual([]);
    expect(db).not.toHaveBeenCalled();
  });
});

describe("runLiveSourceRefetch", () => {
  it("is on", () => {
    expect(LIVE_SOURCE_REFETCH_LIVE).toBe(true);
  });

  it("fetches the page as a side copy under its own address, keyed for its retry wait", async () => {
    fetchAndRecordLinkMock.mockResolvedValueOnce({ result: { outcome: "success", attemptOutcome: "ok", contentHash: "new" }, sourceDocumentId: 40001, supersededCopies: 1 });
    const db = dbAnswering([partnerColorado], []);
    const result = await runLiveSourceRefetch({ db, fetchImpl: vi.fn(), runId: 9 });
    expect(result).toMatchObject({ live: true, selected: 1, tried: 1, stored: 1, matched: 0, failed: 0 });
    expect(result.results[0]).toMatchObject({ institutionId: 7515, liveFees: 29, sourceDocumentId: 40001, confirmed: 0 });
    const [, row, , ctx] = fetchAndRecordLinkMock.mock.calls[0];
    expect(row).toMatchObject({ id: 7515, fee_schedule_url: partnerColorado.fee_schedule_url, profile_canonical_source_url: null, profile_last_source_hash: null });
    expect(ctx).toMatchObject({
      keepRemembered: true,
      dryRun: false,
      learning: true,
      strategy: LIVE_SOURCE_REFETCH_STRATEGY,
      detail: { live_page: partnerColorado.page, live_document_ids: [2336] },
    });
  });

  it("moves the cited document's check date when the bank still serves the same bytes", async () => {
    fetchAndRecordLinkMock.mockResolvedValueOnce({ result: { outcome: "unchanged", attemptOutcome: "unchanged", contentHash: "same" }, sourceDocumentId: 2336, supersededCopies: 0 });
    const db = dbAnswering([partnerColorado], [{ id: 2336 }]);
    const result = await runLiveSourceRefetch({ db, fetchImpl: vi.fn(), runId: 9 });
    expect(result).toMatchObject({ matched: 1, stored: 0 });
    expect(result.results[0].confirmed).toBe(1);
    const update = templateText(db.mock.calls[1][0]);
    expect(update).toContain("SET last_checked_at = NOW()");
    expect(update).toContain("content_hash =");
    expect(db.mock.calls[1].slice(1)).toEqual([[2336], "same"]);
  });

  it("counts a failure and touches no document", async () => {
    fetchAndRecordLinkMock.mockResolvedValueOnce({ result: { outcome: "failed", attemptOutcome: "http_403", contentHash: null }, sourceDocumentId: null, supersededCopies: 0 });
    const db = dbAnswering([partnerColorado]);
    const result = await runLiveSourceRefetch({ db, fetchImpl: vi.fn(), runId: 9 });
    expect(result).toMatchObject({ failed: 1, stored: 0 });
    expect(result.results[0]).toMatchObject({ outcome: "http_403", confirmed: 0 });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("starts no fetch past its deadline", async () => {
    const result = await runLiveSourceRefetch({ db: dbAnswering([partnerColorado]), fetchImpl: vi.fn(), runId: 9, deadline: Date.now() - 1 });
    expect(result).toMatchObject({ selected: 1, tried: 0 });
    expect(fetchAndRecordLinkMock).not.toHaveBeenCalled();
  });

  it("only reports the pages it would fetch while the switch is off", async () => {
    const result = await runLiveSourceRefetch({ db: dbAnswering([partnerColorado]), fetchImpl: vi.fn(), runId: 9, live: false });
    expect(result).toMatchObject({ live: false, selected: 1, tried: 0 });
    expect(result.wouldFetch).toEqual([{ institutionId: 7515, url: partnerColorado.fee_schedule_url, liveFees: 29, newestCopyAt: "2026-02-17T00:00:00.000Z" }]);
    expect(fetchAndRecordLinkMock).not.toHaveBeenCalled();
  });
});
