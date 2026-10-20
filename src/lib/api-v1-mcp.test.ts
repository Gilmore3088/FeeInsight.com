import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { handleMcpPost, MCP_TOOL_NAMES, type McpV1Handlers } from "./api-v1-mcp";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));

function rpc(body: unknown, headers: Record<string, string> = { authorization: "Bearer bfi_test" }, path = "/api/v1/mcp") {
  return new NextRequest(`https://feeinsight.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function handlers(): McpV1Handlers {
  return {
    fees: vi.fn(async () => Response.json({ data: [] })),
    index: vi.fn(async () => Response.json({ scope: "filtered", data: [{ category: "overdraft", median: 30 }] })),
    institutions: vi.fn(async () => Response.json({ error: "Institution not found", code: "not_found" }, { status: 404 })),
    revenue: vi.fn(async () => Response.json({ view: "national", data: [] })),
    feeChanges: vi.fn(async () => Response.json({ count: 0, data: [] })),
    branches: vi.fn(async () => Response.json({ total: 0, data: [] })),
    market: vi.fn(async () => Response.json({ data: [] })),
    peers: vi.fn(async () => Response.json({ categories: [] })),
    rateFees: vi.fn(async () => Response.json({ total: 0, data: [] })),
    hamiltonContext: vi.fn(async () => Response.json({ institution: { id: 12 }, peer_sets: [], active_peer_set_id: null })),
  };
}

describe("MCP connector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });
  });

  it("turns away a caller with no key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, organizationId: null, tier: "free" });

    const response = await handleMcpPost(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {}), handlers());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    await expect(response.json()).resolves.toMatchObject({ code: "api_key_required" });
  });

  it("tells a caller with a revoked key why, with its own code", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      valid: false,
      organizationId: null,
      tier: "free",
      error: "API key has been revoked.",
      code: "key_revoked",
    });

    const response = await handleMcpPost(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }), handlers());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "key_revoked" });
  });

  it("initializes with the client's protocol version and offers tools", async () => {
    const response = await handleMcpPost(
      rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
      handlers(),
    );
    const body = await response.json();

    expect(body.result.protocolVersion).toBe("2025-03-26");
    expect(body.result.capabilities).toHaveProperty("tools");
    expect(body.result.instructions).toContain("call get_hamilton_context first");
    expect(body.result.instructions).toContain("Look this up fresh");
    expect(body.result.instructions).toContain("do not infer it from conversation history or memory");
  });

  it("answers an initialized notification with 202 and no body", async () => {
    const response = await handleMcpPost(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }), handlers());

    expect(response.status).toBe(202);
  });

  it("ranks institutions by a fee through the institutions route", async () => {
    const h = handlers();
    await handleMcpPost(
      rpc({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "rank_institutions_by_fee", arguments: { category: "overdraft", sort: "lowest", state: "TX" } },
      }),
      h,
    );

    const forwarded = vi.mocked(h.institutions).mock.calls[0][0];
    expect(forwarded.nextUrl.searchParams.get("fee_category")).toBe("overdraft");
    expect(forwarded.nextUrl.searchParams.get("sort")).toBe("lowest");
    expect(forwarded.nextUrl.searchParams.get("limit")).toBe("25");
  });

  it("sends revenue and fee-change tools to their own routes", async () => {
    const h = handlers();
    await handleMcpPost(
      rpc([
        { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "get_revenue_trend", arguments: { view: "districts", quarters: 12 } } },
        { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "get_fee_changes", arguments: { days: 30 } } },
      ]),
      h,
    );

    expect(vi.mocked(h.revenue).mock.calls[0][0].nextUrl.pathname).toBe("/api/v1/revenue");
    expect(vi.mocked(h.revenue).mock.calls[0][0].nextUrl.searchParams.get("quarters")).toBe("12");
    expect(vi.mocked(h.feeChanges).mock.calls[0][0].nextUrl.pathname).toBe("/api/v1/fee-changes");
  });

  it("sends branch and market tools to their own routes", async () => {
    const h = handlers();
    await handleMcpPost(
      rpc([
        { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "get_branches", arguments: { state: "TX", city: "Austin" } } },
        { jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "get_local_market", arguments: { institution_id: 69 } } },
      ]),
      h,
    );

    const branches = vi.mocked(h.branches).mock.calls[0][0];
    expect(branches.nextUrl.pathname).toBe("/api/v1/branches");
    expect(branches.nextUrl.searchParams.get("city")).toBe("Austin");
    const market = vi.mocked(h.market).mock.calls[0][0];
    expect(market.nextUrl.pathname).toBe("/api/v1/market");
    expect(market.nextUrl.searchParams.get("institution_id")).toBe("69");
  });

  it("sends peer, rate-fee and changed-since calls to their routes", async () => {
    const h = handlers();
    const response = await handleMcpPost(
      rpc([
        { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "get_peer_comparison", arguments: { institution_id: 12, peer_ids: [4, 5] } } },
        { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "get_rate_fees", arguments: { state: "TX", category: "card_foreign_txn", updated_since: "2026-10-01" } } },
        { jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "get_institution", arguments: { id: 12, updated_since: "2026-10-01" } } },
        { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "get_peer_comparison", arguments: { peer_ids: "4", use_saved_context: false } } },
      ]),
      h,
    );

    const peers = vi.mocked(h.peers).mock.calls[0][0];
    expect(peers.nextUrl.pathname).toBe("/api/v1/peers");
    expect(peers.nextUrl.searchParams.get("institution_id")).toBe("12");
    expect(peers.nextUrl.searchParams.get("peer_ids")).toBe("4,5");
    const rates = vi.mocked(h.rateFees).mock.calls[0][0];
    expect(rates.nextUrl.pathname).toBe("/api/v1/rate-fees");
    expect(rates.nextUrl.searchParams.get("updated_since")).toBe("2026-10-01");
    const detail = vi.mocked(h.institutions).mock.calls[0][0];
    expect(detail.nextUrl.searchParams.get("updated_since")).toBe("2026-10-01");
    const body = await response.json();
    expect(body[3].result).toMatchObject({ isError: true });
    expect(h.peers).toHaveBeenCalledTimes(1);
  });

  it("lists the read-only tools", async () => {
    const response = await handleMcpPost(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }), handlers());
    const body = await response.json();

    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(MCP_TOOL_NAMES);
    expect(MCP_TOOL_NAMES).toHaveLength(13);
    expect(body.result.tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
    const context = body.result.tools.find((t: { name: string }) => t.name === "get_hamilton_context");
    expect(context.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
    const peers = body.result.tools.find((t: { name: string }) => t.name === "get_peer_comparison");
    expect(peers.inputSchema.required ?? []).not.toContain("institution_id");
    expect(peers.inputSchema.properties.use_saved_context).toMatchObject({ type: "boolean", default: true });
    expect(peers.inputSchema.properties.saved_peer_set_id).toMatchObject({ type: "integer", minimum: 1 });
  });

  it("looks up saved Hamilton context fresh through the route with only the caller's key", async () => {
    const h = handlers();
    vi.mocked(h.hamiltonContext)
      .mockResolvedValueOnce(Response.json({ institution: { id: 12 }, peer_sets: [{ id: 3 }], active_peer_set_id: 3 }))
      .mockResolvedValueOnce(Response.json({ institution: { id: 18 }, peer_sets: [], active_peer_set_id: null }));

    const call = () => handleMcpPost(rpc({
      jsonrpc: "2.0", id: 24, method: "tools/call", params: { name: "get_hamilton_context" },
    }, { authorization: "Bearer bfi_holder", cookie: "session=another-user", "x-user-id": "999" },
    "/api/v1/mcp?user_id=999&institution_id=999&saved_peer_set_id=999"), h);
    const first = await (await call()).json();
    const second = await (await call()).json();

    expect(JSON.parse(first.result.content[0].text).institution.id).toBe(12);
    expect(JSON.parse(second.result.content[0].text).institution.id).toBe(18);
    expect(h.hamiltonContext).toHaveBeenCalledTimes(2);
    for (const [forwarded] of vi.mocked(h.hamiltonContext).mock.calls) {
      expect(forwarded.nextUrl.pathname).toBe("/api/v1/hamilton-context");
      expect(forwarded.nextUrl.search).toBe("");
      expect(forwarded.headers.get("authorization")).toBe("Bearer bfi_holder");
      expect(forwarded.headers.get("cookie")).toBeNull();
      expect(forwarded.headers.get("x-user-id")).toBeNull();
    }
  });

  it("forwards query-key context calls and preserves route permission errors", async () => {
    const h = handlers();
    vi.mocked(h.hamiltonContext).mockResolvedValue(Response.json({ code: "plan_required" }, { status: 403 }));
    const response = await handleMcpPost(rpc({
      jsonrpc: "2.0", id: 25, method: "tools/call", params: { name: "get_hamilton_context", arguments: {} },
    }, {}, "/api/v1/mcp?api_key=bfi_holder&user_id=999"), h);

    const forwarded = vi.mocked(h.hamiltonContext).mock.calls[0][0];
    expect([...forwarded.nextUrl.searchParams]).toEqual([["api_key", "bfi_holder"]]);
    expect(await response.json()).toMatchObject({ result: { isError: true } });
  });

  it.each(["user_id", "institution_id", "saved_peer_set_id", "organization_id"])("rejects %s as an argument to the context tool", async (name) => {
    const h = handlers();
    const response = await handleMcpPost(rpc({
      jsonrpc: "2.0", id: 26, method: "tools/call", params: { name: "get_hamilton_context", arguments: { [name]: 999 } },
    }), h);

    expect(await response.json()).toMatchObject({ result: { isError: true } });
    expect(h.hamiltonContext).not.toHaveBeenCalled();
  });

  it.each([
    [{}, {}],
    [{ saved_peer_set_id: 3 }, { saved_peer_set_id: "3" }],
    [{ institution_id: 12, saved_peer_set_id: 3, use_saved_context: false }, { institution_id: "12", saved_peer_set_id: "3", use_saved_context: "false" }],
    [{ institution_id: 12, use_saved_context: false }, { institution_id: "12", use_saved_context: "false" }],
    [{ institution_id: 12, peer_ids: [4, 5] }, { institution_id: "12", peer_ids: "4,5" }],
    [{ state: "TX", charter: "bank" }, { state: "TX", charter: "bank" }],
  ])("forwards peer context choices %j for route authorization", async (args, query) => {
    const h = handlers();
    await handleMcpPost(rpc({
      jsonrpc: "2.0", id: 27, method: "tools/call", params: { name: "get_peer_comparison", arguments: args },
    }), h);

    expect(h.peers).toHaveBeenCalledTimes(1);
    const forwarded = vi.mocked(h.peers).mock.calls[0][0];
    expect(Object.fromEntries(forwarded.nextUrl.searchParams)).toEqual(query);
    expect(forwarded.headers.get("authorization")).toBe("Bearer bfi_test");
  });

  it.each([
    { saved_peer_set_id: 3, peer_ids: "4,5" },
    { saved_peer_set_id: 3, state: "TX" },
    { peer_ids: "4,5", state: "TX" },
    { use_saved_context: false },
    { institution_id: 12, use_saved_context: "false" },
    { institution_id: 12, saved_peer_set_id: "another" },
    { institution_id: 12, user_id: 999 },
    { institution_id: 12, organization_id: 999 },
  ])("rejects invalid or spoofed peer choices %j before calling the route", async (args) => {
    const h = handlers();
    const response = await handleMcpPost(rpc({
      jsonrpc: "2.0", id: 28, method: "tools/call", params: { name: "get_peer_comparison", arguments: args },
    }), h);

    expect(await response.json()).toMatchObject({ result: { isError: true } });
    expect(h.peers).not.toHaveBeenCalled();
  });

  it("runs a tool through the v1 route with the caller's key", async () => {
    const h = handlers();
    const response = await handleMcpPost(
      rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_fee_index", arguments: { state: "TX", charter: "bank" } } }),
      h,
    );
    const body = await response.json();

    const forwarded = vi.mocked(h.index).mock.calls[0][0];
    expect(forwarded.nextUrl.pathname).toBe("/api/v1/index");
    expect(forwarded.nextUrl.searchParams.get("state")).toBe("TX");
    expect(forwarded.nextUrl.searchParams.get("charter")).toBe("bank");
    expect(forwarded.headers.get("authorization")).toBe("Bearer bfi_test");
    expect(body.result.isError).toBeUndefined();
    expect(JSON.parse(body.result.content[0].text).data[0].median).toBe(30);
  });

  it("forwards a key given in the connector URL", async () => {
    const h = handlers();
    await handleMcpPost(
      rpc(
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "find_institutions", arguments: { name: "Example", state: "TX" } } },
        {},
        "/api/v1/mcp?api_key=bfi_test",
      ),
      h,
    );

    const forwarded = vi.mocked(h.institutions).mock.calls[0][0];
    expect(forwarded.nextUrl.searchParams.get("api_key")).toBe("bfi_test");
    expect(forwarded.nextUrl.searchParams.get("q")).toBe("Example");
  });

  it("reports an API error as a tool error, not a protocol error", async () => {
    const response = await handleMcpPost(
      rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_institution", arguments: { id: 999 } } }),
      handlers(),
    );
    const body = await response.json();

    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("not_found");
  });

  it("rejects bad tool arguments without calling the API", async () => {
    const h = handlers();
    const response = await handleMcpPost(
      rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_institution", arguments: { id: "twelve" } } }),
      h,
    );
    const body = await response.json();

    expect(body.result.isError).toBe(true);
    expect(h.institutions).not.toHaveBeenCalled();
  });

  it("returns JSON-RPC errors for unknown tools and methods", async () => {
    const response = await handleMcpPost(
      rpc([
        { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "drop_tables" } },
        { jsonrpc: "2.0", id: 8, method: "resources/list" },
      ]),
      handlers(),
    );
    const body = await response.json();

    expect(body.map((r: { error: { code: number } }) => r.error.code)).toEqual([-32602, -32601]);
  });
});
