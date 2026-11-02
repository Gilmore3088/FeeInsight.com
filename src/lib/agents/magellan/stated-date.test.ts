import { describe, expect, it, vi } from "vitest";

import { EDITION_HEAD_CHARS, EDITION_SCAN_CHARS, editionStarts, effectiveDate } from "@/lib/agents/hamilton/schedule-edition";
import {
  calendarDate,
  countBackfill,
  isStaleStatedDate,
  readCurrentStatedDate,
  readStatedDate,
  readStatedDateV2,
  runStatedDatePass,
  STATED_DATE_BACKFILL_LIVE,
  STATED_DATE_BACKFILL_SHADOW_PER_STEP,
  STATED_DATE_EVENT,
  STATED_DATE_FUTURE_DAYS,
  STATED_DATE_READER_VERSION,
  STATED_DATE_SCAN_CHARS,
  STATED_DATE_VERSION,
  staleBefore,
  statedDateReplaces,
  urlYear,
} from "./stated-date";

const NOW = new Date("2026-10-25T12:00:00Z");

describe("readStatedDate", () => {
  it("reads an effective statement with its words as evidence", () => {
    const text = "FIRST BANK\nSCHEDULE OF FEES\nEffective January 1, 2022\nOverdraft $30.00";
    expect(readStatedDate(text, "https://bank.example/fees.pdf", NOW)).toEqual({
      date: "2022-01-01",
      basis: "effective_statement",
      evidence: "Effective January 1, 2022",
    });
  });

  it("reads the date the way Hamilton's effectiveDate() does", () => {
    for (const text of [
      "Fees Effective September 1, 2023",
      "Effective Date: April 10, 2026",
      "Effective as of 8/1/2026",
      "Effective 03-15-24 until changed",
      "Effective March 1, 2024. Changes effective December 1, 2026: wire $30.",
    ]) {
      expect(readStatedDate(text, null, NOW).date).toBe(effectiveDate(text));
    }
  });

  it("reads a schedule's edition line past a web page's menu, as Hamilton's editionStarts() does", () => {
    const menu = "Home | Personal | Business | Loans | About | Contact\n".repeat(Math.ceil(EDITION_HEAD_CHARS / 50) + 1);
    const text = `${menu}FEE SCHEDULE\nEffective 1 March 2022\nOverdraft $30.00`;
    // effectiveDate() does not read "1 March 2022"; the edition reader does, past the menu.
    expect(effectiveDate(text)).toBeNull();
    expect(editionStarts(text)).toBe("2022-03-01");
    expect(readStatedDate(text, null, NOW)).toEqual({ date: "2022-03-01", basis: "effective_statement", evidence: "Effective 1 March 2022" });
  });

  it("keeps the later of the edition and a change the schedule announces", () => {
    expect(readStatedDate("SCHEDULE OF FEES\nEffective March 1, 2024. Changes effective December 1, 2026: wire $30.", null, NOW)).toEqual({
      date: "2026-12-01",
      basis: "effective_statement",
      evidence: "effective December 1, 2026: wire $30.",
    });
  });

  it("takes the latest date, so a later change or revision makes the schedule newer", () => {
    expect(readStatedDate("Effective January 1, 2021\nOverdraft $30\nRevised 03/2025", null, NOW)).toMatchObject({
      date: "2025-03-01",
      basis: "printed_date",
      evidence: "Revised 03/2025",
    });
    expect(readStatedDate("Rev. 1/15/2020\nEffective July 1, 2024", null, NOW)).toMatchObject({ date: "2024-07-01", basis: "effective_statement" });
    expect(readStatedDate("Last updated: January 2023", null, NOW)).toMatchObject({ date: "2023-01-01", basis: "printed_date" });
  });

  it("falls back to the latest year in the address, never a future one", () => {
    expect(readStatedDate("Overdraft $30", "https://bank.example/uploads/2021/05/Fee-Schedule-2022.pdf", NOW)).toEqual({
      date: "2022-01-01",
      basis: "url_year",
      evidence: "2022",
    });
    expect(urlYear("https://bank.example/fees-2027.pdf", 2026)).toBeNull();
    expect(urlYear("https://bank.example/fees%202020.pdf", 2026)).toBe(2020);
    expect(urlYear("https://bank.example/id/120215/fees.pdf", 2026)).toBeNull();
  });

  it("states none for a text and address without a date", () => {
    expect(readStatedDate("Overdraft $30. Effective immediately.", "https://bank.example/fees", NOW)).toEqual({ date: null, basis: "none", evidence: null });
    expect(readStatedDate(null, null, NOW)).toEqual({ date: null, basis: "none", evidence: null });
  });

  it("refuses days that are not on the calendar and words that are not months", () => {
    expect(calendarDate(2023, 2, 31)).toBeNull();
    expect(calendarDate(24, 2, 29)).toBe("2024-02-29");
    expect(readStatedDate("Effective February 31, 2023", null, NOW).date).toBeNull();
    expect(readStatedDate("effective for accounts opened 12 2019", null, NOW).date).toBeNull();
  });

  it("reads only the opening STATED_DATE_SCAN_CHARS characters, as far as Hamilton reads an edition line", () => {
    expect(STATED_DATE_SCAN_CHARS).toBe(EDITION_SCAN_CHARS);
    const text = `${"x".repeat(STATED_DATE_SCAN_CHARS)} Effective January 1, 2020`;
    expect(readStatedDate(text, null, NOW).date).toBeNull();
  });
});

describe("readStatedDate on current schedules the first reader called old (#2615 review, prod excerpts)", () => {
  it("reads 'As of' heading a schedule, not the upload folder's year (doc 2282)", () => {
    const text = "Fee Schedule\nAs of January 1, 2026\nAccount Fees | Safe Deposit Box Fees\nChecks .......... Varies";
    expect(readStatedDate(text, "https://www.unclecu.org/wp-content/uploads/2017/08/feeschedule.pdf", NOW)).toEqual({
      date: "2026-01-01",
      basis: "printed_date",
      evidence: "As of January 1, 2026",
    });
  });

  it("reads 'current as of' when a two-column PDF puts the date on the next line (docs 2307, 15227)", () => {
    const text = "Personal Account\nThe following list of fees is current as of\nSchedule of Fees | September 17, 2026. All fees subject to change.\nGENERAL FEES";
    const stated = readStatedDate(text, "https://www.usccreditunion.org/wp-content/uploads/2023/01/fees.pdf", NOW);
    expect(stated).toMatchObject({ date: "2026-09-17", basis: "printed_date" });
    expect(isStaleStatedDate(stated, NOW)).toBe(false);
  });

  it("reads 'accurate as of' (docs 12171, 31941)", () => {
    for (const [day, iso] of [["October 05, 2026", "2026-10-05"], ["October 12, 2026", "2026-10-12"]]) {
      const text = `TRUTH IN SAVINGS\nThe rates and fees contained in this Disclosure are accurate as of ${day}. If you have any questions`;
      expect(readStatedDate(text, "https://www.hebfcu.org/wp-content/uploads/2022/03/TISA.pdf", NOW)).toMatchObject({ date: iso, basis: "printed_date" });
    }
  });

  it("takes 'FEES CURRENT AS OF' over a rate's effective date (docs 2797, 14512, 27687)", () => {
    const text = "Rates & Fees\nRates effective September 1, 2024\nShare Savings | 0.10%\nFEES CURRENT AS OF: August 3, 2026 AND SUBJECT TO CHANGE\nOverdraft $30.00";
    expect(readStatedDate(text, "https://www.riegelfcu.org/home/ratesfees/fee", NOW)).toEqual({
      date: "2026-08-03",
      basis: "printed_date",
      evidence: "CURRENT AS OF: August 3, 2026",
    });
  });

  it("takes the latest of 'updated 06/2024' and 'current as of 02/27/2026' (doc 32498)", () => {
    const text =
      "FSB Personal Misc Fees/Rate Chart | updated 06/2024\nAccount Activity Copy | $3.00 each\n" +
      "Interest Rates and Annual Percentage Yields are current as of 02/27/2026.\nFees may reduce earnings";
    expect(readStatedDate(text, "https://www.myfsbonline.com/assets/files/aC9Ij8HH", NOW)).toMatchObject({ date: "2026-02-27", basis: "printed_date" });
  });

  it("still calls a schedule old that states only an old date ('Updated January 2019' footer)", () => {
    const stated = readStatedDate("Overdraft $30.00\nWire $25.00\nUpdated January 2019", "https://bank.example/uploads/2025/01/fees.pdf", NOW);
    expect(stated).toMatchObject({ date: "2019-01-01", basis: "printed_date" });
    expect(isStaleStatedDate(stated, NOW)).toBe(true);
  });

  it("does not read a rate's effective date as the schedule's, nor the address once the text states one", () => {
    for (const text of [
      "Rates effective September 1, 2024\nOverdraft $30",
      "Dividend rates are effective 9/1/2024\nOverdraft $30",
      "APY effective September 1, 2024\nOverdraft $30",
    ]) {
      expect(readStatedDate(text, "https://bank.example/uploads/2019/fees.pdf", NOW)).toEqual({ date: null, basis: "none", evidence: null });
    }
    // Fees named beside rates keep the date the schedule's.
    expect(readStatedDate("Fees and rates effective March 1, 2022", null, NOW)).toMatchObject({ date: "2022-03-01", basis: "effective_statement" });
  });

  it("does not read an 'as of' inside a sentence about something else", () => {
    expect(readStatedDate("Accounts opened as of May 1, 2015 keep free checking.\nOverdraft $30", null, NOW).date).toBeNull();
    // A line-start "As of" that opens a sentence about one product (doc 31175).
    expect(readStatedDate("Conditions of Account:\nAs of April 1, 2014, new Silver accounts are not offered.", null, NOW).date).toBeNull();
  });

  it("reads 'As of: June 1 st, 2026' heading a schedule (doc 16616)", () => {
    expect(readStatedDate("SERVICE CHARGES AND FEES\nAs of: June 1 st, 2026\nOverdraft $30", null, NOW)).toMatchObject({ date: "2026-06-01", basis: "printed_date" });
  });
});

describe("statedDateReplaces", () => {
  const old = { oldDate: "2022-01-01", oldBasis: "effective_statement" };
  it("replaces only with a page that states a later date", () => {
    expect(statedDateReplaces({ ...old, candidateUrl: "https://b.example/fees-2026", candidateText: "FEE SCHEDULE\nEffective March 1, 2026", now: NOW })).toMatchObject({
      replaces: true,
      candidate_date: "2026-03-01",
    });
  });

  it("keeps the link when the page states no date, an older one or the same", () => {
    for (const text of ["Overdraft $30\nWire $25", "FEE SCHEDULE\nEffective June 1, 2020", "FEE SCHEDULE\nEffective January 1, 2022"]) {
      const check = statedDateReplaces({ ...old, candidateUrl: "https://b.example/other", candidateText: text, now: NOW });
      expect(check.replaces).toBe(false);
      expect(check.reason).toMatch(/^kept the link/);
    }
  });

  it("never counts the candidate's address year as its date", () => {
    expect(statedDateReplaces({ ...old, candidateUrl: "https://b.example/uploads/2026/fees.pdf", candidateText: "Overdraft $30", now: NOW }).replaces).toBe(false);
  });

  it("counts an old address year to its last day", () => {
    const fromYear = { oldDate: "2021-01-01", oldBasis: "url_year" };
    expect(statedDateReplaces({ ...fromYear, candidateUrl: null, candidateText: "Revised 06/2021", now: NOW }).replaces).toBe(false);
    expect(statedDateReplaces({ ...fromYear, candidateUrl: null, candidateText: "Revised 01/2022", now: NOW }).replaces).toBe(true);
  });
});

describe("statedDateReplaces: an undated page (#2615 review)", () => {
  const undated = "FEE SCHEDULE\nOverdraft $30\nWire $25";

  it("replaces a link dated only by its address year or the older arm's effective year, as before the guard", () => {
    for (const oldBasis of ["url_year", "effective_year"]) {
      const check = statedDateReplaces({ oldDate: "2021-01-01", oldBasis, candidateUrl: "https://b.example/fees", candidateText: undated, now: NOW });
      expect(check, oldBasis).toMatchObject({ replaces: true, candidate_date: null, old_basis: oldBasis });
      expect(check.reason, oldBasis).toMatch(/states no date/);
    }
  });

  it("keeps a link whose old document's text states a date", () => {
    for (const oldBasis of ["effective_statement", "printed_date"]) {
      const check = statedDateReplaces({ oldDate: "2022-01-01", oldBasis, candidateUrl: "https://b.example/fees", candidateText: undated, now: NOW });
      expect(check, oldBasis).toMatchObject({ replaces: false, candidate_date: null });
      expect(check.reason, oldBasis).toMatch(/^kept the link: .*states no date/);
    }
  });

  it("still holds a dated page to a later date when the old date is only an address year", () => {
    const check = statedDateReplaces({ oldDate: "2021-01-01", oldBasis: "url_year", candidateUrl: null, candidateText: "FEE SCHEDULE\nEffective March 1, 2019", now: NOW });
    expect(check).toMatchObject({ replaces: false, candidate_date: "2019-03-01" });
  });

  it("keeps hebfcu's link against an undated page: October 12, 2026 is printed on its document (institution 6072)", () => {
    expect(statedDateReplaces({ oldDate: "2026-10-12", oldBasis: "printed_date", candidateUrl: "https://www.hebfcu.org/fee-schedule", candidateText: undated, now: NOW }).replaces).toBe(false);
  });
});

describe("statedDateReplaces: the older freshness arm and rate lines (#2615 review)", () => {
  it("holds a link the older arm sent by its year to a page dated after that year", () => {
    const fromEffectiveYear = { oldDate: "2022-01-01", oldBasis: "effective_year" };
    expect(statedDateReplaces({ ...fromEffectiveYear, candidateUrl: null, candidateText: "FEE SCHEDULE\nEffective June 1, 2022", now: NOW }).replaces).toBe(false);
    expect(statedDateReplaces({ ...fromEffectiveYear, candidateUrl: null, candidateText: "FEE SCHEDULE\nEffective March 1, 2023", now: NOW }).replaces).toBe(true);
  });

  it("keeps hebfcu's link: its document states October 12, 2026, though its address names 2022 (institution 6072)", () => {
    const hebfcu = { oldDate: "2026-10-12", oldBasis: "printed_date" };
    const check = statedDateReplaces({ ...hebfcu, candidateUrl: "https://www.hebfcu.org/fee-schedule", candidateText: "FEE SCHEDULE\nEffective March 1, 2026\nOverdraft $30", now: NOW });
    expect(check).toMatchObject({ replaces: false, old_date: "2026-10-12", candidate_date: "2026-03-01" });
  });

  it("does not count a page's rate line stamped with today's date", () => {
    const old = { oldDate: "2022-01-01", oldBasis: "effective_statement" };
    for (const text of [
      "SAVINGS RATES\nRates current as of October 24, 2026\nOverdraft $30",
      "Dividend rates updated 10/24/2026\nOverdraft $30",
      "Interest Rates and Annual Percentage Yields are current as of 10/24/2026.\nFees may reduce earnings.",
      "Overdraft $30\nEffective October 24, 2026, our certificate APY is 4.00%.",
    ]) {
      const check = statedDateReplaces({ ...old, candidateUrl: null, candidateText: text, now: NOW });
      expect(check.replaces, text).toBe(false);
      expect(check.candidate_date, text).toBeNull();
    }
  });

  it("still counts a line that dates fees, or fees and rates together", () => {
    const old = { oldDate: "2022-01-01", oldBasis: "effective_statement" };
    for (const text of ["FEES CURRENT AS OF: August 3, 2026\nRates effective September 1, 2024", "Fees and rates current as of August 3, 2026", "As of August 3, 2026\nOverdraft $30"]) {
      expect(statedDateReplaces({ ...old, candidateUrl: null, candidateText: text, now: NOW })).toMatchObject({ replaces: true, candidate_date: "2026-08-03" });
    }
  });

  it("dates a stored document by its rate currency line as before (doc 32498)", () => {
    const doc32498 =
      "Personal Miscellaneous Fees and Charges\nOverdraft Charge | $29.00\nFSB Personal Misc Fees/Rate Chart | updated 06/2024\n" +
      "Money Market Account | 0.40% | 0.40%\nInterest Rates and Annual Percentage Yields are current as of 02/27/2026.\nFees may reduce earnings on these accounts.";
    expect(readStatedDate(doc32498, "https://www.myfsbonline.com/assets/files/aC9Ij8HH", NOW)).toMatchObject({ date: "2026-02-27", basis: "printed_date" });
    // As a page found to replace a link, only its fee chart's line counts.
    expect(readStatedDate(doc32498, null, NOW, { skipRateLines: true })).toMatchObject({ date: "2024-06-01", basis: "printed_date" });
  });
});

describe("isStaleStatedDate", () => {
  it("is old more than 24 months before today", () => {
    expect(staleBefore(NOW)).toBe("2024-10-25");
    expect(isStaleStatedDate({ date: "2024-10-24", basis: "effective_statement" }, NOW)).toBe(true);
    expect(isStaleStatedDate({ date: "2024-10-25", basis: "effective_statement" }, NOW)).toBe(false);
    expect(isStaleStatedDate({ date: null, basis: "none" }, NOW)).toBe(false);
  });

  it("counts a year from the address from its last day", () => {
    expect(isStaleStatedDate({ date: "2024-01-01", basis: "url_year" }, NOW)).toBe(false);
    expect(isStaleStatedDate({ date: "2023-01-01", basis: "url_year" }, NOW)).toBe(true);
  });
});

type Call = { text: string; values: unknown[] };

function mockDb(options: { ready: boolean; rows?: Array<Record<string, unknown>>; shadowRows?: Array<Record<string, unknown>> }) {
  const calls: Call[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
    calls.push({ text, values });
    if (text.includes("information_schema.columns")) return Promise.resolve([{ ready: options.ready }]);
    if (text.includes("-- magellan stated dates")) {
      const picked = values.includes("shadow") ? options.shadowRows ?? [] : options.rows ?? [];
      return Promise.resolve(picked.map((row) => ({ id: row.id, institution_id: row.institution_id, document_url: row.document_url, head: row.head, prior_version: row.prior_version ?? null, prior_date: row.prior_date ?? null, prior_basis: row.prior_basis ?? null })));
    }
    if (text.includes("-- magellan stated-date live fees")) {
      return Promise.resolve([...(options.rows ?? []), ...(options.shadowRows ?? [])].filter((row) => Number(row.live_fees) > 0).map((row) => ({ id: row.id, live_fees: row.live_fees })));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as Parameters<typeof runStatedDatePass>[0], calls };
}

const ROWS = [
  { id: 11, institution_id: 1, document_url: "https://a.example/fees.pdf", live_fees: 12, head: "SCHEDULE OF FEES\nEffective January 1, 2022" },
  { id: 12, institution_id: 2, document_url: "https://b.example/fees.pdf", live_fees: 4, head: "Effective June 1, 2026" },
  { id: 13, institution_id: 3, document_url: "https://c.example/2021/fees.pdf", live_fees: "3", head: "Overdraft $30" },
  { id: 14, institution_id: 4, document_url: "https://d.example/fees", live_fees: 0, head: "Overdraft $30" },
];

describe("runStatedDatePass", () => {
  it("reads and writes nothing before the migration's columns exist", async () => {
    const { db, calls } = mockDb({ ready: false, rows: ROWS });
    const result = await runStatedDatePass(db, { runId: 1, stepId: 2, now: NOW });
    expect(result).toMatchObject({ schema_ready: false, read: 0 });
    expect(calls.map((c) => c.text).some((text) => text.includes("source_documents doc"))).toBe(false);
  });

  it("dates each document, writes the three columns and records one run event", async () => {
    const { db, calls } = mockDb({ ready: true, rows: ROWS });
    const result = await runStatedDatePass(db, { runId: 1, stepId: 2, now: NOW });
    expect(result).toMatchObject({
      schema_ready: true,
      read: 4,
      dated: 3,
      by_basis: { effective_statement: 2, printed_date: 0, url_year: 1, none: 1 },
      stale: 2,
      stale_live_fees: 15,
      stale_before: "2024-10-25",
    });
    expect(result.stale_samples.map((s) => [s.source_document_id, s.stated_date, s.basis, s.evidence])).toEqual([
      [11, "2022-01-01", "effective_statement", "Effective January 1, 2022"],
      [13, "2021-01-01", "url_year", "2021"],
    ]);
    const update = calls.find((c) => c.text.includes("UPDATE source_documents"))!;
    expect(update.values).toEqual([STATED_DATE_VERSION, [11, 12, 13, 14], ["2022-01-01", "2026-06-01", "2021-01-01", ""], ["effective_statement", "effective_statement", "url_year", "none"]]);
    const select = calls.find((c) => c.text.includes("-- magellan stated dates") && c.values.includes("pick"))!;
    expect(calls.map((c) => c.text).join(" ")).toContain("stated_date_version IS NULL OR doc.stated_date_version <");
    expect(select.text).toContain("t.status = 'completed'");
    // The pick never groups the whole catalog: cited is looked up for the undated documents' banks
    // only, and live fees are counted for the picked documents only (#2615 review).
    expect(select.text).not.toContain("published_fee_catalog");
    expect(select.text).toContain("fp.institution_id IN (SELECT institution_id FROM undated)");
    const live = calls.find((c) => c.text.includes("-- magellan stated-date live fees"))!;
    expect(live.text).toContain("FROM published_fee_catalog c");
    expect(live.values).toEqual([[1, 2, 3, 4], [11, 12, 13, 14]]);
    const event = calls.find((c) => c.text.includes("INSERT INTO agent_run_events"))!;
    expect(event.values).toContain(STATED_DATE_EVENT);
    expect(event.values).toContain("completed");
  });

  it("counts no live fees when it picks no document", async () => {
    const { db, calls } = mockDb({ ready: true, rows: [] });
    const result = await runStatedDatePass(db, { runId: 1, now: NOW });
    expect(result).toMatchObject({ read: 0, stale_live_fees: 0 });
    expect(calls.some((c) => c.text.includes("published_fee_catalog"))).toBe(false);
  });

  it("writes no column in a dry run but still records what it read", async () => {
    const { db, calls } = mockDb({ ready: true, rows: ROWS });
    const result = await runStatedDatePass(db, { runId: 1, dryRun: true, now: NOW });
    expect(result).toMatchObject({ dry_run: true, read: 4, stale: 2 });
    expect(calls.some((c) => c.text.includes("UPDATE source_documents"))).toBe(false);
    expect(calls.find((c) => c.text.includes("INSERT INTO agent_run_events"))!.values).toContain("skipped");
  });
});

// v2 (Nov 2 audit): phrasings from the 250 current copies behind live fees that v1 left undated.
const MENU = "Home | Personal | Business | Loans | About Us | Contact | Locations | Careers\n".repeat(120);

describe("readStatedDateV2: dates v1 missed (prod excerpts)", () => {
  const v2 = (text: string, url: string | null = null) => readStatedDateV2(text, url, NOW);

  it("reads a schedule-named effective line past the first 8,000 characters (docs 39443, 40097, 23307, 37532)", () => {
    expect(MENU.length).toBeGreaterThan(STATED_DATE_SCAN_CHARS);
    for (const [line, date] of [
      ["Fee Schedule: Effective 2/1/2026\nACCOUNT SERVICES", "2026-02-01"],
      ["Fee Schedule\n\nEffective as of: June 1, 2023\n\nDESCRIPTION | FEE", "2023-06-01"],
      ["Fees & Charges\n\nFee Schedule Effective February 1, 2023\n\nWhat You Need to Know", "2023-02-01"],
      ["Miscellaneous Fees\nService | Fee\nFees Effective July 13, 2026 As a non-profit", "2026-07-13"],
    ] as const) {
      expect(readStatedDate(`${MENU}${line}`, null, NOW).date).toBeNull();
      expect(v2(`${MENU}${line}`)).toMatchObject({ date, basis: "effective_statement" });
    }
  });

  it("takes a deep fee line over the same page's deep rate lines (doc 41210)", () => {
    const text = `${MENU}Rates effective as of: August 26, 2026\nLoan Rates\nBox 549, Lugoff, SC 29078\nFees effective as of: Feb 1, 2023\nCard Management`;
    expect(v2(text)).toMatchObject({ date: "2023-02-01", basis: "effective_statement" });
  });

  it("does not read a deep effective date of another document or event (docs 9177, 27624, 40304)", () => {
    for (const line of [
      "Membership and Account Agreement - Effective Nov. 1, 2025",
      "Click to view Privacy Policy.\n\nTexting PolicyEffective Date: 7/1/2026",
      "Posting Order of Payment Transactions (Effective June 1, 2026)",
      "Rates Effective as of: 10-27-2026 (PST)",
    ]) {
      expect(v2(`${MENU}${line}\nOther text`).date, line).toBeNull();
    }
  });

  it("reads revision stamps anywhere: 'Rev. 06/2021', 'rev 05.01.2023', 'Updated 06/01/2026' (docs 2748, 22705, 36897, 39516)", () => {
    expect(v2(`${MENU}Truth in Savings\nRev. 10/2016Rev. 06/2021\nMore`)).toMatchObject({ date: "2021-06-01", basis: "printed_date" });
    expect(v2(`${MENU}rev 05.01.2023\n`)).toMatchObject({ date: "2023-05-01", basis: "printed_date" });
    expect(v2(`${MENU}Updated 06/01/2026\n`)).toMatchObject({ date: "2026-06-01" });
    expect(v2(`${MENU}State Bank of Southern Utah Fee Schedule - Revised 09/16/2026 | Cost`)).toMatchObject({ date: "2026-09-16" });
  });

  it("reads footer and form stamps beside a footer mark (docs 25431, 23884, 12804, 20863, 39178)", () => {
    expect(v2("Inactivity Fee $1.00\nWright-Patt Credit Union, Inc. | Beavercreek, Ohio 45431\n(937)912-7000 | (800)762-0047\nFederally Insured by NCUA | 07/2025\n").date).toBe("2025-07-01");
    expect(v2("Federal Credit Union | dcu.org | 800.328.8797\nPO Box 9130\nMarlborough, MA 01752 | Insured by NCUA\nM619 01.2026 ©DCU").date).toBe("2026-01-01");
    expect(v2("IRA Termination fee $50.00\n03/01/2025 Member FDIC").date).toBe("2025-03-01");
    expect(v2("Deposit Corrections .... $2 per deposit\nAmerant Bank, N.A. | Page 1 of 5 | v 09/01/26\n").date).toBe("2026-09-01");
    expect(v2("not FDIC insured, not | www.mountvernonbank.com\nbank guaranteed, and may lose value.\n7/2022\n\nPersonal | Checking").date).toBe("2022-07-01");
  });

  it("does not read a bare date without a footer mark, a post list or a model form", () => {
    expect(v2("Latest news\n09/30/26\nBranch opening\n09/28/26\nShred day").date).toBeNull();
    expect(v2("Overdraft fee $30\n12/2025\nNSF fee $30").date).toBeNull();
    expect(v2("Privacy Notice | PRIV-MODEL 8/1/2010 | Member FDIC").date).toBeNull();
  });

  it("reads 'effective' misspelt or broken by a ligature (docs 22719, 2671)", () => {
    expect(v2("Schedule of Fees\nPersonal Accounts\nEfective March 6, 2024\nChecking")).toMatchObject({ date: "2024-03-06", basis: "effective_statement" });
    expect(v2("FEE SCHEDULE\nEff ective: 5/1/2024\n")).toMatchObject({ date: "2024-05-01", basis: "effective_statement" });
  });

  it("reads an effective month and year (docs 25625, 15900, 13446, 33648, 26841)", () => {
    expect(v2("Effective July, 2024.\n\nSchedule of Fees")).toMatchObject({ date: "2024-07-01", basis: "effective_statement" });
    expect(v2("you may be charged a fee by that ATM operator.\n\nEffective: December, 2022.\n")).toMatchObject({ date: "2022-12-01" });
    expect(v2("Fax 703-925-5113\nSchedule of Fees and Charges\nEffective 11/2026\nChecking Accounts")).toMatchObject({ date: "2026-11-01" });
    expect(v2("Fee of $32.50 for each item\n\nThis information is effective as of March 2025 and is provided as a courtesy")).toMatchObject({ date: "2025-03-01" });
    expect(v2("Dormant Fee: $5/month (Effective August 2024)")).toMatchObject({ date: "2024-08-01" });
  });

  it("reads a heading's own date (docs 19151, 6556, 20113, 37216, 40185)", () => {
    expect(v2("INDUSTRIAL BANK FEE SCHEDULE\nApproved February 22, 2022\nPERSONAL CHECKING ACCOUNTS")).toMatchObject({ date: "2022-02-22", basis: "printed_date" });
    expect(v2("ALPENA ALCONA AREA CREDIT UNION\nJuly 2025\nSchedule of Fees")).toMatchObject({ date: "2025-07-01", basis: "printed_date" });
    expect(v2("Bank\nSchedule of Fees for Consumer Accounts & Services (October 1, 2026)\nChecking")).toMatchObject({ date: "2026-10-01" });
    expect(v2("Home\nSchedule of Fees revised as of May 1, 2026\nChecking")).toMatchObject({ date: "2026-05-01", basis: "printed_date" });
    expect(v2("Fee Schedule\nReviewed: February 1, 2019\n")).toMatchObject({ date: "2019-02-01" });
  });

  it("reads 'as of <date>' ending a sentence about the fees (docs 16837, 35404)", () => {
    expect(v2("Fee Schedule\n\nFees are subject to change. The following fees and charges are applicable to your account(s), services and/or transactions, as of 07.01.2025.\n\nGeneral Fees: | Fee:")).toMatchObject({ date: "2025-07-01", basis: "printed_date" });
    expect(v2("Fees are subject to change. The following fees and charges are applicable to your account(s), services, and/or transactions, as of 03/01/2025\n\nFEE SCHEDULE")).toMatchObject({ date: "2025-03-01" });
  });

  it("refuses phone numbers, years in names, founding years and events (docs 13446, 31839, 27337, 40304, 23338, 41633)", () => {
    for (const text of [
      "Fax 703-925-5113 | (937)912-7000 | 800.328.8797\nOverdraft $30",
      "Serving members since 1902\n2024 Holiday Club Account | $5.00",
      "All locations will be closed on Monday, October 12, 2026 in observance of Columbus Day.",
      "On July 8, 2026, First Capital was named a top workplace.",
      "Holidays\nJanuary 1, 2026 | New Year's Day\nJuly 4, 2026 | Independence Day",
      "Scheduled Maintenance 10/10/26",
      "Monthly fee on business checking accounts opened before 10/26/2020 | No Charge",
      "Dormant fee $5 for accounts with a balance under $250. Starts May 1, 2017.",
      "Offer ends 4/2/2028. The fees as of 4/2/2028.",
      "As of April 1, 2014, new Silver accounts pay a $5 fee.",
      "APY 0.00% as of March 1, 2026. Fees could reduce the earnings.",
    ]) {
      expect(v2(text).date, text).toBeNull();
    }
  });

  it("refuses a date more than STATED_DATE_FUTURE_DAYS ahead, keeping an earlier one", () => {
    expect(STATED_DATE_FUTURE_DAYS).toBe(60);
    expect(v2("Fee Schedule\nRevised 03/2027").date).toBeNull();
    expect(v2("Fee Schedule Effective March 1, 2024\nChanges effective February 1, 2027").date).toBe("2024-03-01");
    expect(v2("Fee Schedule Effective March 1, 2024\nChanges effective December 1, 2026").date).toBe("2026-12-01");
  });

  it("keeps v1's answers on v1's cases", () => {
    for (const text of [
      "FIRST BANK\nSCHEDULE OF FEES\nEffective January 1, 2022\nOverdraft $30.00",
      "Effective January 1, 2021\nOverdraft $30\nRevised 03/2025",
      "Rates effective September 1, 2024\nFEES CURRENT AS OF: August 3, 2026",
      "Fees/Rate Chart | updated 06/2024\nInterest Rates and Annual Percentage Yields are current as of 02/27/2026",
    ]) {
      expect(v2(text).date, text).toBe(readStatedDate(text, null, NOW).date);
    }
    expect(v2("Overdraft $30", "https://c.example/2021/fees.pdf")).toEqual(readStatedDate("Overdraft $30", "https://c.example/2021/fees.pdf", NOW));
  });

  it("is not the reader in use while the backfill is off", () => {
    expect(STATED_DATE_BACKFILL_LIVE).toBe(false);
    expect(STATED_DATE_VERSION).toBe(1);
    expect(STATED_DATE_READER_VERSION).toBe(2);
    const text = `${MENU}Fee Schedule: Effective 2/1/2026`;
    expect(readCurrentStatedDate(text, null, NOW)).toEqual(readStatedDate(text, null, NOW));
  });
});

describe("runStatedDatePass: the v2 backfill dry run", () => {
  const SHADOW = [
    { id: 21, institution_id: 5, document_url: "https://e.example/fees", live_fees: 9, prior_version: 1, prior_date: null, prior_basis: "none", head: `${MENU}Fee Schedule: Effective 2/1/2026` },
    { id: 22, institution_id: 6, document_url: "https://f.example/fees.pdf", live_fees: 3, prior_version: 1, prior_date: "2022-01-01", prior_basis: "effective_statement", head: "SCHEDULE OF FEES\nEffective January 1, 2022" },
    { id: 23, institution_id: 7, document_url: "https://g.example/fees.pdf", live_fees: 2, prior_version: 1, prior_date: "2021-01-01", prior_basis: "effective_statement", head: "Effective January 1, 2021\nOverdraft $30\nIRA fee $25\n03/01/2025 Member FDIC" },
    { id: 24, institution_id: 8, document_url: "https://h.example/fees", live_fees: 0, prior_version: 1, prior_date: null, prior_basis: "none", head: "Overdraft $30" },
  ];

  it("reads v1 documents with v2, writes none of them, and reports counts and samples", async () => {
    const { db, calls } = mockDb({ ready: true, rows: ROWS, shadowRows: SHADOW });
    const result = await runStatedDatePass(db, { runId: 7, stepId: 2, now: NOW });
    expect(result.backfill).toMatchObject({ live: false, reader_version: 2, read: 4, newly_dated: 1, changed: 1, unchanged: 2, lost: 0, live_fees_touched: 11 });
    expect(result.backfill.samples.map((s) => [s.source_document_id, s.prior_date, s.stated_date, s.basis])).toEqual([
      [21, null, "2026-02-01", "effective_statement"],
      [23, "2021-01-01", "2025-03-01", "printed_date"],
    ]);
    expect(result.backfill.samples[0].evidence).toContain("Effective 2/1/2026");
    const update = calls.find((c) => c.text.includes("UPDATE source_documents"))!;
    expect(update.values[1]).toEqual([11, 12, 13, 14]);
    const shadow = calls.find((c) => c.text.includes("-- magellan stated dates") && c.values.includes("shadow"))!;
    expect(shadow.values).toContain(STATED_DATE_BACKFILL_SHADOW_PER_STEP);
    const event = calls.find((c) => c.text.includes("INSERT INTO agent_run_events"))!;
    expect(event.values.find((v) => typeof v === "string" && v.includes("v2 backfill"))).toContain("dry run (STATED_DATE_BACKFILL_LIVE off, nothing written): 4 v1 documents read, 1 newly dated, 1 changed");
  });

  it("counts the new documents v2 would date differently", async () => {
    const { db } = mockDb({ ready: true, rows: [{ id: 31, institution_id: 1, document_url: null, live_fees: 1, head: "Fee Schedule\nApproved February 22, 2022" }] });
    const result = await runStatedDatePass(db, { runId: 1, now: NOW, shadowLimit: 0 });
    expect(result).toMatchObject({ read: 1, dated: 0, v2_would_differ: 1 });
  });
});

describe("countBackfill", () => {
  it("counts a v1 date v2 no longer reads as lost, not as touched", () => {
    const backfill = { live: false, reader_version: 2, read: 0, newly_dated: 0, changed: 0, unchanged: 0, lost: 0, live_fees_touched: 0, by_basis: { effective_statement: 0, printed_date: 0, url_year: 0, none: 0 }, samples: [] };
    countBackfill(backfill, { id: 1, institution_id: 1, document_url: null, head: null, prior_version: 1, prior_date: "2027-03-01", prior_basis: "printed_date" }, { date: null, basis: "none", evidence: null }, 5);
    expect(backfill).toMatchObject({ read: 1, lost: 1, live_fees_touched: 0, samples: [] });
  });
});
