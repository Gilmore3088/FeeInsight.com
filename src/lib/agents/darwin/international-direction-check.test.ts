// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";
import {
  INTERNATIONAL_DIRECTION_CHECK,
  INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE,
  findInternationalDirections,
  internationalDirectionDetail,
  recheckInternationalDirections,
  storedTextIsOriginal,
  type InternationalDirectionRow,
} from "./international-direction-check";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// Lines as the live fees' stored texts print them (prod, read-only, 2026-10-27).
const AMARILLO = ["Wire Transfer", "Customer Incoming Wire: | Free", "Foreign Wire: | $45.00", "Research Bank Records: | $20.00 Per Hour plus $.50 per copy"].join("\n");
const MEADOWLAND = ["Wire Transfer Domestic | $15.00 in $25.00 out", "Wire Transfer Foreign | $35.00 in", "Cashiers Check Fee | $3.00 per check"].join("\n");
const CLEAN = ["Outgoing Wire (Domestic) | $25.00", "International Wire Outgoing | $45.00", "Stop Payment | $30.00"].join("\n");

function row(id: number, text: string | null, name: string, amount: number, category = "wire_intl_outgoing",
  extra: Partial<InternationalDirectionRow> = {}): InternationalDirectionRow {
  const hash = text == null ? null : sha(text);
  return {
    fee_published_id: String(id), fee_verified_id: String(id + 1_000_000), institution_id: String(id % 97 + 1),
    canonical_fee_key: category, published_amount: String(amount), raw_institution_id: String(id % 97 + 1),
    source_document_id: String(id + 5_000), raw_fee_name: name, raw_amount: String(amount), outlier_flags: [],
    extraction_note: `Knox deterministic extraction from Rosetta artifact #${id + 9_000}. canonical_hint=${category}; text_hash=${hash ?? "0".repeat(64)}; excerpt="${name}"`,
    conditions: null, text_id: text == null ? null : String(id + 9_001), text_institution_id: String(id % 97 + 1),
    text_status: text == null ? null : "completed", text_hash: hash, normalized_text: text, source_url: "https://example.test/fees",
    ...extra,
  };
}

const AMARILLO_ROW = row(118154, AMARILLO, "Foreign Wire", 45);
const MISMATCH_ROW = row(87860, MEADOWLAND, "Wire Transfer Foreign", 35);
const CLEAN_ROW = row(300, CLEAN, "International Wire Outgoing", 45);
const ROWS = [AMARILLO_ROW, MISMATCH_ROW, CLEAN_ROW];

describe("storedTextIsOriginal (#1912)", () => {
  it("proves the text by its hash, not its artifact id", () => {
    expect(storedTextIsOriginal(AMARILLO_ROW)).toBe(true);
    expect(AMARILLO_ROW.text_id).not.toBe("127154"); // a different artifact id than the note's
  });
  it("refuses a re-read text, a body that does not hash to it, and a note naming two hashes", () => {
    expect(storedTextIsOriginal({ ...AMARILLO_ROW, normalized_text: `${AMARILLO}\nNew line`, text_hash: sha(`${AMARILLO}\nNew line`) })).toBe(false);
    expect(storedTextIsOriginal({ ...AMARILLO_ROW, normalized_text: `${AMARILLO} ` })).toBe(false);
    const other = sha("other");
    expect(storedTextIsOriginal({ ...AMARILLO_ROW, extraction_note: `${AMARILLO_ROW.extraction_note} text_hash=${other}; re-read text_hash=${AMARILLO_ROW.text_hash};` })).toBe(true);
    expect(storedTextIsOriginal({ ...AMARILLO_ROW, extraction_note: `Knox re-read. text_hash=${other}; text_hash=${AMARILLO_ROW.text_hash}; excerpt="x"` })).toBe(false);
  });
});

describe("findInternationalDirections (#1912)", () => {
  it("matches Amarillo 118154, whose own line names no direction, and passes a line that names it", () => {
    const found = findInternationalDirections([...ROWS, AMARILLO_ROW]);
    expect(found.checked).toBe(3);
    expect(found.passing).toEqual([300]);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.match])).toEqual([[87860, "direction_mismatch"], [118154, "direction_missing"]]);
    expect(found.matches[1]).toMatchObject({ reason: "international_direction: direction_missing", sourceLine: "Foreign Wire: | $45.00", sourceCategory: null });
    expect(found).toMatchObject({ matched: 2, byReason: { direction_missing: 1, direction_mismatch: 1 }, byCategory: { wire_intl_outgoing: 2 } });
  });

  it("reports the category an incoming line shows on a fee filed outgoing, and never re-files it", () => {
    const [fee] = findInternationalDirections([MISMATCH_ROW]).matches;
    expect(fee).toMatchObject({ canonicalFeeKey: "wire_intl_outgoing", sourceCategory: "wire_intl_incoming" });
  });

  it("leaves a fee whose own line it cannot place live, as unproven", () => {
    const found = findInternationalDirections([row(401, "Wire Transfers | Outgoing (International) $45.00 | Incoming $15.00", "International Wire Transfer", 45)]);
    expect(found.matched).toBe(0);
    expect(found.unproven).toBe(1);
    expect(Object.keys(found.unprovenByReason)).toHaveLength(1);
  });

  it("leaves a changed or missing text and Knox's eligibility hold to Knox", () => {
    const reread = { ...AMARILLO_ROW, normalized_text: `${AMARILLO}\nNew`, text_hash: sha(`${AMARILLO}\nNew`) };
    const missing = row(402, null, "Foreign Wire", 45);
    const held = { ...AMARILLO_ROW, fee_published_id: "403", outlier_flags: ["knox_eligibility:international_wire"] };
    const found = findInternationalDirections([reread, missing, held]);
    expect(found).toMatchObject({ matched: 0, textChanged: 2, eligibilityHeld: 1 });
  });

  it("never judges a fee against another institution's text, even one that hashes right", () => {
    const otherOwner = { ...AMARILLO_ROW, text_institution_id: String(Number(AMARILLO_ROW.institution_id) + 1) };
    expect(findInternationalDirections([otherOwner])).toMatchObject({ matched: 0, textChanged: 1 });
  });
});

describe("own-wire-scope reads directions as banks print them (#1912)", () => {
  const scope = (line: string, name: string, amount: number) => sourceOwnedWireScope(line, name, amount);
  it.each([
    ["International Wire (in/out) | $25.00", "International Wire (in/out)", 25, ["incoming", "outgoing"]],
    ["International Wire – Out | $45.00", "International Wire – Out", 45, ["outgoing"]],
    ["Wire Transfer International Out | $40.00", "Wire Transfer International Out", 40, ["outgoing"]],
    ["Foreign Wire (Out) | $50.00", "Foreign Wire (Out)", 50, ["outgoing"]],
    ["Wire Transfer Foreign-In | $15.00", "Wire Transfer Foreign-In", 15, ["incoming"]],
    ["International Wire Withdrawal | $45.00", "International Wire Withdrawal", 45, ["outgoing"]],
    ["International Wire Deposit | $15.00", "International Wire Deposit", 15, ["incoming"]],
    ["International Wire Transfers- Outcoming | $50.00", "International Wire Transfers- Outcoming", 50, ["outgoing"]],
    ["Income Wire Transfer (foreign) | $10.00", "Income Wire Transfer (foreign)", 10, ["incoming"]],
    ["Foreign Wire | $45.00 | Outgoing", "Foreign Wire", 45, ["outgoing"]],
  ])("%s", (line, name, amount, directions) => {
    const found = scope(line, name, amount);
    expect(found.kind).toBe("owned");
    if (found.kind === "owned") {
      expect(found.geography).toBe("international");
      expect([...found.directions].sort()).toEqual(directions);
    }
  });

  it("reads Outside U.S. as international and Non-Domestic as not domestic", () => {
    const outside = scope("Outgoing Wire Transfer Outside U.S. | $50.00", "Outgoing Wire Transfer Outside U.S.", 50);
    const nonDomestic = scope("Non-Domestic Outgoing Wire | $50.00", "Non-Domestic Outgoing Wire", 50);
    expect(outside.kind === "owned" && outside.geography).toBe("international");
    expect(nonDomestic.kind === "owned" && nonDomestic.geography).toBe("international");
  });

  it("does not read a priced None row as a heading over the wire below it", () => {
    const text = ["Fee Type | Amount", "Wire Transfer Incoming | None", "Wire Transfer Outgoing | $30.00", "International Wire Transfer | $35.00"].join("\n");
    const found = scope(text, "International Wire Transfer", 35);
    expect(found.kind === "owned" && found.directions).toEqual([]);
  });

  it("keeps an undirected international line undirected", () => {
    const found = scope("International Wire Transfer | $50.00/Transfer", "International Wire Transfer", 50);
    expect(found.kind === "owned" && found.directions).toEqual([]);
  });
});

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(rows: InternationalDirectionRow[], options: { flags?: Array<Record<string, unknown>>; cursor?: string; failRead?: boolean } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("detail->>'next_after_id' AS next_after_id")) return Promise.resolve(options.cursor ? [{ next_after_id: options.cursor }] : []);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "118154" }]);
    if (text.includes("FROM published_fee_records fp")) return options.failRead ? Promise.reject(new Error("read failed")) : Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckInternationalDirections>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("recheckInternationalDirections (#1912)", () => {
  it("is off by default and only reports, on the run ledger", async () => {
    expect(INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE).toBe(false);
    const db = dbFor(ROWS);
    const result = await recheckInternationalDirections(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: false, matched: 2, flagged: 0, takenDown: [], nextAfterId: 0 });
    expect(texts(db).some((text) => text.includes("UPDATE"))).toBe(false);
    expect(texts(db).some((text) => text.includes("INSERT INTO agent_run_events"))).toBe(true);
    expect(internationalDirectionDetail(result)).toMatchObject({ check: INTERNATIONAL_DIRECTION_CHECK, switch_live: false, matched: 2, next_after_id: 0 });
  });

  it("writes nothing on a dry run", async () => {
    const db = dbFor(ROWS);
    const result = await recheckInternationalDirections(asDb(db), { runId: 7, dryRun: true, live: true });
    expect(result.matched).toBe(2);
    expect(texts(db).some((text) => text.includes("INSERT") || text.includes("UPDATE"))).toBe(false);
  });

  it("continues after the cursor and records the next one on a full batch", async () => {
    const db = dbFor(ROWS, { cursor: "100" });
    const result = await recheckInternationalDirections(asDb(db), { runId: 7, dryRun: false, limit: 3 });
    expect(result).toMatchObject({ afterId: 100, nextAfterId: 300 });
  });

  it("switched on, flags a first failure and takes the fee down on its second look 12 hours on", async () => {
    const first = await recheckInternationalDirections(asDb(dbFor(ROWS)), { runId: 8, dryRun: false, live: true });
    expect(first.flagged).toBe(2);
    expect(first.takenDown).toEqual([]);

    const second = dbFor([AMARILLO_ROW], {
      flags: [{ fee_published_id: "118154", kind: "takedown_pending", evidence: { flag_run_id: 8, flagged_at: "2026-10-27T00:00:00Z", reason: "international_direction: direction_missing" } }],
    });
    const result = await recheckInternationalDirections(asDb(second), { runId: 9, dryRun: false, live: true, now: new Date("2026-10-27T13:00:00Z") });
    expect(result.takenDown).toEqual([118154]);
    const written = texts(second);
    expect(written.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
    expect(written.some((text) => text.includes("darwin.international_direction_takedown"))).toBe(true);
  });

  it("reports nothing when the read fails", async () => {
    const result = await recheckInternationalDirections(asDb(dbFor(ROWS, { failRead: true })), { runId: 7, dryRun: false });
    expect(result).toMatchObject({ checked: 0, matched: 0 });
  });
});
