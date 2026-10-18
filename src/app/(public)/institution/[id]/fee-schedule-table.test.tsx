import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeeScheduleTable, splitFeesByAudience, type DisplayFee } from "./fee-schedule-table";
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
    sourced: true,
    ...overrides,
  };
}

const BENCH = { overdraft: { p25: 25, median: 30, p75: 32 }, nsf: { p25: 25, median: 30, p75: 32 } };

describe("FeeScheduleTable", () => {
  it("shows a CD or IRA fee filed under early closure as not compared", () => {
    const fees = [
      fee({ id: "a", feeName: "Account Closed Within 180 Days of Opening Fee", feeCategory: "early_closure", amount: 30, feeAudience: "consumer" }),
      fee({ id: "b", feeName: "Early closure of CD (fee to close prior to maturity)", feeCategory: "early_closure", amount: 50 }),
      fee({ id: "c", feeName: "Individual Retirement Account Closing Fee", feeCategory: "early_closure", amount: 50, feeAudience: "consumer" }),
    ];
    render(<FeeScheduleTable fees={fees} disclosureUrl={null} benchmarks={{ early_closure: { p25: 20, median: 25, p75: 25 } }} />);
    expect(screen.getAllByText("Not compared: CD/IRA fee").length).toBe(4); // two rows, phone and wide
    expect(screen.getAllByText(/Above the U\.S\. middle 50%/).length).toBe(2); // only the account-closure row
  });

  it("never places box drilling or a key deposit against the safe deposit box rent range (Capital City Bank rows)", () => {
    const fees = [
      fee({ id: "a", feeName: "Box Drilling Fee (both keys lost)", feeCategory: "safe_deposit_box", amount: 250 }),
      fee({ id: "b", feeName: "Key Deposit Fee", feeCategory: "safe_deposit_box", amount: 25 }),
      fee({ id: "c", feeName: "Safe Deposit Box 3x5", feeCategory: "safe_deposit_box", amount: 40 }),
    ];
    render(<FeeScheduleTable fees={fees} disclosureUrl={null} benchmarks={{ safe_deposit_box: { p25: 30, median: 45, p75: 65 } }} />);
    expect(screen.getAllByText("Not compared: Box drilling or key fee").length).toBe(4); // two rows, phone and wide
    expect(screen.getAllByText(/Inside the U\.S\. middle 50%/).length).toBe(2); // only the box rent
    expect(screen.queryByText(/Above the U\.S\. middle 50%|Below the U\.S\. middle 50%/)).toBeNull();
  });

  it("never places an unsourced fee, as the medians never count one", () => {
    render(<FeeScheduleTable fees={[fee({ sourced: false })]} disclosureUrl={null} benchmarks={BENCH} />);
    expect(screen.queryByText(/U\.S\. middle 50%/)).toBeNull();
  });

  it("names no audience on each row; the asterisk and one footnote carry it", () => {
    render(<FeeScheduleTable fees={[fee({ feeAudience: "consumer" }), fee({ id: "2", feeName: "NSF", feeCategory: "nsf", feeAudience: "unknown" })]} disclosureUrl={null} />);
    expect(screen.queryByText("Consumer accounts")).toBeNull();
    expect(screen.getAllByText(/Audience not stated on the bank/).length).toBe(1);
  });

  it("links each amount to the schedule it was read from", () => {
    render(<FeeScheduleTable fees={[fee({ sourceUrl: "https://bank.example/fees.pdf" })]} disclosureUrl={null} />);
    const amounts = screen.getAllByRole("link", { name: "$35" });
    expect(amounts.length).toBeGreaterThan(0);
    for (const link of amounts) expect(link).toHaveAttribute("href", "https://bank.example/fees.pdf");
  });

  it("places a verified fee against the U.S. middle 50%", () => {
    render(<FeeScheduleTable fees={[fee({})]} disclosureUrl={null} benchmarks={BENCH} />);
    expect(screen.getAllByText(/Above the U\.S\. middle 50%/).length).toBeGreaterThan(0);
  });

  it("never places a fee that is still under review", () => {
    render(
      <FeeScheduleTable fees={[fee({ id: "2", feeCategory: "nsf", status: "provisional" })]} disclosureUrl={null} benchmarks={BENCH} />,
    );
    expect(screen.queryByText(/U\.S\. middle 50%/)).toBeNull();
  });

  it("highlights and anchors the focused fee", () => {
    const { container } = render(
      <FeeScheduleTable fees={[fee({})]} disclosureUrl={null} benchmarks={BENCH} focusCategory="overdraft" />,
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
      <FeeScheduleTable fees={[rate]} disclosureUrl={null} benchmarks={{ card_foreign_txn: { p25: 1, median: 3, p75: 5 } }} />,
    );
    expect(screen.getAllByText("1.1%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("of the transaction").length).toBeGreaterThan(0);
    expect(screen.queryByText(/U\.S\. middle 50%/)).toBeNull();
  });

  it("marks rows past the limit as extra, hidden until Show all", () => {
    const fees = Array.from({ length: 7 }, (_, i) => fee({ id: String(i), feeName: `Fee ${i}`, amount: 10 + i }));
    const { container } = render(<FeeScheduleTable fees={fees} disclosureUrl={null} limit={5} />);
    expect(container.querySelectorAll("tbody tr.hidden").length).toBe(2);
  });
});

it("shows business scope without a personal position", () => {
  render(<FeeScheduleTable fees={[fee({ feeAudience: "business" })]} disclosureUrl={null}
    benchmarks={{ overdraft: { p25: 25, median: 30, p75: 35 } }} />);
  expect(screen.queryByText(/U\.S\. middle 50%/)).toBeNull();
  // Scope is carried by the tabs, not a line repeated on every row.
  expect(screen.queryByText("Business accounts")).toBeNull();
  expect(screen.queryByText(/treated as personal/)).toBeNull();
});

it("places an unstated-audience fee as personal, with the asterisk and footnote", () => {
  render(<FeeScheduleTable fees={[fee({ feeAudience: "unknown" })]} disclosureUrl={null}
    benchmarks={{ overdraft: { p25: 25, median: 30, p75: 35 } }} />);
  expect(screen.getAllByText(/Inside the U\.S\. middle 50%/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Audience not stated/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Audience not stated on the bank\u2019s schedule; treated as personal\. Fees may differ for business or commercial accounts\./)).toBeTruthy();
});

it("keeps a fee from a business-only schedule out of personal comparisons", () => {
  render(<FeeScheduleTable fees={[fee({ feeAudience: "unknown", sourceUrl: "https://bank.example/business/fee-schedule.pdf" })]}
    disclosureUrl={null} benchmarks={{ overdraft: { p25: 25, median: 30, p75: 35 } }} />);
  expect(screen.queryByText(/U\.S\. middle 50%/)).toBeNull();
});

it("labels an explicitly eliminated consumer fee instead of treating it as missing", () => {
  render(<FeeScheduleTable fees={[fee({ feeCategory: "nsf", feeAudience: "consumer", feeTreatment: "eliminated", amount: 0 })]}
    disclosureUrl={null} benchmarks={{ nsf: { p25: 25, median: 30, p75: 32 } }} />);
  expect(screen.getAllByText(/Fee eliminated/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Below the U\.S\. middle 50%/).length).toBeGreaterThan(0);
});

describe("splitFeesByAudience", () => {
  const consumer = fee({ id: "c", feeAudience: "consumer" });
  const unknown = fee({ id: "u", feeAudience: "unknown" });
  const business = fee({ id: "b", feeAudience: "business" });
  const both = fee({ id: "x", feeAudience: "both" });
  const bizSchedule = fee({ id: "s", feeAudience: "unknown", sourceUrl: "https://bank.example/docs/Business-Account-Fee-Schedule.pdf" });
  const ids = (list: DisplayFee[] | undefined) => list?.map((f) => f.id);

  it.each([
    ["personal only", [consumer, unknown], null],
    ["labeled both, nothing business", [consumer, both], null],
    ["mixed", [consumer, unknown, business], { personal: ["c", "u"], business: ["b"] }],
    ["business only", [business], { personal: [], business: ["b"] }],
    ["labeled both, with business", [consumer, both, business], { personal: ["c", "x"], business: ["x", "b"] }],
    // #1592: an unlabeled fee from a business-only schedule sits under Business.
    ["unlabeled from a business-only schedule", [consumer, bizSchedule], { personal: ["c"], business: ["s"] }],
    ["unlabeled from a personal schedule", [consumer, unknown], null],
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
    expect(within(businessPanel).getAllByRole("link", { hidden: true, name: "$35" })[0]).toHaveAttribute("href", "https://bank.example/business.pdf");

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

describe("business-only schedule (#1592)", () => {
  it("lists an unlabeled fee from a business-only schedule under Business, without the treated-as-personal asterisk", () => {
    const fees = [
      fee({ id: "p", feeName: "Paid item overdraft", feeCategory: "overdraft", feeAudience: "consumer" }),
      fee({ id: "s", feeName: "Wire transfer", feeCategory: "wire_domestic_outgoing", amount: 30, feeAudience: "unknown", sourceUrl: "https://bank.example/docs/Business-Account-Fee-Schedule.pdf" }),
    ];
    render(<FeeScheduleTable fees={fees} disclosureUrl={null} />);
    const business = screen.getByRole("tab", { name: "Business" });
    fireEvent.click(business);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByText("Wire transfer").length).toBeGreaterThan(0);
    expect(panel.textContent).not.toMatch(/treated as personal/);
  });
});
