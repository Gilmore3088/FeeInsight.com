import { NextRequest, NextResponse } from "next/server";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { authorizeV1 } from "@/lib/api-v1-auth";
import { apiError, apiOptions, withApiHeaders } from "@/lib/api-v1";
import { getV1HamiltonContext, requireV1ContextUserId, V1ContextError, withPrivateV1Context } from "@/lib/api-v1-hamilton-context";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";

async function handleGET(request: NextRequest) {
  const caller = await authorizeV1(request, { paidOnly: "Hamilton account context", usageEvent: "api.v1.hamilton_context" });
  if (caller instanceof Response) return withPrivateV1Context(caller);
  const { organizationId, anonymousId, keyId, rateLimit } = caller;
  try {
    const context = await getV1HamiltonContext(requireV1ContextUserId(caller));
    logApiUsage(organizationId, anonymousId, "api.v1.hamilton_context", { status: 200 }, keyId).catch(() => {});
    return withPrivateV1Context(withApiHeaders(NextResponse.json({
      ...context,
      note: "Current Hamilton research preference and permitted saved peer groups. A research selection is not proof of institution ownership. No conversation history is included.",
      attribution: API_ATTRIBUTION,
    }), rateLimit));
  } catch (error) {
    if (!(error instanceof V1ContextError)) throw error;
    logApiUsage(organizationId, anonymousId, "api.v1.hamilton_context", { status: error.status }, keyId).catch(() => {});
    return withPrivateV1Context(apiError(error.status, error.code, error.message, { rateLimit }));
  }
}

export const GET = withApiRoutePolicy("api.v1.hamilton_context", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.hamilton_context", "OPTIONS", async () => apiOptions());
