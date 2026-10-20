import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { handleMcpPost, hamiltonContextGET } = vi.hoisted(() => ({
  handleMcpPost: vi.fn(),
  hamiltonContextGET: vi.fn(),
}));

vi.mock("@/lib/api-hardening/route-wrapper", () => ({
  withApiRoutePolicy: (_route: string, _method: string, handler: unknown) => handler,
}));
vi.mock("@/lib/api-v1-mcp", () => ({ handleMcpPost }));
vi.mock("../hamilton-context/route", () => ({ GET: hamiltonContextGET }));
vi.mock("../branches/route", () => ({ GET: vi.fn() }));
vi.mock("../fee-changes/route", () => ({ GET: vi.fn() }));
vi.mock("../fees/route", () => ({ GET: vi.fn() }));
vi.mock("../index/route", () => ({ GET: vi.fn() }));
vi.mock("../institutions/route", () => ({ GET: vi.fn() }));
vi.mock("../market/route", () => ({ GET: vi.fn() }));
vi.mock("../peers/route", () => ({ GET: vi.fn() }));
vi.mock("../rate-fees/route", () => ({ GET: vi.fn() }));
vi.mock("../revenue/route", () => ({ GET: vi.fn() }));

import { POST } from "./route";

describe("/api/v1/mcp", () => {
  it("registers the authorized context route without replacing the incoming request", async () => {
    const response = Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    handleMcpPost.mockResolvedValue(response);
    const request = new NextRequest("https://feeinsight.com/api/v1/mcp", {
      method: "POST",
      headers: { authorization: "Bearer bfi_holder", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_hamilton_context" } }),
    });

    expect(await POST(request)).toBe(response);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(handleMcpPost).toHaveBeenCalledExactlyOnceWith(request, expect.objectContaining({ hamiltonContext: hamiltonContextGET }));
    expect(hamiltonContextGET).not.toHaveBeenCalled();
  });
});
