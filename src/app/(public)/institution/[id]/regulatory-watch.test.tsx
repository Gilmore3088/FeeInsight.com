import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegulatoryWatchSection, peerRows, timelineWindow } from "./regulatory-watch";
import type { RegulatoryWatch, WatchPeerAction } from "@/lib/data-store/regulatory-watch";

const action = (over: Partial<WatchPeerAction>): WatchPeerAction => ({
  peer_id: 4, peer_name: "Big Bank, National Association", agency: "OCC", party_name: "Big Bank, National Association",
  against_holding_company: false, action_type: "Civil Money Penalty (CMP)", subject: "Consumer Law; Unfair or Deceptive (UDAP)",
  consumer_law: true, theme: "consumer", no_end_date_on_file: false, start_date: "2024-12-01", termination_date: null,
  penalty_amount: 20_000_000, document_url: "https://www.occ.gov/x.pdf", ...over,
});

const WATCH: RegulatoryWatch = {
  state: null,
  market: { places: ["Austin, TX"], peers_checked: 20 },
  agencies_loaded: ["OCC", "FRB"],
  as_of: "2026-10-07",
  rules_tracked: true,
  peer_actions: [
    action({}),
    action({ peer_id: 5, peer_name: "Other Bank", agency: "FRB", party_name: "Other Bancorp", against_holding_company: true, action_type: "Written Agreement", subject: "BSA/AML", consumer_law: false, theme: "bsa_aml", no_end_date_on_file: true, start_date: "2025-02-01", penalty_amount: null, document_url: null }),
  ],
  fee_focus: [
    { fee_category: "overdraft", display_name: "Overdraft (OD)", amount: 35, market_median: 32, market_count: 6 },
    { fee_category: "stop_payment", display_name: "Stop Payment", amount: 25, market_median: 30, market_count: 8 },
  ],
  rule_changes: [
    { source: "federal_register", title: "Overdraft Lending: Very Large Financial Institutions", kind: "final_rule", stage: "in_effect", agencies: ["Consumer Financial Protection Bureau"], published_on: "2024-12-30", comments_close_on: null, effective_on: "2025-10-01", url: "https://www.federalregister.gov/x", topics: ["overdraft_nsf"], all_fees: false,
      fees: [{ fee_category: "overdraft", display_name: "Overdraft (OD)", amount: 35, market_median: 32, market_count: 6 }] },
  ],
};

describe("RegulatoryWatchSection", () => {
  it("leads with the headline and figures, then the timeline, fee and rule exhibits", () => {
    const { container } = render(<RegulatoryWatchSection watch={WATCH} exportHref="/api/v1/institutions?id=12&view=benchmark&format=csv" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "2 of your 20 largest Austin competitors drew federal enforcement since Oct 2023; 1 action concerned consumer law.",
    );
    expect(screen.getByText("2 of 20")).toBeInTheDocument();
    expect(screen.getAllByText(/^\$20(\.0)?M$/).length).toBe(2);
    expect(screen.getByText(/^Exhibit 1 · /)).toBeInTheDocument();
    expect(screen.getByText(/^Exhibit 3 · /)).toBeInTheDocument();
    // Short names on the timeline; the order link and holding company sit in the mark's label.
    expect(screen.getByText("Big Bank")).toBeInTheDocument();
    expect(container.querySelector('a[href="https://www.occ.gov/x.pdf"]')?.getAttribute("aria-label")).toContain("Consumer Law");
    expect(container.innerHTML).toContain("against the holding company, Other Bancorp");
    expect(screen.getByText("+$3.00")).toBeInTheDocument();
    expect(screen.getByText("−$5.00")).toBeInTheDocument();
    expect(screen.getByText("In effect")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bactive\b/i);
    expect(screen.getByRole("link", { name: /Download your fees and peer benchmarks/ })).toHaveAttribute("href", "/api/v1/institutions?id=12&view=benchmark&format=csv");
  });

  it("drops empty exhibits and says when no competitor has an action", () => {
    render(<RegulatoryWatchSection watch={{ ...WATCH, peer_actions: [], rule_changes: [], fee_focus: [] }} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("None of your 20 largest Austin competitors has a federal enforcement action since Oct 2023.");
    expect(screen.queryByText(/Exhibit/)).toBeNull();
  });
});

describe("timeline helpers", () => {
  it("spans the last three years to the read date and orders competitors by latest action", () => {
    const { start, end } = timelineWindow("2026-10-07", []);
    expect(new Date(start).toISOString().slice(0, 10)).toBe("2023-10-07");
    expect(new Date(end).toISOString().slice(0, 10)).toBe("2026-10-07");
    expect(peerRows(WATCH.peer_actions).map((r) => r.peer_name)).toEqual(["Other Bank", "Big Bank, National Association"]);
  });
});

describe("state exhibit", () => {
  const state = {
    state_code: "IL", state_name: "Illinois",
    supervisor: { agency: "Illinois Department of Financial and Professional Regulation", website: "https://idfpr.illinois.gov" },
    laws: [{ id: "il_dormancy", name: "Conditions on dormancy charges", citation: "765 ILCS 1026/15-602", summary: "A holder may deduct a dormancy charge only under a contract.", url: null, topic: "dormancy", all_fees: false,
      fees: [{ fee_category: "dormant_account", display_name: "Dormant Account", amount: 10, market_median: 15, market_count: 7 }] }],
    laws_reviewed: true,
    bills: [],
    bills_tracked: false,
  };

  it("shows the state's laws on the bank's fees with its charter supervisor", () => {
    const { container } = render(<RegulatoryWatchSection watch={{ ...WATCH, state }} />);
    expect(screen.getByText("Illinois: state law and bills on your fees")).toBeInTheDocument();
    expect(screen.getByText("Illinois Department of Financial and Professional Regulation")).toBeInTheDocument();
    expect(screen.getByText("$10.00").parentElement?.textContent).toBe("Dormant Account $10.00");
    expect(container.textContent).not.toMatch(/not yet legally reviewed/i);
  });

  it("marks a draft for legal review, and draws nothing when the state has no laws or bills to show", () => {
    render(<RegulatoryWatchSection watch={{ ...WATCH, state: { ...state, laws_reviewed: false } }} />);
    expect(screen.getByText("Not yet legally reviewed")).toBeInTheDocument();
    const { container } = render(<RegulatoryWatchSection watch={{ ...WATCH, state: { ...state, laws: [] } }} />);
    expect(container.textContent).not.toContain("state law and bills");
  });
});


describe("state banking-department orders on the timeline", () => {
  it("names state enforcement in the headline and exhibit once a state order is shown", () => {
    const watch: RegulatoryWatch = {
      ...WATCH,
      agencies_loaded: ["OCC", "FRB", "STATE_TX"],
      peer_actions: [action({ peer_id: 6, peer_name: "Herring Bank", agency: "STATE_TX", party_name: "Herring Bank", action_type: "Consent order", subject: null, consumer_law: false, theme: "other", penalty_amount: null, document_url: null })],
    };
    render(<RegulatoryWatchSection watch={watch} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/drew federal or state enforcement since/);
    expect(screen.getByText(/^Federal and state enforcement against your largest local competitors/)).toBeInTheDocument();
  });
});
