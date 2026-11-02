import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LaneWaitExceeded, createLanes, recomputeLaneCount } from "./recompute-lanes";

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

  it("drops a recompute that waits past the cap instead of running it without a lane", async () => {
    vi.useFakeTimers();
    const lanes = createLanes(1, 1000);
    const holder = deferred();
    const held = lanes.run(() => holder.promise);
    let ran = false;
    const late = lanes.run(async () => { ran = true; });
    const outcome = late.then(() => "ran", (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBeInstanceOf(LaneWaitExceeded);
    expect(ran).toBe(false);
    expect(lanes.waiting).toBe(0);
    expect(lanes.busy).toBe(1);
    holder.resolve();
    await held;
    expect(lanes.busy).toBe(0);
  });

  it("starts a waiting recompute at once when it is promoted, without taking a lane", async () => {
    const lanes = createLanes(1);
    const holder = deferred();
    const held = lanes.run(() => holder.promise);
    let ran = false;
    const queued = lanes.start(async () => { ran = true; return "promoted"; });
    await flush();
    expect(ran).toBe(false);
    queued.promote();
    expect(await queued.result).toBe("promoted");
    expect(lanes.waiting).toBe(0);
    expect(lanes.busy).toBe(1);
    holder.resolve();
    await held;
    expect(lanes.busy).toBe(0);
  });

  it("ignores a promotion once the recompute has its lane", async () => {
    const lanes = createLanes(1);
    const run = lanes.start(async () => "laned");
    run.promote();
    expect(await run.result).toBe("laned");
    expect(lanes.busy).toBe(0);
  });

  it("runs a waiting recompute in the context of the call that queued it, not the one that freed the lane", async () => {
    const lanes = createLanes(1);
    const request = new AsyncLocalStorage<string>();
    const holder = deferred();
    const held = request.run("request-A", () => lanes.run(() => holder.promise));
    const queued = request.run("request-B", () => lanes.run(async () => request.getStore()));
    await flush();
    holder.resolve();
    await held;
    expect(await queued).toBe("request-B");
  });

  it("keeps the lane count right when a waiting recompute throws before returning a promise", async () => {
    const lanes = createLanes(1);
    const holder = deferred();
    const held = lanes.run(() => holder.promise);
    const broken = lanes.run((() => { throw new Error("sync"); }) as () => Promise<void>);
    await flush();
    holder.resolve();
    await expect(held).resolves.toBeUndefined();
    await expect(broken).rejects.toThrow("sync");
    expect(lanes.busy).toBe(0);
    await expect(lanes.run(async () => "next")).resolves.toBe("next");
  });
});
