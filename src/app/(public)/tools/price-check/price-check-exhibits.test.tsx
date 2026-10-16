// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PricedInstitution } from "@/lib/price-check";
import { InstitutionList, MarketList, RangeStack, ShareBar, VerdictTag } from "./price-check-exhibits";
import { placeAmong } from "./price-check-view";

afterEach(cleanup);

const VALUES = [0, 10, 20, 25, 30, 30, 35, 35, 36, 40];
const us = placeAmong("U.S.", VALUES, 38)!;
const banks = placeAmong("Banks", [30, 32, 35, 35, 36], 38)!;

const institution = (id: number, value: number, documentUrl: string | null = null): PricedInstitution => ({
  id,
  name: `Institution ${id}`,
  value,
  documentUrl,
  sourceLine: null,
  readAt: null,
  charterType: "bank",
  city: null,
  cbsaName: null,
});

describe("VerdictTag", () => {
  it("names where the fee sits", () => {
    render(<VerdictTag placement={us} />);
    expect(screen.getByText("Higher than most")).toBeInTheDocument();
  });
});

describe("ShareBar", () => {
  it("draws less, same and more with an accessible summary", () => {
    render(<ShareBar placement={placeAmong("U.S.", VALUES, 30)!} />);
    expect(screen.getByRole("img", { name: "4 charge less, 2 the same, 4 more" })).toBeInTheDocument();
  });
});

describe("RangeStack", () => {
  it("draws one range per group on one axis, with the fee as a dot on each", () => {
    const { container } = render(<RangeStack rows={[us, banks]} price={38} />);
    expect(screen.getByText("U.S.: 9 of 10 charge less")).toBeInTheDocument();
    expect(screen.getByText("Banks: 5 of 5 charge less")).toBeInTheDocument();
    expect(container.querySelectorAll("circle.you")).toHaveLength(2);
    expect(container.querySelector(".fi-range-axis")).not.toBeNull();
    expect(screen.getByText(/Dot: your fee/)).toBeInTheDocument();
  });

  it("draws nothing without rows", () => {
    const { container } = render(<RangeStack rows={[]} price={38} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MarketList", () => {
  it("lists each market with its count below the price and its median", () => {
    render(<MarketList rows={[{ label: "Omaha, NE", count: 12, median: 30, lower: 5, same: 2, higher: 5 }]} price={30} />);
    expect(screen.getByText("Omaha, NE")).toBeInTheDocument();
    expect(screen.getByText("5 of 12 charge less than $30")).toBeInTheDocument();
    expect(screen.getByText("$30")).toBeInTheDocument();
  });
});

describe("InstitutionList", () => {
  it("links each institution and its own schedule, up to the shown limit", () => {
    const list = [institution(1, 0, "https://example.com/fees.pdf"), institution(2, 25), institution(3, 30)];
    render(<InstitutionList institutions={list} shown={2} />);
    expect(screen.getByRole("link", { name: "Institution 1" })).toHaveAttribute("href", "/institution/1");
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "https://example.com/fees.pdf");
    expect(screen.queryByText("Institution 3")).toBeNull();
  });
});
