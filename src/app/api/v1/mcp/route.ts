import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import type { NextRequest } from "next/server";
import { handleMcpPost } from "@/lib/api-v1-mcp";
import { GET as branchesGET } from "../branches/route";
import { GET as feeChangesGET } from "../fee-changes/route";
import { GET as feesGET } from "../fees/route";
import { GET as indexGET } from "../index/route";
import { GET as institutionsGET } from "../institutions/route";
import { GET as marketGET } from "../market/route";
import { GET as revenueGET } from "../revenue/route";

// MCP connector for AI assistants. Each tool call runs the matching v1 route
// with the caller's own key.
export const POST = withApiRoutePolicy("api.v1.mcp", "POST", (request: NextRequest) =>
  handleMcpPost(request, {
    fees: feesGET,
    index: indexGET,
    institutions: institutionsGET,
    revenue: revenueGET,
    feeChanges: feeChangesGET,
    branches: branchesGET,
    market: marketGET,
  }),
);
