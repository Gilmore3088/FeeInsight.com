import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, seatStillCovered, afterMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  seatStillCovered: vi.fn(),
  afterMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));
vi.mock("@/lib/api-subscriber-keys", () => ({ seatStillCovered }));
vi.mock("next/server", () => ({ after: afterMock }));

import { validateApiKey } from "./api-auth";

function request() {
  return new Request("https://feeinsight.com/api/v1/fees", {
    headers: { authorization: "Bearer bfi_test_key" },
  });
}

/** Queues the key row, the payer's subscription row, then the last-used update. */
function queue(keyRow: Record<string, unknown>, payer?: Record<string, unknown>) {
  sqlMock.mockReset();
  sqlMock.mockResolvedValueOnce([keyRow]);
  if (payer) sqlMock.mockResolvedValueOnce([payer]);
  sqlMock.mockResolvedValue([]);
}

const KEY = { id: 1, organization_id: 9, tier: "pro", revoked_at: null };
const ACTIVE = { subscription_status: "active", past_due_since: null };

describe("validateApiKey on subscriber keys", () => {
  beforeEach(() => {
    seatStillCovered.mockReset();
    afterMock.mockReset();
  });

  it("accepts the payer's own key while Pro is active", async () => {
    queue({ ...KEY, slug: "pro-user-7", name: "Pro user 7" }, ACTIVE);
    const result = await validateApiKey(request());
    expect(result.valid).toBe(true);
    expect(seatStillCovered).not.toHaveBeenCalled();
  });

  it("accepts a team seat's key while the seat is on the payer's workspace", async () => {
    queue({ ...KEY, slug: "pro-user-7", name: "Pro user 12" }, ACTIVE);
    seatStillCovered.mockResolvedValue(true);
    const result = await validateApiKey(request());
    expect(seatStillCovered).toHaveBeenCalledWith(12, 7);
    expect(result).toMatchObject({ valid: true, organizationId: 9, keyId: 1 });
  });

  it("stops a removed seat's key", async () => {
    queue({ ...KEY, slug: "pro-user-7", name: "Pro user 12" }, ACTIVE);
    seatStillCovered.mockResolvedValue(false);
    const result = await validateApiKey(request());
    expect(result.valid).toBe(false);
    expect(result.keyId).toBeUndefined();
    expect(result.code).toBe("seat_removed");
    expect(result.error).toMatch(/no longer has a seat/);
  });

  it("stops every key on the plan once the payer cancels", async () => {
    queue({ ...KEY, slug: "pro-user-7", name: "Pro user 12" }, { subscription_status: "canceled", past_due_since: null });
    const result = await validateApiKey(request());
    expect(result.valid).toBe(false);
    expect(result.code).toBe("subscription_inactive");
    expect(seatStillCovered).not.toHaveBeenCalled();
  });

  it("gives an unknown key and a revoked key their own codes, each saying the fix", async () => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce([]);
    const unknown = await validateApiKey(request());
    expect(unknown).toMatchObject({ valid: false, code: "invalid_api_key" });
    expect(unknown.error).toMatch(/^Invalid API key/);

    queue({ ...KEY, revoked_at: "2026-10-01T00:00:00Z", slug: "pro-user-7", name: "Pro user 7" });
    const revoked = await validateApiKey(request());
    expect(revoked).toMatchObject({ valid: false, code: "key_revoked" });
    expect(revoked.error).toMatch(/revoked\. Make a new key on your account page/);
  });

  it("leaves hand-made partner keys alone", async () => {
    queue({ ...KEY, tier: "enterprise", slug: "api-betteranalyst", name: "Default" });
    const result = await validateApiKey(request());
    expect(result).toMatchObject({ valid: true, tier: "enterprise" });
  });

  it("returns the authorized caller while its single last-used write remains pending", async () => {
    let finish!: () => void;
    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce([{ ...KEY, tier: "enterprise", slug: "api-partner", name: "Default" }]);
    sqlMock.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));

    expect(await validateApiKey(request())).toMatchObject({ valid: true, keyId: 1 });
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(sqlMock).toHaveBeenCalledTimes(2);
    finish();
    await afterMock.mock.calls[0][0];
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it("silently handles the last-used failure even outside a Next request", async () => {
    afterMock.mockImplementation(() => { throw new Error("No request context"); });
    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce([{ ...KEY, slug: "api-partner", name: "Default" }]);
    sqlMock.mockRejectedValueOnce(new Error("CONNECT_TIMEOUT"));

    expect(await validateApiKey(request())).toMatchObject({ valid: true, keyId: 1 });
    await expect(afterMock.mock.calls[0][0]).resolves.toBeUndefined();
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it("does not add a v1 background task for rejected keys", async () => {
    queue({ ...KEY, revoked_at: "2026-10-01T00:00:00Z" });
    expect(await validateApiKey(request())).toMatchObject({ valid: false, code: "key_revoked" });
    expect(afterMock).not.toHaveBeenCalled();
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it("leaves key-validation callers outside v1 unchanged", async () => {
    queue({ ...KEY, slug: "api-partner", name: "Default" });
    const outside = new Request("https://feeinsight.com/api/v10/fees", { headers: { authorization: "Bearer bfi_test_key" } });

    expect(await validateApiKey(outside)).toMatchObject({ valid: true, keyId: 1 });
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(afterMock).not.toHaveBeenCalled();
  });
});
