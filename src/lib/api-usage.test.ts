import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));

import { logApiUsage } from "./api-usage";

const text = (call: unknown[]) => (call[0] as string[]).join("?");
const values = (call: unknown[]) => call.slice(1);

describe("logApiUsage", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
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
});
