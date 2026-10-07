import { sql, withTransaction } from "./connection";

export interface SavedPeerSet {
  id: number;
  name: string;
  tiers: string | null;
  districts: string | null;
  charter_type: string | null;
  created_by: string;
  created_at: string;
  /** Hand-picked peers; when set, the peers are exactly these institutions. */
  institution_ids: number[] | null;
  states: string[] | null;
  /** The workspace (institution) the set belongs to, shared with its members; null for a personal set. */
  institution_id: number | null;
  /** "Use for all charts": the default peer group for its workspace, or for its owner when personal. */
  is_default: boolean;
}

export interface PeerSetFilterInput {
  charter_type?: string;
  asset_tiers?: string[];
  fed_districts?: number[];
  states?: string[];
  institution_ids?: number[];
}

const columns = () => sql`
  s.id, s.name, s.tiers, s.districts, s.charter_type, s.created_by, s.created_at,
  s.institution_ids, s.states, s.institution_id, COALESCE(s.is_default, false) AS is_default
`;

/** True when the user is an active member of the set's workspace. */
const memberOf = (userId: string) => sql`
  EXISTS (
    SELECT 1 FROM institution_workspace_memberships m
     WHERE m.institution_id = s.institution_id
       AND m.user_id::text = ${userId}
       AND m.membership_status = 'active'
  )
`;

function mapRow(row: Record<string, unknown>): SavedPeerSet {
  const ids = Array.isArray(row.institution_ids) ? (row.institution_ids as unknown[]).map(Number) : null;
  const states = Array.isArray(row.states) ? (row.states as unknown[]).map(String) : null;
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    tiers: (row.tiers as string | null) ?? null,
    districts: (row.districts as string | null) ?? null,
    charter_type: (row.charter_type as string | null) ?? null,
    created_by: String(row.created_by ?? ""),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    institution_ids: ids && ids.length > 0 ? ids : null,
    states: states && states.length > 0 ? states : null,
    institution_id: row.institution_id == null ? null : Number(row.institution_id),
    is_default: row.is_default === true,
  };
}

/**
 * The peer sets a user can see: their own, plus every set of the workspace they are working
 * in (when they are an active member of it). Workspace sets come first.
 */
export async function getSavedPeerSets(
  userId: string,
  workspaceInstitutionId?: number | null,
): Promise<SavedPeerSet[]> {
  const workspace = workspaceInstitutionId ?? null;
  const rows = await sql`
    SELECT ${columns()}
    FROM saved_peer_sets s
    WHERE s.created_by = ${userId}
       OR (${workspace}::int IS NOT NULL AND s.institution_id = ${workspace}::int AND ${memberOf(userId)})
    ORDER BY (s.institution_id IS NULL), s.created_at DESC
  ` as Record<string, unknown>[];
  return rows.map(mapRow);
}

/** One set the user can use: their own, or one of a workspace they are an active member of. */
export async function getSavedPeerSetById(
  id: number,
  userId: string,
): Promise<SavedPeerSet | null> {
  const rows = await sql`
    SELECT ${columns()}
    FROM saved_peer_sets s
    WHERE s.id = ${id}
      AND (s.created_by = ${userId} OR (s.institution_id IS NOT NULL AND ${memberOf(userId)}))
    LIMIT 1
  ` as Record<string, unknown>[];
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * The default sets that could apply: the workspace's default (only when the user is an active
 * member of it) and the user's own personal default. The caller picks between them.
 */
export async function getDefaultPeerSets(params: {
  userId: string;
  institutionId: number | null;
}): Promise<SavedPeerSet[]> {
  const workspace = params.institutionId ?? null;
  const rows = await sql`
    SELECT ${columns()}
    FROM saved_peer_sets s
    WHERE s.is_default
      AND (
        (s.institution_id IS NULL AND s.created_by = ${params.userId})
        OR (${workspace}::int IS NOT NULL AND s.institution_id = ${workspace}::int AND ${memberOf(params.userId)})
      )
  ` as Record<string, unknown>[];
  return rows.map(mapRow);
}

/**
 * The workspace a user's new peer sets belong to: their selected bank, when they are an
 * active member of its workspace. Null means their sets are personal.
 */
export async function getPeerSetWorkspace(
  userId: string,
): Promise<{ institutionId: number; role: string } | null> {
  const rows = await sql`
    SELECT c.selected_institution_id AS institution_id, m.membership_role AS role
    FROM hamilton_workspace_contexts c
    JOIN institution_workspace_memberships m
      ON m.institution_id = c.selected_institution_id
     AND m.user_id = c.user_id
     AND m.membership_status = 'active'
    WHERE c.user_id::text = ${userId}
    ORDER BY m.granted_at DESC
    LIMIT 1
  ` as { institution_id: number | string; role: string }[];
  const row = rows[0];
  return row ? { institutionId: Number(row.institution_id), role: String(row.role) } : null;
}

function filterValues(filters: PeerSetFilterInput) {
  return {
    tiers: filters.asset_tiers?.length ? filters.asset_tiers.join(",") : null,
    districts: filters.fed_districts?.length ? filters.fed_districts.join(",") : null,
    charter_type: filters.charter_type ?? null,
    states: filters.states?.length ? filters.states : null,
    institution_ids: filters.institution_ids?.length ? filters.institution_ids : null,
  };
}

export async function savePeerSet(
  name: string,
  filters: PeerSetFilterInput,
  userId: string,
  institutionId: number | null = null,
): Promise<number> {
  const v = filterValues(filters);
  const [row] = await sql`
    INSERT INTO saved_peer_sets (name, tiers, districts, charter_type, states, institution_ids, institution_id, created_by)
    VALUES (
      ${name},
      ${v.tiers},
      ${v.districts},
      ${v.charter_type},
      ${v.states}::text[],
      ${v.institution_ids}::int[],
      ${institutionId},
      ${userId}
    )
    RETURNING id
  `;
  return row.id;
}

/** Who may change a set: its creator, or an active non-viewer member of its workspace. */
const editableBy = (userId: string, db: typeof sql = sql) => db`
  (s.created_by = ${userId} OR (s.institution_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM institution_workspace_memberships m
     WHERE m.institution_id = s.institution_id
       AND m.user_id::text = ${userId}
       AND m.membership_status = 'active'
       AND m.membership_role <> 'viewer'
  )))
`;

export async function updatePeerSet(
  id: number,
  name: string,
  filters: PeerSetFilterInput,
  userId: string,
): Promise<boolean> {
  const v = filterValues(filters);
  const result = await sql`
    UPDATE saved_peer_sets s SET
      name = ${name},
      tiers = ${v.tiers},
      districts = ${v.districts},
      charter_type = ${v.charter_type},
      states = ${v.states}::text[],
      institution_ids = ${v.institution_ids}::int[]
    WHERE s.id = ${id} AND ${editableBy(userId)}
  `;
  return result.count > 0;
}

/**
 * Make a set the default ("Use for all charts") for its scope, clearing the scope's other
 * default first so the one-default unique indexes hold. With `id` null, clears the default
 * for the given scope instead. Returns the scope changed (`institutionId` null = personal),
 * or null when the user may not change it.
 */
export async function setDefaultPeerSet(params: {
  id: number | null;
  userId: string;
  institutionId: number | null;
}): Promise<{ institutionId: number | null } | null> {
  const { id, userId } = params;
  return withTransaction(async (tx) => {
    let scope: number | null = params.institutionId;
    if (id !== null) {
      const rows = await tx`
        SELECT s.institution_id FROM saved_peer_sets s WHERE s.id = ${id} AND ${editableBy(userId, tx)} LIMIT 1
      ` as { institution_id: number | null }[];
      if (!rows[0]) return null;
      scope = rows[0].institution_id == null ? null : Number(rows[0].institution_id);
    }
    if (scope === null) {
      await tx`UPDATE saved_peer_sets SET is_default = false WHERE is_default AND institution_id IS NULL AND created_by = ${userId}`;
    } else {
      const allowed = await tx`
        SELECT 1 FROM institution_workspace_memberships m
         WHERE m.institution_id = ${scope} AND m.user_id::text = ${userId}
           AND m.membership_status = 'active' AND m.membership_role <> 'viewer'
         LIMIT 1
      `;
      if (allowed.length === 0) return null;
      await tx`UPDATE saved_peer_sets SET is_default = false WHERE is_default AND institution_id = ${scope}`;
    }
    if (id !== null) await tx`UPDATE saved_peer_sets SET is_default = true WHERE id = ${id}`;
    return { institutionId: scope };
  });
}

export async function deletePeerSet(id: number, userId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM saved_peer_sets s WHERE s.id = ${id} AND ${editableBy(userId)}
  `;
  return result.count > 0;
}

/** Names of the given institutions (for chosen-peer chips); unknown ids are left out. */
export async function getPeerInstitutionNames(ids: number[]): Promise<Map<number, string>> {
  const clean = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (clean.length === 0) return new Map();
  const rows = await sql`
    SELECT id, institution_name FROM institution_sources WHERE id = ANY(${clean}::int[])
  ` as { id: number | string; institution_name: string }[];
  return new Map(rows.map((row) => [Number(row.id), String(row.institution_name)]));
}
