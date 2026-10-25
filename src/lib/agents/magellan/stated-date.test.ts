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
    if (text.includes("-- magellan stated dates")) return Promise.resolve(options.rows ?? []);
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
    const event = calls.find((c) => c.text.includes("INSERT INTO agent_run_events"))!;
    expect(event.values).toContain(STATED_DATE_EVENT);
    expect(event.values).toContain("completed");
  });

  it("writes no column in a dry run but still records what it read", async () => {
    const { db, calls } = mockDb({ ready: true, rows: ROWS });
    const result = await runStatedDatePass(db, { runId: 1, dryRun: true, now: NOW });
    expect(result).toMatchObject({ dry_run: true, read: 4, stale: 2 });
    expect(calls.some((c) => c.text.includes("UPDATE source_documents"))).toBe(false);
    expect(calls.find((c) => c.text.includes("INSERT INTO agent_run_events"))!.values).toContain("skipped");
  });
});
