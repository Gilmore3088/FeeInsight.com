// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MagellanConsole } from "./magellan-console";
import type { MagellanStatus } from "../types";

const mocks = vi.hoisted(() => ({
  fetchMagellanStatus: vi.fn(),
  resetMagellanCircuit: vi.fn(),
  runMagellanRepair: vi.fn(),
  triggerAgentRunExecution: vi.fn(),
}));

vi.mock("../actions", () => ({
  fetchMagellanStatus: () => mocks.fetchMagellanStatus(),
  resetMagellanCircuit: (actor: string) => mocks.resetMagellanCircuit(actor),
  runMagellanRepair: (size: number, chain: number) => mocks.runMagellanRepair(size, chain),
}));

vi.mock("@/lib/agents/client-execution", () => ({
  triggerAgentRunExecution: (runId: number) => mocks.triggerAgentRunExecution(runId),
}));

const initialStatus: MagellanStatus = {
  pending: 500,
  circuit: { halted: false, reason: null },
  rescued: 0,
  dead: 0,
  needs_human: 0,
  retry_after: 0,
  today_cost_usd: 0,
  spend_read_at: null,
};

beforeEach(() => {
  mocks.fetchMagellanStatus.mockReset().mockResolvedValue(initialStatus);
  mocks.resetMagellanCircuit.mockReset().mockResolvedValue({ ok: true });
  mocks.runMagellanRepair.mockReset();
  mocks.triggerAgentRunExecution.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      generatedAt: "2026-08-12T00:00:00.000Z",
      activeJobs: [],
      recentJobs: [],
    }),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MagellanConsole", () => {
  it("renders a visible run receipt after Magellan repair is queued", async () => {
    mocks.runMagellanRepair.mockResolvedValue({ success: true, jobId: 456, reused: false });

    render(<MagellanConsole initialStatus={initialStatus} />);

    fireEvent.click(screen.getByRole("button", { name: /queue repair/i }));

    expect(await screen.findByText(/run created/i)).toBeInTheDocument();
    expect(screen.getByText(/#456/)).toBeInTheDocument();
    expect(screen.getByText("Magellan repair")).toBeInTheDocument();
    expect(screen.getByText(/waiting for run events/i)).toBeInTheDocument();
    expect(mocks.runMagellanRepair).toHaveBeenCalledWith(500, 1);
    expect(mocks.triggerAgentRunExecution).toHaveBeenCalledWith(456);
  });
});
