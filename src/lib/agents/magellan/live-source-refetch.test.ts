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
  LIVE_SOURCE_UNREACHABLE_TRIES,
  liveLandingKey,
  livePageKey,
  liveSourceAnswer,
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

describe("livePageKey and liveSourceAnswer", () => {
  it("keys a page like the SQL does", () => {
    expect(livePageKey("https://www.Tyndall.org:443/Fee-Schedule/")).toBe("tyndall.org/fee-schedule");
    expect(livePageKey("http://tyndall.org/fee-schedule")).toBe("tyndall.org/fee-schedule");
    expect(livePageKey(null)).toBeNull();
    expect(livePageKey("  ")).toBeNull();
  });

  it("tells an answer from the page, a redirect elsewhere and a failure apart", () => {
    const page = "tyndall.org/learn/documents/fee-schedule";
    expect(liveSourceAnswer("ok", "https://www.tyndall.org/learn/documents/fee-schedule/", page)).toBe("answered");
    expect(liveSourceAnswer("unchanged", null, page)).toBe("answered");
    expect(liveSourceAnswer("ok", "https://www.tyndall.org/fee-schedule", page)).toBe("moved");
    expect(liveSourceAnswer("http_404", "https://www.tyndall.org/learn/documents/fee-schedule", page)).toBe("failed");
  });

  it("compares a landing without the fragment and with %20 read as a space", () => {
    expect(liveLandingKey("customersbank.com/consumer-disclosures/#fee-schedule")).toBe("customersbank.com/consumer-disclosures");
    expect(liveLandingKey("bank.com/docs/fee schedule.pdf")).toBe("bank.com/docs/fee schedule.pdf");
    expect(liveLandingKey("bank.com/docs/fee%20schedule.pdf")).toBe("bank.com/docs/fee schedule.pdf");
    // The fetch's final URL drops the fragment and percent-encodes spaces: still the page answering.
    expect(liveSourceAnswer("ok", "https://www.customersbank.com/consumer-disclosures/", "customersbank.com/consumer-disclosures/#fee-schedule")).toBe("answered");
    expect(liveSourceAnswer("unchanged", "https://bank.com/docs/Fee%20Schedule.pdf", "bank.com/docs/fee schedule.pdf")).toBe("answered");
  });

  it("counts a same-site redirect to another path or query as moved", () => {
    expect(liveSourceAnswer("ok", "https://www.tyndall.org/learn/documents/fees", "tyndall.org/learn/documents/fee-schedule")).toBe("moved");
    expect(liveSourceAnswer("ok", "https://www.educationfirstfcu.org/policies-disclosures/fee-schedule", "educationfirstfcu.org/policies-disclosures/fee-schedule?hslang=en")).toBe("moved");
  });

  it("counts a redirect that still serves the cited bytes as an answer", () => {
    expect(liveSourceAnswer("unchanged", "https://www.tyndall.org/fee-schedule", "tyndall.org/learn/documents/fee-schedule", true)).toBe("answered");
    expect(liveSourceAnswer("http_404", null, "tyndall.org/learn/documents/fee-schedule", true)).toBe("failed");
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

  it("counts an answer only when it came from the page, and takes the remembered address once the plain fetch missed it", async () => {
    const db = dbAnswering([]);
    await selectStaleLiveSources(db, 5);
    const text = templateText(db.mock.calls[0][0]);
    expect(text).toContain("AS last_answered");
    expect(text).toContain("WHEN tried.last_answered THEN");
    expect(text).toContain("btrim(ok.detail->>'url')");
    expect(text).toContain("AND NOT (failed.outcome IN ('ok', 'unchanged')");
    // Only after the plain fetch had an answer (a failed plain fetch moves last_crawl_at only).
    expect(text).toContain("inst.last_success_at > newest.copy_at + INTERVAL '1 hour'");
    expect(text).not.toContain("inst.last_crawl_at > newest.copy_at");
    // Landings compared without the fragment, %20 read as a space; a match of the cited bytes answers.
    expect(text).toContain("regexp_replace(replace(regexp_replace(pages.page, '#.*$', ''), '%20', ' '), '/+$', '') AS page");
    expect(text).toContain("'#.*$', ''), '%20', ' '), '/+$', ''), landing.page) = landing.page");
    expect(text).toContain("failed.detail->'live_document_ids' @> jsonb_build_array(failed.source_document_id)");
    expect(text).toContain("ok.detail->'live_document_ids' @> jsonb_build_array(ok.source_document_id)");
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

  // Tyndall FCU (prod, Oct 20): its cited page redirected to /fee-schedule; the copy was stored
  // under that address and the cited document stayed "checked Feb 17".
  const tyndall = { ...partnerColorado, id: 5559, fee_schedule_url: "https://www.tyndall.org/learn/documents/fee-schedule", page: "tyndall.org/learn/documents/fee-schedule", live_fees: 5, document_ids: ["2096"] };

  it("counts a redirect elsewhere as moved, not as the page answering", async () => {
    fetchAndRecordLinkMock.mockResolvedValueOnce({ result: { outcome: "success", attemptOutcome: "ok", contentHash: "other", finalUrl: "https://www.tyndall.org/fee-schedule" }, sourceDocumentId: 50001, supersededCopies: 0 });
    const result = await runLiveSourceRefetch({ db: dbAnswering([tyndall], []), fetchImpl: vi.fn(), runId: 9 });
    expect(result).toMatchObject({ stored: 1, moved: 1, unreachable: [] });
  });

  it("reports a page after three tries in a row that did not answer, a redirect counting", async () => {
    fetchAndRecordLinkMock.mockResolvedValueOnce({ result: { outcome: "unchanged", attemptOutcome: "unchanged", contentHash: "other", finalUrl: "https://www.tyndall.org/fee-schedule" }, sourceDocumentId: 50001, supersededCopies: 0 });
    const result = await runLiveSourceRefetch({ db: dbAnswering([{ ...tyndall, failures: LIVE_SOURCE_UNREACHABLE_TRIES - 1 }], []), fetchImpl: vi.fn(), runId: 9 });
    expect(result.unreachable).toEqual([{
      institutionId: 5559, url: tyndall.fee_schedule_url, landedUrl: "https://www.tyndall.org/fee-schedule",
      lastOutcome: "moved", tries: LIVE_SOURCE_UNREACHABLE_TRIES, liveFees: 5, documentIds: [2096],
    }]);
  });

  it("reports a gone page after three failed tries, and not before", async () => {
    const gone = { result: { outcome: "failed", attemptOutcome: "http_404", contentHash: null }, sourceDocumentId: null, supersededCopies: 0 };
    fetchAndRecordLinkMock.mockResolvedValueOnce(gone).mockResolvedValueOnce(gone);
    const early = await runLiveSourceRefetch({ db: dbAnswering([{ ...partnerColorado, failures: 1 }]), fetchImpl: vi.fn(), runId: 9 });
    expect(early.unreachable).toEqual([]);
    const late = await runLiveSourceRefetch({ db: dbAnswering([{ ...partnerColorado, failures: 2 }]), fetchImpl: vi.fn(), runId: 9 });
    expect(late.unreachable).toMatchObject([{ institutionId: 7515, lastOutcome: "http_404", tries: 3, landedUrl: null, liveFees: 29 }]);
  });

  it("does not read a fragment page's fragment-less landing as moved", async () => {
    const customers = { ...partnerColorado, id: 1, fee_schedule_url: "https://www.customersbank.com/consumer-disclosures/#fee-schedule", page: "customersbank.com/consumer-disclosures/#fee-schedule", failures: 5 };
    fetchAndRecordLinkMock.mockResolvedValueOnce({ result: { outcome: "success", attemptOutcome: "ok", contentHash: "new", finalUrl: "https://www.customersbank.com/consumer-disclosures/" }, sourceDocumentId: 60001, supersededCopies: 0 });
    const result = await runLiveSourceRefetch({ db: dbAnswering([customers], []), fetchImpl: vi.fn(), runId: 9 });
    expect(result).toMatchObject({ moved: 0, unreachable: [] });
  });

  it("does not report a moved page whose bytes still match the cited document", async () => {
    fetchAndRecordLinkMock.mockResolvedValueOnce({ result: { outcome: "unchanged", attemptOutcome: "unchanged", contentHash: "same", finalUrl: "https://www.tyndall.org/fee-schedule" }, sourceDocumentId: 2096, supersededCopies: 0 });
    const result = await runLiveSourceRefetch({ db: dbAnswering([{ ...tyndall, failures: 5 }], [{ id: 2096 }]), fetchImpl: vi.fn(), runId: 9 });
    expect(result.results[0].confirmed).toBe(1);
    expect(result).toMatchObject({ moved: 0, unreachable: [] });
  });

  it("only reports the pages it would fetch while the switch is off", async () => {
    const result = await runLiveSourceRefetch({ db: dbAnswering([partnerColorado]), fetchImpl: vi.fn(), runId: 9, live: false });
    expect(result).toMatchObject({ live: false, selected: 1, tried: 0 });
    expect(result.wouldFetch).toEqual([{ institutionId: 7515, url: partnerColorado.fee_schedule_url, liveFees: 29, newestCopyAt: "2026-02-17T00:00:00.000Z" }]);
    expect(fetchAndRecordLinkMock).not.toHaveBeenCalled();
  });
});
