import { sql } from "@/lib/data-store/connection";
import { hashApiKey } from "@/lib/api-keys";
import { subscriberKeyAllowed, subscriberKeyUserId, subscriberUserIdFromSlug } from "@/lib/api-subscriber-access";
import { seatStillCovered } from "@/lib/api-subscriber-keys";
import { CONTACT_EMAIL } from "@/lib/constants";

/** Why a key that was sent was turned away; each is its own v1 error code. */
export type ApiKeyErrorCode = "invalid_api_key" | "key_revoked" | "subscription_inactive" | "seat_removed";

export interface ApiKeyValidation {
  valid: boolean;
  organizationId: number | null;
  tier: string;
  /** The api_keys row that was accepted; set only when `valid`. */
  keyId?: number | null;
  error?: string;
  /** Set together with `error`. */
  code?: ApiKeyErrorCode;
}

function extractApiKey(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer bfi_")) {
    return authHeader.slice(7);
  }

  const url = new URL(request.url);
  const paramKey = url.searchParams.get("api_key");
  if (paramKey?.startsWith("bfi_")) {
    return paramKey;
  }

  return null;
}

export async function validateApiKey(
  request: Request
): Promise<ApiKeyValidation> {
  const key = extractApiKey(request);

  if (!key) {
    return { valid: false, organizationId: null, tier: "free" };
  }

  const keyHash = hashApiKey(key);

  const rows = await sql`
    SELECT k.id, k.organization_id, k.tier, k.revoked_at, k.name, o.slug
    FROM api_keys k
    LEFT JOIN organizations o ON o.id = k.organization_id
    WHERE k.key_hash = ${keyHash}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      valid: false,
      organizationId: null,
      tier: "free",
      error: "Invalid API key. Check that the whole key was copied, or make a new one on your account page.",
      code: "invalid_api_key",
    };
  }

  const row = rows[0];

  if (row.revoked_at) {
    return {
      valid: false,
      organizationId: null,
      tier: "free",
      error: `API key has been revoked. Make a new key on your account page, or ask ${CONTACT_EMAIL} for a new partner key.`,
      code: "key_revoked",
    };
  }

  // A Pro subscriber's key works only while their subscription does (cancel stops it), and
  // a team seat's key only while that person still holds a seat on the payer's workspace.
  const subscriberId = subscriberUserIdFromSlug(row.slug);
  if (subscriberId !== null) {
    const users = await sql<{ subscription_status: string | null; past_due_since: string | null }[]>`
      SELECT subscription_status, past_due_since FROM users WHERE id = ${subscriberId} LIMIT 1
    `;
    if (!subscriberKeyAllowed(users[0] ?? null)) {
      return {
        valid: false,
        organizationId: null,
        tier: "free",
        error: "This key's Hamilton subscription is not active. Restart Hamilton from your account to use it again.",
        code: "subscription_inactive",
      };
    }
    const holderId = subscriberKeyUserId(row.name);
    if (holderId !== null && holderId !== subscriberId && !(await seatStillCovered(holderId, subscriberId))) {
      return {
        valid: false,
        organizationId: null,
        tier: "free",
        error:
          "This key's holder no longer has a seat on the Hamilton plan that covered it. Ask the plan's owner to add you back to their workspace.",
        code: "seat_removed",
      };
    }
  }

  // Fire-and-forget: update last_used_at
  sql`
    UPDATE api_keys SET last_used_at = NOW() WHERE id = ${row.id}
  `.catch(() => {
    // Silent — non-critical timestamp update
  });

  return {
    valid: true,
    organizationId: row.organization_id,
    tier: row.tier ?? "pro",
    keyId: row.id == null ? null : Number(row.id),
  };
}
