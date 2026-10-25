import { describe, expect, it, vi } from "vitest";

import { EDITION_HEAD_CHARS, EDITION_SCAN_CHARS, editionStarts, effectiveDate } from "@/lib/agents/hamilton/schedule-edition";
import {
  calendarDate,
  isStaleStatedDate,
  readStatedDate,
  runStatedDatePass,
  STATED_DATE_EVENT,
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

function mockDb(options: { ready: boolean; rows?: Array<Record<string, unknown>> }) {
  const calls: Call[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
    calls.push({ text, values });
    if (text.includes("information_schema.columns")) return Promise.resolve([{ ready: options.ready }]);
    if (text.includes("-- magellan stated dates")) return Promise.resolve((options.rows ?? []).map((row) => ({ id: row.id, institution_id: row.institution_id, document_url: row.document_url, head: row.head })));
    if (text.includes("-- magellan stated-date live fees")) {
      return Promise.resolve((options.rows ?? []).filter((row) => Number(row.live_fees) > 0).map((row) => ({ id: row.id, live_fees: row.live_fees })));
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
    const select = calls.find((c) => c.text.includes("-- magellan stated dates"))!;
    expect(select.text).toContain("stated_date_version IS NULL OR doc.stated_date_version <");
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
