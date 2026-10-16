import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CompetitorBoard } from "./board-math";
import { axisTicks } from "./board-math";
import { CompetitorBoardExhibit, PriceTesterExhibit, SourceFooter, keyboardPrice } from "./workspace-exhibits";
import { SAMPLE_REPORT_HREF } from "@/app/landing-shared";

const peer = (id: number, name: string, amount: number) => ({ id, name, amount });

const board: CompetitorBoard = {
  institutionName: "Capital City Bank",
  marketLabel: "Tallahassee, FL area (3 counties)",
  competitorsWithData: 29,
  leadKey: "overdraft",
  readOn: "2026-10-12",
  lines: [
    {
      key: "overdraft",
      label: "Overdraft",
      own: 35,
      quote: "Overdraft Item Fee* … $35",
      readOn: "2026-10-03",
      peers: [peer(1, "Bank of America, N.A.", 10), peer(2, "Truist Bank", 36), peer(3, "Ameris Bank", 35), peer(4, "Regions Bank", 33), peer(5, "T M H Federal Credit Union", 31.5)],
      median: 35,
      p25: 33,
      p75: 36,
      position: "in_market",
    },
    {
      key: "wire_intl_outgoing",
      label: "Outgoing international wire",
      own: 75,
      quote: null,
      readOn: null,
      peers: [peer(1, "Bank of America, N.A.", 45), peer(2, "Truist Bank", 65), peer(6, "ServisFirst Bank", 20), peer(7, "MidSouth Bank", 40), peer(8, "Regions Bank", 50)],
      median: 45,
      p25: 40,
      p75: 50,
      position: "above_market",
    },
  ],
};

describe("CompetitorBoardExhibit", () => {
  it("shows the institution's fee, its own schedule line, the source footer and the sample link", () => {
    render(<CompetitorBoardExhibit board={board} />);
    expect(screen.getByText("Hamilton · My fees")).toBeTruthy();
    expect(screen.getByText(/3 of 5 local competitors charge less/)).toBeTruthy();
    expect(screen.getByText(/Capital City Bank’s schedule: “Overdraft Item Fee\* … \$35”/)).toBeTruthy();
    expect(screen.getByText(/Bank Fee Index · each fee from the bank’s own published schedule · latest read Oct 12, 2026/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "From the free sample report" }).getAttribute("href")).toBe(SAMPLE_REPORT_HREF);
  });

  it("names a competitor on hover, and keeps the dots out of the tab order", () => {
    render(<CompetitorBoardExhibit board={board} />);
    const dot = screen.getByRole("button", { name: "Truist Bank: $36.00" });
    expect(dot.getAttribute("tabindex")).toBe("-1");
    fireEvent.mouseEnter(dot);
    expect(screen.getAllByText("Truist Bank").length).toBeGreaterThan(0);
  });

  it("opens on the lead line and switches with pressed toggle buttons", () => {
    render(<CompetitorBoardExhibit board={{ ...board, leadKey: "wire_intl_outgoing" }} />);
    expect(screen.getByRole("group", { name: "Fee" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Outgoing international wire" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/5 of 5 local competitors charge less/)).toBeTruthy();
    expect(screen.getByText("Above local range")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Overdraft" }));
    expect(screen.getByRole("button", { name: "Overdraft" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("tab")).toBeNull();
  });
});

describe("picker order", () => {
  it("draws the pickers in the board's order, so the lead line (first) is the first picker in both exhibits", () => {
    const lead = { ...board, lines: [board.lines[1], board.lines[0]], leadKey: "wire_intl_outgoing" };
    for (const Exhibit of [CompetitorBoardExhibit, PriceTesterExhibit]) {
      const { unmount } = render(<Exhibit board={lead} />);
      const first = screen.getAllByRole("group")[0].querySelector("button")!;
      expect(first.textContent).toBe("Outgoing international wire");
      expect(first.getAttribute("aria-pressed")).toBe("true");
      unmount();
    }
  });
});

describe("PriceTesterExhibit", () => {
  it("counts the competitors charging less as the price moves, and returns to the exact price", () => {
    render(<PriceTesterExhibit board={board} />);
    const slider = screen.getByLabelText("Price to try") as HTMLInputElement;
    expect(slider.value).toBe("35");
    expect(slider.getAttribute("step")).toBe("0.01");
    fireEvent.change(slider, { target: { value: "20" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("$20.00: 1 of 5 local competitors charge less");
    expect(screen.getByText("Below local range")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "35" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("$35.00: 3 of 5 local competitors charge less");
    expect(document.querySelector("[aria-live]")).toBeNull();
    expect(screen.getByText(/Bank Fee Index · each fee/)).toBeTruthy();
  });

  it("moves $1 per arrow key and $10 with Shift, within the axis", () => {
    expect(keyboardPrice(35, "ArrowRight", false, 60)).toBe(36);
    expect(keyboardPrice(35.5, "ArrowDown", false, 60)).toBe(34.5);
    expect(keyboardPrice(35, "ArrowUp", true, 60)).toBe(45);
    expect(keyboardPrice(5, "ArrowLeft", true, 60)).toBe(0);
    expect(keyboardPrice(55, "ArrowRight", true, 60)).toBe(60);
    expect(keyboardPrice(35, "Home", false, 60)).toBeNull();
    expect(keyboardPrice(35, "ArrowRight", false, 60, true)).toBeNull();
    render(<PriceTesterExhibit board={board} />);
    const slider = screen.getByLabelText("Price to try") as HTMLInputElement;
    // Ctrl, Alt or Meta with an arrow is the browser's or the screen reader's, not the slider's.
    fireEvent.keyDown(slider, { key: "ArrowLeft", ctrlKey: true });
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^\$35\.00: /);
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(slider.getAttribute("aria-valuetext")).toBe("$25.00: 1 of 5 local competitors charge less");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^\$26\.00: /);
  });

  it("labels the axis in dollars and cents, with a round middle tick", () => {
    render(<PriceTesterExhibit board={board} />);
    expect(screen.getByText("$25.00")).toBeTruthy();
    expect(axisTicks(125)).toEqual([0, 60, 125]);
    expect(axisTicks(50)).toEqual([0, 25, 50]);
    expect(axisTicks(10)).toEqual([0, 5, 10]);
  });
});

describe("SourceFooter", () => {
  it("says what its date covers when it is not every figure", () => {
    render(<SourceFooter readOn="2026-10-03" readLabel="local figures latest read" />);
    expect(screen.getByText(/· local figures latest read Oct 3, 2026$/)).toBeTruthy();
  });
});
