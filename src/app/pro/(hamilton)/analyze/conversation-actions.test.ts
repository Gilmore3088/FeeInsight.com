import { beforeEach, describe, expect, it, vi } from "vitest";

// #979 H04-T09: the conversation store's server actions refuse a reader without Pro access and
// a malformed conversation ID before any database call. Ownership itself is checked in SQL
// (chat-memory.db.test.ts).
const mocks = vi.hoisted(() => ({ user: null as unknown, create: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: (u: { premium?: boolean }) => Boolean(u?.premium) }));
vi.mock("@/lib/hamilton/chat-memory", () => ({ createConversation: mocks.create, saveConversationState: mocks.save }));
import { recordAnalyzeConversationAction, startAnalyzeConversationAction } from "./conversation-actions";

const ID = "8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1";
beforeEach(() => {
  mocks.user = { id: 7, premium: true };
  mocks.create.mockReset().mockResolvedValue(ID);
  mocks.save.mockReset().mockResolvedValue(true);
});

describe("Analyze conversation actions", () => {
  it("refuses a signed-out or non-Pro reader", async () => {
    for (const user of [null, { id: 8, premium: false }]) {
      mocks.user = user;
      expect(await startAnalyzeConversationAction()).toEqual({ error: "Active subscription required" });
      expect(await recordAnalyzeConversationAction(ID, {})).toEqual({ ok: false });
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("refuses a malformed conversation ID without touching the store", async () => {
    expect(await recordAnalyzeConversationAction("1 OR 1=1", {})).toEqual({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("creates and records as the signed-in user only", async () => {
    expect(await startAnalyzeConversationAction()).toEqual({ id: ID });
    expect(mocks.create).toHaveBeenCalledWith(7);
    expect(await recordAnalyzeConversationAction(ID, { version: 1 })).toEqual({ ok: true });
    expect(mocks.save).toHaveBeenCalledWith(ID, 7, { version: 1 });
  });

  it("reports a refused store (another user's conversation, a stale snapshot) as not saved", async () => {
    mocks.save.mockResolvedValue(false);
    expect(await recordAnalyzeConversationAction(ID, {})).toEqual({ ok: false });
  });
});
