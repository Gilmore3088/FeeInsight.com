import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompetitorBoard } from "./board-math";
import { CompetitorBoardExhibit, PriceTesterExhibit } from "./workspace-exhibits";
import { DEMO_LEAD_SOURCE, DemoRequestForm } from "./demo-request-form";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const peer = (id: number, name: string, amount: number) => ({ id, name, amount });

const board: CompetitorBoard = {
  institutionName: "Capital City Bank",
  marketLabel: "Tallahassee, FL area (3 counties)",
  competitorsWithData: 29,
  lines: [
    {
      key: "overdraft",
      label: "Overdraft",
      own: 35,
      quote: "Overdraft Item Fee* | $35",
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

afterEach(() => vi.restoreAllMocks());

describe("CompetitorBoardExhibit", () => {
  it("shows the institution's fee, its source line, and names a competitor on hover", () => {
    render(<CompetitorBoardExhibit board={board} />);
    expect(screen.getByText("Hamilton · My fees")).toBeTruthy();
    expect(screen.getByText(/3 of 5 local competitors charge less/)).toBeTruthy();
    expect(screen.getByText(/Overdraft Item Fee\* \| \$35/)).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Truist Bank: $36.00" }));
    expect(screen.getAllByText("Truist Bank").length).toBeGreaterThan(0);
  });

  it("switches fee line from the tabs", () => {
    render(<CompetitorBoardExhibit board={board} />);
    fireEvent.click(screen.getByRole("tab", { name: "Outgoing international wire" }));
    expect(screen.getByRole("tab", { name: "Outgoing international wire" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/5 of 5 local competitors charge less/)).toBeTruthy();
    expect(screen.getByText("Above local range")).toBeTruthy();
  });
});

describe("PriceTesterExhibit", () => {
  it("counts the competitors charging less as the price moves", () => {
    render(<PriceTesterExhibit board={board} />);
    const slider = screen.getByLabelText("Price to try") as HTMLInputElement;
    expect(slider.value).toBe("35");
    fireEvent.change(slider, { target: { value: "20" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("$20.00: 1 of 5 local competitors charge less");
    expect(screen.getByText("Below local range")).toBeTruthy();
  });
});

describe("DemoRequestForm", () => {
  it("posts the same demo lead the contact form does", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DemoRequestForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Smith" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "jane@bank.com" } });
    fireEvent.change(screen.getByLabelText("Bank or credit union"), { target: { value: "Capital City Bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Request a demo" }));
    await waitFor(() => expect(screen.getByText("Request received")).toBeTruthy());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/leads");
    expect(body).toMatchObject({ name: "Jane Smith", email: "jane@bank.com", company: "Capital City Bank", source: DEMO_LEAD_SOURCE });
    vi.unstubAllGlobals();
  });
});
