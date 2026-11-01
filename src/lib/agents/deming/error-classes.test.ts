import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  classRecord,
  errorClassesDetail,
  errorClassLines,
  isNameFamilyClass,
  nameFamily,
  nameFamilyRows,
  patternLabel,
  type NameErrorRow,
  readErrorClasses,
  runErrorClasses,
  summarizeErrorClasses,
  summarizeRows,
  ERROR_CLASS_CHECK,
  ERROR_CLASS_KIND,
  ERROR_CLASS_LIMIT,
  NAME_CLASS_LIMIT,
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

  it("names an amount class by its layout and says whether today's check already blocks it (#2067)", () => {
    const [cls] = summarizeRows([{ ...row("extract", "wrong_amount", "amount:footnote_glued_price", 3), passes_today: 2 }]).classes;
    expect(cls).toMatchObject({ owner: "knox", passesToday: 2 });
    expect(patternLabel(cls.pattern)).toMatch(/footnote mark glued/);
    expect(classRecord(cls).body).toMatch(/still passes 2 of 3 rows.*write the extraction rule/);
    const [blocked] = summarizeRows([{ ...row("extract", "wrong_amount", "amount:price_before_label", 4), passes_today: 0 }]).classes;
    expect(classRecord(blocked).body).toMatch(/refuses all 4 rows/);
    expect(classRecord(summarizeRows([row("extract", "wrong_amount", "category:nsf", 2)]).classes[0]).body).not.toMatch(/source check/);
  });

  describe("name families", () => {
    let nextId = 1000;
    const named = (institution: number, name: string, category: string | null, extra: Partial<NameErrorRow> = {}): NameErrorRow => ({
      feedback_id: nextId++, about_stage: "extract", kind: "wrong_category", check_name: "hamilton.category_guard:v3",
      institution_id: institution, fee_published_id: institution * 10 + (nextId % 10), canonical_fee_key: category, fee_name: name, amount_row: false, ...extra,
    });

    it("puts names printed different ways in one family, from Knox's own name rules", () => {
      expect(nameFamily("Wire Transfer - Outgoing Domestic")).toBe("name:wire_domestic_outgoing");
      expect(nameFamily("Outgoing domestic wire")).toBe("name:wire_domestic_outgoing");
      expect(nameFamily("NSF Item Returned")).toBe("name:nsf");
      expect(nameFamily("Returned item fee")).toBe("name:nsf");
      // A name the rules do not file falls back to the lesson family (#2068), and one word is too broad.
      expect(nameFamily("Lobby Kiosk Usage")).toBe("name_words:kiosk lobby usage");
      expect(nameFamily("Usage of Lobby Kiosks Fee")).toBe("name_words:kiosk lobby usage");
      expect(nameFamily("Annual")).toBeNull();
      expect(nameFamily("")).toBeNull();
      expect(nameFamily(null)).toBeNull();
    });

    it("lists one class across banks for a name family filed under different categories, without changing the row counts", () => {
      const summary = summarizeRows([row("extract", "wrong_category", "category:overdraft", 1), row("extract", "wrong_category", "category:account_research", 1)], 7, [
        named(1, "NSF Item Returned", "overdraft"),
        named(2, "Returned item fee", "account_research"),
        named(2, "Returned Item", "account_research"),
      ]);
      expect(summary.confirmedRows).toBe(2);
      expect(summary.oneBankPatterns).toBe(2);
      expect(summary.nameFamilyClasses).toBe(1);
      expect(summary.nameRowsRead).toBe(3);
      expect(summary.classes).toHaveLength(1);
      const [cls] = summary.classes;
      expect(cls).toMatchObject({ key: "extract:wrong_category:name:nsf", owner: "knox", banks: 2, rows: 3, categories: ["account_research", "overdraft"], checks: ["hamilton.category_guard"] });
      expect(cls.exampleInstitutions).toEqual([1, 2]);
      expect(isNameFamilyClass(cls)).toBe(true);
      expect(patternLabel(cls.pattern)).toMatch(/^fees named as /);
      expect(classRecord(cls).body).toContain("filed under `account_research`, `overdraft`");
    });

    it("skips a family that only restates one category's class, and keeps one with no category or a live wrong amount", () => {
      const same = nameFamilyRows([named(1, "Wire Transfer - Outgoing Domestic", "wire_domestic_outgoing"), named(2, "Outgoing domestic wire", "wire_domestic_outgoing")]);
      expect(same).toEqual([]);
      const uncategorised = nameFamilyRows([named(1, "Wire Transfer - Outgoing Domestic", null), named(2, "Outgoing domestic wire", "wire_domestic_outgoing")]);
      expect(uncategorised.map((group) => [group.pattern, group.banks, group.categories])).toEqual([["name:wire_domestic_outgoing", 2, ["none", "wire_domestic_outgoing"]]]);
      const amounts = nameFamilyRows([
        named(1, "Wire Transfer - Outgoing Domestic", "wire_domestic_outgoing", { kind: "wrong_amount", amount_row: true }),
        named(2, "Outgoing domestic wire", "wire_domestic_outgoing", { kind: "wrong_amount", amount_row: true }),
      ]);
      expect(amounts.map((group) => group.pattern)).toEqual(["name:wire_domestic_outgoing"]);
    });

    it("keeps stages and kinds apart, and a family at one bank is not a class", () => {
      const summary = summarizeRows([], 7, [
        named(1, "NSF Item Returned", "overdraft"),
        named(2, "Returned item fee", "account_research", { about_stage: "verify" }),
        named(3, "Returned item fee", "account_research", { kind: "duplicate" }),
      ]);
      expect(summary.classes).toEqual([]);
      expect(summary.nameFamilyClasses).toBe(0);
    });

    it("never lets name classes push a category class off the list", () => {
      const categories = Array.from({ length: ERROR_CLASS_LIMIT }, (_, i) => row("extract", "wrong_category", `category:c${i}`, 2));
      const names = Array.from({ length: 30 }, (_, i) => named(100 + i, "NSF Item Returned", i % 2 ? "overdraft" : "account_research"));
      const summary = summarizeRows(categories, 7, names);
      expect(summary.classes.filter((cls) => !isNameFamilyClass(cls))).toHaveLength(ERROR_CLASS_LIMIT);
      expect(summary.classes.filter(isNameFamilyClass)).toHaveLength(1);
      // The widest class still leads the list.
      expect(summary.classes[0].key).toBe("extract:wrong_category:name:nsf");
      expect(NAME_CLASS_LIMIT).toBeGreaterThan(0);
    });

    it("keeps the category classes when the name read fails", async () => {
      const db = ((strings: TemplateStringsArray) => {
        const text = strings.join("?");
        return text.includes("AS amount_row") ? Promise.reject(new Error("name read failed")) : Promise.resolve([]);
      }) as unknown as Parameters<typeof readErrorClasses>[0];
      const summary = await readErrorClasses(db, 7);
      expect(summary).toMatchObject({ confirmedRows: 0, nameReadFailed: true, nameReadError: "name read failed" });
      expect(summary.nameRowsRead).toBeUndefined();
      expect(errorClassesDetail({ asOf: "2026-10-26", written: 0, skipped: [], summary })).toMatchObject({ name_read_failed: true, name_read_error: "name read failed" });
    });

    it("shows the name-family count in the step's summary and run-ledger detail", () => {
      const result = {
        asOf: "2026-10-26", written: 1, skipped: [],
        summary: summarizeRows([], 7, [named(1, "NSF Item Returned", "overdraft"), named(2, "Returned item fee", "account_research")]),
      };
      expect(summarizeErrorClasses(result)).toContain("into 1 class (1 by name family) across banks");
      const detail = errorClassesDetail(result);
      expect(detail).toMatchObject({ name_family_classes: 1, name_rows_read: 2, name_row_limit_hit: false, classes: 1 });
      expect(detail.top[0]).toMatchObject({ key: "extract:wrong_category:name:nsf", categories: ["account_research", "overdraft"] });
      // A summary from before name families keeps its shape: no name fields on a category class.
      const old = errorClassesDetail({ ...result, summary: summarizeRows([row("extract", "wrong_category", "category:bill_pay", 3)]) });
      expect(old).toMatchObject({ name_family_classes: null, name_rows_read: null });
      expect(old.top[0]).not.toHaveProperty("categories");
    });
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
