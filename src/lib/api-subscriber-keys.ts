import { sql, withTransaction } from "@/lib/data-store/connection";
import { generateApiKey } from "@/lib/api-keys";
import { subscriberOrgSlug } from "@/lib/api-subscriber-access";

/** Database side of subscriber keys; the rules are in api-subscriber-access.ts. */
export interface SubscriberKey {
  id: number;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The subscriber's current (unrevoked) key, if any. */
export async function getSubscriberKey(userId: number): Promise<SubscriberKey | null> {
  const rows = await sql<{ id: number; key_prefix: string; created_at: string; last_used_at: string | null }[]>`
    SELECT k.id, k.key_prefix, k.created_at, k.last_used_at
    FROM api_keys k
    JOIN organizations o ON o.id = k.organization_id
    WHERE o.slug = ${subscriberOrgSlug(userId)} AND k.revoked_at IS NULL
    ORDER BY k.created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    prefix: row.key_prefix,
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
  };
}

/**
 * Issues the subscriber a new key and revokes any key they held before, so each person has
 * at most one working key. The plaintext key is returned once and never stored.
 */
export async function issueSubscriberKey(input: {
  userId: number;
  organizationName: string;
}): Promise<{ key: string; prefix: string }> {
  const generated = generateApiKey();
  const slug = subscriberOrgSlug(input.userId);
  await withTransaction(async (tx) => {
    const [org] = await tx<{ id: number }[]>`
      INSERT INTO organizations (name, slug)
      VALUES (${input.organizationName}, ${slug})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      RETURNING id
    `;
    await tx`
      UPDATE api_keys SET revoked_at = NOW()
      WHERE organization_id = ${org.id} AND revoked_at IS NULL
    `;
    await tx`
      INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, tier)
      VALUES (${org.id}, ${generated.hash}, ${generated.prefix}, 'Pro subscription', 'pro')
    `;
  });
  return { key: generated.key, prefix: generated.prefix };
}

/** Turns off every key the subscriber holds. */
export async function revokeSubscriberKeys(
  userId: number,
  db: typeof sql = sql,
): Promise<void> {
  await db`
    UPDATE api_keys SET revoked_at = NOW()
    WHERE revoked_at IS NULL
      AND organization_id IN (SELECT id FROM organizations WHERE slug = ${subscriberOrgSlug(userId)})
  `;
}
