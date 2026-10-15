import { describe, expect, it } from "vitest";
import {
  maturityTier,
  summarizeFees,
  summarizeFeesBy,
  valuePerInstitution,
  institutionPositions,
  STATS_ROW_FILTER,
  businessSourceSql,
  statsRowFilter,
  sharedScheduleRepresentatives,
  scheduleKeysSql,
  COUNT_SHARED_SCHEDULE_ONCE,
  STATS_SCHEDULE_KEYS,
  STATS_METHOD_VERSION,
} from "./fee-stats";
import { BUSINESS_PATH_SQL, CONSUMER_PATH_SQL, isBusinessOnlyLink } from "@/lib/agents/magellan/link-coverage";

function rowsFor(amounts: (number | string | null)[], charter = "bank") {
  return amounts.map((amount, index) => ({ institution_id: index + 1, amount, charter_type: charter }));
}

describe("fee statistics contract", () => {
  it("counts each institution once, at the median of its own amounts", () => {
    const rows = [
      ...rowsFor([10, 20, 30, 40, 50]),
      { institution_id: 1, amount: 35, charter_type: "bank" },
      { institution_id: 1, amount: "12.00", charter_type: "bank" },
    ];
    expect(valuePerInstitution(rows).get(1)).toBe(12);

    const stats = summarizeFees(rows);
    expect(stats.institution_count).toBe(5);
    expect(stats.observation_count).toBe(7);
    expect(stats.median_amount).toBe(30);
  });

  it("counts a bank's tiered overdraft at its highest (standard) tier", () => {
    const tiers = [5, 20, 35].map((amount) => ({ institution_id: 7, amount, fee_category: "overdraft" }));
    expect(valuePerInstitution(tiers).get(7)).toBe(35);
    // A $0 NSF beside tiered overdraft is its own category and keeps the median rule.
    expect(valuePerInstitution([{ institution_id: 7, amount: 0, fee_category: "nsf" }]).get(7)).toBe(0);
    expect(valuePerInstitution([5, 20, 35].map((amount) => ({ institution_id: 7, amount, fee_category: "nsf" }))).get(7)).toBe(20);
  });

  it("includes $0 fees in the median", () => {
    const stats = summarizeFees(rowsFor([0, 0, 0, 25, 30]));
    expect(stats.median_amount).toBe(0);
    expect(stats.min_amount).toBe(0);
  });

  it("interpolates even-sized medians from NUMERIC strings", () => {
    const stats = summarizeFees(rowsFor(["10.00", "20.00", "30.00", "40.00", "50.00", "60.00"]));
    expect(stats.median_amount).toBe(35);
  });

  it("shows no distribution below five institutions", () => {
    const stats = summarizeFees(rowsFor([10, 20, 30, 40]));
    expect(stats.institution_count).toBe(4);
    expect(stats.median_amount).toBeNull();
    expect(stats.p25_amount).toBeNull();
    expect(stats.min_amount).toBeNull();
    expect(stats.maturity_tier).toBe("insufficient");
  });

  it("does not let duplicate rows reach the minimum sample", () => {
    const rows = [1, 1, 1, 2, 2, 3].map((id) => ({ institution_id: id, amount: 10, charter_type: "bank" }));
    expect(summarizeFees(rows).median_amount).toBeNull();
  });

  it("labels maturity by institutions, not rows", () => {
    expect(maturityTier(4)).toBe("insufficient");
    expect(maturityTier(5)).toBe("provisional");
    expect(maturityTier(19)).toBe("provisional");
    expect(maturityTier(20)).toBe("strong");
  });

  it("does not count unknown charter types as credit unions", () => {
    const stats = summarizeFees([
      { institution_id: 1, amount: 5, charter_type: "bank" },
      { institution_id: 2, amount: 5, charter_type: "credit_union" },
      { institution_id: 3, amount: 5, charter_type: null },
      { institution_id: 4, amount: 5, charter_type: "thrift" },
    ]);
    expect(stats.bank_count).toBe(1);
    expect(stats.cu_count).toBe(1);
    expect(stats.institution_count).toBe(4);
  });

  it("excludes missing prices from the displayed sample as well as the median", () => {
    const stats = summarizeFees([...rowsFor([10, 20, 30, 40]), { institution_id: 9, amount: null, charter_type: "bank" }]);
    expect(stats.institution_count).toBe(4);
    expect(stats.observation_count).toBe(4);
    expect(stats.bank_count).toBe(4);
    expect(stats.median_amount).toBeNull();
  });

  it("summarizes each group separately", () => {
    const rows = [
      ...rowsFor([1, 2, 3, 4, 5]).map((row) => ({ ...row, fee_category: "atm" })),
      ...rowsFor([30, 35]).map((row) => ({ ...row, fee_category: "overdraft" })),
    ];
    const grouped = summarizeFeesBy(rows, (row) => row.fee_category);
    expect(grouped.get("atm")?.median_amount).toBe(3);
    expect(grouped.get("overdraft")?.median_amount).toBeNull();
  });
});

describe("institutionPositions", () => {
  it("compares each institution's median to the category p25/p75 and skips thin categories", () => {
    const rows = [
      ...[10, 20, 30, 40, 50].map((amount, index) => ({ institution_id: index + 1, amount, fee_category: "nsf" })),
      { institution_id: 5, amount: 70, fee_category: "nsf" },
      { institution_id: 1, amount: 0, fee_category: "atm" },
      { institution_id: 2, amount: 3, fee_category: "atm" },
    ];
    const positions = institutionPositions(rows);
    expect(positions.every((position) => position.fee_category === "nsf")).toBe(true);
    expect(positions).toHaveLength(5);
    const top = positions.find((position) => position.institution_id === 5)!;
    expect(top.value).toBe(60);
    expect(top.value).toBeGreaterThan(top.p75);
  });
});

describe("business-only sources (rule 6)", () => {
  it("leaves business-only schedules out of statistics with the same address test Magellan uses", () => {
    expect(STATS_ROW_FILTER).toContain("ef.source_document_id IS NOT NULL");
    expect(STATS_ROW_FILTER).toContain("AND NOT (");
    expect(businessSourceSql("c")).toContain("COALESCE(c.source_url, '')");
    // The SQL applies BUSINESS_PATH_SQL / CONSUMER_PATH_SQL to the lowercased path; mirror it here.
    const sqlSays = (url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "").toLowerCase();
      return new RegExp(BUSINESS_PATH_SQL).test(path) && !new RegExp(CONSUMER_PATH_SQL).test(path);
    };
    for (const url of [
      "https://www.fnbalaska.com/docs/Business-Account-Fee-Schedule.pdf",
      "https://bank.com/personal/fee-schedule.pdf",
      "https://bank.com/commercial-and-consumer-fees.pdf",
      "https://businessbank.com/fees.pdf",
      "https://bank.com/treasury-management/pricing",
    ]) {
      expect(sqlSays(url)).toBe(isBusinessOnlyLink(url));
    }
  });
});


it("counts unknown audience as personal, never business, and keeps real zeros", () => {
  expect(STATS_ROW_FILTER).not.toContain("'business'");
  expect(STATS_ROW_FILTER).toContain("ef.fee_audience IN ('consumer', 'both', 'unknown')");
  expect(STATS_ROW_FILTER).not.toContain("ef.amount > 0");
  expect(valuePerInstitution([{ institution_id: 47, amount: 0, fee_category: "nsf" }]).get(47)).toBe(0);
});


it("does not turn blank, negative or non-finite observations into evidence", () => {
  const stats = summarizeFees([
    ...rowsFor([0, "0.00", 10, 20, 30]),
    { institution_id: 21, amount: "", charter_type: "bank" },
    { institution_id: 22, amount: "  ", charter_type: "credit_union" },
    { institution_id: 23, amount: -1, charter_type: "bank" },
    { institution_id: 24, amount: "NaN", charter_type: "bank" },
    { institution_id: 25, amount: Infinity, charter_type: "bank" },
    { institution_id: 0, amount: 999, charter_type: "bank" },
    { institution_id: -1, amount: 999, charter_type: "bank" },
    { institution_id: "invalid", amount: 999, charter_type: "bank" },
  ]);
  expect(stats).toMatchObject({ institution_count: 5, observation_count: 5,
    bank_count: 5, cu_count: 0, median_amount: 10, min_amount: 0 });
});

it("shares the same audience boundary across SQL aliases without filtering out zero", () => {
  const predicate = statsRowFilter("c");
  expect(predicate).toContain("c.source_document_id IS NOT NULL");
  expect(predicate).toContain("c.fee_audience IN ('consumer', 'both', 'unknown')");
  expect(predicate).not.toContain("ef.");
  expect(predicate).not.toContain("amount > 0");
  expect(predicate).not.toContain("amount IS NOT NULL"); // rate rows have a separate value column
  expect(statsRowFilter()).toBe(STATS_ROW_FILTER);
  expect(() => statsRowFilter("c; SELECT 1")).toThrow("Invalid statistics table alias");
});

describe("count once: sibling charters sharing one schedule (#1441, rule 7)", () => {
  // Five IBC-style charters read the same schedule (same address, same text) and charge $30;
  // four unrelated banks charge $10, $12, $14 and $16.
  const shared = ["u:ibc.com/fees", "t:abc123"];
  const siblings = [160, 318, 1769, 688, 1319].map((id) => ({
    institution_id: id, amount: 30, charter_type: "bank", fee_category: "nsf", schedule_keys: shared,
  }));
  const others = [10, 12, 14, 16].map((amount, i) => ({
    institution_id: 9000 + i, amount, charter_type: "bank", fee_category: "nsf", schedule_keys: [`u:bank${i}.com/fees`],
  }));
  const rows = [...siblings, ...others];

  it("counts 5 charters on one document as 1 in the median and counts", () => {
    const before = summarizeFees(rows, { countSharedScheduleOnce: false });
    expect(before.institution_count).toBe(9);
    expect(before.median_amount).toBe(30);

    const after = summarizeFees(rows, { countSharedScheduleOnce: true });
    expect(after.institution_count).toBe(5);
    expect(after.bank_count).toBe(5);
    expect(after.median_amount).toBe(14);
    expect(after.maturity_tier).toBe("provisional");
  });

  it("keeps every charter's own value for its own page", () => {
    const values = valuePerInstitution(rows);
    for (const id of [160, 318, 1769, 688, 1319]) expect(values.get(id)).toBe(30);
  });

  it("links charters by identical text even when the addresses differ, and through chains", () => {
    const reps = sharedScheduleRepresentatives([
      { institution_id: 5, amount: 1, schedule_keys: ["u:a.com/fees", "t:h1"] },
      { institution_id: 3, amount: 1, schedule_keys: ["u:b.com/fees", "t:h1"] },
      { institution_id: 8, amount: 1, schedule_keys: ["u:b.com/fees", "t:h2"] },
      { institution_id: 2, amount: 1, schedule_keys: ["u:c.com/fees"] },
      { institution_id: 4, amount: 1, schedule_keys: null },
    ]);
    expect(Object.fromEntries(reps)).toEqual({ 5: 3, 3: 3, 8: 3, 2: 2, 4: 4 });
  });

  it("counts a shared schedule once within a peer group, even when its lowest charter is outside it", () => {
    // A Texas-only peer group: charter 688 (Oklahoma) is filtered out before the stats run.
    const texas = rows.filter((row) => row.institution_id !== 688);
    const stats = summarizeFees(texas, { countSharedScheduleOnce: true });
    expect(stats.institution_count).toBe(5);
    expect(stats.median_amount).toBe(14);
  });

  it("is off by default and selects no keys while off", () => {
    expect(COUNT_SHARED_SCHEDULE_ONCE).toBe(false);
    expect(summarizeFees(rows).institution_count).toBe(9);
    expect(STATS_SCHEDULE_KEYS).toBe("NULL::text[] AS schedule_keys");
    expect(STATS_METHOD_VERSION).toBe(7);
  });

  it("builds the schedule key from the document address and the stored text hash when on", () => {
    const keySql = scheduleKeysSql("ef", true);
    expect(keySql).toContain("ef.document_url");
    expect(keySql).toContain("agent_source_texts ast");
    expect(keySql).toContain("ast.source_document_id = ef.source_document_id");
    expect(() => scheduleKeysSql("ef; drop", true)).toThrow();
  });
});
