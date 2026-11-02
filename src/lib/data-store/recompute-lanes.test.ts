import { afterEach, describe, expect, it, vi } from "vitest";
import { createLanes, recomputeLaneCount } from "./recompute-lanes";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  vi.useRealTimers();
});

describe("recomputeLaneCount", () => {
  it("leaves two of the server's connections for a page's own reads", () => {
    expect(recomputeLaneCount(5)).toBe(3);
    expect(recomputeLaneCount(10)).toBe(8);
  });

  it("keeps at least one lane on a small pool", () => {
    expect(recomputeLaneCount(2)).toBe(1);
    expect(recomputeLaneCount(1)).toBe(1);
  });
});

describe("createLanes", () => {
  it("runs at most `count` recomputes at once and starts the next as one finishes", async () => {
    const lanes = createLanes(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, i) => lanes.run(async () => { started.push(i); await gate.promise; return i; }));
    await flush();
    expect(started).toEqual([0, 1]);
    expect(lanes.busy).toBe(2);
    expect(lanes.waiting).toBe(1);

    gates[0].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(lanes.busy).toBe(2);
    expect(lanes.waiting).toBe(0);

    gates[1].resolve();
    gates[2].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
    expect(lanes.busy).toBe(0);
  });

  it("frees the lane when a recompute fails", async () => {
    const lanes = createLanes(1);
    await expect(lanes.run(async () => { throw new Error("db down"); })).rejects.toThrow("db down");
    expect(lanes.busy).toBe(0);
    await expect(lanes.run(async () => "next")).resolves.toBe("next");
  });

  it("runs a recompute nested in a running one at once, so held lanes cannot deadlock", async () => {
    const lanes = createLanes(1);
    const result = await lanes.run(() => lanes.run(async () => "inner"));
    expect(result).toBe("inner");
    expect(lanes.busy).toBe(0);
  });

  it("runs a waiting recompute without a lane after the wait cap, and gives no lane back for it", async () => {
    vi.useFakeTimers();
    const lanes = createLanes(1, 1000);
    const holder = deferred();
    const held = lanes.run(() => holder.promise);
    let ran = false;
    const late = lanes.run(async () => { ran = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(ran).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await late;
    expect(ran).toBe(true);
    expect(lanes.waiting).toBe(0);
    expect(lanes.busy).toBe(1);
    holder.resolve();
    await held;
    expect(lanes.busy).toBe(0);
  });
});
