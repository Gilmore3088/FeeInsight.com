// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: start }));

import { scheduleAnswerKeyRekeyRun } from "./answer-key-rekey-schedule";
import { REKEY_MAX_COST_MICROUSD, REKEY_SOURCE, REKEY_STEP_KEY } from "./answer-key-rekey";

function db(state: { active: boolean; banks: number; charge: number }) {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join("$");
    if (text.includes("FROM agent_runs")) return state.active ? [{ id: 77 }] : [];
    if (text.includes("FROM answer_key_institutions k")) return Array.from({ length: state.banks }, (_, i) => ({ institution_id: i, answer_key_institution_id: i, text_id: i, source_document_id: i, source_url: null, char_count: 10 }));
    if (text.includes("AS charge")) return [{ charge: state.charge }];
    return [];
  }) as never;
}

describe("scheduleAnswerKeyRekeyRun", () => {
  beforeEach(() => {
    start.mockReset();
    start.mockResolvedValue({ reused: false, run: { id: 88 } });
  });

  it("never queues a second run while one is active", async () => {
    expect(await scheduleAnswerKeyRekeyRun(db({ active: true, banks: 5, charge: 0 }))).toEqual({ scheduled: false, runId: 77, reason: "active" });
    expect(start).not.toHaveBeenCalled();
  });

  it("stops once every bank is read or the batch reaches its cap", async () => {
    expect(await scheduleAnswerKeyRekeyRun(db({ active: false, banks: 0, charge: 0 }))).toMatchObject({ scheduled: false, reason: "done" });
    expect(await scheduleAnswerKeyRekeyRun(db({ active: false, banks: 3, charge: REKEY_MAX_COST_MICROUSD }))).toMatchObject({ scheduled: false, reason: "capped" });
    expect(start).not.toHaveBeenCalled();
  });

  it("queues one provider-step run keyed by the ten-minute bucket", async () => {
    const result = await scheduleAnswerKeyRekeyRun(db({ active: false, banks: 3, charge: 0 }), new Date("2026-11-01T18:05:00Z"));
    expect(result).toEqual({ scheduled: true, runId: 88 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      params: { source: REKEY_SOURCE, batch_id: "2026-11-01" },
      idempotencyKey: `deming:answer-key-rekey:2026-11-01:${Math.floor(Date.parse("2026-11-01T18:05:00Z") / 600_000)}`,
      steps: [expect.objectContaining({ key: REKEY_STEP_KEY })],
    }));
  });
});
