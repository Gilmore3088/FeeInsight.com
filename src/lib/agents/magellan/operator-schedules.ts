import { sql } from "@/lib/data-store/connection";
import { recordAttempt } from "@/lib/agents/learning/attempts";

import { looksLikePdfUrl } from "./find-validate";
import { urlIdentity } from "./finders";

type SqlTag = typeof sql;

/**
 * Consumer fee schedules James found by hand for banks Magellan had not found yet. Each is
 * stored as a companion document (`consumer_supplement`), the same way the paid schedule
 * search stores its answers, so the bank keeps its link and live fees and companion fetch,
 * Rosetta and Knox read the schedule next. Adding a link here is the whole change: the
 * fetch step adds any listed schedule the bank does not hold yet, once.
 */
export const OPERATOR_SCHEDULE_STRATEGY = { strategy: "discover.operator_schedule", version: 1 } as const;

export interface OperatorSchedule {
  institutionId: number;
  /** For readers of this file; the id decides. */
  institutionName: string;
  url: string;
  /** Who gave the link and when (UTC). */
  givenBy: string;
}

export const OPERATOR_SCHEDULES: readonly OperatorSchedule[] = [
  {
    institutionId: 1,
    institutionName: "JPMorgan Chase Bank, National Association",
    url: "https://www.chase.com/content/dam/chase-ux/documents/personal/checking/ABSF-en.pdf",
    givenBy: "James, 2026-10-07 00:51",
  },
  {
    institutionId: 3,
    institutionName: "Citibank, National Association",
    url: "https://www.citigroup.com/rcs/citigpa/storage/public/Schedule_of_Charges_Effective_February_26_2026.pdf",
    givenBy: "James, 2026-10-07 00:52",
  },
];

export interface OperatorScheduleResult {
  added: Array<{ institutionId: number; url: string }>;
}

/**
 * Adds each listed schedule the bank does not hold yet (as its link, a stored document or a
 * companion). A schedule already held, or one a reviewer rejected, is left alone.
 */
export async function addOperatorSchedules(options: {
  db?: SqlTag;
  runId: number;
  stepId?: number | null;
  schedules?: readonly OperatorSchedule[];
}): Promise<OperatorScheduleResult> {
  const db = options.db ?? sql;
  const schedules = options.schedules ?? OPERATOR_SCHEDULES;
  const result: OperatorScheduleResult = { added: [] };
  if (schedules.length === 0) return result;

  const ids = [...new Set(schedules.map((schedule) => schedule.institutionId))];
  const held = await db`
    SELECT inst.id AS institution_id, inst.fee_schedule_url AS url FROM institution_sources inst WHERE inst.id = ANY(${ids}::bigint[])
    UNION ALL
    SELECT doc.institution_id, doc.document_url FROM source_documents doc WHERE doc.institution_id = ANY(${ids}::bigint[])
    UNION ALL
    SELECT ias.institution_id, ias.url FROM institution_additional_sources ias WHERE ias.institution_id = ANY(${ids}::bigint[])
  `;
  const exists = new Set(held.map((row) => Number(row.institution_id)));
  const known = new Set(held.filter((row) => row.url).map((row) => `${Number(row.institution_id)}:${urlIdentity(String(row.url))}`));

  for (const schedule of schedules) {
    if (!exists.has(schedule.institutionId)) continue;
    if (known.has(`${schedule.institutionId}:${urlIdentity(schedule.url)}`)) continue;
    const reason = `Consumer fee schedule given by ${schedule.givenBy}`;
    const inserted = await db`
      INSERT INTO institution_additional_sources
        (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
      VALUES
        (${schedule.institutionId}, ${schedule.url}, ${looksLikePdfUrl(schedule.url) ? "pdf" : "html"}, 'consumer_supplement',
         ${OPERATOR_SCHEDULE_STRATEGY.strategy}, ${OPERATOR_SCHEDULE_STRATEGY.version}, ${options.runId}, ${reason})
      ON CONFLICT (institution_id, url) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) continue;
    known.add(`${schedule.institutionId}:${urlIdentity(schedule.url)}`);
    result.added.push({ institutionId: schedule.institutionId, url: schedule.url });
    await recordAttempt(db, {
      institutionId: schedule.institutionId,
      stage: "discover",
      strategy: OPERATOR_SCHEDULE_STRATEGY.strategy,
      version: OPERATOR_SCHEDULE_STRATEGY.version,
      fingerprint: urlIdentity(schedule.url),
      outcome: "ok",
      yieldCount: 1,
      costMicrousd: 0,
      durationMs: 0,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: { url: schedule.url, given_by: schedule.givenBy, reason },
    });
  }
  return result;
}
