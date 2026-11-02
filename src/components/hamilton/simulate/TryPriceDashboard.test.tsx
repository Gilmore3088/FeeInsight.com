import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/app/pro/(hamilton)/simulate/actions", () => ({ saveScenario: mocks.save }));

import { TryPriceDashboard, type TryPriceDashboardProps } from "./TryPriceDashboard";
import { tryPriceGroups } from "@/lib/hamilton/dashboard/try-price";
import { REPORT_BASKET_KEY } from "@/lib/hamilton/report-basket";

const state = [10, 20, 25, 25, 30, 30, 32, 35, 35, 40];
const peers = [27, 33, 37];

function props(over: Partial<TryPriceDashboardProps> = {}): TryPriceDashboardProps {
  return {
    institutionId: "303",
    institutionName: "Synthetic Bank B",
    fee: "overdraft",
    feeName: "Overdraft",
    feeProse: "overdraft",
    current: 30,
    dek: "Synthetic Bank B charges $30 today.",
    fees: [{ category: "overdraft", name: "Overdraft", label: "$30", href: "/pro/simulate?fee=overdraft", active: true }],
    groups: tryPriceGroups([
      { key: "state", label: "Ohio", scope: "Banks in Ohio", n: 10, minPeers: 10, thin: false, amounts: state, p25: 25, median: 30, p75: 34.25 },
      { key: "peers", label: "Peer group", scope: "Saved peers", n: 3, minPeers: 10, thin: true, amounts: peers, p25: null, median: null, p75: null },
    ]),
    openingGroup: "state",
    peerAmounts: peers,
    strip: { title: "Your saved peers", tiles: peers.map((a, i) => ({ id: i + 1, name: `Synthetic Peer ${i + 1}`, amount: a, label: `$${a}` })), more: 0 },
    initialPrice: 30,
    slider: { max: 50, step: 0.5 },
    figures: { items: "", waiver: "", saved: false },
    saved: [{ id: "s1", fee: "overdraft", feeName: "Overdraft", current: 30, proposed: 25, savedOn: "Oct 30, 2026", href: "/pro/simulate?scenario_id=s1" }],
    source: "published fee schedules on file, read Nov 2, 2026.",
    tableHref: "/pro/simulate?fee=overdraft&layer=state&instId=303",
    settingsHref: "/pro/settings",
    researchHref: "/pro/research",
    ...over,
  };
}

beforeEach(() => {
  mocks.save.mockReset();
  window.localStorage.removeItem(REPORT_BASKET_KEY);
});

describe("TryPriceDashboard", () => {
  it("opens at no change and moves every readout with the slider", () => {
    render(<TryPriceDashboard {...props()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Test a new price");
    expect(screen.getByText("No change")).toBeInTheDocument();
    expect(screen.getByText("50th")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Drag to set the price"), { target: { value: "40" } });
    expect(screen.getByLabelText("Proposed price in dollars")).toHaveValue(40);
    expect(screen.getByText("+$10")).toBeInTheDocument();
    expect(screen.getByText("95th")).toBeInTheDocument();
    expect(screen.getAllByText(/Above the middle half/).length).toBeGreaterThan(0);
    const counts = within(screen.getByRole("list", { name: /charging more/ }));
    expect(counts.getByText("Ohio (10)").parentElement).toHaveTextContent("▲ 0 charge more● 1 same▼ 9 charge less");
    expect(screen.getByRole("img", { name: /Proposed \$40: 0 charge more, 1 the same, 9 charge less/ })).toBeInTheDocument();
  });

  it("follows a typed price and says a thin peer group is too few for a median", () => {
    render(<TryPriceDashboard {...props()} />);
    fireEvent.change(screen.getByLabelText("Proposed price in dollars"), { target: { value: "20" } });
    expect(screen.getByText("−$10")).toBeInTheDocument();
    expect(screen.getByText(/Too few peers for a median: 3 publish, 10 needed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Peer group" }));
    expect(screen.getByText("Too few")).toBeInTheDocument();
    expect(screen.getByText(/Only 3 publish this fee; a percentile needs 10/)).toBeInTheDocument();
  });

  it("shows no fee income until the bank types its yearly count", () => {
    render(<TryPriceDashboard {...props({ initialPrice: 35 })} />);
    expect(screen.getByLabelText("Items charged a year")).toHaveValue("");
    expect(screen.getByText(/Type your yearly count to see it/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Items charged a year"), { target: { value: "14,500" } });
    fireEvent.change(screen.getByLabelText("Share waived (%)"), { target: { value: "10" } });
    // (35 - 30) x 14,500 x 0.9
    expect(screen.getByText("+$65,250")).toBeInTheDocument();
    expect(screen.getByText(/An estimate before any change in customer behaviour/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Show with every assumption/ }).getAttribute("href")).toContain("paid=14500");
  });

  it("tags each peer against the proposed price", () => {
    render(<TryPriceDashboard {...props({ initialPrice: 33 })} />);
    expect(screen.getByText("Synthetic Peer 1").parentElement).toHaveTextContent("▼ $6 less");
    expect(screen.getByText("Synthetic Peer 2").parentElement).toHaveTextContent("● Same as proposed");
    expect(screen.getByText("Synthetic Peer 3").parentElement).toHaveTextContent("▲ $4 more");
  });

  it("saves a scenario with the existing action and lists it", async () => {
    mocks.save.mockResolvedValue({ id: "new-id" });
    render(<TryPriceDashboard {...props({ initialPrice: 35 })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ institutionId: "303", feeCategory: "overdraft", currentValue: 30, proposedValue: 35 }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved: Overdraft at $35.");
    expect(screen.getByRole("link", { name: "Overdraft: $30 to $35" })).toBeInTheDocument();
  });

  it("says plainly when a save is refused", async () => {
    mocks.save.mockResolvedValue({ error: "Active subscription required" });
    render(<TryPriceDashboard {...props()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Not saved. Active subscription required");
  });

  it("adds the tested price to the board brief and takes it out again", () => {
    render(<TryPriceDashboard {...props({ initialPrice: 35 })} />);
    const button = screen.getByRole("button", { name: "Add to board brief" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "In board brief" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(REPORT_BASKET_KEY)).toContain("\"proposedFee\":35");
    fireEvent.click(screen.getByRole("button", { name: "In board brief" }));
    expect(screen.getByRole("button", { name: "Add to board brief" })).toBeInTheDocument();
  });

  it("loads a saved scenario of the same fee into the price", () => {
    render(<TryPriceDashboard {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Load $25 into the price" }));
    expect(screen.getByLabelText("Proposed price in dollars")).toHaveValue(25);
  });
});
