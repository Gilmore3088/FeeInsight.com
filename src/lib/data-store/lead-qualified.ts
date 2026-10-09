/**
 * The qualified flag on leads (migration 20270110000032): when James marked a lead qualified
 * on /admin/leads and who did. The sales metrics (DRAPER's weekly report) count it, and the
 * growth step `growth-quote` drafts a quote for each qualified lead. Before the migration
 * every function here reads as "not ready" and writes nothing.
 */
import { sql } from "./connection";

type SqlTag = typeof sql;

/** True once both qualified columns exist on `leads`. */
export async function leadQualifiedReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leads' AND column_name IN ('qualified_at', 'qualified_by')`;
  return Number(row?.n) === 2;
}

/**
 * Marks a lead qualified (recording who and when) or clears the mark. Marking an already
 * qualified lead keeps its first time and marker. Returns false when no row changed.
 */
export async function setLeadQualified(leadId: number, qualified: boolean, by: string, db: SqlTag = sql): Promise<boolean> {
  const rows = qualified
    ? await db`
        UPDATE leads SET qualified_at = now(), qualified_by = ${by}
         WHERE id = ${leadId} AND qualified_at IS NULL
        RETURNING id`
    : await db`
        UPDATE leads SET qualified_at = NULL, qualified_by = NULL
         WHERE id = ${leadId} AND qualified_at IS NOT NULL
        RETURNING id`;
  return rows.length > 0;
}

export interface QualifiedLeadMark {
  leadId: number;
  /** The institution James's quote names, when there is one. */
  institutionId: number | null;
  at: string;
}

/** Leads marked qualified before `to`, oldest first; empty before the migration. */
export async function listQualifiedLeads(to: Date, db: SqlTag = sql): Promise<QualifiedLeadMark[]> {
  if (!(await leadQualifiedReady(db))) return [];
  const rows = await db`
    SELECT id, to_jsonb(leads)->>'quote_institution_id' AS institution_id, qualified_at
      FROM leads
     WHERE qualified_at IS NOT NULL AND qualified_at < ${to.toISOString()}
     ORDER BY qualified_at, id`;
  return rows.map((row) => ({
    leadId: Number(row.id),
    institutionId: row.institution_id === null || row.institution_id === undefined ? null : Number(row.institution_id),
    at: new Date(row.qualified_at as string).toISOString(),
  }));
}
