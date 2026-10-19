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

import { SAVED_LINK_FETCH_STRATEGY, runSavedLinkFetch, savedLinkDiffers, selectUnfetchedSavedLinks } from "./saved-link-fetch";

type Db = Parameters<typeof runSavedLinkFetch>[0]["db"];

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// Texas Capital before #1883 (Oct 18): the saved link was the new PDF, the profile remembered the old page.
const texasCapital = {
  id: 69,
  institution_name: "Texas Capital Bank",
  fee_schedule_url: "https://texascapitalbank.com/sites/default/files/documents/Disclosures/Personal-Banking-Fee-Schedule.pdf",
  asset_size: "1000",
  last_crawl_at: "2026-10-18T05:40:00Z",
  consecutive_failures: 0,
  profile_canonical_source_url: "https://texascapitalbank.com/personal-banking/services-fees",
  has_live_fees: true,
};

function dbReturning(rows: unknown[]) {
  return vi.fn(async () => rows) as unknown as Db & ReturnType<typeof vi.fn>;
}

beforeEach(() => fetchAndRecordLinkMock.mockReset());

describe("savedLinkDiffers", () => {
  it("is true only when the saved link is another page than the remembered address", () => {
    expect(savedLinkDiffers(texasCapital)).toBe(true);
    // Spellings of one page: print view, www, scheme, trailing slash.
    expect(savedLinkDiffers({ fee_schedule_url: "https://bank.com/fees", profile_canonical_source_url: "http://www.bank.com/fees/?print=1" })).toBe(false);
    expect(savedLinkDiffers({ fee_schedule_url: "https://bank.com/fees", profile_canonical_source_url: null })).toBe(false);
    expect(savedLinkDiffers({ fee_schedule_url: null, profile_canonical_source_url: "https://bank.com/fees" })).toBe(false);
    expect(savedLinkDiffers({ fee_schedule_url: "not a link", profile_canonical_source_url: "https://bank.com/fees" })).toBe(false);
  });
});

describe("selectUnfetchedSavedLinks", () => {
  it("asks only for unlocked, never-fetched saved links and drops spellings of the remembered page", async () => {
    const printView = { ...texasCapital, id: 70, fee_schedule_url: "https://texascapitalbank.com/personal-banking/services-fees?print=1" };
    const db = dbReturning([texasCapital, printView]);
    const rows = await selectUnfetchedSavedLinks(db, 5);
    expect(rows.map((row) => row.id)).toEqual([69]);
    const text = templateText(db.mock.calls[0][0]);
    expect(text).toContain("profile.locked_by_correction IS NOT TRUE");
    expect(text).toContain("FROM source_documents doc");
    expect(text).toContain("doc.status = 'success'");
    expect(text).toContain("tried.outcome IN ('ok', 'unchanged')");
    expect(db.mock.calls[0].slice(1)).toContain(SAVED_LINK_FETCH_STRATEGY.strategy);
  });

  it("asks for nothing with no room", async () => {
    const db = dbReturning([texasCapital]);
    expect(await selectUnfetchedSavedLinks(db, 0)).toEqual([]);
    expect(db).not.toHaveBeenCalled();
  });
});

describe("runSavedLinkFetch", () => {
  it("fetches the saved link as a side copy, keeping the remembered address", async () => {
    fetchAndRecordLinkMock.mockResolvedValueOnce({ result: { outcome: "success", attemptOutcome: "ok" }, sourceDocumentId: 37594, supersededCopies: 0 });
    const result = await runSavedLinkFetch({ db: dbReturning([texasCapital]), fetchImpl: vi.fn(), runId: 9, live: true });
    expect(result).toMatchObject({ selected: 1, tried: 1, stored: 1, matched: 0, failed: 0 });
    expect(result.results[0]).toMatchObject({ institutionId: 69, link: texasCapital.fee_schedule_url, remembered: texasCapital.profile_canonical_source_url, sourceDocumentId: 37594 });
    const [, row, , ctx] = fetchAndRecordLinkMock.mock.calls[0];
    // The fetch asks for the saved link; the side copy leaves the bank's remembered address alone.
    expect(row).toMatchObject({ id: 69, fee_schedule_url: texasCapital.fee_schedule_url, profile_canonical_source_url: null });
    expect(ctx).toMatchObject({ keepRemembered: true, strategy: SAVED_LINK_FETCH_STRATEGY, dryRun: false });
  });

  it("counts a saved link that answers with the stored bytes as matched, and a failure as failed", async () => {
    fetchAndRecordLinkMock
      .mockResolvedValueOnce({ result: { outcome: "unchanged", attemptOutcome: "unchanged" }, sourceDocumentId: 37585, supersededCopies: 0 })
      .mockResolvedValueOnce({ result: { outcome: "failed", attemptOutcome: "http_404" }, sourceDocumentId: null, supersededCopies: 0 });
    const other = { ...texasCapital, id: 71, fee_schedule_url: "https://texascapitalbank.com/gone.pdf" };
    const result = await runSavedLinkFetch({ db: dbReturning([texasCapital, other]), fetchImpl: vi.fn(), runId: 9, live: true });
    expect(result).toMatchObject({ tried: 2, stored: 0, matched: 1, failed: 1 });
  });

  it("starts no fetch past its deadline", async () => {
    const result = await runSavedLinkFetch({ db: dbReturning([texasCapital]), fetchImpl: vi.fn(), runId: 9, deadline: Date.now() - 1, live: true });
    expect(result).toMatchObject({ selected: 1, tried: 0 });
    expect(fetchAndRecordLinkMock).not.toHaveBeenCalled();
  });

  it("only reports the banks it would fetch while the switch is off", async () => {
    const result = await runSavedLinkFetch({ db: dbReturning([texasCapital]), fetchImpl: vi.fn(), runId: 9 });
    expect(result).toMatchObject({ live: false, selected: 1, tried: 0, stored: 0 });
    expect(result.wouldFetch).toEqual([{ institutionId: 69, link: texasCapital.fee_schedule_url, remembered: texasCapital.profile_canonical_source_url }]);
    expect(fetchAndRecordLinkMock).not.toHaveBeenCalled();
  });
});
