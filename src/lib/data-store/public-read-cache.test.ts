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

import { DEGRADED_PAGE_SECONDS, cachedPublicRead, shortenPageLife } from "./public-read-cache";

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
