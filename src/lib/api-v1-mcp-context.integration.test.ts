import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/mcp/route";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), sets: vi.fn(), defaults: vi.fn(), byId: vi.fn(), comparison: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn(async (request: Request) => {
  const id = request.headers.get("authorization") === "Bearer bfi_seat" ? 12 : 7;
  return { valid: true, tier: "pro", organizationId: 99, keyId: id, subscriberUserId: id };
}) }));
vi.mock("@/lib/api-rate-limit", () => ({
  checkBurstLimitWithTier: vi.fn(async () => ({ allowed: true, remaining: 59, limit: 60, reset: new Date("2026-11-01") })),
  checkRateLimitWithTier: vi.fn(async () => ({ allowed: true, remaining: 99, limit: 100, reset: new Date("2026-11-01") })),
}));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(() => { throw new Error("MCP must use its key, never browser identity"); }) }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ getHamiltonWorkspaceContext: mocks.workspace }));
vi.mock("@/lib/data-store/saved-peers", () => ({ getSavedPeerSets: mocks.sets, getDefaultPeerSets: mocks.defaults, getSavedPeerSetById: mocks.byId }));
vi.mock("@/lib/data-store/core", () => ({ getInstitutionById: vi.fn(async (id: number) => ({ id, institution_name: `Bank ${id}` })) }));
vi.mock("@/lib/data-store/peer-comparison", () => ({ MAX_CHOSEN_PEERS: 25, getPeerComparison: mocks.comparison }));

function call(name: string, args = {}, key = "bfi_seat") {
  return POST(new NextRequest("https://feeinsight.com/api/v1/mcp?user_id=7", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", cookie: "session=owner", "x-user-id": "7" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
}
async function content(response: Response) {
  const body = await response.json();
  expect(body.result.isError).not.toBe(true);
  return JSON.parse(body.result.content[0].text);
}
function set(userId: string) { return { id: Number(userId) * 10, name: `Peers ${userId}`, institution_ids: [41, 42], states: null, tiers: null, districts: null, charter_type: null, created_by: userId, institution_id: null, is_default: true }; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockImplementation(async (id: number) => ({ selectedInstitutionId: id * 10, selectedSource: "manual" }));
  mocks.sets.mockImplementation(async (id: string) => [set(id)]);
  mocks.defaults.mockImplementation(async ({ userId }: { userId: string }) => [set(userId)]);
  mocks.byId.mockImplementation(async (id: number, userId: string) => id === Number(userId) * 10 ? set(userId) : null);
  mocks.comparison.mockResolvedValue({ institution: { id: 120 }, peer_group: { basis: "chosen", label: "2 chosen institutions", peer_ids: [41, 42] }, categories: [], rate_fees: [] });
});

it("runs context tool through the real v1 route with each shared-plan key's own settings", async () => {
  const seat = await content(await call("get_hamilton_context"));
  const owner = await content(await call("get_hamilton_context", {}, "bfi_owner"));
  expect(seat).toMatchObject({ institution: { id: 120 }, active_peer_set_id: 120, peer_sets: [{ name: "Peers 12" }] });
  expect(owner).toMatchObject({ institution: { id: 70 }, active_peer_set_id: 70, peer_sets: [{ name: "Peers 7" }] });
  expect(mocks.byId).toHaveBeenCalledWith(120, "12");
  expect(mocks.byId).toHaveBeenCalledWith(70, "7");
});

it("uses saved selections in a no-argument comparison through the real MCP and API handlers", async () => {
  const result = await content(await call("get_peer_comparison"));
  expect(mocks.comparison).toHaveBeenCalledWith(120, [41, 42], null);
  expect(result).toMatchObject({ context: { institution_source: "saved", peer_source: "saved", saved_peer_set_id: 120 }, peer_group: { label: "Peers 12" } });
});

it("a connected client observes the next website selection without reconnecting", async () => {
  await content(await call("get_hamilton_context"));
  mocks.workspace.mockResolvedValue({ selectedInstitutionId: 200, selectedSource: "profile" });
  const result = await content(await call("get_hamilton_context"));
  expect(result).toMatchObject({ institution: { id: 200 }, institution_source: "profile" });
});

it("does not let one holder use another holder's personal peer set", async () => {
  const response = await call("get_peer_comparison", { saved_peer_set_id: 70 });
  const body = await response.json();
  expect(body.result.isError).toBe(true);
  expect(JSON.parse(body.result.content[0].text)).toMatchObject({ code: "not_found" });
  expect(mocks.comparison).not.toHaveBeenCalled();
});
