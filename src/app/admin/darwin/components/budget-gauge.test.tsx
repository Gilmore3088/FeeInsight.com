import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetGauge } from "./budget-gauge";

describe("BudgetGauge", () => {
  it("shows ledger counts with their scope, the last Darwin step, and an as-of time", () => {
    render(
      <BudgetGauge
        status={{
          pending: 55_324,
          today_promoted: 180,
          today_cost_usd: 4.48,
          circuit: { halted: false },
          last_step: { run_id: 3151, status: "completed", at: "2026-10-08T22:04:52.000Z" },
          as_of: "2026-10-08T22:30:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("180")).toBeInTheDocument();
    expect(screen.getByText("$4.48")).toBeInTheDocument();
    expect(screen.getByText(/All Darwin provider calls, UTC day/)).toBeInTheDocument();
    expect(screen.getByText("Oct 8, 3:04 PM PDT")).toBeInTheDocument();
    expect(screen.getByText("completed · run #3151")).toBeInTheDocument();
    expect(screen.getByText("As of Oct 8, 3:30 PM PDT")).toBeInTheDocument();
  });

  it("says a failed read could not be read instead of showing zero", () => {
    render(
      <BudgetGauge
        status={{
          pending: null,
          today_promoted: null,
          today_cost_usd: null,
          circuit: { halted: false },
          last_step: null,
          as_of: null,
        }}
      />,
    );
    expect(screen.getAllByText("Couldn't read")).toHaveLength(4);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
