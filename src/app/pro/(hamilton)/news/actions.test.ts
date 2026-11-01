import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  startRegistryRun: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/agents/registry-scheduler", () => ({ startRegistryRun: mocks.startRegistryRun }));

import { refreshFeeds } from "./actions";

describe("Regulatory Wire refresh (#2233)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.startRegistryRun.mockResolvedValue({ run: { id: 9101, status: "queued" }, steps: [], reused: false });
  });

  it("queues the scheduled reg-news registry run for an operator and fetches nothing itself", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 3, role: "analyst" });
    expect(await refreshFeeds()).toEqual({ runId: 9101, status: "queued", reused: false });
    expect(mocks.startRegistryRun).toHaveBeenCalledWith({
      source: "reg-news",
      partitionKey: "current",
      triggeredBy: "admin:3",
      triggerSource: "admin",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reports a run already queued instead of starting a second", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, role: "admin" });
    mocks.startRegistryRun.mockResolvedValue({ run: { id: 9100, status: "running" }, steps: [], reused: true });
    expect(await refreshFeeds()).toEqual({ runId: 9100, status: "running", reused: true });
  });

  it("refuses anyone but an admin or analyst and queues nothing", async () => {
    for (const user of [null, { id: 8, role: "viewer" }, { id: 7, role: "premium" }]) {
      mocks.getCurrentUser.mockResolvedValue(user);
      await expect(refreshFeeds()).rejects.toThrow("Unauthorized");
    }
    expect(mocks.startRegistryRun).not.toHaveBeenCalled();
  });
});
