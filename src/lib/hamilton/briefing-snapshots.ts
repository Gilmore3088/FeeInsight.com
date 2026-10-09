import { sql } from "@/lib/data-store/connection";
import { getWorkspaceBriefing } from "@/lib/hamilton/workspace/research";
import { briefingQuarter, diffBriefings, type BriefingDiff } from "@/lib/hamilton/workspace/briefing-diff";
import type { Briefing } from "@/lib/hamilton/workspace/types";

/**
 * Quarterly refresh of each institution workspace's Hamilton briefing.
 *
 * The `briefing-refresh` step runs daily. It stores one copy of the briefing per active
 * workspace per quarter: the first run of a quarter, or the first run after a new
 * workspace appears. `getWorkspaceBriefing` (Improving Hamilton's engine) builds it; this
 * file only stores it, read-only to the engine and deterministic, with no provider
 * calls. The bank then sees `diffBriefings` between its two newest copies.
 */

export interface BriefingRefreshResult {
  dryRun: boolean;
  quarter: string;
  workspaces: number;
  /** Already had this quarter's copy. */
  alreadyStored: number;
  stored: number;
  /** getWorkspaceBriefing returned nothing for the institution. */
  noBriefing: number;
  failed: number;
  /** Of the stored (or, on a dry run, built) copies, how many have a previous quarter to compare. */
  withPreviousQuarter: number;
  previews: Array<{ institutionId: number; institutionName: string; observations: number; fees: number; changes: number | null }>;
}

async function loadWorkspaceInstitutions(onlyInstitutionId: number | null): Promise<number[]> {
  const rows = await sql<{ institution_id: number | string }[]>`
    SELECT DISTINCT b.institution_id
      FROM (
        SELECT m.institution_id::bigint AS institution_id, m.user_id::bigint AS user_id
          FROM institution_workspace_memberships m
         WHERE m.membership_status = 'active'
        UNION
        -- A Pro reader's saved bank counts too, so the bank they work on gets these before
        -- anyone holds a seat on it (no institution has a paid seat yet).
        SELECT c.selected_institution_id::bigint, c.user_id::bigint
          FROM hamilton_workspace_contexts c
          JOIN users u ON u.id = c.user_id
         WHERE c.selected_institution_id IS NOT NULL AND u.is_active = TRUE
           AND (u.role IN ('admin', 'analyst', 'premium') OR u.subscription_status IN ('active', 'past_due'))
      ) b
     WHERE (${onlyInstitutionId}::bigint IS NULL OR b.institution_id = ${onlyInstitutionId}::bigint)
     ORDER BY b.institution_id
  `;
  return rows.map((row) => Number(row.institution_id));
}

async function storedQuarters(institutionIds: number[]): Promise<Map<number, string[]>> {
  if (institutionIds.length === 0) return new Map();
  const rows = await sql<{ institution_id: number | string; quarter: string }[]>`
    SELECT institution_id, quarter
      FROM hamilton_briefing_snapshots
     WHERE institution_id = ANY(${institutionIds}::bigint[])
     ORDER BY quarter DESC
  `;
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const id = Number(row.institution_id);
    map.set(id, [...(map.get(id) ?? []), row.quarter]);
  }
  return map;
}

async function loadSnapshot(institutionId: number, quarter: string): Promise<Briefing | null> {
  const rows = await sql<{ briefing: Briefing | string }[]>`
    SELECT briefing FROM hamilton_briefing_snapshots
     WHERE institution_id = ${institutionId} AND quarter = ${quarter}
  `;
  const value = rows[0]?.briefing;
  if (!value) return null;
  return typeof value === "string" ? (JSON.parse(value) as Briefing) : value;
}

export async function runBriefingRefresh({
  dryRun = false,
  institutionId = null,
  now = new Date(),
  runId = null,
}: { dryRun?: boolean; institutionId?: number | null; now?: Date; runId?: number | null } = {}): Promise<BriefingRefreshResult> {
  const quarter = briefingQuarter(now);
  const result: BriefingRefreshResult = {
    dryRun,
    quarter,
    workspaces: 0,
    alreadyStored: 0,
    stored: 0,
    noBriefing: 0,
    failed: 0,
    withPreviousQuarter: 0,
    previews: [],
  };
  let institutions = await loadWorkspaceInstitutions(institutionId);
  // A dry run for a named institution works before it has a workspace, as a preview.
  if (dryRun && institutionId !== null && institutions.length === 0) institutions = [institutionId];
  result.workspaces = institutions.length;
  const quarters = await storedQuarters(institutions);

  for (const id of institutions) {
    const have = quarters.get(id) ?? [];
    if (have.includes(quarter) && !dryRun) {
      result.alreadyStored += 1;
      continue;
    }
    try {
      const briefing = await getWorkspaceBriefing(id, now);
      if (!briefing) {
        result.noBriefing += 1;
        continue;
      }
      const previousQuarter = have.find((q) => q < quarter) ?? null;
      let changes: number | null = null;
      if (previousQuarter) {
        const previous = await loadSnapshot(id, previousQuarter);
        if (previous) {
          result.withPreviousQuarter += 1;
          changes = diffBriefings({ quarter: previousQuarter, briefing: previous }, { quarter, briefing }).changes.length;
        }
      }
      if (result.previews.length < 5) {
        result.previews.push({
          institutionId: id,
          institutionName: briefing.institutionName,
          observations: briefing.observations.length,
          fees: briefing.positions.length,
          changes,
        });
      }
      if (dryRun) continue;
      const inserted = await sql`
        INSERT INTO hamilton_briefing_snapshots (institution_id, quarter, engine_version, briefing, agent_run_id)
        VALUES (${id}, ${quarter}, ${briefing.provenance.engineVersion}, ${JSON.stringify(briefing)}::jsonb, ${runId})
        ON CONFLICT (institution_id, quarter) DO NOTHING
        RETURNING institution_id
      `;
      if (inserted.length > 0) result.stored += 1;
      else result.alreadyStored += 1;
    } catch (error) {
      console.error(`[briefing-refresh] institution ${id} failed`, error instanceof Error ? error.message : String(error));
      result.failed += 1;
    }
  }
  return result;
}

export function summarizeBriefingRefresh(result: BriefingRefreshResult): string {
  const lead = result.dryRun ? "Dry run: " : "";
  if (result.workspaces === 0) return `${lead}No institution has an active workspace, so no ${result.quarter} briefing was stored.`;
  const stored = result.dryRun ? `built ${result.previews.length}` : `stored ${result.stored}`;
  const parts = [
    `${lead}${result.quarter} briefings for ${result.workspaces} workspace(s): ${stored}`,
    `${result.alreadyStored} already stored`,
    `${result.withPreviousQuarter} with a previous quarter to compare`,
  ];
  if (result.noBriefing) parts.push(`${result.noBriefing} had no briefing`);
  if (result.failed) parts.push(`${result.failed} failed`);
  return `${parts.join(", ")}.`;
}

/** The bank's two newest stored briefings, compared; null until there are two. */
export async function getBriefingChangesSinceLastQuarter(institutionId: number): Promise<BriefingDiff | null> {
  const rows = await sql<{ quarter: string; briefing: Briefing | string }[]>`
    SELECT quarter, briefing FROM hamilton_briefing_snapshots
     WHERE institution_id = ${institutionId}
     ORDER BY quarter DESC
     LIMIT 2
  `.catch(() => [] as { quarter: string; briefing: Briefing | string }[]);
  if (rows.length < 2) return null;
  const parse = (value: Briefing | string): Briefing => (typeof value === "string" ? (JSON.parse(value) as Briefing) : value);
  return diffBriefings(
    { quarter: rows[1].quarter, briefing: parse(rows[1].briefing) },
    { quarter: rows[0].quarter, briefing: parse(rows[0].briefing) },
  );
}
