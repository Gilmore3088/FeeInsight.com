import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, afterMock } = vi.hoisted(() => ({ sqlMock: vi.fn(), afterMock: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));
vi.mock("next/server", () => ({ after: afterMock }));

import { logApiUsage } from "./api-usage";

const text = (call: unknown[]) => (call[0] as string[]).join("?");
const values = (call: unknown[]) => call.slice(1);

describe("logApiUsage", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    afterMock.mockReset();
  });

  it("writes the key that made the call", async () => {
    await logApiUsage(7, null, "api.v1.index", { status: 200 }, 41);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(text(sqlMock.mock.calls[0])).toContain("api_key_id");
    expect(values(sqlMock.mock.calls[0])).toEqual([7, null, "api.v1.index", '{"status":200}', 41]);
  });

  it("keeps the old insert when no key is given", async () => {
    await logApiUsage(null, "anon-1", "api.v1.index", { status: 400 });

    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(text(sqlMock.mock.calls[0])).not.toContain("api_key_id");
    expect(values(sqlMock.mock.calls[0])).toEqual([null, "anon-1", "api.v1.index", '{"status":400}']);
  });

  it("still records the call without the key before the column exists", async () => {
    sqlMock.mockRejectedValueOnce(Object.assign(new Error('column "api_key_id" does not exist'), { code: "42703" }));

    await logApiUsage(7, null, "api.v1.index", { status: 200 }, 41);

    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(text(sqlMock.mock.calls[1])).not.toContain("api_key_id");
  });

  it("never throws when the write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sqlMock.mockRejectedValue(new Error("connection refused"));

    await expect(logApiUsage(7, null, "api.v1.index", undefined, 41)).resolves.toBeUndefined();
    expect(sqlMock).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it.each(["api.v1.index", "api.fees.list", "api.fees.category"])("retains the pending %s write through the response lifetime", async (eventType) => {
    let finish!: () => void;
    sqlMock.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const task = logApiUsage(7, null, eventType, { status: 200 }, 41);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(afterMock).toHaveBeenCalledExactlyOnceWith(task);
    finish();
    await task;
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it("registers a handled failure and preserves fallback outside a Next request", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    afterMock.mockImplementation(() => { throw new Error("No request context"); });
    sqlMock.mockRejectedValue(new Error("CONNECT_TIMEOUT"));
    const task = logApiUsage(7, null, "api.v1.index", undefined, 41);

    await expect(task).resolves.toBeUndefined();
    expect(afterMock).toHaveBeenCalledExactlyOnceWith(task);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("keeps other usage events outside the v1 response lifecycle", async () => {
    await logApiUsage(7, null, "hamilton.report", undefined, 41);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(afterMock).not.toHaveBeenCalled();
  });
});
