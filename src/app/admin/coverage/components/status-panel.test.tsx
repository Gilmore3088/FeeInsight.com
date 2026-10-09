import { render, screen } from "@testing-library/react";
import { StatusPanel } from "./status-panel";
import { describe, it, expect } from "vitest";

describe("StatusPanel", () => {
  it("renders all 5 tiles with numbers", () => {
    render(
      <StatusPanel
        status={{
          pending: 965,
          rescued: 12,
          dead: 3,
          needs_human: 1,
          retry_after: 5,
          today_cost_usd: 0.4,
          spend_read_at: "2026-10-08T22:30:00.000Z",
          circuit: { halted: false },
        }}
      />
    );
    expect(screen.getByText("965")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Waiting for rescue")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("$0.40")).toBeInTheDocument();
    expect(screen.getByText(/All Magellan provider calls, UTC day · as of Oct 8, 3:30 PM PDT/)).toBeInTheDocument();
  });

  it("says spend could not be read instead of showing $0.00", () => {
    render(
      <StatusPanel
        status={{
          pending: 1, rescued: 0, dead: 0, needs_human: 0, retry_after: 0,
          today_cost_usd: null, spend_read_at: null, circuit: { halted: false },
        }}
      />
    );
    expect(screen.getByText("Couldn't read")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});
