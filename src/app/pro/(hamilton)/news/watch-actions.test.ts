import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  watchState: vi.fn(),
  unwatchState: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/data-store/wire-watch", () => ({
  MAX_WATCHED_STATES: 10,
  watchState: mocks.watchState,
  unwatchState: mocks.unwatchState,
}));

import { setWatchedState, watchStateFormAction } from "./watch-actions";

const pro = { id: 7, role: "premium", subscription_status: "active" };
const free = { id: 8, role: "viewer", subscription_status: "none" };

function form(state: string, watch: "0" | "1") {
  const data = new FormData();
  data.set("state", state);
  data.set("watch", watch);
  return data;
}

describe("watch a state on the Regulatory Wire", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.watchState.mockResolvedValue({ ok: true });
    mocks.unwatchState.mockResolvedValue({ ok: true });
  });

  it("refuses a signed-out visitor and writes nothing", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(await setWatchedState(form("CA", "1"))).toEqual({ ok: false, error: "Sign in to watch a state." });
    expect(mocks.watchState).not.toHaveBeenCalled();
    expect(mocks.unwatchState).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user without Pro and writes nothing", async () => {
    mocks.getCurrentUser.mockResolvedValue(free);
    const result = await setWatchedState(form("CA", "1"));
    expect(result.ok).toBe(false);
    expect(mocks.watchState).not.toHaveBeenCalled();
  });

  it("watches and stops watching for the signed-in Pro user only", async () => {
    mocks.getCurrentUser.mockResolvedValue(pro);
    expect(await setWatchedState(form("ca", "1"))).toEqual({ ok: true, watching: true });
    expect(mocks.watchState).toHaveBeenCalledWith(7, "CA");
    expect(await setWatchedState(form("CA", "0"))).toEqual({ ok: true, watching: false });
    expect(mocks.unwatchState).toHaveBeenCalledWith(7, "CA");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pro/news");
  });

  it("rejects a code that is not a state", async () => {
    mocks.getCurrentUser.mockResolvedValue(pro);
    expect(await setWatchedState(form("ZZ", "1"))).toEqual({ ok: false, error: "Choose a state to watch." });
    expect(mocks.watchState).not.toHaveBeenCalled();
  });

  it("says when the limit is reached", async () => {
    mocks.getCurrentUser.mockResolvedValue(pro);
    mocks.watchState.mockResolvedValue({ ok: false, reason: "limit" });
    const result = await setWatchedState(form("TX", "1"));
    expect(result).toEqual({ ok: false, error: "You can watch up to 10 states. Stop watching one first." });
  });

  it("the form action runs the same checks", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await watchStateFormAction(form("CA", "1"));
    expect(mocks.watchState).not.toHaveBeenCalled();
  });
});
