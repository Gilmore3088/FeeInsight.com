import type { NextRequest } from "next/server";
import { validateApiKey, type ApiKeyValidation } from "@/lib/api-auth";
import { checkBurstLimitWithTier, checkRateLimitWithTier, type RateLimitResult } from "@/lib/api-rate-limit";
import { logApiUsage } from "@/lib/api-usage";
import { getCurrentUser, type User } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import {
  API_V1_RATE_LIMIT_ROUTE,
  apiError,
  apiKeyRequiredError,
  burstLimitError,
  getAnonymousId,
  isPaidApiKey,
  planRequiredError,
  rateLimitError,
} from "@/lib/api-v1";

export interface V1Caller {
  auth: ApiKeyValidation;
  /** The signed-in site user, looked up only when no valid key was sent. */
  user: User | null;
  organizationId: number | null;
  /** The issued key that made the call (null for a signed-in session); logged per usage event. */
  keyId: number | null;
  anonymousId: string | null;
  /** The monthly allowance after this call's reservation. */
  rateLimit: RateLimitResult;
  /** A paid key (pro, enterprise) or a signed-in Pro session. */
  paid: boolean;
}

export interface AuthorizeV1Options {
  /** Set on paid-only endpoints: what needs the plan, e.g. "Branch locations". */
  paidOnly?: string;
  /** The usage event a plan_required refusal is logged under. */
  usageEvent?: string;
}

/**
 * The one front door for every v1 data endpoint: a valid issued key (or, without one, a
 * signed-in site session), then the per-minute burst limit, then the shared monthly
 * allowance, then a paid plan when the endpoint needs one. The burst check comes first so
 * a refused burst does not use up monthly allowance. Returns the caller, or the error
 * response to send.
 */
export async function authorizeV1(
  request: NextRequest,
  options: AuthorizeV1Options = {},
): Promise<V1Caller | Response> {
  const auth = await validateApiKey(request);
  if (auth.error) return apiError(401, auth.code ?? "invalid_api_key", auth.error);
  // The API is for partners we have issued a key to; the site's own signed-in
  // download buttons still work without one.
  const user = auth.valid ? null : await getCurrentUser();
  if (!auth.valid && !user) return apiKeyRequiredError();

  const organizationId = auth.organizationId;
  const keyId = auth.valid ? (auth.keyId ?? null) : null;
  const anonymousId = organizationId ? null : getAnonymousId(request);
  const tier = auth.valid ? auth.tier : "free";

  const burst = await checkBurstLimitWithTier(organizationId, anonymousId, tier);
  if (!burst.allowed) return burst.unavailable ? rateLimitError(burst) : burstLimitError(burst);

  const rateLimit = await checkRateLimitWithTier(organizationId, anonymousId, tier, API_V1_RATE_LIMIT_ROUTE);
  if (!rateLimit.allowed) return rateLimitError(rateLimit);

  const paid = isPaidApiKey(auth) || canAccessPremium(user);
  if (options.paidOnly && !paid) {
    if (options.usageEvent) {
      logApiUsage(organizationId, anonymousId, options.usageEvent, { status: 403 }, keyId).catch(() => {});
    }
    return planRequiredError(rateLimit, options.paidOnly);
  }

  return { auth, user, organizationId, keyId, anonymousId, rateLimit, paid };
}
