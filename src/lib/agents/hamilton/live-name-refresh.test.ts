import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/savepoint", () => ({ inSavepoint: (db: unknown, fn: (scope: unknown) => unknown) => fn(db) }));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";
import {
  LIVE_NAME_REFRESH_ENV,
  LIVE_NAME_REFRESH_ROWS_SQL,
  findLiveNameRefreshes,
  judgeLiveNameRefresh,
  liveNameRefreshOn,
  nameImprovement,
  refreshLiveFeeNames,
  sameLine,
  writeLiveNameRefreshes,
  type LiveNameRefreshRow,
} from "./live-name-refresh";

// #1912: each bank's stored text around the fee's line (agent_source_texts, prod, read-only, Oct 27).
// Ringstad / RSB (inst 2521, doc 31383, text 29159), repaired by Rosetta's glyph lane on Oct 26.
const RSB = [
  "Night Deposit Replacement Key ......................... $10.00",
  "Wire Transfer - Remote Outgoing ................ $40.00*",
  "Wire International Transfer-Remote Outgoing ..$70.00*",
  "PAID or RETURNED",
].join("\n");
// GASCU (inst 8739, doc 28625, text 26035).
const GASCU = [
  " Wire transfer - Incoming ...................................................................................... $15.00",
  " Wire transfer - Outgoing (domestic only) ............................................................ $20.00",
].join("\n");
// Consumers Professional CU (inst 7213, doc 18129, text 13640): the price sits on the next line.
const CPCU = [
  "Low Balance Fee Traditional Checking",
  "$2.50",
  "($250 minimum balance)",
  "Share Draft Photocopies | $4.00",
  "Stop Payment Order (draft or EFT) | $30.00",
].join("\n");
// Dutrac (inst 7711, doc 24816, text 21982): Knox v135 reads "Outgoing Domestic Wire Transfer (phone request)".
const DUTRAC = [
  "Outgoing Domestic Wire Transfer $25.00 - in person or recurring agreement request",
  "High Yield Check Fee $.10 each + tax Outgoing Domestic Wire Transfer $30.00 - phone request",
].join("\n");

function row(overrides: Partial<LiveNameRefreshRow>): LiveNameRefreshRow {
  return {
    fee_published_id: 1,
    fee_verified_id: 11,
    institution_id: 100,
    fee_name: "",
    canonical_fee_key: "wire_domestic_outgoing",
    amount: 1,
    frequency: null,
    source_document_id: 1000,
    live_excerpt: "",
    reread_raw_id: 500,
    reread_verified_id: 50,
    reread_name: "",
    reread_key: "wire_domestic_outgoing",
    reread_frequency: null,
    reread_excerpt: "",
    document_text_id: 1,
    normalized_text: "",
    same_amount: [],
    ...overrides,
  };
}

const rsb = row({
  fee_published_id: 140286, institution_id: 2521, source_document_id: 31383, amount: "70.00",
  fee_name: "Wire Interna�onal Transfer-Remote Outgoing", canonical_fee_key: "wire_domestic_outgoing",
  live_excerpt: "wire interna�onal transfer-remote outgoing ..$70.00*",
  reread_raw_id: 1186050, reread_verified_id: 215327, reread_name: "Wire International Transfer-Remote Outgoing", reread_key: "wire_intl_outgoing",
  reread_excerpt: "wire international transfer-remote outgoing ..$70.00*", document_text_id: 29159, normalized_text: RSB,
});
const gascu = row({
  fee_published_id: 133140, institution_id: 8739, source_document_id: 28625, amount: "20.00",
  fee_name: " Wire transfer - Outgoing (domes�c only)",
  live_excerpt: " wire transfer - outgoing (domes�c only) ............................................................ $20.00",
  reread_raw_id: 1183585, reread_verified_id: 215117, reread_name: " Wire transfer - Outgoing (domestic only)",
  reread_excerpt: " wire transfer - outgoing (domestic only) ............................................................ $20.00",
  document_text_id: 26035, normalized_text: GASCU,
});
const dutrac = row({
  fee_published_id: 110356, institution_id: 7711, source_document_id: 24816, amount: "30.00", frequency: "per_item",
  fee_name: "Outgoing Domestic Wire Transfer", live_excerpt: "tax outgoing domestic wire transfer $30.00",
  reread_name: "Outgoing Domestic Wire Transfer (phone request)", reread_frequency: "per_item",
  reread_excerpt: "tax outgoing domestic wire transfer $30.00", document_text_id: 21982, normalized_text: DUTRAC,
});

describe("nameImprovement", () => {
  it("reads a glyph restored as a ligature, and a dropped ligature put back, as a repair", () => {
    expect(nameImprovement("Wire Interna�onal Transfer-Remote Outgoing", "Wire International Transfer-Remote Outgoing", "wire_domestic_outgoing")).toBe("glyph_repair");
    expect(nameImprovement("NSF/Overdra� Fee (per item)", "NSF/Overdraft Fee (per item)", "nsf")).toBe("glyph_repair");
    expect(nameImprovement("Overdra Fee", "Overdraft Fee", "overdraft")).toBe("glyph_repair");
  });

  it("reads a channel clause added to a wire's name as an improvement", () => {
    expect(nameImprovement("Outgoing Domestic Wire Transfer", "Outgoing Domestic Wire Transfer (phone request)", "wire_domestic_outgoing")).toBe("channel_clause");
    expect(nameImprovement("Outgoing Domestic Wire fee", "Outgoing Domestic Wire fee (Recurring)", "wire_domestic_outgoing")).toBe("channel_clause");
    expect(nameImprovement("Outgoing Domestic", "Outgoing Domestic - Not in Person", "wire_domestic_outgoing")).toBe("channel_clause");
  });

  it("refuses every other change", () => {
    // Words dropped, another reading, a case change.
    expect(nameImprovement("Overdra�s an NSF fee", "NSF fee", "nsf")).toBeNull();
    expect(nameImprovement("Share Dra� Photocopies", "Monthly Bad Address/E-mail Address", "document_reproduction")).toBeNull();
    expect(nameImprovement("OUTGOING WIRE", "Outgoing Wire", "wire_domestic_outgoing")).toBeNull();
    // A glyph that stood for a cell break, not a ligature.
    expect(nameImprovement("ACH Wire Transfers � Foreign", "ACH Wire Transfers - Foreign", "wire_intl_outgoing")).toBeNull();
    // A word that is not a fee word with a ligature dropped.
    expect(nameImprovement("Tile Fee", "Title Fee", "other")).toBeNull();
    // Added words that are no channel: a currency, a notice, a direction.
    expect(nameImprovement("Outgoing Wire Transfer: International", "Outgoing Wire Transfer: International (Foreign Currency)", "wire_intl_outgoing")).toBeNull();
    expect(nameImprovement("Incoming Wire", "Incoming Wire with Phone Notification", "wire_domestic_incoming")).toBeNull();
    expect(nameImprovement("Wire Transfer (incoming)", "Foreign Wire Transfer (incoming)", "wire_domestic_incoming")).toBeNull();
    // Review of #2766: a channel word beside another price's words is not a channel clause.
    expect(nameImprovement("Outgoing Wire", "Outgoing Wire Each Additional Recurring", "wire_domestic_outgoing")).toBeNull();
    expect(nameImprovement("Domestic Wire", "Domestic Wire Waived Online", "wire_domestic_outgoing")).toBeNull();
    // A channel clause on a fee that is not a wire.
    expect(nameImprovement("Stop Payment", "Stop Payment (online)", "stop_payment")).toBeNull();
    // A new name still carrying a glyph.
    expect(nameImprovement("Wire �", "Wire � (phone)", "wire_domestic_outgoing")).toBeNull();
  });
});

describe("sameLine", () => {
  it("needs the re-read's line printed once, pricing the amount once, and the live line to be that line", () => {
    expect(sameLine(rsb.live_excerpt, rsb.reread_excerpt, RSB, 70)).toBe(true);
    // CPCU's re-read joins the name and its price with " / ": the text never prints that line.
    expect(sameLine("low balance fee tradi�onal checking / $2.50", "low balance fee traditional checking / $2.50", CPCU, 2.5)).toBe(false);
    // A line printed twice may be two fees.
    expect(sameLine("wire $10.00", "wire $10.00", "Wire $10.00\nWire $10.00", 10)).toBe(false);
    // Another line of the same page.
    expect(sameLine("wire transfer - remote outgoing ................ $40.00*", rsb.reread_excerpt, RSB, 70)).toBe(false);
  });
});

describe("judgeLiveNameRefresh", () => {
  it("renames RSB's 140286 in place; the guard then fails it as a domestic wire", () => {
    const verdict = judgeLiveNameRefresh(rsb);
    expect(verdict).toMatchObject({
      outcome: "refresh", improvement: "glyph_repair", newName: "Wire International Transfer-Remote Outgoing",
      rereadKey: "wire_intl_outgoing", sourceLine: expect.stringContaining("Wire International Transfer-Remote Outgoing"),
    });
    // Guard v101 has no domestic-to-international wire move: the second look takes it down and 215327 publishes.
    expect(verdict.guardAfter).toEqual({ ok: false, refileTo: null });
  });

  it("renames GASCU's 133140 and keeps it a domestic wire", () => {
    expect(judgeLiveNameRefresh(gascu)).toMatchObject({ outcome: "refresh", improvement: "glyph_repair", guardAfter: { ok: true, refileTo: null } });
  });

  it("gives Dutrac's 110356 the channel Knox v135 reads", () => {
    expect(judgeLiveNameRefresh(dutrac)).toMatchObject({ outcome: "refresh", improvement: "channel_clause", newName: "Outgoing Domestic Wire Transfer (phone request)" });
  });

  it("refuses a re-read under a category the repaired name does not move it to", () => {
    const cpcu = row({
      fee_name: "Share Dra� Photocopies", canonical_fee_key: "document_reproduction", amount: "4.00",
      live_excerpt: "share dra� photocopies | $4.00", reread_name: "Share Draft Photocopies", reread_key: "check_image",
      reread_excerpt: "share draft photocopies | $4.00", normalized_text: CPCU,
    });
    expect(judgeLiveNameRefresh(cpcu).outcome).toBe("category_differs");
  });

  it("refuses a differing frequency, a name the text does not trace, and a missing text", () => {
    expect(judgeLiveNameRefresh({ ...dutrac, reread_frequency: "monthly" }).outcome).toBe("frequency_differs");
    expect(judgeLiveNameRefresh({ ...gascu, normalized_text: GASCU.replace("(domestic only)", "(domestic)") }).outcome).toBe("not_same_line");
    expect(judgeLiveNameRefresh({ ...gascu, normalized_text: null }).outcome).toBe("no_text");
    // The text no longer prints the channel: the new name does not trace.
    expect(judgeLiveNameRefresh({ ...dutrac, normalized_text: DUTRAC.replace("$30.00 - phone request", "$30.00") }).outcome).toBe("untraced");
  });
});

describe("findLiveNameRefreshes", () => {
  it("one verdict per live fee; two different passing names are ambiguous", () => {
    const second = { ...dutrac, reread_raw_id: 501, reread_name: "Outgoing Domestic Wire Transfer (phone)" };
    const found = findLiveNameRefreshes([dutrac, second, rsb]);
    expect(found.checked).toBe(2);
    expect(found.verdicts.find((verdict) => verdict.feePublishedId === 110356)?.outcome).toBe("ambiguous");
    expect(found).toMatchObject({ matched: 1, wouldRefile: 1 });
  });

  it("keeps the name when another live fee of the bank already shows it at the price", () => {
    const twin = { ...gascu, same_amount: [{ fee_published_id: 9, fee_name: " Wire transfer - Outgoing (domestic only)", canonical_fee_key: "wire_domestic_outgoing" }] };
    expect(findLiveNameRefreshes([twin]).verdicts[0]).toMatchObject({ outcome: "same_name_live", refusedBy: "live fee #9" });
    const other = { ...gascu, fee_published_id: 133141 };
    expect(findLiveNameRefreshes([gascu, other]).verdicts.map((verdict) => verdict.outcome)).toEqual(["same_name_live", "same_name_live"]);
  });
});

describe("refreshLiveFeeNames switch", () => {
  function refreshDb(rows: LiveNameRefreshRow[]) {
    const db = vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve(strings.join("?").includes("UPDATE published_fee_records") ? rows.map((r) => ({ fee_published_id: r.fee_published_id })) : []),
    ) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe = vi.fn(() => Promise.resolve(rows));
    return db;
  }
  type Db = Parameters<typeof refreshLiveFeeNames>[0];
  const writes = (db: ReturnType<typeof refreshDb>) => db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");

  it("on unless LIVE_NAME_REFRESH_LIVE is false, 0 or off (James's yes, 2026-10-31)", () => {
    expect(LIVE_NAME_REFRESH_ENV).toBe("LIVE_NAME_REFRESH_LIVE");
    expect(liveNameRefreshOn({})).toBe(true);
    expect(liveNameRefreshOn({ LIVE_NAME_REFRESH_LIVE: "false" })).toBe(false);
    expect(liveNameRefreshOn({ LIVE_NAME_REFRESH_LIVE: " Off " })).toBe(false);
    expect(liveNameRefreshOn({ LIVE_NAME_REFRESH_LIVE: " True " })).toBe(true);
  });

  it("switched off, it reports and logs an event but renames nothing; a dry run writes nothing at all", async () => {
    const off = refreshDb([gascu]);
    const result = await refreshLiveFeeNames(off as unknown as Db, { runId: 7, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, matched: 1, renamed: [] });
    expect(writes(off)).not.toMatch(/UPDATE/);
    expect(writes(off)).toMatch(/INSERT INTO agent_run_events/);

    const dry = refreshDb([gascu]);
    expect(await refreshLiveFeeNames(dry as unknown as Db, { runId: 7, dryRun: true, live: true })).toMatchObject({ matched: 1, renamed: [] });
    expect(dry).not.toHaveBeenCalled();
  });

  it("switched on, it renames in place guarded on the old name and logs the old name", async () => {
    const db = refreshDb([gascu]);
    const result = await refreshLiveFeeNames(db as unknown as Db, { runId: 7, stepId: 3, dryRun: false, live: true });
    expect(result.renamed).toEqual([133140]);
    expect(writes(db)).toMatch(/UPDATE published_fee_records fp\s+SET fee_name = v\.new_name/);
    expect(writes(db)).toMatch(/AND fp\.fee_name = v\.old_name/);
    expect(writes(db)).toMatch(/INSERT INTO pipeline_feedback/);
    expect(writes(db)).toMatch(/INSERT INTO agent_run_events/);
  });

  it("a full read runs at most once per interval; an institution-scoped read always runs", async () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const recent = refreshDb([gascu]);
    recent.mockImplementation(((strings: TemplateStringsArray) =>
      Promise.resolve(strings.join("?").includes("SELECT created_at") ? [{ created_at: "2026-10-27T10:00:00Z" }] : [])) as never);
    expect(await refreshLiveFeeNames(recent as unknown as Db, { runId: 7, dryRun: false, live: true, now })).toMatchObject({ skipped: true, matched: 0, renamed: [] });
    expect(recent.unsafe).not.toHaveBeenCalled();
    const scoped = await refreshLiveFeeNames(recent as unknown as Db, { runId: 7, dryRun: false, live: false, institutionId: 8739, now });
    expect(scoped).toMatchObject({ skipped: false, scoped: true, matched: 1 });
  });

  it("a refused candidate is never written", async () => {
    const db = refreshDb([{ ...dutrac, reread_frequency: "monthly" }]);
    const result = await refreshLiveFeeNames(db as unknown as Db, { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ matched: 0, renamed: [] });
    expect(writes(db)).not.toMatch(/UPDATE/);
  });

  it("reads only newer, verified, unpublished reads of the live fee's own document", () => {
    expect(LIVE_NAME_REFRESH_ROWS_SQL).toMatch(/rr\.source_document_id = lr\.source_document_id/);
    expect(LIVE_NAME_REFRESH_ROWS_SQL).toMatch(/rr\.fee_raw_id > lr\.fee_raw_id/);
    expect(LIVE_NAME_REFRESH_ROWS_SQL).toMatch(/rv\.review_status IN \('verified', 'approved'\)/);
    expect(LIVE_NAME_REFRESH_ROWS_SQL).toMatch(/other\.lineage_ref = rv\.fee_verified_id/);
  });

  it("never reads or renames an admin-corrected fee (#978)", async () => {
    expect(LIVE_NAME_REFRESH_ROWS_SQL).toContain(notAdminCorrectedSql("fp"));
    const calls: string[] = [];
    const db = (strings: TemplateStringsArray) => { calls.push(strings.join("?")); return Promise.resolve([]); };
    await writeLiveNameRefreshes(db as never, 1, null, [{
      feePublishedId: 61057, feeVerifiedId: null, institutionId: 7213, sourceDocumentId: 18129, amount: 30,
      canonicalFeeKey: "stop_payment", oldName: "Stop Payment Order (dra\uFFFD or EFT)", outcome: "refresh",
      newName: "Stop Payment Order (draft or EFT)",
    }]);
    const update = (calls.find((sql) => /UPDATE published_fee_records/.test(sql)) ?? "").replace(/\s+/g, " ");
    expect(update).toContain(notAdminCorrectedSql("fp"));
  });
});
