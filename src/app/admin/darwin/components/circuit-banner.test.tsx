import { render, screen } from "@testing-library/react";
import { CircuitBanner } from "@/components/agent-console/circuit-banner";
import { describe, it, expect, vi } from "vitest";

describe("CircuitBanner", () => {
  it("renders nothing when not halted", () => {
    const { container } = render(
      <CircuitBanner
        status={{
          pending: 0,
          circuit: { halted: false },
        }}
        onReset={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders red banner with reason when halted", () => {
    render(
      <CircuitBanner
        status={{
          pending: 0,
          circuit: { halted: true, reason: "error_rate" },
        }}
        onReset={vi.fn()}
      />
    );
    expect(screen.getByText(/Work is paused for this agent/)).toBeInTheDocument();
    expect(screen.getByText(/error_rate/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("offers no reset button when nothing here can reset the pause (Darwin, #1115)", () => {
    render(<CircuitBanner status={{ pending: 0, circuit: { halted: true, reason: "backend off" } }} />);
    expect(screen.getByText(/backend off/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
