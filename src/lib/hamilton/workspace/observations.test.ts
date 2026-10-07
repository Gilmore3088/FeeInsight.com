import { describe, expect, it } from "vitest";
import {
  competitorMoveObservations,
  feePositionRows,
  marketPositionObservations,
  rankObservations,
  revenueShiftObservation,
} from "./observations";
import { serviceChargeTrend } from "./revenue";
import { priceBands } from "./bands";

const peers = [4, 5, 5, 5, 6, 6, 7, 5, 4, 6];

describe("market position observations", () => {
  it("flags a fee in the bottom 15% without telling the bank what to do", () => {
    const [obs] = marketPositionObservations([{ feeCategory: "night_deposit", current: 3, peers, peerLabel: "Texas banks" }]);
    expect(obs.kind).toBe("market_position");
    expect(obs.headline).toMatch(/^Your .+ is below 10 of 10 peers\.$/);
    expect(obs.headline.toLowerCase()).not.toMatch(/raise|lower|should|recommend/);
    expect(obs.actions).toContain("model_price");
  });
  it("skips fees inside the normal range", () => {
    expect(marketPositionObservations([{ feeCategory: "x", current: 5, peers, peerLabel: "p" }])).toEqual([]);
  });
});

describe("competitor moves", () => {
  it("groups real changes on fees the bank charges", () => {
    const obs = competitorMoveObservations(
      [
        { institutionName: "A Bank", feeCategory: "overdraft", oldAmount: 30, newAmount: 35, changedAt: "2026-09-01T00:00:00Z" },
        { institutionName: "B Bank", feeCategory: "overdraft", oldAmount: 32, newAmount: 29, changedAt: "2026-08-01T00:00:00Z" },
        { institutionName: "C Bank", feeCategory: "wire_fee", oldAmount: 20, newAmount: 25, changedAt: "2026-08-01T00:00:00Z" },
        { institutionName: "D Bank", feeCategory: "overdraft", oldAmount: null, newAmount: 30, changedAt: "2026-08-01T00:00:00Z" },
      ],
      new Set(["overdraft"]),
      "TX",
    );
    expect(obs).toHaveLength(1);
    expect(obs[0].headline).toContain("2 institutions in TX");
    expect(obs[0].facts[0].text).toContain("A Bank: $30 to $35");
  });
});

describe("revenue shift", () => {
  const rows = (values: number[], source = "fdic") =>
    ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31", "2024-12-31", "2024-09-30"].map(
      (report_date, i) => ({ report_date, source, service_charge_income: values[i] }),
    );

  it("compares the latest four quarters with the four before", () => {
    const trend = serviceChargeTrend(rows([150, 150, 150, 150, 100, 100, 100, 100]));
    expect(trend).toMatchObject({ latestTtm: 600_000, priorTtm: 400_000, source: "fdic" });
    expect(revenueShiftObservation(trend)?.headline).toBe("Your deposit service charge income is up 50% from a year earlier.");
  });

  it("turns NCUA year-to-date income into quarters", () => {
    // Quarters: 100, 100, 100 (400-300), 140 (300-160) then 80, 80, 80 (320-240), 80 (240-160)
    const ncua = [
      { report_date: "2026-06-30", source: "ncua", service_charge_income: 200 },
      { report_date: "2026-03-31", source: "ncua", service_charge_income: 100 },
      { report_date: "2025-12-31", source: "ncua", service_charge_income: 400 },
      { report_date: "2025-09-30", source: "ncua", service_charge_income: 300 },
      { report_date: "2025-06-30", source: "ncua", service_charge_income: 160 },
      { report_date: "2025-03-31", source: "ncua", service_charge_income: 80 },
      { report_date: "2024-12-31", source: "ncua", service_charge_income: 320 },
      { report_date: "2024-09-30", source: "ncua", service_charge_income: 240 },
      { report_date: "2024-06-30", source: "ncua", service_charge_income: 160 },
    ];
    expect(serviceChargeTrend(ncua)).toMatchObject({ latestTtm: 440_000, priorTtm: 320_000, source: "ncua" });
  });

  it("returns nothing when a quarter is missing", () => {
    expect(serviceChargeTrend(rows([150, 150, 150, 150, 100, 100, 100]).slice(0, 7))).toBeNull();
  });

  it("ignores small moves", () => {
    expect(revenueShiftObservation({ latestTtm: 105, priorTtm: 100, quarterEnd: "2026-06-30", source: "fdic" })).toBeNull();
  });
});

describe("ranking and bands", () => {
  it("orders by salience and caps the list", () => {
    const make = (id: string, salience: number) => ({ id, kind: "market_position" as const, feeCategory: null, headline: id, facts: [], actions: [], salience });
    expect(rankObservations([make("a", 0.2), make("b", 0.9), make("c", 0.5)], 2).map((o) => o.id)).toEqual(["b", "c"]);
  });
  it("counts every peer in exactly one band", () => {
    const bands = priceBands([0, 25, 28, 30, 35, 36], 30);
    expect(bands.reduce((n, b) => n + b.count, 0)).toBe(6);
    expect(bands[0]).toMatchObject({ label: "$0", count: 1 });
  });
});

describe("fee position rows", () => {
  it("returns every reviewed fee with its peer band, unranked, and no band below the peer minimum", () => {
    const rows = feePositionRows([
      { feeCategory: "night_deposit", current: 3, peers, peerLabel: "Texas banks" },
      { feeCategory: "overdraft", current: 30, peers: [25, 35], peerLabel: "Texas banks" },
    ]);
    expect(rows.map((r) => r.feeCategory)).toEqual(["night_deposit", "overdraft"]);
    expect(rows[0]).toMatchObject({ current: 3, band: { p25: 5, median: 5, p75: 6, n: 10 }, peerLabel: "Texas banks" });
    expect(rows[0].displayName.length).toBeGreaterThan(0);
    expect(rows[1].band).toBeNull();
  });
});
