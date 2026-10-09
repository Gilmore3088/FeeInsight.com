import { beforeEach, describe, expect, it, vi } from "vitest";

const { startAgentRunMock } = vi.hoisted(() => ({ startAgentRunMock: vi.fn() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { FREQUENCY_FILL_VERSION } from "./frequency-fill";
import { GUARD_CATCH_UP_SOURCE, scheduleGuardCatchUpRun } from "./guard-catch-up";

function createDb(existing: Array<{ id: number }>) {
  return vi.fn(() => Promise.resolve(existing)) as unknown as Parameters<typeof scheduleGuardCatchUpRun>[0] & ReturnType<typeof vi.fn>;
}

describe("guard catch-up run", () => {
  beforeEach(() => {
    startAgentRunMock.mockReset();
    startAgentRunMock.mockResolvedValue({ run: { id: 900 }, steps: [], reused: false });
  });

  it("starts one run over every live fee when this guard and frequency version pair has none", async () => {
    const result = await scheduleGuardCatchUpRun(createDb([]));
    expect(result).toMatchObject({ scheduled: true, runId: 900 });
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.params).toEqual({
      source: GUARD_CATCH_UP_SOURCE,
      category_guard_version: CATEGORY_GUARD_VERSION,
      frequency_fill_version: FREQUENCY_FILL_VERSION,
    });
    expect(input.params.institution_id).toBeUndefined();
    expect(input.steps.map((step: { key: string }) => step.key)).toEqual(["category-guard", "frequency-fill"]);
  });

  it("starts nothing when a run for this version pair already exists", async () => {
    const result = await scheduleGuardCatchUpRun(createDb([{ id: 777 }]));
    expect(result).toMatchObject({ scheduled: false, runId: 777 });
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });
});
