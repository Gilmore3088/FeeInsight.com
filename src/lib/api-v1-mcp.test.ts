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

  it("initializes with the client's protocol version and offers tools", async () => {
    const response = await handleMcpPost(
      rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
      handlers(),
    );
    const body = await response.json();

    expect(body.result.protocolVersion).toBe("2025-03-26");
    expect(body.result.capabilities).toHaveProperty("tools");
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

  it("lists the read-only tools", async () => {
    const response = await handleMcpPost(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }), handlers());
    const body = await response.json();

    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(MCP_TOOL_NAMES);
    expect(MCP_TOOL_NAMES).toHaveLength(8);
    expect(body.result.tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
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
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "find_institutions", arguments: { name: "Frost", state: "TX" } } },
        {},
        "/api/v1/mcp?api_key=bfi_test",
      ),
      h,
    );

    const forwarded = vi.mocked(h.institutions).mock.calls[0][0];
    expect(forwarded.nextUrl.searchParams.get("api_key")).toBe("bfi_test");
    expect(forwarded.nextUrl.searchParams.get("q")).toBe("Frost");
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
