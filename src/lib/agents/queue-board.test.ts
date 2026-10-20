import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { growthBaseFor, judgeQueue, queueBoardFromDetail, queueSizesFromDetail, readQueueBoard, summarizeQueueBoard, type QueueHistoryDay } from "./queue-board";
import type { PipelineQueue } from "./queue-registry";

const NOW = new Date("2026-10-21T06:00:00Z");
const ENTRY: PipelineQueue = {
  key: "fixture_pile",
  label: "Fixture pile",
  owner: "knox",
  tables: ["fixture_queue"],
  sql: "SELECT COUNT(*)::int AS size, MIN(created_at) AS oldest FROM fixture_queue",
  ageMeans: "the oldest row",
  ageLimitDays: 7,
  growthWindowDays: 14,
  wayOut: "Knox works it.",
  issues: [1108],
};
const day = (date: string, size: number | null): QueueHistoryDay => ({ date, sizes: { fixture_pile: size } });

describe("queue board (#1108)", () => {
  it("fires the age alarm only past the limit and only when the pile holds something", () => {
    expect(judgeQueue(ENTRY, { size: 3, oldest: "2026-10-13T06:00:00Z" }, [], NOW).alarms).toEqual(["age"]);
    expect(judgeQueue(ENTRY, { size: 3, oldest: "2026-10-14T06:00:00Z" }, [], NOW).alarms).toEqual([]);
    expect(judgeQueue(ENTRY, { size: 0, oldest: null }, [], NOW)).toMatchObject({ alarms: [], oldestDays: null });
  });

  it("compares growth with the newest stored day at least the window back", () => {
    const history = [day("2026-10-01", 50), day("2026-10-07", 90), day("2026-10-08", 10)];
    expect(growthBaseFor("fixture_pile", 14, history, "2026-10-21")).toEqual({ date: "2026-10-07", size: 90 });
    expect(judgeQueue(ENTRY, { size: 91, oldest: null }, history, NOW).alarms).toEqual(["growth"]);
    expect(judgeQueue(ENTRY, { size: 90, oldest: null }, history, NOW).alarms).toEqual([]);
  });

  it("does not judge growth before the history reaches back far enough, or across an unread day", () => {
    expect(judgeQueue(ENTRY, { size: 500, oldest: null }, [day("2026-10-08", 1)], NOW)).toMatchObject({ growthBase: null, alarms: [] });
    expect(growthBaseFor("fixture_pile", 14, [day("2026-10-05", null)], "2026-10-21")).toBeNull();
  });

  it("stores a failed read as unknown, never as zero", () => {
    expect(judgeQueue(ENTRY, null, [day("2026-10-01", 5)], NOW)).toMatchObject({ size: null, alarms: [], growthBase: null });
  });

  it("reads sizes back from a stored board and skips malformed rows", () => {
    expect(queueSizesFromDetail({ queues: [{ key: "a", size: 4 }, { key: "b", size: null }, { size: 3 }] })).toEqual({ a: 4, b: null });
    expect(queueSizesFromDetail(null)).toEqual({});
    expect(queueBoardFromDetail({ queues: [] })).toEqual({ queues: [] });
    expect(queueBoardFromDetail("nope")).toBeNull();
  });

  it("measures each queue with its own query and judges it against stored days", async () => {
    const calls: string[] = [];
    const db = Object.assign(
      async (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return [{ day: "2026-10-01", queues: { queues: [{ key: "fixture_pile", size: 2 }] } }];
      },
      { unsafe: async (text: string) => { calls.push(text); return [{ size: 5, oldest: "2026-10-01T00:00:00Z" }]; } },
    );
    const board = await readQueueBoard(db as never, [ENTRY], NOW);
    expect(calls[0]).toContain("pipeline_scoreboard_snapshots");
    expect(calls[1]).toBe(ENTRY.sql);
    expect(board.queues[0]).toMatchObject({ key: "fixture_pile", owner: "knox", size: 5, oldestDays: 20, alarms: ["age", "growth"] });
    expect(summarizeQueueBoard(board)).toBe("Piles: 1 of 1 piles alarmed: Fixture pile (knox) 5: oldest 20 days, limit 7; up from 2 on 2026-10-01.");
  });

  it("keeps the other piles when one query fails", async () => {
    const db = Object.assign(async () => [], {
      unsafe: async (text: string) => { if (text.includes("broken")) throw new Error("boom"); return [{ size: 0, oldest: null }]; },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const board = await readQueueBoard(db as never, [{ ...ENTRY, key: "broken", sql: "SELECT broken" }, ENTRY], NOW);
    error.mockRestore();
    expect(board.queues.map((queue) => queue.size)).toEqual([null, 0]);
    expect(summarizeQueueBoard(board)).toBe("Piles: 0 of 2 piles alarmed (1 unreadable).");
  });
});
