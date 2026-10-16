import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeeScheduleTable, describeMedianDelta, splitFeesByAudience, type DisplayFee } from "./fee-schedule-table";
import { feeHashCategory, tabForHash } from "./fee-audience-tabs";

function fee(overrides: Partial<DisplayFee>): DisplayFee {
  return {
    id: "1",
    feeName: "Paid item overdraft",
    feeAudience: "consumer",
    feeCategory: "overdraft",
    amount: 35,
    frequency: "per_item",
    conditions: null,
    status: "verified",
    sourceUrl: null,
    ...overrides,
  };
}

describe("describeMedianDelta", () => {
  it("states the distance from the median in words", () => {
    expect(describeMedianDelta(35, 32.5)).toEqual({ text: "$2.50 above the national median", tone: "above" });
    expect(describeMedianDelta(30, 32.5)).toEqual({ text: "$2.50 below the national median", tone: "below" });
    expect(describeMedianDelta(32.5, 32.5)).toEqual({ text: "At the national median", tone: "at" });
  });

  it("names the state for the home-state comparison", () => {
    expect(describeMedianDelta(30, 32.5, "Texas")).toEqual({ text: "$2.50 below the Texas median", tone: "below" });
    expect(describeMedianDelta(32.5, 32.5, "Texas")).toEqual({ text: "At the Texas median", tone: "at" });
  });

  it("says nothing when either side is missing", () => {
    expect(describeMedianDelta(null, 30)).toBeNull();
    expect(describeMedianDelta(30, null)).toBeNull();
    expect(describeMedianDelta(30, undefined)).toBeNull();
  });
});

describe("FeeScheduleTable", () => {
  const medians = new Map<string, number | null>([["overdraft", 32.5], ["nsf", 30]]);

  it("links verified rows to the national page for that fee", () => {
    render(<FeeScheduleTable fees={[fee({})]} disclosureUrl={null} medians={medians} />);
    const links = screen.getAllByRole("link", { name: "$2.50 above the national median" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute("href", "/fees/overdraft");
  });

  it("never compares a fee that is still under review", () => {
    render(
      <FeeScheduleTable fees={[fee({ id: "2", feeCategory: "nsf", status: "provisional" })]} disclosureUrl={null} medians={medians} />,
    );
    expect(screen.queryByRole("link", { name: /national median/ })).toBeNull();
  });

  it("highlights and anchors the focused fee", () => {
    const { container } = render(
      <FeeScheduleTable fees={[fee({})]} disclosureUrl={null} medians={medians} focusCategory="overdraft" />,
    );
    const row = container.querySelector("#fee-overdraft");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Paid item overdraft")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-fee-anchor="overdraft"]').length).toBe(2);
  });

  it("shows a rate fee as its rate, with no dollar comparison", () => {
    const rate = fee({
      id: "rate-1",
      feeName: "Foreign transaction fee",
      feeCategory: "card_foreign_txn",
      amount: null,
      rate: { rate: "1.1%", detail: "of the transaction" },
    });
    render(
      <FeeScheduleTable
        fees={[rate]}
        disclosureUrl={null}
        medians={new Map([["card_foreign_txn", 3]])}
        benchmarks={{ card_foreign_txn: { p25: 1, median: 3, p75: 5 } }}
      />,
    );
    expect(screen.getAllByText("1.1%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("of the transaction").length).toBeGreaterThan(0);
    expect(screen.queryByText(/(above|below|At) the national median/)).toBeNull();
  });
});


it("shows business scope without personal median comparisons", () => {
  render(<FeeScheduleTable fees={[fee({ feeAudience: "business" })]} disclosureUrl={null}
    medians={new Map([["overdraft", 30]])}
    benchmarks={{ overdraft: { p25: 25, median: 30, p75: 35 } }} />);
  expect(screen.queryByRole("link", { name: /national median/ })).toBeNull();
  expect(screen.queryByText(/Within the typical range/)).toBeNull();
  expect(screen.getAllByText("Business accounts").length).toBeGreaterThan(0);
  expect(screen.queryByText(/treated as personal/)).toBeNull();
});

it("compares an unstated-audience fee as personal, with the asterisk and footnote", () => {
  render(<FeeScheduleTable fees={[fee({ feeAudience: "unknown" })]} disclosureUrl={null}
    medians={new Map([["overdraft", 30]])}
    benchmarks={{ overdraft: { p25: 25, median: 30, p75: 35 } }} />);
  expect(screen.getAllByRole("link", { name: /national median/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Audience not stated/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Audience not stated on the bank\u2019s schedule; treated as personal\. Fees may differ for business or commercial accounts\./)).toBeTruthy();
});

it("keeps a fee from a business-only schedule out of personal comparisons", () => {
  render(<FeeScheduleTable fees={[fee({ feeAudience: "unknown", sourceUrl: "https://bank.example/business/fee-schedule.pdf" })]}
    disclosureUrl={null} medians={new Map([["overdraft", 30]])}
    benchmarks={{ overdraft: { p25: 25, median: 30, p75: 35 } }} />);
  expect(screen.queryByRole("link", { name: /national median/ })).toBeNull();
});

it("labels an explicitly eliminated consumer fee instead of treating it as missing", () => {
  render(<FeeScheduleTable fees={[fee({ feeCategory: "nsf", feeAudience: "consumer", feeTreatment: "eliminated", amount: 0 })]}
    disclosureUrl={null} medians={new Map([["nsf", 30]])} />);
  expect(screen.getAllByText(/Fee eliminated/).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("link", { name: "$30 below the national median" }).length).toBeGreaterThan(0);
});

describe("splitFeesByAudience", () => {
  const consumer = fee({ id: "c", feeAudience: "consumer" });
  const unknown = fee({ id: "u", feeAudience: "unknown" });
  const business = fee({ id: "b", feeAudience: "business" });
  const both = fee({ id: "x", feeAudience: "both" });
  const ids = (list: DisplayFee[] | undefined) => list?.map((f) => f.id);

  it.each([
    ["personal only", [consumer, unknown], null],
    ["labeled both, nothing business", [consumer, both], null],
    ["mixed", [consumer, unknown, business], { personal: ["c", "u"], business: ["b"] }],
    ["business only", [business], { personal: [], business: ["b"] }],
    ["labeled both, with business", [consumer, both, business], { personal: ["c", "x"], business: ["x", "b"] }],
  ] as const)("%s", (_, fees, expected) => {
    const split = splitFeesByAudience([...fees]);
    if (expected === null) expect(split).toBeNull();
    else expect({ personal: ids(split?.personal), business: ids(split?.business) }).toEqual(expected);
  });
});

describe("Personal / Business tabs", () => {
  it("shows no tabs when no fee is labeled business", () => {
    render(<FeeScheduleTable fees={[fee({ feeAudience: "unknown" })]} disclosureUrl={null} />);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("opens on Personal, switches by arrow key, and keeps each row's source and one footnote", () => {
    render(
      <FeeScheduleTable
        fees={[
          fee({ id: "p", feeName: "Paid item overdraft", feeAudience: "unknown", sourceUrl: "https://bank.example/personal.pdf" }),
          fee({ id: "b", feeName: "Business overdraft", feeAudience: "business", sourceUrl: "https://bank.example/business.pdf" }),
        ]}
        disclosureUrl={null}
      />,
    );
    const personal = screen.getByRole("tab", { name: "Personal" });
    const business = screen.getByRole("tab", { name: "Business" });
    expect(personal).toHaveAttribute("aria-selected", "true");
    expect(business).toHaveAttribute("tabindex", "-1");
    const businessPanel = document.getElementById(business.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(businessPanel).not.toBeVisible();
    expect(within(businessPanel).getAllByRole("link", { hidden: true, name: /Source/ })[0]).toHaveAttribute("href", "https://bank.example/business.pdf");

    fireEvent.keyDown(personal, { key: "ArrowRight" });
    expect(business).toHaveAttribute("aria-selected", "true");
    expect(business).toHaveFocus();
    expect(businessPanel).toBeVisible();
    // One footnote, ending the Personal list: the only list with unlabeled fees.
    const notes = [...document.querySelectorAll("p")].filter((p) => /treated as personal\. Fees may differ/.test(p.textContent ?? ""));
    expect(notes).toHaveLength(1);
    expect(notes[0]).not.toBeVisible();
  });

  it("shows only a Business tab for a business-only bank", () => {
    render(<FeeScheduleTable fees={[fee({ feeAudience: "business" })]} disclosureUrl={null} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Business"]);
  });

  it("opens on Business when the focused fee is listed only for business", () => {
    render(
      <FeeScheduleTable
        fees={[fee({ id: "p", feeCategory: "nsf" }), fee({ id: "b", feeAudience: "business" })]}
        disclosureUrl={null}
        focusCategory="overdraft"
      />,
    );
    expect(screen.getByRole("tab", { name: "Business" })).toHaveAttribute("aria-selected", "true");
  });

  it("a #fee- link followed on the page opens the tab that lists the fee (#1592)", () => {
    render(
      <FeeScheduleTable
        fees={[fee({ id: "p" }), fee({ id: "b", feeAudience: "business", feeCategory: "nsf" })]}
        disclosureUrl={null}
        focusCategory="overdraft"
      />,
    );
    const personal = screen.getByRole("tab", { name: "Personal" });
    fireEvent.click(screen.getByRole("tab", { name: "Business" }));
    expect(personal).toHaveAttribute("aria-selected", "false");
    window.location.hash = "#fee-overdraft";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(personal).toHaveAttribute("aria-selected", "true");
    window.location.hash = "";
  });

  it("keeps the active tab when it lists the fee, and ignores other hashes", () => {
    const lists = (key: "personal" | "business", category: string) => category === "overdraft";
    expect(tabForHash("#fee-overdraft", "business", lists, ["personal", "business"])).toBe("business");
    expect(tabForHash("#fee-overdraft", "personal", (key) => key === "business", ["personal", "business"])).toBe("business");
    expect(tabForHash("#fee-nsf", "personal", lists, ["personal", "business"])).toBeNull();
    expect(tabForHash("#plans", "personal", lists, ["personal", "business"])).toBeNull();
    expect(tabForHash("#fee-%E0%A4%A", "personal", lists, ["personal", "business"])).toBeNull();
    expect(feeHashCategory("#fee-overdraft")).toBe("overdraft");
  });
});
