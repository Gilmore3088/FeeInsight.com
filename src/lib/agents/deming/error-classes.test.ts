import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  classRecord,
  errorClassLines,
  patternLabel,
  runErrorClasses,
  summarizeErrorClasses,
  summarizeRows,
  ERROR_CLASS_CHECK,
  ERROR_CLASS_KIND,
} from "./error-classes";

const row = (stage: string, kind: string, pattern: string, banks: number, rows = banks) => ({
  about_stage: stage, kind, pattern, banks, fees: rows, rows,
  checks: ["hamilton.category_guard"], institutions: [1, 2], fee_ids: [11, 12], feedback_ids: [101, 102],
});

describe("error classes (#2063)", () => {
  it("lists a pattern as a class only when it reaches two banks, largest first, and names the stage's owner", () => {
    const summary = summarizeRows([
      row("extract", "non_customer_price", "category:check_cashing", 73, 78),
      row("verify", "wrong_category", "category:early_closure", 268, 276),
      row("read", "no_fees_found", "layout:read.pdf_layout/pdf", 1),
    ]);
    expect(summary.confirmedRows).toBe(78 + 276 + 1);
    expect(summary.oneBankPatterns).toBe(1);
    expect(summary.classes.map((cls) => [cls.key, cls.owner])).toEqual([
      ["verify:wrong_category:category:early_closure", "darwin"],
      ["extract:non_customer_price:category:check_cashing", "knox"],
    ]);
  });

  it("writes the pattern in words, and leaves rows with no pattern out of the classes", () => {
    expect(patternLabel("category:early_closure")).toMatch(/fees$/);
    expect(patternLabel("document:product_page")).toBe("product page documents");
    expect(patternLabel("layout:read.pdf_layout/pdf")).toBe("documents read by read.pdf_layout/pdf");
    const summary = summarizeRows([row("extract", "wrong_amount", "unknown", 40), row("extract", "wrong_amount", "category:nsf", 2)]);
    expect(summary.classes.map((cls) => cls.pattern)).toEqual(["category:nsf"]);
    expect(summary.unpatternedRows).toBe(40);
  });

  it("gives each class a GitHub-ready record that sends the fix to its step", () => {
    const [cls] = summarizeRows([row("extract", "wrong_category", "category:bill_pay", 32, 33)]).classes;
    const record = classRecord(cls);
    expect(record.title).toContain("wrong category at extract");
    expect(record.title).toContain("32 banks");
    expect(record.body).toContain("extract (knox)");
    expect(record.body).toContain("error-fixes.json");
  });

  it("keeps one weight-0 ledger row per class, updated with the day's counts, and writes nothing on a dry run", async () => {
    const reads = [row("extract", "wrong_category", "category:bill_pay", 32, 33)];
    const calls: string[] = [];
    const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      calls.push(query);
      if (query.includes("WITH confirmed")) return Promise.resolve(reads);
      if (query.includes("INSERT INTO pipeline_feedback")) {
        const written = JSON.parse(String(values[0]));
        expect(written).toHaveLength(1);
        expect(written[0]).toMatchObject({ kind: ERROR_CLASS_KIND, check_name: ERROR_CLASS_CHECK, weight: 0, about_stage: "extract", reported_by: "deming",
          dedupe_key: `${ERROR_CLASS_CHECK}:extract:wrong_category:category:bill_pay` });
        expect(written[0].evidence).toMatchObject({ owner: "knox", banks: 32, rows: 33, as_of: "2026-10-25", window_days: 7 });
        expect(written[0].evidence.github_body).toContain("knox");
        return Promise.resolve([{ id: 1 }]);
      }
      return Promise.resolve([]);
    });
    const db = Object.assign(tag, { savepoint: (callback: (scope: typeof tag) => unknown) => callback(tag) }) as never;
    const now = new Date("2026-10-25T04:00:00Z");
    const dry = await runErrorClasses({ db, now, dryRun: true });
    expect(dry.written).toBe(0);
    expect(calls.some((query) => query.includes("INSERT INTO pipeline_feedback"))).toBe(false);
    const live = await runErrorClasses({ db, now, runId: 9 });
    expect(live.written).toBe(1);
    expect(summarizeErrorClasses(live)).toContain("into 1 class across banks");
  });

  it("gives the brief one line: the classes, none, or unavailable", () => {
    expect(errorClassLines(undefined)).toEqual([]);
    expect(errorClassLines(null)).toEqual(["Error classes this week: unavailable today."]);
    expect(errorClassLines(summarizeRows([]))[0]).toContain(": none.");
    const line = errorClassLines(summarizeRows([row("verify", "duplicate", "category:account_research", 29)]))[0];
    expect(line).toContain("Error classes this week (2+ banks): 1. Largest: duplicate at verify");
    expect(line).toContain("29 banks, darwin");
  });
});
