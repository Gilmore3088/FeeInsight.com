import { beforeEach, describe, expect, it, vi } from "vitest";

// Next builds its request stores on this global, which its server bootstrap sets before any
// app module loads; set it here too so the real store (and the nesting check) works.
await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.defineProperty(globalThis, "AsyncLocalStorage", { value: AsyncLocalStorage, configurable: true });
});

// A minimal stand-in for Next's data cache: keyed by the JSON of the arguments,
// stores only results that resolve (a throw is never cached, as in Next).
const store = new Map<string, unknown>();
let cacheAvailable = true;
// vi.mock is hoisted above this file's declarations, so the list it fills is hoisted too.
const seenScopes = vi.hoisted(() => [] as unknown[]);
const registered = vi.hoisted(() => [] as { keyParts: string[]; options?: { revalidate?: number } }[]);

vi.mock("next/cache", async () => {
  const { workUnitAsyncStorage: units } = await import("next/dist/server/app-render/work-unit-async-storage.external");
  return {
    unstable_cache: <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[], options?: { revalidate?: number }) => {
      registered.push({ keyParts, options });
      return async (...args: A): Promise<R> => {
        if (!cacheAvailable) throw new Error("Invariant: incrementalCache missing in unstable_cache");
        // As in Next: a call made while another unstable_cache computes skips the cache entirely.
        seenScopes.push(units.getStore());
        if (units.getStore()?.type === "unstable-cache") return fn(...args);
        const key = JSON.stringify([keyParts, args]);
        if (store.has(key)) return store.get(key) as R;
        const value = await units.run({ type: "unstable-cache" } as never, () => fn(...args));
        store.set(key, value);
        return value;
      };
    },
  };
});

import { DEGRADED_PAGE_SECONDS, STALE_GRACE_MS, cachedPublicRead, shortenPageLife } from "./public-read-cache";
import { STATS_METHOD_VERSION } from "./fee-stats";

beforeEach(() => {
  store.clear();
  cacheAvailable = true;
});

describe("cachedPublicRead", () => {
  it("serves repeat calls with the same arguments from cache", async () => {
    const read = vi.fn(async (state: string) => [{ state, count: 3 }]);
    const cached = cachedPublicRead("test-repeat", read);

    expect(await cached("TX")).toEqual([{ state: "TX", count: 3 }]);
    expect(await cached("TX")).toEqual([{ state: "TX", count: 3 }]);
    expect(read).toHaveBeenCalledTimes(1);

    await cached("CA");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("returns an empty result without caching it, so the next call retries", async () => {
    const read = vi
      .fn<() => Promise<number[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([1, 2]);
    const cached = cachedPublicRead("test-empty", read);

    expect(await cached()).toEqual([]);
    expect(await cached()).toEqual([1, 2]);
    expect(await cached()).toEqual([1, 2]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("honours a custom emptiness rule", async () => {
    const read = vi
      .fn<() => Promise<{ institutions: number }>>()
      .mockResolvedValueOnce({ institutions: 0 })
      .mockResolvedValueOnce({ institutions: 12 });
    const cached = cachedPublicRead("test-custom", read, (v) => v.institutions === 0);

    expect(await cached()).toEqual({ institutions: 0 });
    expect(await cached()).toEqual({ institutions: 12 });
    expect(await cached()).toEqual({ institutions: 12 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("propagates read errors", async () => {
    const cached = cachedPublicRead("test-error", async () => {
      throw new Error("db down");
    });
    await expect(cached()).rejects.toThrow("db down");
  });

  it("falls back to a direct read outside a Next request", async () => {
    cacheAvailable = false;
    const read = vi.fn(async () => [7]);
    const cached = cachedPublicRead("test-no-cache", read);

    expect(await cached()).toEqual([7]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  // 2026-10-18-public-cache-ignores-stats-rules: after #1816 changed what the medians count, the
  // cached snapshot kept serving counts made under the old rule, since nothing in its key changed.
  it("keys every entry by the statistics rules' version", () => {
    cachedPublicRead("test-stats-key", async () => [1]);
    const entry = registered.find((e) => e.keyParts.includes("test-stats-key"));
    expect(entry?.keyParts).toContain(`stats-v${STATS_METHOD_VERSION}`);
  });
});

describe("shortenPageLife (#1572)", () => {
  it("makes a cached read with a one-minute life, which caps the page's cache life", async () => {
    const marker = registered.find((entry) => entry.keyParts.includes("degraded-page-marker"));
    expect(DEGRADED_PAGE_SECONDS).toBe(60);
    expect(marker?.options?.revalidate).toBe(DEGRADED_PAGE_SECONDS);
    await expect(shortenPageLife()).resolves.toBeUndefined();
  });

  it("does nothing outside a Next render", async () => {
    cacheAvailable = false;
    await expect(shortenPageLife()).resolves.toBeUndefined();
  });
});

// 2026-10-26-stale-public-reads-block-page-renders: once a takedown made the public reads stale,
// every cached page render waited on the catalog-wide recompute and missed its read budget.
describe("cachedPublicRead when the cache has to recompute", () => {
  it("serves this server's last good value when the recompute is slow, and lets it finish", async () => {
    vi.useFakeTimers();
    try {
      let release: (value: number[]) => void = () => {};
      const read = vi
        .fn<() => Promise<number[]>>()
        .mockResolvedValueOnce([1])
        .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      const cached = cachedPublicRead("test-slow-refresh", read);

      expect(await cached()).toEqual([1]);
      store.clear(); // the tag was invalidated

      const pending = cached();
      await vi.advanceTimersByTimeAsync(STALE_GRACE_MS);
      expect(await pending).toEqual([1]);

      release([2]);
      await vi.runAllTimersAsync();
      expect(await cached()).toEqual([2]);
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a recompute that finishes within the grace period", async () => {
    const read = vi.fn<() => Promise<number[]>>().mockResolvedValueOnce([1]).mockResolvedValueOnce([2]);
    const cached = cachedPublicRead("test-fast-refresh", read);

    expect(await cached()).toEqual([1]);
    store.clear();
    expect(await cached()).toEqual([2]);
  });

  it("still reports a read that fails within the grace period", async () => {
    const read = vi
      .fn<() => Promise<number[]>>()
      .mockResolvedValueOnce([1])
      .mockRejectedValueOnce(new Error("statement timeout"));
    const cached = cachedPublicRead("test-failed-refresh", read);

    expect(await cached()).toEqual([1]);
    store.clear();
    await expect(cached()).rejects.toThrow("statement timeout");
  });

  it("runs one database read for concurrent misses of the same call", async () => {
    let release: (value: number[]) => void = () => {};
    const read = vi.fn(() => new Promise<number[]>((resolve) => { release = resolve; }));
    const cached = cachedPublicRead("test-shared", read);

    const first = cached();
    const second = cached();
    await Promise.resolve();
    release([3]);
    expect(await first).toEqual([3]);
    expect(await second).toEqual([3]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("cachedPublicRead inside another cached read", () => {
  it("serves the inner read from its own cache entry instead of the database", async () => {
    const inner = vi.fn(async () => [1, 2, 3]);
    const innerCached = cachedPublicRead("test-nested-inner", inner);
    const outer = cachedPublicRead("test-nested-outer", async (id: number) => (await innerCached()).map((n) => n * id));

    expect(await outer(2)).toEqual([2, 4, 6]);
    expect(await outer(3)).toEqual([3, 6, 9]);
    expect(await outer(4)).toEqual([4, 8, 12]);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("gives the inner read a scope in which Next waits for a stale entry's recompute", async () => {
    const { willConsumerServerCache } = await import("next/dist/server/app-render/work-unit-async-storage.external");
    const innerCached = cachedPublicRead("test-nested-scope-inner", async () => [1]);
    const outer = cachedPublicRead("test-nested-scope-outer", async () => innerCached());
    seenScopes.length = 0;
    await outer();
    // The outer read is called with no scope; the inner one is called inside the outer's computation.
    const inner = seenScopes[1] as Parameters<typeof willConsumerServerCache>[0];
    expect(inner).toBeDefined();
    expect((inner as { type: string }).type).not.toBe("unstable-cache");
    expect(willConsumerServerCache(inner)).toBe(true);
  });
});

describe("cachedPublicRead recompute lanes", () => {
  const settle = () => new Promise((r) => setImmediate(r));

  it("runs at most three catalog-wide recomputes at once on a five-connection server, so page reads keep two", async () => {
    const gates: Array<() => void> = [];
    let running = 0;
    let peak = 0;
    const read = vi.fn(async (n: number) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => gates.push(resolve));
      running -= 1;
      return [n];
    });
    const cached = cachedPublicRead("test-lanes", read, undefined, { catalogWide: true });

    const calls = [1, 2, 3, 4, 5].map((n) => cached(n));
    await settle();
    expect(read).toHaveBeenCalledTimes(3);

    while (read.mock.calls.length < 5 || gates.length > 0) {
      gates.shift()?.();
      await settle();
    }
    expect(await Promise.all(calls)).toEqual([[1], [2], [3], [4], [5]]);
    expect(peak).toBe(3);
  });

  it("leaves per-institution reads out of the lanes", async () => {
    const gates: Array<() => void> = [];
    const read = vi.fn(async (n: number) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return [n];
    });
    const cached = cachedPublicRead("test-lanes-unmarked", read);
    const calls = [1, 2, 3, 4, 5].map((n) => cached(n));
    await settle();
    expect(read).toHaveBeenCalledTimes(5);
    gates.forEach((open) => open());
    await Promise.all(calls);
  });

  it("starts a shared read queued for a lane when a recompute holding a lane needs it", async () => {
    // Every lane is held by a recompute that needs the shared list, and the list itself was
    // asked for first from outside any lane, so it is queued. Without promotion nothing frees
    // until the 60 s wait cap.
    const list = cachedPublicRead("test-lanes-list", async () => [7], undefined, { catalogWide: true });
    const blockers: Array<() => void> = [];
    const blocker = cachedPublicRead("test-lanes-blocker", async (n: number) => {
      await new Promise<void>((resolve) => blockers.push(resolve));
      return [n];
    }, undefined, { catalogWide: true });
    const outerGates: Array<() => void> = [];
    const outer = cachedPublicRead("test-lanes-holder", async (n: number) => {
      await new Promise<void>((resolve) => outerGates.push(resolve));
      return [...(await list()), n];
    }, undefined, { catalogWide: true });

    const holders = [1, 2, 3].map((n) => outer(n));
    await settle();
    const topLevel = list();
    await settle();
    outerGates.forEach((open) => open());
    const started = Date.now();
    expect(await Promise.all(holders)).toEqual([[7, 1], [7, 2], [7, 3]]);
    expect(await topLevel).toEqual([7]);
    expect(Date.now() - started).toBeLessThan(1000);
    // Lanes are free again: a new recompute starts at once.
    const next = blocker(9);
    await settle();
    expect(blockers).toHaveLength(1);
    blockers[0]();
    expect(await next).toEqual([9]);
  });

  it("lets a recompute read another shared entry while every lane is held", async () => {
    const inner = cachedPublicRead("test-lanes-inner", async (n: number) => [n * 10], undefined, { catalogWide: true });
    const outer = cachedPublicRead("test-lanes-outer", async (n: number) => [...(await inner(n)), n], undefined, { catalogWide: true });
    expect(await Promise.all([1, 2, 3, 4].map((n) => outer(n)))).toEqual([[10, 1], [20, 2], [30, 3], [40, 4]]);
  });
});
