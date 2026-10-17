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
  countedAmounts,
  countedInstitutionCount,
  countedValuePerInstitution,
  scheduleKeysSql,
  scheduleGroupSql,
  summarizeRates,
  MIN_LINKING_TEXT_CHARS,
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
  // IBC's five charters (one holding company) read the same schedule and charge $30;
  // four unrelated banks charge $10, $12, $14 and $16.
  const IBC = "1102367";
  const shared = ["u:ibc.com/fees", "t:abc123"];
  const siblings = [160, 318, 1769, 688, 1319].map((id) => ({
    institution_id: id, amount: 30, charter_type: "bank", fee_category: "nsf", schedule_keys: shared, schedule_group: IBC,
  }));
  const others = [10, 12, 14, 16].map((amount, i) => ({
    institution_id: 9000 + i, amount, charter_type: "bank", fee_category: "nsf",
    schedule_keys: [`u:bank${i}.com/fees`], schedule_group: `hc${i}`,
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

  it("gives raw-row readers the median's own count and population (17 Oct readers fix)", () => {
    // The provenance line, the API's institution_count and the outlier list count from raw rows.
    expect(countedInstitutionCount(rows, { countSharedScheduleOnce: false })).toBe(9);
    expect(countedInstitutionCount(rows, { countSharedScheduleOnce: true })).toBe(summarizeFees(rows, { countSharedScheduleOnce: true }).institution_count);
    // A row with no amount still names an institution, as the provenance count reads it.
    const unpriced = [...rows, { institution_id: 77, amount: null, charter_type: "bank", fee_category: "nsf", schedule_keys: [] as string[], schedule_group: "" }];
    expect(countedInstitutionCount(unpriced, { countSharedScheduleOnce: true })).toBe(6);
    const values = countedValuePerInstitution(rows, { countSharedScheduleOnce: true });
    expect([...values.keys()].sort((a, b) => a - b)).toEqual([160, 9000, 9001, 9002, 9003]);
    expect(values.get(160)).toBe(30);
    expect(countedValuePerInstitution(rows, { countSharedScheduleOnce: false }).size).toBe(9);
  });

  it("counts Hamilton's peers once per shared schedule, at the lower middle (countedAmounts)", () => {
    const peers = [
      { institutionId: 160, amount: 30 },
      { institutionId: 318, amount: 28, countedAs: 160 },
      { institutionId: 1769, amount: 35, countedAs: 160 },
      { institutionId: 688, amount: 32, countedAs: 160 },
      { institutionId: 9000, amount: 10 },
      { institutionId: 9001, amount: 40 },
    ];
    // IBC's four values 28, 30, 32, 35 count once at 30, as collapseSharedSchedules counts them.
    expect(countedAmounts(peers)).toEqual([10, 30, 40]);
    expect(countedAmounts(peers.map(({ institutionId, amount }) => ({ institutionId, amount })))).toEqual([10, 28, 30, 32, 35, 40]);
    const asRows = peers.map((p) => ({ institution_id: p.institutionId, amount: p.amount, schedule_keys: p.institutionId < 9000 ? shared : null, schedule_group: p.institutionId < 9000 ? IBC : null }));
    expect([...countedValuePerInstitution(asRows, { countSharedScheduleOnce: true }).values()].sort((a, b) => a - b)).toEqual(countedAmounts(peers));
  });

  it("keeps every charter's own value for its own page", () => {
    const values = valuePerInstitution(rows);
    for (const id of [160, 318, 1769, 688, 1319]) expect(values.get(id)).toBe(30);
  });

  it("links siblings by identical text even when the addresses differ, and through chains", () => {
    const reps = sharedScheduleRepresentatives([
      { institution_id: 5, schedule_keys: ["u:a.com/fees", "t:h1"], schedule_group: "WF" },
      { institution_id: 3, schedule_keys: ["u:b.com/fees", "t:h1"], schedule_group: "WF" },
      { institution_id: 8, schedule_keys: ["u:b.com/fees", "t:h2"], schedule_group: "WF" },
      { institution_id: 2, schedule_keys: ["u:c.com/fees"], schedule_group: "WF" },
      { institution_id: 4, schedule_keys: null, schedule_group: "WF" },
    ]);
    expect(Object.fromEntries(reps)).toEqual({ 5: 3, 3: 3, 8: 3, 2: 2, 4: 4 });
  });

  it("links Wells Fargo's three charters on one holding company", () => {
    const wf = [4, 172, 359].map((id) => ({ institution_id: id, schedule_keys: ["u:wellsfargo.com/fees"], schedule_group: "1120754" }));
    expect(Object.fromEntries(sharedScheduleRepresentatives(wf))).toEqual({ 4: 4, 172: 4, 359: 4 });
  });

  it("never links unrelated institutions on one schedule: 6 banks, 4 on one Elan card agreement", () => {
    const elan = [21, 22, 23, 24, 25, 26].map((id, i) => ({
      institution_id: id,
      amount: 25 + i,
      charter_type: "bank",
      fee_category: "card_replacement",
      schedule_keys: i < 4 ? ["u:elan.com/cardagreement.pdf"] : [`u:bank${id}.com/fees`],
      schedule_group: i < 2 ? null : `hc${id}`,
    }));
    const reps = sharedScheduleRepresentatives(elan);
    for (const id of [21, 22, 23, 24, 25, 26]) expect(reps.get(id)).toBe(id);
    const stats = summarizeFees(elan, { countSharedScheduleOnce: true });
    expect(stats.institution_count).toBe(6);
    expect(stats).toEqual(summarizeFees(elan, { countSharedScheduleOnce: false }));
  });

  it("ignores vendor download paths even within one holding company (Healthplus, Horizons North)", () => {
    const vendor = [
      { institution_id: 5009, schedule_keys: ["u:healthplusfcu.org/ezs3download/download/1/fees.pdf", "t:hp"], schedule_group: "X" },
      { institution_id: 7001, schedule_keys: ["u:othercu.org/ezs3download/download/1/fees.pdf", "t:hp"], schedule_group: "X" },
      { institution_id: 8416, schedule_keys: ["u:horizonsnorth.org/_/kcms-doc/9/fees.pdf", "t:hn"], schedule_group: "Y" },
      { institution_id: 2092, schedule_keys: ["u:5starbank.com/_/kcms-doc/9/fees.pdf", "t:hn"], schedule_group: "Y" },
    ];
    const reps = sharedScheduleRepresentatives(vendor);
    for (const row of vendor) expect(reps.get(row.institution_id)).toBe(row.institution_id);
  });

  it("does not link charters with no holding company", () => {
    const cus = [6729, 5756].map((id) => ({ institution_id: id, schedule_keys: ["u:ukfcu.org/fees.pdf"], schedule_group: null }));
    expect(Object.fromEntries(sharedScheduleRepresentatives(cus))).toEqual({ 6729: 6729, 5756: 5756 });
    const zero = [1, 2].map((id) => ({ institution_id: id, schedule_keys: ["u:x.com/fees"], schedule_group: "0" }));
    expect(Object.fromEntries(sharedScheduleRepresentatives(zero))).toEqual({ 1: 1, 2: 2 });
  });

  it("counts an even-size shared schedule at a price a member charges (the lower middle)", () => {
    const pair = [
      { institution_id: 1, amount: 20, charter_type: "bank", schedule_keys: ["u:x.com/fees"], schedule_group: "H" },
      { institution_id: 2, amount: 30, charter_type: "bank", schedule_keys: ["u:x.com/fees"], schedule_group: "H" },
      ...[40, 50, 60, 70].map((amount, i) => ({ institution_id: 10 + i, amount, charter_type: "bank" })),
    ];
    const stats = summarizeFees(pair, { countSharedScheduleOnce: true });
    expect(stats.institution_count).toBe(5);
    expect(stats.min_amount).toBe(20);
  });

  it("counts a shared schedule once within a peer group, even when its lowest charter is outside it", () => {
    // A Texas-only peer group: charter 688 (Oklahoma) is filtered out before the stats run.
    const texas = rows.filter((row) => row.institution_id !== 688);
    const stats = summarizeFees(texas, { countSharedScheduleOnce: true });
    expect(stats.institution_count).toBe(5);
    expect(stats.median_amount).toBe(14);
  });

  it("applies to rate statistics the same way", () => {
    const rateRows = [
      ...[160, 318, 1769, 688, 1319].map((id) => ({ institution_id: id, rate_percent: 3, amount_kind: "percent", schedule_keys: shared, schedule_group: IBC })),
      ...[1, 1.5, 2, 2.5].map((rate, i) => ({ institution_id: 9000 + i, rate_percent: rate, amount_kind: "percent" })),
    ];
    expect(summarizeRates(rateRows, { countSharedScheduleOnce: false })).toMatchObject({ institution_count: 9, median_rate: 3 });
    expect(summarizeRates(rateRows, { countSharedScheduleOnce: true })).toMatchObject({ institution_count: 5, median_rate: 2 });
  });

  it("is off by default and selects no keys while off", () => {
    expect(COUNT_SHARED_SCHEDULE_ONCE).toBe(false);
    expect(summarizeFees(rows).institution_count).toBe(9);
    expect(STATS_SCHEDULE_KEYS).toBe("NULL::text[] AS schedule_keys, NULL::text AS schedule_group");
    expect(STATS_METHOD_VERSION).toBe(7);
  });

  it("builds the schedule keys and holding company scope when on", () => {
    const keySql = scheduleKeysSql("ef", true);
    expect(keySql).toContain("ef.document_url");
    expect(keySql).toContain("ast.source_document_id = ef.source_document_id");
    expect(keySql).toContain("ezs3download|kcms-doc");
    expect(keySql).toContain(`ast.char_count >= ${MIN_LINKING_TEXT_CHARS}`);
    expect(MIN_LINKING_TEXT_CHARS).toBe(200);
    expect(scheduleGroupSql("ef", true)).toContain("hc.holding_company_rssd");
    expect(() => scheduleKeysSql("ef; drop", true)).toThrow();
    expect(() => scheduleGroupSql("ef; drop", true)).toThrow();
  });
});
