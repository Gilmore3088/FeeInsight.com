import { describe, expect, it, vi } from "vitest";

// Next's real unstable_cache, driven with a stand-in incremental cache, so a Next upgrade that
// changes how nested caches or work-unit scopes behave fails here
// (findings/2026-11-02-nested-public-reads-bypass-cache.md). Next builds its scopes on this
// global, which its server bootstrap sets before any app module loads.
await vi.hoisted(async () => {
  const { AsyncLocalStorage: Als } = await import("node:async_hooks");
  Object.defineProperty(globalThis, "AsyncLocalStorage", { value: Als, configurable: true });
});

import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { cachedPublicRead } from "./public-read-cache";

function harness() {
  const entries = new Map<string, string>();
  const state = { stale: false };
  const incrementalCache = {
    isOnDemandRevalidate: false,
    async generateSimpleCacheKey(key: string) { return key; },
    async get(key: string) {
      const body = entries.get(key);
      return body === undefined
        ? null
        : { isStale: state.stale, value: { kind: "FETCH", data: { body, headers: {}, url: "" }, revalidate: 3600 } };
    },
    async set(key: string, data: { data: { body: string } } | null) {
      if (data) entries.set(key, data.data.body);
    },
  };
  const render = async <T>(run: () => Promise<T>): Promise<T> => {
    const workStore = { incrementalCache, route: "/institution/[id]", nextFetchId: 1, isDraftMode: false, isOnDemandRevalidate: false, pendingRevalidates: {} as Record<string, Promise<unknown>> };
    const request = { type: "request", phase: "render", url: { pathname: "/institution/1", search: "" }, implicitTags: { tags: [] } };
    const value = await workAsyncStorage.run(workStore as never, () => workUnitAsyncStorage.run(request as never, run));
    await Promise.all(Object.values(workStore.pendingRevalidates));
    return value;
  };
  return { entries, state, render };
}

describe("cachedPublicRead with Next's own unstable_cache", () => {
  it("serves a read made inside another cached read from its own entry", async () => {
    const { render } = harness();
    let innerRuns = 0;
    const inner = cachedPublicRead("next-nested-inner", async () => { innerRuns += 1; return [1, 2]; });
    const outer = cachedPublicRead("next-nested-outer", async (id: number) => (await inner()).map((n) => n * id));

    expect(await render(() => outer(2))).toEqual([2, 4]);
    expect(await render(() => outer(3))).toEqual([3, 6]);
    expect(await render(() => outer(4))).toEqual([4, 8]);
    expect(innerRuns).toBe(1);
  });

  it("recomputes a stale inner entry before the outer read stores its value", async () => {
    const { render, state } = harness();
    let version = 1;
    const inner = cachedPublicRead("next-stale-inner", async () => [version]);
    const outer = cachedPublicRead("next-stale-outer", async (id: number) => (await inner()).map((n) => n * 100 + id));

    expect(await render(() => inner())).toEqual([1]);
    // A takedown marks every public entry stale; the inner read's answer has since changed.
    version = 2;
    state.stale = true;
    expect(await render(() => outer(7))).toEqual([207]);
  });
});
