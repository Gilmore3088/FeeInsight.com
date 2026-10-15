import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoardChart, BoardHeading, BoardRows, CharterRows, FindingButtons, StateBoard } from "./state-board";
import type { BoardFee } from "./state-view";

// Overdraft: four banks charge $30-$34, three credit unions $20-$25. NSF: five banks at $15.
const overdraft: BoardFee = {
  key: "overdraft",
  name: "Overdraft (OD)",
  institutions: 7,
  median: 30,
  p25: 22,
  p75: 33,
  bank: { median: 32, institutions: 4 },
  cu: { median: null, institutions: 3 },
  us: { p25: 25, median: 30, p75: 35 },
  position: "within",
  district: { p25: 20, median: 25, p75: 28, institutions: 40 },
  values: [
    [20, 2],
    [22, 2],
    [25, 2],
    [30, 1],
    [32, 1],
    [33, 1],
    [34, 1],
  ],
};
const nsf: BoardFee = {
  ...overdraft,
  key: "nsf",
  name: "NSF",
  institutions: 5,
  median: 15,
  bank: { median: 15, institutions: 5 },
  cu: { median: null, institutions: 0 },
  position: "below",
  district: null,
  values: [15, 15, 15, 15, 15].map((v) => [v, 1] as [number, 1]),
};

function renderBoard() {
  render(
    <StateBoard fees={[overdraft, nsf]} stateName="Ohio" districtName="Cleveland Fed district">
      <BoardHeading id="h" />
      <FindingButtons findings={[{ key: "f", figure: "$15", headline: "NSF is lowest", note: "$15 vs U.S. $30 · 5 institutions", fee: "nsf" }]} />
      <BoardChart />
      <BoardRows fees={[overdraft, nsf]} ariaLabel="Fees" />
      <CharterRows fees={[{ ...overdraft, cu: { median: 22, institutions: 3 } }]} />
    </StateBoard>,
  );
}

describe("state board", () => {
  it("opens on the first fee and counts a tapped price range", () => {
    renderBoard();
    expect(screen.getByText("Median of 7 Ohio institutions. U.S. $30.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^\$30 to \$34\.99: 4 institutions/ }));
    expect(screen.getByText("4 institutions")).toBeTruthy();
    expect(screen.getByText("charge $30 to $34.99: 57% of 7 Ohio institutions")).toBeTruthy();
  });

  it("redraws for banks or credit unions, and says when a charter is too thin for a median", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /^Banks/ }));
    expect(screen.getByText("Median of 4 Ohio banks. U.S. $30.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Credit unions/ }));
    expect(screen.getByText("Too few credit unions for a median yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^\$20 to \$24\.99: 2 credit unions/ })).toBeTruthy();
  });

  it("draws the fee picked in a finding or a list row", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /NSF is lowest/ }));
    expect(screen.getByRole("heading", { name: "NSF" })).toBeTruthy();
    expect(screen.getByText("Median of 5 Ohio institutions. U.S. $30.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Overdraft \(OD\): banks/ }));
    expect(screen.getByRole("heading", { name: "Overdraft (OD)" })).toBeTruthy();
  });

  it("opens a fee with no credit unions on everyone rather than an empty chart", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /^Credit unions/ }));
    fireEvent.click(screen.getByRole("button", { name: /NSF is lowest/ }));
    expect(screen.getByText("Median of 5 Ohio institutions. U.S. $30.")).toBeTruthy();
  });

  it("reads the state against its Fed district at a tap", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Cleveland Fed district" }));
    expect(screen.getByRole("heading", { name: "Ohio against the Cleveland Fed district" })).toBeTruthy();
    expect(screen.getByText("Median of 7 Ohio institutions. Cleveland Fed district $25.")).toBeTruthy();
    // $30 sits above the district's middle half ($20 to $28), though inside the U.S. one.
    expect(screen.getByRole("button", { name: /^Overdraft \(OD\): \$30.*above the district middle half; district median \$25/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^NSF: \$15 across 5 institutions$/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /NSF is lowest/ }));
    expect(screen.getByText(/Too few district institutions for a median yet\./)).toBeTruthy();
  });
});
