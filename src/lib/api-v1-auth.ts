import type { NextRequest } from "next/server";
import { validateApiKey, type ApiKeyValidation } from "@/lib/api-auth";
import { checkRateLimitWithTier, type RateLimitResult } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import {
  API_V1_RATE_LIMIT_ROUTE,
  apiError,
  apiKeyRequiredError,
  getAnonymousId,
  isPaidApiKey,
  planRequiredError,
  rateLimitError,
} from "@/lib/api-v1";

export interface V1Caller {
  auth: ApiKeyValidation;
  organizationId: number | null;
  anonymousId: string | null;
  rateLimit: RateLimitResult;
}

/**
 * The checks every paid-only v1 endpoint runs first: a valid issued key (or a
 * signed-in Pro session), the shared monthly allowance, then a paid plan.
 * Returns the caller, or the error response to send.
 */
export async function authorizePaidV1(request: NextRequest, what: string): Promise<V1Caller | Response> {
  const auth = await validateApiKey(request);
  if (auth.error) return apiError(401, "invalid_api_key", auth.error);
  const user = auth.valid ? null : await getCurrentUser();
  if (!auth.valid && !user) return apiKeyRequiredError();

  const organizationId = auth.organizationId;
  const anonymousId = organizationId ? null : getAnonymousId(request);
  const rateLimit = await checkRateLimitWithTier(
    organizationId,
    anonymousId,
    auth.valid ? auth.tier : "free",
    API_V1_RATE_LIMIT_ROUTE,
  );
  if (!rateLimit.allowed) return rateLimitError(rateLimit);
  if (!(isPaidApiKey(auth) || canAccessPremium(user))) return planRequiredError(rateLimit, what);

  return { auth, organizationId, anonymousId, rateLimit };
}
