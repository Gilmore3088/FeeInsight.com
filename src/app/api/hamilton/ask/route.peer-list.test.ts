import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), peer: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.access }));
vi.mock("@/lib/hamilton/peer-list-service", () => ({ answerPeerList: mocks.peer }));
vi.mock("@/lib/hamilton/ask-service", () => ({ answerAsk: mocks.legacy }));
vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }));
import { POST } from "./route";
const request = (body: unknown) => new Request("https://example.test/api/hamilton/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const peer = { kind: "peer_list", shortAnswer: "List", peerList: { version: 1, status: "ready", rows: [], totalMatches: 0 } };
beforeEach(() => { mocks.user.mockReset().mockResolvedValue({ id: 7 }); mocks.access.mockReset().mockReturnValue(true); mocks.peer.mockReset().mockResolvedValue(peer); mocks.legacy.mockReset().mockResolvedValue({ status: 200, body: { kind: "research" } }); });

describe("authenticated Ask peer-list routing", () => {
  it("returns a list before calling the fee engine", async () => { const result = await POST(request({ institutionId: 202, question: "List peers" })); expect(result.status).toBe(200); expect((await result.json()).kind).toBe("peer_list"); expect(mocks.legacy).not.toHaveBeenCalled(); });
  it("uses the authenticated user, not an ID supplied in the body", async () => { await POST(request({ userId: 99, question: "List my peers" })); expect(mocks.peer.mock.calls[0][0].id).toBe(7); });
  it("does not read peer data before authentication", async () => { mocks.user.mockResolvedValue(null); expect((await POST(request({ question: "List peers" }))).status).toBe(401); expect(mocks.peer).not.toHaveBeenCalled(); });
  it("preserves the premium access check", async () => { mocks.access.mockReturnValue(false); expect((await POST(request({ question: "List peers" }))).status).toBe(401); expect(mocks.peer).not.toHaveBeenCalled(); });
  it("does not fall back to a report when peer data is unavailable", async () => { mocks.peer.mockResolvedValue({ ...peer, peerList: { ...peer.peerList, status: "unavailable", totalMatches: null } }); const result = await POST(request({ question: "List peers" })); expect((await result.json()).peerList.totalMatches).toBeNull(); expect(mocks.legacy).not.toHaveBeenCalled(); });
  it("does not call the fee engine when a peer request throws", async () => { mocks.peer.mockRejectedValue(new Error("synthetic failure")); expect((await POST(request({ question: "List peers" }))).status).toBe(500); expect(mocks.legacy).not.toHaveBeenCalled(); });
  it("keeps the legacy route for explicit fee analysis", async () => { mocks.peer.mockResolvedValue(null); const result = await POST(request({ question: "Compare overdraft fees" })); expect((await result.json()).kind).toBe("research"); expect(mocks.legacy).toHaveBeenCalledTimes(1); });
  it("rejects arrays instead of treating them as a request object", async () => { expect((await POST(request([]))).status).toBe(400); expect(mocks.peer).not.toHaveBeenCalled(); });
  it("rejects malformed JSON before a query", async () => { expect((await POST(new Request("https://example.test", { method: "POST", body: "{" }))).status).toBe(400); expect(mocks.peer).not.toHaveBeenCalled(); });
});
