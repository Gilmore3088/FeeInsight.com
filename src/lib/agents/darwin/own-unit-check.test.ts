import { describe, expect, it, vi } from "vitest";
import { settledFrequency } from "@/lib/fee-frequency";
import {
  blankFrequency,
  findOwnUnitFees,
  OWN_UNIT_BLANK_PART_HOUR_LIVE,
  OWN_UNIT_CHECK,
  OWN_UNIT_CHECK_VERSION,
  OWN_UNIT_REFILE_LIVE,
  OWN_UNIT_REFILED_EVENT,
  OWN_UNIT_REFILED_KIND,
  OWN_UNIT_ROWS_SQL,
  ownUnitDetail,
  ownUnitFeedbackRow,
  ownUnitVerdict,
  recheckOwnUnits,
  type OwnUnitRow,
} from "./own-unit-check";
import { FEEDBACK_KINDS } from "@/lib/agents/learning/feedback-kinds";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";

/** Lines from prod's live per_item fees (#2248, read-only, 2026-10-30). */
const row = (id: number, name: string, amount: number, key: string, line: string, extra: Partial<OwnUnitRow> = {}): OwnUnitRow => ({
  fee_published_id: String(id),
  fee_verified_id: String(id + 9000),
  institution_id: "5",
  source_document_id: String(id + 500),
  fee_name: name,
  amount: String(amount),
  canonical_fee_key: key,
  frequency: "per_item",
  conditions: `Knox deterministic extraction. canonical_hint=${key}; excerpt="${line}"`,
  ...extra,
});

const PHOTOCOPY = row(101, "Photocopies", 0.25, "document_reproduction", "Photocopies | $0.25 per page");
const PREFIX = row(102, "Photocopies (per page)", 0.1, "document_reproduction", "Photocopies (per page) | $0.10");
const NOTARY = row(103, "Notary Service (non-customers)", 5, "notary_fee", "Notary Service (non-customers) $5.00 | Per document");
const CONFLICT = row(104, "Statement copy", 5, "document_reproduction", "Statement copy | $5.00/page");
const FLAT = row(105, "Stop Payment", 30, "stop_payment", "Stop Payment | $30.00 per item");
const HOURLY = row(106, "Account Research", 25, "account_research", "Account Research | $25.00 per hour");
const NO_TEXT = row(107, "Temporary Checks", 1, "counter_check", "Temporary Checks | $1.00 per page");
const UNTRACED = row(108, "Fax Service", 0.5, "document_reproduction", "Fax Service $.50/page");

const TEXTS = new Map<number, string>([
  [601, "Other Services\nPhotocopies | $0.25 per page\nStop Payment | $30.00"],
  [602, "Photocopies (per page) | $0.10\nFax | $1.00"],
  [603, "Notary Service (members) | Free\nNotary Service (non-customers) $5.00 | Per document"],
  // The bank's document prices the statement copy per statement; the stored line said per page.
  [604, "Statement copy | $5.00/statement"],
  [605, "Stop Payment | $30.00 per item"],
  [606, "Account Research | $25.00 per hour"],
  // The document no longer prints the fee at its price.
  [608, "Fax Service | $1.00/page"],
]);

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
function dbFor(rows: OwnUnitRow[], options: { cursor?: string | null; texts?: Map<number, string>; updated?: number[] } = {}): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM agent_run_events")) return Promise.resolve(options.cursor == null ? [] : [{ next_after_id: options.cursor }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve((options.updated ?? [101]).map((id) => ({ fee_published_id: String(id) })));
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => {
    if (query.includes("FROM published_fee_records")) return Promise.resolve(rows);
    if (query.includes("FROM agent_source_texts")) {
      return Promise.resolve([...(options.texts ?? TEXTS)].map(([id, text]) => ({ source_document_id: String(id), normalized_text: text })));
    }
    return Promise.resolve([]);
  });
  return db;
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckOwnUnits>[0];
const sent = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));
const call = (db: DbMock, needle: string) => db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes(needle));

describe("Darwin live own-unit re-check (#2248)", () => {
  it("ships switched on since Nov 2 (sampled clean), with a recorded kind", () => {
    expect(OWN_UNIT_REFILE_LIVE).toBe(true);
    expect(FEEDBACK_KINDS[OWN_UNIT_REFILED_KIND]).toMatchObject({ record: expect.stringContaining("own-unit-check.ts") });
  });

  it("re-files a flat fee whose own line and document price it by the page or document", () => {
    expect(ownUnitVerdict(PHOTOCOPY, TEXTS.get(601))).toMatchObject({ outcome: "refile", unit: "per_page", from: "per_item", amount: 0.25, tracedLine: "Photocopies | $0.25 per page" });
    expect(ownUnitVerdict(PREFIX, TEXTS.get(602))).toMatchObject({ outcome: "refile", unit: "per_page" });
    expect(ownUnitVerdict(NOTARY, TEXTS.get(603))).toMatchObject({ outcome: "refile", unit: "per_document" });
  });

  it("never re-files a fee by a free allowance's period or one of two units (v2, Nov 2 sample)", () => {
    // Live 98831 (inst 237, doc 20764), the bank's line verbatim: $2 a copy, 2 free each statement cycle.
    const line = "Money Order (per check) & Copies of Checks (per statement; 2 free per statement cycle) | $2.00";
    const allowance = row(98831, "Money Order (per check) & Copies of Checks", 2, "check_image", line);
    expect(ownUnitVerdict(allowance, `Loose Coin Count ($5 minimum) | 5% of total\n${line}`)).toBeNull();
    const twoUnits = "Duplicate Statement or Document Copy | $5.00/statement or document copy";
    expect(ownUnitVerdict(row(65324, "Duplicate Statement or Document Copy", 5, "document_reproduction", twoUnits), twoUnits)).toBeNull();
    const pages = "Notary | $2.00/Page, First 2 pages free for members";
    expect(ownUnitVerdict(row(67181, "Notary", 2, "notary_fee", pages), pages)).toMatchObject({ outcome: "refile", unit: "per_page" });
  });

  it("keeps a fee its line gives no unit, or leaves it to another check or a person", () => {
    expect(ownUnitVerdict(FLAT, TEXTS.get(605))).toBeNull();
    expect(ownUnitVerdict(HOURLY, TEXTS.get(606))).toMatchObject({ outcome: "hourly" });
    expect(ownUnitVerdict(NO_TEXT, null)).toMatchObject({ outcome: "no_text" });
    expect(ownUnitVerdict(UNTRACED, TEXTS.get(608))).toMatchObject({ outcome: "untraced" });
    expect(ownUnitVerdict(CONFLICT, TEXTS.get(604))).toMatchObject({ outcome: "unit_conflict", tracedLine: "Statement copy | $5.00/statement" });
    // A period category never takes a unit (own-fee-unit's guard).
    expect(ownUnitVerdict(row(109, "Paper Statement", 2, "monthly_maintenance", "Paper Statement | $2.00 per page"), "Paper Statement | $2.00 per page")).toBeNull();
  });

  it("holds when a current line that traces the fee does not itself state the same unit cleanly (#2248 review)", () => {
    const photocopy = row(120, "Photocopies", 0.25, "document_reproduction", "Photocopies | $0.25 per page");
    const copies = row(121, "Copies", 1, "document_reproduction", "Copies | $1.00 per page");
    const outcome = (fee: OwnUnitRow, text: string) => ownUnitVerdict(fee, text)?.outcome;
    expect(outcome(photocopy, "Photocopies (per statement) | $0.25 per page")).toBe("unit_conflict");
    expect(outcome(photocopy, "Photocopies | $0.25 per statement per page")).toBe("unit_conflict");
    expect(outcome(photocopy, "Photocopies | $0.25 per page; $1.00 per document over 10")).toBe("unit_conflict");
    expect(outcome(copies, "Copies | $1.00 per page, $5.00 minimum per request")).toBe("unit_conflict");
    expect(outcome(photocopy, "Personal\nPhotocopies | $0.25 per page\nBusiness\nPhotocopies | $0.25 per document")).toBe("unit_conflict");
    expect(outcome(photocopy, "Other Services\nPhotocopies | $0.25")).toBe("unit_unstated");
    // A flattened line prints neighbours beside the fee's own row; only its own row is read, and a
    // basis in the next cell ("| Per Page") is part of that row.
    expect(outcome(photocopy, "Wire | $25.00 per wire | Photocopies | $0.25 per page | Fax | $1.00 per page")).toBe("refile");
    expect(outcome(row(125, "Photocopy", 0.2, "document_reproduction", "Photocopy | $0.20 | Per Page"), "Photocopy | $0.20 | Per Page\nFax | $1.00 | Per Page")).toBe("refile");
    expect(outcome(row(126, "Photocopy", 0.2, "document_reproduction", "Photocopy | $0.20 | Per Page"), "Photocopy | $0.20 | Notary | $5.00 | Per Document")).toBe("unit_unstated");
    // The same row printed twice with the same unit still re-files.
    expect(outcome(photocopy, "Personal\nPhotocopies | $0.25 per page\nBusiness\nPhotocopies | $0.25 per page")).toBe("refile");
  });

  it("re-files nothing when the stored line's per-event basis after the price beats the name's unit (Knox v140)", () => {
    const request = row(122, "Research Copies (Per Page)", 5, "document_reproduction", "Research Copies (Per Page) | $5.00 per request");
    const item = row(123, "Research Copies (Per Page)", 5, "document_reproduction", "Research Copies (Per Page) | $5.00 per item");
    const each = row(124, "Research Copies (Per Page)", 5, "document_reproduction", "Research Copies (Per Page) | $5.00 each");
    expect(ownUnitVerdict(request, "Research Copies (Per Page) | $5.00 per request")).toBeNull();
    expect(ownUnitVerdict(item, "Research Copies (Per Page) | $5.00 per item")).toBeNull();
    expect(ownUnitVerdict(each, "Research Copies (Per Page) | $5.00 each")).toMatchObject({ outcome: "refile", unit: "per_page" });
  });

  it("re-files only a unit Hamilton's fill keeps on the same line, so the next publish step writes nothing back", () => {
    for (const fee of [PHOTOCOPY, PREFIX, NOTARY]) {
      const verdict = ownUnitVerdict(fee, TEXTS.get(Number(fee.source_document_id)))!;
      const line = fee.conditions!.match(/excerpt="(.*)"$/)![1];
      expect(settledFrequency(line, verdict.amount, verdict.unit, fee.canonical_fee_key, { hourly: false })).toBe(verdict.unit);
    }
  });

  it("counts by outcome, category and unit", () => {
    const found = findOwnUnitFees([PHOTOCOPY, PREFIX, NOTARY, CONFLICT, FLAT, HOURLY, NO_TEXT, UNTRACED], TEXTS);
    expect(found).toMatchObject({
      checked: 8,
      proven: 7,
      outcomes: { refile: 3, hourly: 1, no_text: 1, untraced: 1, unit_conflict: 1 },
      refileByCategory: { document_reproduction: 2, notary_fee: 1 },
      refileByUnit: { per_page: 2, per_document: 1 },
    });
    expect(found.samples.map((verdict) => verdict.feePublishedId)).toEqual([101, 102, 103]);
  });

  it("reads only live flat per-event fees no person corrected", () => {
    expect(OWN_UNIT_ROWS_SQL).toContain("fp.rolled_back_at IS NULL");
    expect(OWN_UNIT_ROWS_SQL).toContain("fp.amount_kind = 'flat'");
    expect(OWN_UNIT_ROWS_SQL).toContain("published_fee_corrections");
    expect(OWN_UNIT_ROWS_SQL).toContain("'per_item'");
  });

  it("switched off, records its counts on the ledger and moves the cursor but writes no fee", async () => {
    const db = dbFor([PHOTOCOPY, PREFIX, NOTARY, CONFLICT], { cursor: "100" });
    const result = await recheckOwnUnits(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, outcomes: { refile: 3, unit_conflict: 1 }, afterId: 100, nextAfterId: 0, refiled: [] });
    expect(db.unsafe.mock.calls[0][1]).toEqual([100, 0, 2_000]);
    expect(sent(db).some((text) => text.includes("UPDATE") || text.includes("pipeline_feedback"))).toBe(false);
    const report = call(db, "INSERT INTO agent_run_events");
    expect(report?.[3]).toBe(OWN_UNIT_CHECK);
    expect(String(report?.[4])).toContain("switch off, nothing written");
    expect(JSON.parse(String(report?.[5]))).toMatchObject({ next_after_id: 0, would_refile: 3, switch_live: false, refile_by_unit: { per_page: 2, per_document: 1 } });
  });

  it("a dry run writes nothing at all, even switched on", async () => {
    const db = dbFor([PHOTOCOPY]);
    const result = await recheckOwnUnits(asDb(db), { runId: 7, dryRun: true, live: true });
    expect(result.outcomes.refile).toBe(1);
    expect(sent(db).some((text) => text.includes("UPDATE") || text.includes("INSERT"))).toBe(false);
  });

  it("switched on, re-files the live and verified rows guarded on the old value and price, and logs each change", async () => {
    const db = dbFor([PHOTOCOPY, CONFLICT], { updated: [101] });
    const result = await recheckOwnUnits(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: true });
    expect(result.refiled).toEqual([101]);
    const update = call(db, "UPDATE published_fee_records");
    const text = (update?.[0] as TemplateStringsArray).join("?");
    expect(text).toContain("fp.frequency IS NOT DISTINCT FROM v.from_frequency");
    expect(text).toContain("fp.amount = v.amount");
    expect(text).not.toContain("rolled_back_at = ");
    // #978: the write re-checks the admin-correction guard, not only the read.
    expect(text.replace(/\s+/g, " ")).toContain(notAdminCorrectedSql("fp"));
    expect(update?.slice(1, 5)).toEqual([[101], ["per_item"], ["per_page"], [0.25]]);
    const verified = call(db, "UPDATE verified_fee_observations");
    expect(verified?.slice(1, 4)).toEqual([[9101], ["per_item"], ["per_page"]]);
    expect(JSON.stringify(db.mock.calls)).toContain(OWN_UNIT_REFILED_EVENT);
    expect(sent(db).some((text) => text.includes("pipeline_feedback"))).toBe(true);
  });

  it("an institution-scoped run leaves the cursor alone", async () => {
    const db = dbFor([PHOTOCOPY], { cursor: "100" });
    const result = await recheckOwnUnits(asDb(db), { runId: 7, dryRun: false, institutionId: 5, live: false });
    expect(result.afterId).toBeNull();
    expect(db.unsafe.mock.calls[0][1]).toEqual([0, 5, 2_000]);
    expect(sent(db).some((text) => text.includes("FROM agent_run_events"))).toBe(false);
  });

  it("logs the old frequency for a rollback, as a record", () => {
    const verdict = ownUnitVerdict(PHOTOCOPY, TEXTS.get(601))!;
    expect(ownUnitFeedbackRow(verdict, 7)).toMatchObject({
      kind: OWN_UNIT_REFILED_KIND,
      checkName: OWN_UNIT_CHECK,
      weight: 0,
      feePublishedId: 101,
      evidence: { from: "per_item", to: "per_page", source_line: "Photocopies | $0.25 per page" },
      dedupeKey: `${OWN_UNIT_CHECK}:v${OWN_UNIT_CHECK_VERSION}:101:per_item:per_page`,
    });
  });

  it("gives step detail with the switch state and samples", () => {
    const detail = ownUnitDetail({ ...findOwnUnitFees([PHOTOCOPY], TEXTS), live: false, blankPartHourLive: false, dryRun: false, afterId: 0, nextAfterId: 0, refiled: [] });
    expect(detail).toMatchObject({ check: OWN_UNIT_CHECK, version: OWN_UNIT_CHECK_VERSION, switch_live: false, blank_part_hour_live: false, would_refile: 1, refiled: 0 });
    expect(detail.samples_refile[0]).toMatchObject({ fee_published_id: 101, from: "per_item", unit: "per_page", outcome: "refile" });
  });
});

/**
 * #1905: live fees with no frequency whose own line prices them by part of an hour, written with a
 * fraction glyph (prod, read-only, 2026-11-01). Navy Federal's lines are from its stored fees page
 * (doc 41267, text 39818); the others are the stored lines of live fees 133209, 144440 and 88539.
 */
describe("blank-frequency part-hour fees (#1905)", () => {
  const blank = (id: number, name: string, amount: number, line: string) =>
    row(id, name, amount, "account_research", line, { frequency: null });
  const NAVY_TEXT = [
    "Checking Fees",
    "Fee | Amount",
    "Check copies | $1.00 per copy after the first free copy per month",
    "Checkbook balancing (repeated) | $5.00 (per ½ hour)",
    "Check orders and accessories | Prices vary depending on the style and quality selected.",
  ].join("\n");
  const NAVY = blank(122355, "Checkbook balancing (repeated)", 5, "Checkbook balancing (repeated) | $5.00 (per ½ hour)");
  const QUARTER = blank(88539, "Account Balancing Assistance", 10, "Account Balancing Assistance ............................$10.00 per ¼ hour | Debit Cards:");
  const HALF_HR = blank(133209, "Account Balancing", 25, "Account Balancing | $25.00 per ½ hr.");
  const SLASH = blank(144440, "Account Balancing", 10, "Account Balancing $10.00 / ½ hour");
  const PAGE_BLANK = blank(130, "Photocopies", 0.25, "Photocopies | $0.25 per page");

  it("ships switched off, apart from the per-item switch", () => {
    expect(OWN_UNIT_BLANK_PART_HOUR_LIVE).toBe(false);
    expect(blankFrequency(null)).toBe(true);
    expect(blankFrequency(" ")).toBe(true);
    expect(blankFrequency("per_item")).toBe(false);
  });

  it("re-files a blank fee whose own line and document price it per ½ or ¼ hour", () => {
    expect(ownUnitVerdict(NAVY, NAVY_TEXT)).toMatchObject({ outcome: "refile", unit: "per_half_hour", from: null, amount: 5 });
    expect(ownUnitVerdict(HALF_HR, "Account Balancing | $25.00 per ½ hr.\nAccount Research Fee | $25.00 per ½ hr.")).toMatchObject({ outcome: "refile", unit: "per_half_hour" });
    expect(ownUnitVerdict(SLASH, "Account Balancing $10.00 / ½ hour")).toMatchObject({ outcome: "refile", unit: "per_half_hour" });
    expect(ownUnitVerdict(QUARTER, "Account Balancing Assistance ............................$10.00 per ¼ hour | Debit Cards:")).toMatchObject({ outcome: "refile", unit: "per_quarter_hour" });
  });

  it("reads a blank only for a part-hour unit, and keeps a minimum or an hourly price out", () => {
    expect(ownUnitVerdict(PAGE_BLANK, "Photocopies | $0.25 per page")).toBeNull();
    const minimum = blank(131, "Account Research", 30, "Account Research (½ hour minimum) | $30.00/hour");
    expect(ownUnitVerdict(minimum, "Account Research (½ hour minimum) | $30.00/hour")).toBeNull();
    const flat = blank(132, "Checkbook balancing", 5, "Checkbook balancing | $5.00");
    expect(ownUnitVerdict(flat, "Checkbook balancing | $5.00")).toBeNull();
  });

  it("selects blanks only on a part-hour line", () => {
    expect(OWN_UNIT_ROWS_SQL).toMatch(/IS NULL AND COALESCE\(fr\.extraction_note, fr\.conditions\) ~\* 'excerpt=.*½/);
  });

  it("writes a blank only with its own switch, and a per-item fee only with the per-item switch", async () => {
    const texts = new Map([[122855, NAVY_TEXT], [601, TEXTS.get(601)!]]);
    const offDb = dbFor([NAVY, PHOTOCOPY], { texts });
    const off = await recheckOwnUnits(asDb(offDb), { runId: 7, dryRun: false, live: true, blankPartHourLive: false });
    expect(off.outcomes.refile).toBe(2);
    expect(off.blankPartHourRefile).toBe(1);
    expect(ownUnitDetail(off)).toMatchObject({ would_refile: 2, would_refile_blank_part_hour: 1, blank_part_hour_live: false });
    expect(call(offDb, "UPDATE published_fee_records")?.slice(1, 3)).toEqual([[101], ["per_item"]]);

    const onDb = dbFor([NAVY, PHOTOCOPY], { texts, updated: [122355] });
    const on = await recheckOwnUnits(asDb(onDb), { runId: 7, dryRun: false, live: false, blankPartHourLive: true });
    expect(on.refiled).toEqual([122355]);
    expect(call(onDb, "UPDATE published_fee_records")?.slice(1, 4)).toEqual([[122355], [null], ["per_half_hour"]]);
  });
});
