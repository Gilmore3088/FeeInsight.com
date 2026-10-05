import { sql } from "@/lib/data-store/connection";
import { hashApiKey } from "@/lib/api-keys";

export interface ApiKeyValidation {
  valid: boolean;
  organizationId: number | null;
  tier: string;
  error?: string;
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
    SELECT id, organization_id, tier, revoked_at
    FROM api_keys
    WHERE key_hash = ${keyHash}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      valid: false,
      organizationId: null,
      tier: "free",
      error: "Invalid API key",
    };
  }

  const row = rows[0];

  if (row.revoked_at) {
    return {
      valid: false,
      organizationId: null,
      tier: "free",
      error: "API key has been revoked",
    };
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
  };
}

/** Paid partner keys (pro, enterprise) may download CSV without a Pro login. */
export function apiKeyCanExport(auth: ApiKeyValidation): boolean {
  return auth.valid && (auth.tier === "pro" || auth.tier === "enterprise");
}
