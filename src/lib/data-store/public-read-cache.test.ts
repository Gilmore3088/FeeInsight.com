import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal stand-in for Next's data cache: keyed by the JSON of the arguments,
// stores only results that resolve (a throw is never cached, as in Next).
const store = new Map<string, unknown>();
let cacheAvailable = true;
// vi.mock is hoisted above this file's declarations, so the list it fills is hoisted too.
const registered = vi.hoisted(() => [] as { keyParts: string[]; options?: { revalidate?: number } }[]);

vi.mock("next/cache", () => ({
  unstable_cache: <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[], options?: { revalidate?: number }) => {
    registered.push({ keyParts, options });
    return async (...args: A): Promise<R> => {
      if (!cacheAvailable) throw new Error("Invariant: incrementalCache missing in unstable_cache");
      const key = JSON.stringify([keyParts, args]);
      if (store.has(key)) return store.get(key) as R;
      const value = await fn(...args);
      store.set(key, value);
      return value;
    };
  },
}));

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
