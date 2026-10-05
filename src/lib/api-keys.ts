import { createHash, randomBytes } from "crypto";
import { sql, withTransaction } from "@/lib/data-store/connection";

export const API_KEY_TIERS = ["free", "pro", "enterprise"] as const;
export type ApiKeyTier = (typeof API_KEY_TIERS)[number];

export interface ApiKeyRow {
  id: number;
  organization_name: string;
  name: string;
  key_prefix: string;
  tier: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `bfi_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function organizationSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `api-${slug || "partner"}`;
}

/**
 * Creates (or reuses) the partner organization and issues a new key.
 * The plaintext key is returned once and never stored.
 */
export async function createApiKey(input: {
  organizationName: string;
  keyName: string;
  tier: ApiKeyTier;
}): Promise<{ key: string; prefix: string }> {
  const generated = generateApiKey();
  const slug = organizationSlug(input.organizationName);

  await withTransaction(async (tx) => {
    const [org] = await tx<{ id: number }[]>`
      INSERT INTO organizations (name, slug)
      VALUES (${input.organizationName}, ${slug})
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    await tx`
      INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, tier)
      VALUES (${org.id}, ${generated.hash}, ${generated.prefix}, ${input.keyName}, ${input.tier})
    `;
  });

  return { key: generated.key, prefix: generated.prefix };
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const rows = await sql<ApiKeyRow[]>`
    SELECT k.id, o.name AS organization_name, k.name, k.key_prefix, k.tier,
           k.created_at, k.last_used_at, k.revoked_at
    FROM api_keys k
    JOIN organizations o ON o.id = k.organization_id
    ORDER BY k.created_at DESC
  `;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function revokeApiKey(id: number): Promise<void> {
  await sql`
    UPDATE api_keys SET revoked_at = NOW()
    WHERE id = ${id} AND revoked_at IS NULL
  `;
}
