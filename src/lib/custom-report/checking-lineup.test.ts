import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ getSql: vi.fn(), sql: vi.fn() }));

import type { LineupAccount } from "@/lib/data-store/account-lineup";
import {
  MIN_LINEUP_PEERS_FOR_MEDIAN,
  NOT_STATED,
  buildCheckingLineup,
  isConsumerCheckingAccount,
  lineupCoverageLine,
  lineupMeasures,
  lineupMoney,
  lineupShare,
} from "./checking-lineup";

const account = (overrides: Partial<LineupAccount>): LineupAccount => ({
  institutionId: 1,
  productName: null,
  productNameSource: null,
  monthlyFee: 10,
  minBalanceToAvoid: null,
  minBalanceSource: null,
  minOpeningDeposit: null,
  waiverText: null,
  waiverSource: null,
  feeName: "Monthly maintenance fee",
  sourceLine: null,
  ...overrides,
});

describe("isConsumerCheckingAccount", () => {
  it("keeps named checking accounts even when the line mentions savings", () => {
    expect(isConsumerCheckingAccount(account({ productName: "Essential Checking", sourceLine: "waived with a linked savings account" }))).toBe(true);
    expect(isConsumerCheckingAccount(account({ feeName: "Share Draft monthly fee" }))).toBe(true);
  });

  it("leaves out savings, money market and business accounts", () => {
    expect(isConsumerCheckingAccount(account({ productName: "Statement Savings" }))).toBe(false);
    expect(isConsumerCheckingAccount(account({ feeName: "Monthly fee", sourceLine: "Money Market monthly fee $12" }))).toBe(false);
    expect(isConsumerCheckingAccount(account({ productName: "Business Checking" }))).toBe(false);
  });

  it("keeps an unnamed monthly fee whose line names no other account", () => {
    expect(isConsumerCheckingAccount(account({ sourceLine: "Monthly service charge $8" }))).toBe(true);
    expect(isConsumerCheckingAccount(account({ feeName: "Monthly fee", sourceLine: "fee waived each business day" }))).toBe(true);
  });
});

describe("buildCheckingLineup", () => {
  const peers = [
    { institutionId: 2, name: "Second Bank" },
    { institutionId: 3, name: "Third CU" },
    { institutionId: 4, name: "No Data Bank" },
    { institutionId: 1, name: "Subject listed as a peer" },
  ];
  const accounts = [
    account({ institutionId: 1, productName: "Basic Checking", monthlyFee: 12, minBalanceToAvoid: 1500, minBalanceSource: "derived" }),
    account({ institutionId: 1, productName: "Club Savings", monthlyFee: 3 }),
    account({ institutionId: 2, productName: "Free Checking", monthlyFee: 0 }),
    account({ institutionId: 2, productName: "Plus Checking", monthlyFee: 10, waiverText: "with direct deposit" }),
    account({ institutionId: 3, monthlyFee: 6, minBalanceToAvoid: 500 }),
    account({ institutionId: 99, monthlyFee: 1 }),
  ];
  const view = buildCheckingLineup(1, peers, accounts);

  it("compares the subject's checking accounts with its market's", () => {
    expect(view.subject.accounts).toBe(1);
    expect(view.subject.lowestMonthlyFee).toBe(12);
    expect(view.peers.accounts).toBe(3);
    expect(view.peers.lowestMonthlyFee).toBe(0);
    expect(view.peers.medianMonthlyFee).toBe(6);
    expect(view.peers.shareWithFreeAccount).toBe(0.5);
  });

  it("counts coverage over the market only, the subject left out", () => {
    expect(view.peersInMarket).toBe(3);
    expect(view.peersWithLineup).toBe(2);
    expect(view.peersWithBalance).toBe(1);
    expect(view.peersWithWaiver).toBe(1);
    expect(view.peerRows.map((row) => row.name)).toEqual(["Second Bank", "Third CU"]);
    expect(view.leftOut).toBe(1);
    expect(view.anyDerived).toBe(true);
  });

  it("says so when no competitor has a lineup, and shows no market figure", () => {
    const empty = buildCheckingLineup(1, [{ institutionId: 4, name: "No Data Bank" }], accounts);
    expect(lineupCoverageLine(empty)).toBe(
      "Checking lineup on file for 0 of 1 local competitor, so there is no market figure to set beside yours yet.",
    );
    expect(lineupMeasures(empty).every((m) => m.market === NOT_STATED)).toBe(true);
  });

  it("writes the coverage line from the counts", () => {
    expect(lineupCoverageLine(view)).toBe(
      "Checking lineup on file for 2 of 3 local competitors (3 accounts). Of those competitors, 1 states a balance that avoids the fee and 1 states another way to avoid it.",
    );
  });

  it("shows unknown figures as not stated, never as zero", () => {
    const measures = Object.fromEntries(lineupMeasures(view).map((m) => [m.label, m]));
    expect(measures["Lowest monthly fee"]).toMatchObject({ yours: "$12", market: "$0 · 2 competitors reporting" });
    // One competitor states a balance: below the floor, so no market median is shown.
    expect(measures["Median balance to avoid the fee"]).toMatchObject({ yours: "$1,500", market: "Too few to compare · 1 competitor reporting" });
    expect(measures["No-fee checking account found in the schedules reviewed"]).toMatchObject({ yours: "None found", market: "1 of 2 competitors" });
    const none = buildCheckingLineup(5, peers, accounts);
    const noneMeasures = Object.fromEntries(lineupMeasures(none).map((m) => [m.label, m]));
    expect(noneMeasures["Lowest monthly fee"].yours).toBe(NOT_STATED);
    expect(noneMeasures["No-fee checking account found in the schedules reviewed"].yours).toBe(NOT_STATED);
  });
});

describe("market medians", () => {
  it("shows a balance median with its count once enough competitors state one", () => {
    const many = Array.from({ length: MIN_LINEUP_PEERS_FOR_MEDIAN }, (_, i) => ({ institutionId: 100 + i, name: `Peer ${i}` }));
    const manyAccounts = many.map((p, i) => account({ institutionId: p.institutionId, productName: "Basic Checking", minBalanceToAvoid: 1000 + i * 100 }));
    const measures = Object.fromEntries(lineupMeasures(buildCheckingLineup(1, many, manyAccounts)).map((m) => [m.label, m]));
    expect(measures["Median balance to avoid the fee"].market).toBe(`$1,350 · ${MIN_LINEUP_PEERS_FOR_MEDIAN} competitors reporting`);
  });
});

describe("lineupMoney and lineupShare", () => {
  it("formats known values and says not stated otherwise", () => {
    expect(lineupMoney(4.5)).toBe("$4.50");
    expect(lineupMoney(0)).toBe("$0");
    expect(lineupMoney(null)).toBe(NOT_STATED);
    expect(lineupShare(0.333)).toBe("33%");
    expect(lineupShare(null)).toBe(NOT_STATED);
  });
});

describe("the lineup's comparison rules", () => {
  it("leaves out an optional add-on's monthly charge, as the fee comparison does", () => {
    expect(isConsumerCheckingAccount(account({ feeName: "For a monthly fee", sourceLine: "First Commerce offers the ATM Freedom add-on for the Power Checking account. For a monthly fee of $2.99" }))).toBe(false);
    expect(isConsumerCheckingAccount(account({ productName: "Power Checking + CoverMe", feeName: "Power Checking + CoverMe Monthly service charge" }))).toBe(true);
  });

  it("labels its median as every account pooled, with the accounts and competitors it rests on", () => {
    const peers = Array.from({ length: MIN_LINEUP_PEERS_FOR_MEDIAN }, (_, i) => ({ institutionId: 10 + i, name: `Peer ${i}` }));
    const accounts = peers.flatMap((p) => [account({ institutionId: p.institutionId, monthlyFee: 5 }), account({ institutionId: p.institutionId, monthlyFee: 12 })]);
    const median = lineupMeasures(buildCheckingLineup(1, peers, accounts)).find((m) => m.label === "Median monthly fee, every account pooled");
    expect(median?.market).toBe(`$8.50 · median of ${MIN_LINEUP_PEERS_FOR_MEDIAN * 2} accounts pooled across ${MIN_LINEUP_PEERS_FOR_MEDIAN} competitors`);
  });
});
