import { sql, withTransaction } from "@/lib/data-store/connection";
import { generateApiKey } from "@/lib/api-keys";
import { WORKSPACE_SEAT_GRACE_DAYS } from "@/lib/auth";
import { subscriberKeyName, subscriberOrgSlug } from "@/lib/api-subscriber-access";

/** Database side of subscriber keys; the rules are in api-subscriber-access.ts. */
export interface SubscriberKey {
  id: number;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The person whose plan covers a user's API key: themselves, or their workspace's owner. */
export interface ApiPayer {
  userId: number;
  stripeCustomerId: string | null;
  organizationName: string;
}

/**
 * Who pays for this user's API access. A user with their own active (or in-grace) Pro
 * subscription pays for themselves; a team seat is covered by the owner of an institution
 * workspace they are an active member of, under the same rule `hasWorkspaceSeat` uses.
 */
export async function findApiPayer(userId: number, db: typeof sql = sql): Promise<ApiPayer | null> {
  const rows = await db<{ id: number; stripe_customer_id: string | null; name: string | null }[]>`
    SELECT u.id, u.stripe_customer_id,
           COALESCE(NULLIF(u.institution_name, ''), NULLIF(u.display_name, ''), u.email, 'User ' || u.id::text) AS name,
           (u.id = ${userId}) AS own
      FROM users u
     WHERE u.is_active = true
       AND u.stripe_customer_id IS NOT NULL
       AND (
         u.subscription_status = 'active'
         OR (
           u.subscription_status = 'past_due'
           AND (
             to_jsonb(u.*) ->> 'past_due_since' IS NULL
             OR (to_jsonb(u.*) ->> 'past_due_since')::timestamptz
                  > NOW() - make_interval(days => ${WORKSPACE_SEAT_GRACE_DAYS})
           )
         )
       )
       AND (
         u.id = ${userId}
         OR EXISTS (
           SELECT 1
             FROM institution_workspace_memberships seat
             JOIN institution_workspace_memberships owner_seat
               ON owner_seat.institution_id = seat.institution_id
              AND owner_seat.membership_role = 'owner'
              AND owner_seat.membership_status = 'active'
            WHERE seat.user_id = ${userId}
              AND seat.membership_status = 'active'
              AND owner_seat.user_id = u.id
         )
       )
     ORDER BY own DESC, u.id
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { userId: Number(row.id), stripeCustomerId: row.stripe_customer_id, organizationName: row.name ?? `User ${row.id}` };
}

/**
 * Whether a team seat's key still has a seat: the key's holder is an active member of an
 * institution workspace whose active owner is the payer.
 */
export async function seatStillCovered(holderId: number, payerId: number, db: typeof sql = sql): Promise<boolean> {
  const rows = await db<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
        FROM institution_workspace_memberships seat
        JOIN institution_workspace_memberships owner_seat
          ON owner_seat.institution_id = seat.institution_id
         AND owner_seat.membership_role = 'owner'
         AND owner_seat.membership_status = 'active'
       WHERE seat.user_id = ${holderId}
         AND seat.membership_status = 'active'
         AND owner_seat.user_id = ${payerId}
    ) AS ok
  `;
  return rows[0]?.ok === true;
}

/** The user's current (unrevoked) key, if any, on any subscriber organization. */
export async function getSubscriberKey(userId: number): Promise<SubscriberKey | null> {
  const rows = await sql<{ id: number; key_prefix: string; created_at: string; last_used_at: string | null }[]>`
    SELECT k.id, k.key_prefix, k.created_at, k.last_used_at
    FROM api_keys k
    JOIN organizations o ON o.id = k.organization_id
    WHERE k.revoked_at IS NULL
      AND (
        k.name = ${subscriberKeyName(userId)}
        OR (o.slug = ${subscriberOrgSlug(userId)} AND k.name = 'Pro subscription')
      )
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
 * Issues the user a new key on the payer's organization and revokes any key the user held
 * before, so each person has at most one working key. The plaintext key is returned once and
 * never stored.
 */
export async function issueSubscriberKey(input: {
  userId: number;
  payer: ApiPayer;
}): Promise<{ key: string; prefix: string }> {
  const generated = generateApiKey();
  const slug = subscriberOrgSlug(input.payer.userId);
  await withTransaction(async (tx) => {
    const [org] = await tx<{ id: number }[]>`
      INSERT INTO organizations (name, slug)
      VALUES (${input.payer.organizationName}, ${slug})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      RETURNING id
    `;
    await revokeSubscriberKeys(input.userId, tx as unknown as typeof sql);
    await tx`
      INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, tier)
      VALUES (${org.id}, ${generated.hash}, ${generated.prefix}, ${subscriberKeyName(input.userId)}, 'pro')
    `;
  });
  return { key: generated.key, prefix: generated.prefix };
}

/** Turns off every key the user holds on any subscriber organization. */
export async function revokeSubscriberKeys(
  userId: number,
  db: typeof sql = sql,
): Promise<void> {
  await db`
    UPDATE api_keys SET revoked_at = NOW()
    WHERE revoked_at IS NULL
      AND organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pro-user-%')
      AND (
        name = ${subscriberKeyName(userId)}
        OR (name = 'Pro subscription'
            AND organization_id IN (SELECT id FROM organizations WHERE slug = ${subscriberOrgSlug(userId)}))
      )
  `;
}
