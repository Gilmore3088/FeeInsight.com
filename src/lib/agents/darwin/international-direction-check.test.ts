// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";
import {
  INTERNATIONAL_DIRECTION_CHECK,
  INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE,
  INTERNATIONAL_DIRECTION_CHECK_VERSION,
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
// v3: an undirected international wire priced the same as the document's own incoming international line is that incoming wire.
const HELD = ["Incoming International Wire | $45.00", "Outgoing Wire (Domestic) | $25.00", "Foreign Wire: | $45.00", "Research Bank Records: | $20.00 Per Hour plus $.50 per copy"].join("\n");
const HELD_ROW = row(118155, HELD, "Foreign Wire", 45);
const ROWS = [HELD_ROW, MISMATCH_ROW, CLEAN_ROW];

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
  it("matches an undirected international wire priced as the document's incoming one, and passes a line that names it", () => {
    const found = findInternationalDirections([...ROWS, HELD_ROW]);
    expect(found.checked).toBe(3);
    expect(found.passing).toEqual([300]);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.match])).toEqual([[87860, "direction_mismatch"], [118155, "direction_missing"]]);
    expect(found.matches[1]).toMatchObject({ reason: "international_direction: direction_missing", sourceLine: "Foreign Wire: | $45.00", sourceCategory: null });
    expect(found.undirectedOutgoing).toBe(0);
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
    const reread = { ...HELD_ROW, normalized_text: `${AMARILLO}\nNew`, text_hash: sha(`${AMARILLO}\nNew`) };
    const missing = row(402, null, "Foreign Wire", 45);
    const held = { ...HELD_ROW, fee_published_id: "403", outlier_flags: ["knox_eligibility:international_wire"] };
    const found = findInternationalDirections([reread, missing, held]);
    expect(found).toMatchObject({ matched: 0, textChanged: 2, eligibilityHeld: 1 });
  });

  it("never judges a fee against another institution's text, even one that hashes right", () => {
    const otherOwner = { ...HELD_ROW, text_institution_id: String(Number(HELD_ROW.institution_id) + 1) };
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
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "118155" }]);
    if (text.includes("FROM published_fee_records fp")) return options.failRead ? Promise.reject(new Error("read failed")) : Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckInternationalDirections>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("recheckInternationalDirections (#1912)", () => {
  it("is on (v3 sampled clean, 7 of 7); switched off it only reports, on the run ledger", async () => {
    expect(INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE).toBe(true);
    const db = dbFor(ROWS);
    const result = await recheckInternationalDirections(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: false });
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
    const result = await recheckInternationalDirections(asDb(db), { runId: 7, dryRun: false, limit: 3, live: false });
    expect(result).toMatchObject({ afterId: 100, nextAfterId: 300 });
  });

  it("switched on, flags a first failure and takes the fee down on its second look 12 hours on", async () => {
    const first = await recheckInternationalDirections(asDb(dbFor(ROWS)), { runId: 8, dryRun: false, live: true });
    expect(first.flagged).toBe(2);
    expect(first.takenDown).toEqual([]);

    const second = dbFor([HELD_ROW], {
      flags: [{ fee_published_id: "118155", kind: "takedown_pending", evidence: { flag_run_id: 8, flagged_at: "2026-10-27T00:00:00Z", reason: "international_direction: direction_missing" } }],
    });
    const result = await recheckInternationalDirections(asDb(second), { runId: 9, dryRun: false, live: true, now: new Date("2026-10-27T13:00:00Z") });
    expect(result.takenDown).toEqual([118155]);
    const written = texts(second);
    expect(written.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
    expect(written.some((text) => text.includes("darwin.international_direction_takedown"))).toBe(true);
  });

  it("reports nothing when the read fails", async () => {
    const result = await recheckInternationalDirections(asDb(dbFor(ROWS, { failRead: true })), { runId: 7, dryRun: false });
    expect(result).toMatchObject({ checked: 0, matched: 0 });
  });
});

// v2 (2026-11-02, PR #2762's sample): verbatim lines of the live fees' stored texts (prod, read-only).
describe("v2: an undirected international wire read in its whole document (#1912)", () => {
  // 90279, Midwest Coalition of Labor CU (text 13174): incoming wires have their own line.
  const MIDWEST = ["Midwest Coalition of Labor Credit Union", "FEE SCHEDULE", "(Effective January 1, 2023)", "General Fees",
    "- Bank Checks1 | $1.00", "- Monthly/Quarterly Printed Statements2 | $2.00", "- Incoming Wire Transfers | Free",
    "- Domestic Wire Transfers | $25.00", "- International Wire Transfers | $50.00", "- Return Check or ACH | $25.00"].join("\n");
  // 73732 (text 36173): "Domestic wire (incoming) | FREE".
  const FOUR_SEVEN_THREE_NINE = ["Other Service Fees", "Notary service | FREE", "Deposited item return fee | $5.00",
    "Next-day ACH transfer | FREE", "Domestic wire (outgoing) | $15.00", "Domestic wire (incoming) | FREE",
    "International wire | $35.00", "Online banking | FREE", "Bill pay | FREE"].join("\n");
  // 70332 (text 16149): "Wire Transfers – Incoming | $15 each".
  const TWO_SIXTY = ["Wire transfers – outgoing:", "", "Consumer | $20 each", "", "Heritage Club Members | $15 each", "",
    "Wire Transfers – Incoming | $15 each", "", "International Wires | $60 + costs per wire", "",
    "Services and fees are subject to change at any time."].join("\n");
  // 71822 (text 39215): "Wire Transfers:" over "Incoming | $20.00", "International | $65.00", "Outgoing | $30.00".
  const EIGHTEEN_NINETY = ["Telephone Transfers - Per request | $7.00", "", "Treasury Securities - Sent for collection | $25.00", "",
    "Wire Transfers:", "", "Incoming | $20.00", "", "International | $65.00", "", "Outgoing | $30.00", "", "Rev. 3/1/2026"].join("\n");
  // 137423 (text 27658): the bank says it does not offer the service.
  const NOT_OFFERED = ["Western Union / Wire Transfer - International (At This Time, We Do Not Allow International WU or Wire Transfers) | $55 each",
    "Stop Payment | $30 each"].join("\n");
  // 113188-shaped: no wire line names a direction.
  const NO_DIRECTION = ["PAYMENTS & TRANSFERS", "Stop Payment Order | $15.00", "Domestic Wire Transfer | $20.00", "International Wire Transfer | $50.00"].join("\n");

  it("keeps 90279, 73732, 70332 and 71822 live as the outgoing international wire", () => {
    const rows = [row(90279, MIDWEST, "International Wire Transfers", 50), row(73732, FOUR_SEVEN_THREE_NINE, "International wire", 35),
      row(70332, TWO_SIXTY, "International Wires", 60), row(71822, EIGHTEEN_NINETY, "Wire Transfers: International", 65)];
    for (const one of rows) {
      const found = findInternationalDirections([one]);
      expect(found.matches.map((fee) => fee.feePublishedId), String(one.fee_published_id)).toEqual([]);
      expect(found.passing).toEqual([Number(one.fee_published_id)]);
      expect(found.undirectedOutgoing).toBe(1);
    }
  });

  it("keeps one whose document names no wire direction at all", () => {
    expect(findInternationalDirections([row(113188, NO_DIRECTION, "International Wire Transfer", 50)])).toMatchObject({ matched: 0, undirectedOutgoing: 1 });
  });

  it("still takes down 137423, a wire the bank says it does not offer", () => {
    const name = "Western Union / Wire Transfer - International (At This Time, We Do Not Allow International WU or Wire Transfers)";
    const found = findInternationalDirections([row(137423, NOT_OFFERED, name, 55)]);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.match, fee.reason])).toEqual([[137423, "not_offered", "international_direction: not_offered"]]);
    expect(found.undirectedOutgoing).toBe(0);
  });

  it("still holds one filed incoming: the undirected line is the outgoing price", () => {
    expect(findInternationalDirections([row(502, MIDWEST, "International Wire Transfers", 50, "wire_intl_incoming")])).toMatchObject({ matched: 1, byReason: { direction_missing: 1 } });
  });

  it("is version 3 and reports the kept count on the run ledger", async () => {
    expect(INTERNATIONAL_DIRECTION_CHECK_VERSION).toBe(3);
    const result = await recheckInternationalDirections(asDb(dbFor([row(90279, MIDWEST, "International Wire Transfers", 50)])), { runId: 7, dryRun: true });
    expect(internationalDirectionDetail(result)).toMatchObject({ version: 3, undirected_outgoing: 1, matched: 0 });
  });
});

// v3 (2026-11-02, the v2 sample: 17 of 20 wrong): verbatim lines of the live fees' stored texts (prod, read-only).
describe("v3: an undirected international wire is the outgoing price unless priced as the incoming one (#1912)", () => {
  // 65352: the schedule prices only outgoing wires.
  const SIXTY_FIVE = ["Money Order Customer | $2.50", "", "Money Order Non-Customer | $5.50", "",
    "Dormant Account Charge(per statement cycle) | $10.00", "", "Outgoing Wire Fee | $30.00", "", "Foreign Wire Fee | $50.00", "",
    "Collection Fee/Sight Draft Fee | $25.00"].join("\n");
  // 109961: one line prices both directions; the $20 is the incoming price.
  const BOTH = ["Domestic Wire Transfers | $5.00 (Incoming) | $20.00 (Outgoing)",
    "International Wire Transfers | $20.00 (Incoming) | $40.00 (Outgoing)"].join("\n");
  // 139028: a fee-free schedule prints $0.00 for every wire, both directions.
  const FEE_FREE = ["Wire Transfer Fee (Domestic) | $0.00", "", "Wire Transfer Fee (International) | $0.00", "",
    "Incoming Wire – Domestic | $0.00", "", "Incoming Wire – International | $0.00", "", "Outgoing Wire – Domestic | $0.00", "",
    "Outgoing Wire – International Wire (USD) | $0.00"].join("\n");
  // 139807, Embers CU: prose that says "receiving" is no incoming price.
  const EMBERS = ["Outgoing wires", "",
    "To send a wire from your Embers account, you’ll need to provide complete outgoing wire instructions for the financial institution or recipient receiving the funds.", "",
    "Outgoing wire requests must be received by:", "", "Domestic wires: 4:00 p.m. Eastern Time", "International wires: 3:00 p.m. Eastern Time", "",
    "Outgoing wires require a member signature or callback verification using the current phone number on file with Embers Credit Union.", "",
    "Fees are:", "", "Domestic wire: $20", "International wire: $40", "",
    "There is a $40 fee for international wires. Because international wire requirements can vary by country and receiving financial institution, it’s best to have as much information as possible before submitting your request."].join("\n");
  // 152355, Fulton Bank: a monthly module priced as the international incoming wire.
  const FULTON = ["WIRE TRANSFER SERVICES", "Domestic/International Incoming (USD) | $15.00 | Per Wire", "Domestic Outgoing (USD) | $40.00 | Per Wire",
    "International Incoming | $20.00 | Per Wire", "International Wire Module | $20.00 | Per Month"].join("\n");

  it("keeps 65352 live: a schedule that prices only outgoing wires", () => {
    const found = findInternationalDirections([row(65352, SIXTY_FIVE, "Foreign Wire Fee", 50)]);
    expect(found).toMatchObject({ matched: 0, undirectedOutgoing: 1, passing: [65352] });
  });

  it("keeps one beside another line pricing an international wire as outgoing: a duplicate or second tier", () => {
    const priced = ["Incoming Wire | $15.00", "International Wire Outgoing | $45.00", "International Wire | $35.00"].join("\n");
    expect(findInternationalDirections([row(501, priced, "International Wire", 35)])).toMatchObject({ matched: 0, undirectedOutgoing: 1 });
  });

  it("keeps one whose price differs from the document's incoming international price", () => {
    const text = ["International Wire Incoming | $15.00", "International Wire | $45.00"].join("\n");
    expect(findInternationalDirections([row(503, text, "International Wire", 45)])).toMatchObject({ matched: 0, undirectedOutgoing: 1 });
  });

  it("takes down one priced as the incoming international wire, under a heading too", () => {
    const found = findInternationalDirections([row(152355, FULTON, "International Wire Module", 20)]);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.match])).toEqual([[152355, "direction_missing"]]);
    const headed = ["International Wires:", "Incoming | $15.00", "Outgoing | $45.00", "Wire Transfer - International | $15.00"].join("\n");
    expect(findInternationalDirections([row(504, headed, "Wire Transfer - International", 15)])).toMatchObject({ matched: 1 });
  });

  it("keeps 139028 (both directions $0.00) and 139807 (prose is no incoming price)", () => {
    expect(findInternationalDirections([row(139028, FEE_FREE, "Wire Transfer Fee (International)", 0)])).toMatchObject({ matched: 0, undirectedOutgoing: 1 });
    expect(findInternationalDirections([row(139807, EMBERS, "International wire", 40)])).toMatchObject({ matched: 0, undirectedOutgoing: 1 });
  });

  it("still takes down 109961, whose line prices $20.00 as incoming", () => {
    const found = findInternationalDirections([row(109961, BOTH, "International Wire Transfers", 20)]);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.match])).toEqual([[109961, "direction_mismatch"]]);
  });
});
