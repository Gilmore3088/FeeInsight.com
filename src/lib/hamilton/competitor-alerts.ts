import { sql } from "@/lib/data-store/connection";
import { statsRowFilter } from "@/lib/data-store/fee-stats";
import { consumerPriceMoveSql } from "@/lib/data-store/consumer-price-moves";
import { getInstitutionById } from "@/lib/data-store/core";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { FEE_MOVES_TRACKED_SINCE, getLocalMarketCompetitors } from "@/lib/data-store/local-market";
import { SECOND_LOOK_MIN_MINUTES } from "@/lib/agents/hamilton/second-look";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";
import { effectiveDate } from "@/lib/agents/hamilton/schedule-edition";
import {
  judgeFeeChange,
  type FeeChangeHold,
  type PulseChange,
  type RecordedChangeRow,
} from "@/lib/report-assemblers/monthly-pulse";

/**
 * In-app competitor change alerts for institution workspaces (the institution product).
 *
 * When a local competitor (FDIC branch-deposit market, `getLocalMarketCompetitors`) changes
 * a headline fee, every active member of the bank's workspace gets a Monitor alert. While
 * fees are still loading most recorded "changes" are re-reads, so a change alerts only when:
 *   - Hamilton publish recorded it in `fee_change_records` after PR 78's same-line rule
 *     (`FEE_MOVES_TRACKED_SINCE`), from a Darwin-verified row that is still live;
 *   - it is at least 12 hours old (`SECOND_LOOK_MIN_MINUTES`) and the new price has no
 *     pending takedown (`pipeline_feedback` kind `takedown_pending`), so it has had its
 *     second look;
 *   - `judgeFeeChange`, the rule Hamilton and the Monthly Pulse share, bears it out
 *     against the two schedule copies. It never counts our corrected reading of one document,
 *     or an older schedule found late, as the bank changing its price (#1898).
 * Each alert carries its baseline (#1898): the price we had on file before, from which
 * schedule and edition and since when, beside the new price and when we first read it, so the
 * subscriber sees what we knew and when. An alert whose change later fails the rule is
 * withdrawn, not deleted. Nothing is emailed. Each bank sees each change once (dedupe key in
 * the signal).
 */

export const COMPETITOR_CHANGE_SIGNAL = "hamilton_competitor_fee_change";
/**
 * Space Coast CU, the demo institution. While no institution has an active workspace, the
 * scheduled competitor-alert and briefing runs also record a dry-run preview for it, so the
 * run ledger shows what they would write.
 */
export const PREVIEW_INSTITUTION_ID = 8109;
const COMPETITOR_LIMIT = 20;

export interface WorkspaceBank {
  institutionId: number;
  memberUserIds: number[];
}

export interface CompetitorChangeRow extends RecordedChangeRow {
  change_id: number | string;
  competitor_id: number | string;
  new_fee_published_id: number | string;
  /** When the old price went live in the index: what we knew, and since when. */
  old_read_at?: string | Date | null;
  /** When the new price went live in the index. */
  new_read_at?: string | Date | null;
}

/** One side of an alert's baseline: a price, the schedule it was read from, and when. */
export interface BaselineSide {
  amount: number;
  scheduleUrl: string | null;
  /** The edition date the schedule states (YYYY-MM-DD), or null when it states none. */
  edition: string | null;
  /** The day this price went live in the index (YYYY-MM-DD), or null when unknown. */
  readOn: string | null;
}

export interface CompetitorBaseline {
  before: BaselineSide;
  after: BaselineSide;
}

export interface CompetitorAlert {
  bankId: number;
  bankName: string;
  competitorId: number;
  competitorName: string;
  feeKey: string;
  previousAmount: number;
  newAmount: number;
  ownAmount: number | null;
  changeId: number;
  changedAt: string;
  scheduleUrl: string | null;
  dedupeKey: string;
  title: string;
  body: string;
  baseline: CompetitorBaseline;
}

export function competitorAlertDedupeKey(bankId: number, changeId: number): string {
  return `competitor_change:${bankId}:${changeId}`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** "Overdraft (OD)" -> "overdraft fee"; "Wire Transfer Fee" -> "wire transfer fee". */
function feeLabel(displayName: string): string {
  const base = displayName.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
  return /\bfee$/.test(base) ? base : `${base} fee`;
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function day(value: string | Date | null | undefined): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Pure: what we had on file before the change and what replaced it, with sources and dates. */
export function buildCompetitorBaseline(row: CompetitorChangeRow, change: PulseChange): CompetitorBaseline {
  return {
    before: {
      amount: change.old_amount,
      scheduleUrl: row.old_source_url ?? null,
      edition: effectiveDate(row.old_document_text),
      readOn: day(row.old_read_at),
    },
    after: {
      amount: change.new_amount,
      scheduleUrl: row.source_url ?? null,
      edition: effectiveDate(row.new_document_text),
      readOn: day(row.new_read_at),
    },
  };
}

/** Pure: the alert one bank should see for one confirmed competitor change. */
export function buildCompetitorAlert(input: {
  bankId: number;
  bankName: string;
  ownAmount: number | null;
  change: PulseChange;
  changeId: number;
  competitorId: number;
  baseline: CompetitorBaseline;
}): CompetitorAlert {
  const { change } = input;
  const fee = feeLabel(change.display_name);
  const verb = change.direction === "up" ? "raised" : "lowered";
  const competitorName = cleanName(change.institution_name);
  const title = `${competitorName} ${verb} its ${fee} from ${money(change.old_amount)} to ${money(change.new_amount)}`;
  const ownLine =
    input.ownAmount === null
      ? `${cleanName(input.bankName)} has no published ${fee} on file.`
      : input.ownAmount === change.new_amount
        ? `${cleanName(input.bankName)} charges the same, ${money(input.ownAmount)}.`
        : `${cleanName(input.bankName)} charges ${money(input.ownAmount)}, ${money(Math.abs(input.ownAmount - change.new_amount))} ${input.ownAmount > change.new_amount ? "higher" : "lower"}.`;
  const body =
    `${ownLine} The new price was on ${competitorName}'s fee schedule on ${change.changed_at}, ` +
    "verified, and held for a 12-hour second look before this alert.";
  return {
    bankId: input.bankId,
    bankName: input.bankName,
    competitorId: input.competitorId,
    competitorName,
    feeKey: change.fee_category,
    previousAmount: change.old_amount,
    newAmount: change.new_amount,
    ownAmount: input.ownAmount,
    changeId: input.changeId,
    changedAt: change.changed_at,
    scheduleUrl: change.schedule_url,
    dedupeKey: competitorAlertDedupeKey(input.bankId, input.changeId),
    title,
    body,
    baseline: input.baseline,
  };
}

/**
 * Pure: alerts for one bank from its competitors' recorded changes. Drops changes that
 * `judgeFeeChange` does not bear out and ones the bank was already shown; `held` counts the
 * ones dropped because they are a correction or an older schedule found late.
 */
export function planCompetitorAlerts(input: {
  bankId: number;
  bankName: string;
  ownFees: Record<string, number>;
  changes: CompetitorChangeRow[];
  alreadyAlerted: Set<string>;
}): { alerts: CompetitorAlert[]; notConfirmed: number; alreadyShown: number; held: HeldCounts } {
  const alerts: CompetitorAlert[] = [];
  let notConfirmed = 0;
  let alreadyShown = 0;
  const held = emptyHeld();
  for (const row of input.changes) {
    const changeId = Number(row.change_id);
    if (input.alreadyAlerted.has(competitorAlertDedupeKey(input.bankId, changeId))) {
      alreadyShown += 1;
      continue;
    }
    const verdict = judgeFeeChange(row);
    if (!verdict.change) {
      notConfirmed += 1;
      if (verdict.hold !== "not_confirmed") held[verdict.hold] += 1;
      continue;
    }
    const change = verdict.change;
    alerts.push(
      buildCompetitorAlert({
        bankId: input.bankId,
        bankName: input.bankName,
        ownAmount: input.ownFees[change.fee_category] ?? null,
        change,
        changeId,
        competitorId: Number(row.competitor_id),
        baseline: buildCompetitorBaseline(row, change),
      }),
    );
  }
  return { alerts, notConfirmed, alreadyShown, held };
}

/** Changes held because of what we knew and when, by reason (`FeeChangeHold`). */
export type HeldCounts = Record<Exclude<FeeChangeHold, "not_confirmed">, number>;

function emptyHeld(): HeldCounts {
  return { correction: 0, older_edition: 0, edition_unknown: 0 };
}

const HOLD_REASON: Record<Exclude<FeeChangeHold, "not_confirmed">, string> = {
  correction: "a corrected reading of the same schedule",
  older_edition: "an older schedule found late",
  edition_unknown: "new schedule states no edition date",
};

/** Pure: why an alert's change no longer stands under the change rule, or null when it does. */
export function recheckReason(row: CompetitorChangeRow): string | null {
  const verdict = judgeFeeChange(row);
  if (verdict.change) return null;
  return verdict.hold === "not_confirmed" ? "schedules no longer bear out the change" : HOLD_REASON[verdict.hold];
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadWorkspaceBanks(onlyInstitutionId: number | null): Promise<WorkspaceBank[]> {
  const rows = await sql<{ institution_id: number | string; user_ids: Array<number | string> }[]>`
    SELECT b.institution_id, array_agg(DISTINCT b.user_id) AS user_ids
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
     GROUP BY b.institution_id
     ORDER BY b.institution_id
  `;
  return rows.map((row) => ({
    institutionId: Number(row.institution_id),
    memberUserIds: (row.user_ids ?? []).map(Number),
  }));
}

async function loadOwnFees(institutionId: number): Promise<Record<string, number>> {
  const rows = await sql<{ fee_category: string; amount: number | string }[]>`
    SELECT c.fee_category,
           CASE WHEN c.fee_category = 'overdraft' THEN MAX(c.amount)
                ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.amount) END AS amount
      FROM published_fee_catalog c
     WHERE c.institution_id = ${institutionId}
       AND c.review_status = 'approved'
       AND c.amount IS NOT NULL AND c.amount >= 0
       AND ${sql.unsafe(statsRowFilter("c"))}
       AND c.amount_kind IS DISTINCT FROM 'percent'
     GROUP BY c.fee_category
  `;
  return Object.fromEntries(rows.map((row) => [row.fee_category, Number(row.amount)]));
}

/**
 * Recorded dollar changes with both schedules' texts: by these competitors and past their second
 * look, or (`changeIds`) the changes behind alerts already raised, to re-check them.
 */
async function loadChanges(
  filter: { competitorIds: number[]; categories: string[]; agedBefore: string } | { changeIds: number[] },
): Promise<CompetitorChangeRow[]> {
  const byIds = "changeIds" in filter ? filter.changeIds : null;
  const competitorIds = "competitorIds" in filter ? filter.competitorIds : [];
  const categories = "categories" in filter ? filter.categories : [];
  const agedBefore = "agedBefore" in filter ? filter.agedBefore : null;
  if ((byIds ?? competitorIds).length === 0) return [];
  return sql<CompetitorChangeRow[]>`
    SELECT c.id AS change_id, c.institution_id AS competitor_id,
           i.institution_name, i.state_code, i.charter_type,
           COALESCE(c.canonical_fee_key, c.fee_category) AS fee_key,
           COALESCE(c.old_amount::float8, c.previous_amount) AS old_amount,
           c.new_amount, COALESCE(c.changed_at, c.detected_at) AS changed_at,
           n.fee_published_id AS new_fee_published_id, n.fee_name, n.source_url,
           o.fee_name AS old_fee_name, o.source_url AS old_source_url,
           n.source_document_id AS new_document_id, o.source_document_id AS old_document_id,
           n.published_at AS new_read_at, o.published_at AS old_read_at,
           (SELECT t.normalized_text FROM agent_source_texts t
             WHERE t.source_document_id = o.source_document_id AND t.status = 'completed'
             ORDER BY t.id DESC LIMIT 1) AS old_document_text,
           (SELECT t.normalized_text FROM agent_source_texts t
             WHERE t.source_document_id = n.source_document_id AND t.status = 'completed'
             ORDER BY t.id DESC LIMIT 1) AS new_document_text
      FROM fee_change_records c
      JOIN institution_sources i ON i.id = c.institution_id
      JOIN LATERAL (
        SELECT fp.fee_published_id, fp.fee_name, fp.source_url, fp.published_at, fr.source_document_id
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         -- The pair publish recorded (hamilton/change-pairing.ts), not one guessed by amount.
         WHERE fp.fee_published_id = c.new_fee_published_id
           AND fp.rolled_back_at IS NULL
           AND fp.quarantined_at IS NULL
           AND fv.outlier_flags::text LIKE '%agentic_darwin_verified%'
      ) n ON TRUE
      LEFT JOIN LATERAL (
        SELECT fp.fee_name, fp.source_url, fp.published_at, fr.source_document_id
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         WHERE fp.fee_published_id = c.previous_fee_published_id
      ) o ON TRUE
     WHERE (
             (${byIds}::bigint[] IS NOT NULL AND c.id = ANY(${byIds}::bigint[]))
          OR (${byIds}::bigint[] IS NULL
              AND c.institution_id = ANY(${competitorIds}::bigint[])
              AND COALESCE(c.canonical_fee_key, c.fee_category) = ANY(${categories}::text[])
              AND c.detected_at >= ${FEE_MOVES_TRACKED_SINCE}::timestamptz
              AND c.detected_at <= ${agedBefore}::timestamptz)
           )
       -- One schedule against an older copy of itself (hamilton/change-pairing.ts).
       AND c.like_for_like IS TRUE
       AND ${sql.unsafe(consumerPriceMoveSql("c"))}
       AND c.new_amount IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_feedback f
          WHERE f.fee_published_id = n.fee_published_id AND f.kind = 'takedown_pending'
       )
     ORDER BY c.detected_at
  `;
}

/** Recorded dollar changes by these competitors that are past their second look. */
function loadAgedChanges(competitorIds: number[], categories: string[], now: Date): Promise<CompetitorChangeRow[]> {
  const agedBefore = new Date(now.getTime() - SECOND_LOOK_MIN_MINUTES * 60_000).toISOString();
  return loadChanges({ competitorIds, categories, agedBefore });
}

async function loadAlreadyAlerted(bankId: number): Promise<Set<string>> {
  const rows = await sql<{ dedupe_key: string }[]>`
    SELECT source_json ->> 'dedupe_key' AS dedupe_key
      FROM hamilton_signals
     WHERE signal_type = ${COMPETITOR_CHANGE_SIGNAL}
       AND institution_id = ${String(bankId)}
  `;
  return new Set(rows.map((row) => row.dedupe_key).filter(Boolean));
}

async function raiseAlert(alert: CompetitorAlert, memberUserIds: number[]): Promise<boolean> {
  const signalId = await recordHamiltonMonitorSignal({
    institutionId: alert.bankId,
    signalType: COMPETITOR_CHANGE_SIGNAL,
    severity: "medium",
    title: alert.title,
    body: alert.body,
    sourceJson: {
      source: "competitor_change_alerts",
      dedupe_key: alert.dedupeKey,
      competitor_institution_id: alert.competitorId,
      competitor_name: alert.competitorName,
      bank_name: cleanName(alert.bankName),
      changed_at: alert.changedAt,
      fee_change_record_id: alert.changeId,
      canonical_fee_key: alert.feeKey,
      previous_amount: alert.previousAmount,
      new_amount: alert.newAmount,
      own_amount: alert.ownAmount,
      schedule_url: alert.scheduleUrl,
      // What we knew and when (#1898): the price on file before, and what replaced it.
      baseline: {
        before: {
          amount: alert.baseline.before.amount,
          schedule_url: alert.baseline.before.scheduleUrl,
          edition: alert.baseline.before.edition,
          read_on: alert.baseline.before.readOn,
        },
        after: {
          amount: alert.baseline.after.amount,
          schedule_url: alert.baseline.after.scheduleUrl,
          edition: alert.baseline.after.edition,
          read_on: alert.baseline.after.readOn,
        },
      },
      evidence_policy: "verified-only",
      provider_call_queued: false,
    },
  });
  if (!signalId) return false;
  if (memberUserIds.length > 0) {
    await sql`
      INSERT INTO hamilton_priority_alerts (user_id, signal_id, status, created_at)
      SELECT u::text, ${signalId}::uuid, 'active', NOW()
        FROM unnest(${memberUserIds}::bigint[]) AS u
    `;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Takes back alerts whose change no longer stands: the change is no longer like for like, or
 * its new price was rolled back or is waiting on a takedown (the second look after a misread,
 * as with Jeanne D'Arc's old "through July 31" column on 8 Oct). The signal row stays, marked
 * `withdrawn_at` and `withdrawn_reason` in its source_json, so the Monitor feeds skip it; its
 * active member alerts are dismissed. Nothing is deleted.
 */
async function withdrawStaleAlerts(dryRun: boolean, institutionId: number | null): Promise<number> {
  const stale = await sql<{ id: string; reason: string }[]>`
    SELECT s.id::text AS id,
           CASE
             WHEN c.id IS NULL THEN 'change record missing'
             WHEN c.like_for_like IS NOT TRUE THEN 'change is not like for like'
             WHEN n.fee_published_id IS NULL OR n.rolled_back_at IS NOT NULL THEN 'new price rolled back'
             WHEN n.quarantined_at IS NOT NULL THEN 'new price is held'
             ELSE 'new price has a pending takedown'
           END AS reason
      FROM hamilton_signals s
      LEFT JOIN fee_change_records c ON c.id = (s.source_json ->> 'fee_change_record_id')::bigint
      LEFT JOIN published_fee_records n ON n.fee_published_id = c.new_fee_published_id
     WHERE s.signal_type = ${COMPETITOR_CHANGE_SIGNAL}
       AND NOT (s.source_json ? 'withdrawn_at')
       AND (${institutionId}::text IS NULL OR s.institution_id = ${institutionId}::text)
       AND (
         c.id IS NULL
         OR c.like_for_like IS NOT TRUE
         OR n.fee_published_id IS NULL
         OR n.rolled_back_at IS NOT NULL
         OR n.quarantined_at IS NOT NULL
         OR EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = n.fee_published_id AND pf.kind = 'takedown_pending')
       )
  `;
  // The rest still stand in the tables; re-check them against today's change rule (#1898), so an
  // alert raised before the rule, on an older schedule found late or a corrected reading, is
  // taken back too.
  const staleIds = new Set(stale.map((row) => row.id));
  const live = await sql<{ id: string; change_id: number | string | null }[]>`
    SELECT s.id::text AS id, s.source_json ->> 'fee_change_record_id' AS change_id
      FROM hamilton_signals s
     WHERE s.signal_type = ${COMPETITOR_CHANGE_SIGNAL}
       AND s.source_json -> 'withdrawn_at' IS NULL
       AND (${institutionId}::text IS NULL OR s.institution_id = ${institutionId}::text)
  `;
  const recheck = live.filter((row) => row.change_id != null && !staleIds.has(row.id));
  if (recheck.length > 0) {
    const rows = await loadChanges({ changeIds: [...new Set(recheck.map((row) => Number(row.change_id)))] });
    const reasons = new Map(rows.map((row) => [Number(row.change_id), recheckReason(row)]));
    for (const signal of recheck) {
      const reason = reasons.get(Number(signal.change_id));
      if (reason) stale.push({ id: signal.id, reason });
    }
  }
  if (dryRun || stale.length === 0) return stale.length;
  const updates = JSON.stringify(stale.map((row) => ({ id: row.id, reason: row.reason })));
  await sql`
    UPDATE hamilton_signals s
       SET source_json = s.source_json || jsonb_build_object('withdrawn_at', NOW(), 'withdrawn_reason', u.reason)
      FROM jsonb_to_recordset(${updates}::jsonb) AS u(id uuid, reason text)
     WHERE s.id = u.id
  `;
  await sql`
    UPDATE hamilton_priority_alerts
       SET status = 'dismissed'
     WHERE status = 'active'
       AND signal_id = ANY(${stale.map((row) => row.id)}::uuid[])
  `;
  return stale.length;
}

export interface CompetitorAlertsResult {
  dryRun: boolean;
  /** Institutions with an active workspace (or the one asked for). */
  banks: number;
  banksWithMarket: number;
  competitorsChecked: number;
  /** Recorded changes past their second look at those competitors. */
  agedChanges: number;
  notConfirmed: number;
  /** Of those, held as a corrected reading or an older schedule found late (#1898). */
  held: HeldCounts;
  alreadyShown: number;
  alerts: number;
  /** Member alerts written (alerts x members). */
  memberAlerts: number;
  /** Earlier alerts taken back because their change no longer stands. */
  withdrawn: number;
  previews: Array<{ bank: string; title: string; body: string }>;
}

export async function runCompetitorAlerts({
  dryRun = false,
  institutionId = null,
  now = new Date(),
}: { dryRun?: boolean; institutionId?: number | null; now?: Date } = {}): Promise<CompetitorAlertsResult> {
  const result: CompetitorAlertsResult = {
    dryRun,
    banks: 0,
    banksWithMarket: 0,
    competitorsChecked: 0,
    agedChanges: 0,
    notConfirmed: 0,
    held: emptyHeld(),
    alreadyShown: 0,
    alerts: 0,
    memberAlerts: 0,
    withdrawn: 0,
    previews: [],
  };
  let banks = await loadWorkspaceBanks(institutionId);
  // A dry run for a named institution works before it has a workspace, as a preview.
  if (dryRun && institutionId !== null && banks.length === 0) banks = [{ institutionId, memberUserIds: [] }];
  result.banks = banks.length;
  const categories = [...HEADLINE_FEE_KEYS];

  for (const bank of banks) {
    const institution = await getInstitutionById(bank.institutionId);
    if (!institution) continue;
    const market = await getLocalMarketCompetitors({
      institutionId: bank.institutionId,
      certNumber: institution.cert_number,
      city: institution.city,
      stateCode: institution.state_code,
      categories,
      limit: COMPETITOR_LIMIT,
    });
    if (!market || market.competitors.length === 0) continue;
    result.banksWithMarket += 1;
    const competitorIds = market.competitors.map((c) => c.institution_id);
    result.competitorsChecked += competitorIds.length;

    const [changes, ownFees, alreadyAlerted] = await Promise.all([
      loadAgedChanges(competitorIds, categories, now),
      loadOwnFees(bank.institutionId),
      loadAlreadyAlerted(bank.institutionId),
    ]);
    result.agedChanges += changes.length;
    const plan = planCompetitorAlerts({
      bankId: bank.institutionId,
      bankName: institution.institution_name,
      ownFees,
      changes,
      alreadyAlerted,
    });
    result.notConfirmed += plan.notConfirmed;
    for (const key of Object.keys(plan.held) as Array<keyof HeldCounts>) result.held[key] += plan.held[key];
    result.alreadyShown += plan.alreadyShown;

    for (const alert of plan.alerts) {
      if (result.previews.length < 5) result.previews.push({ bank: alert.bankName, title: alert.title, body: alert.body });
      if (dryRun) {
        result.alerts += 1;
        continue;
      }
      if (await raiseAlert(alert, bank.memberUserIds)) {
        result.alerts += 1;
        result.memberAlerts += bank.memberUserIds.length;
      }
    }
  }
  result.withdrawn = await withdrawStaleAlerts(dryRun, institutionId);
  return result;
}

export function summarizeCompetitorAlerts(result: CompetitorAlertsResult): string {
  const lead = result.dryRun ? "Dry run: " : "";
  const withdrawn = result.withdrawn > 0
    ? ` ${result.dryRun ? "Would withdraw" : "Withdrew"} ${result.withdrawn} earlier alert(s) whose change no longer stands.`
    : "";
  if (result.banks === 0) return `${lead}No institution has an active workspace, so there are no competitor alerts to raise.${withdrawn}`;
  const raised = result.dryRun ? "Would raise" : "Raised";
  const held = result.held.correction + result.held.older_edition + result.held.edition_unknown;
  const heldLine = held > 0
    ? ` (${result.held.older_edition} older schedule(s) found late, ${result.held.correction} corrected reading(s), ${result.held.edition_unknown} new schedule(s) with no edition date)`
    : "";
  return (
    `${lead}Checked ${result.competitorsChecked} local competitor(s) for ${result.banksWithMarket} of ${result.banks} institution(s); ` +
    `${result.agedChanges} recorded change(s) were past their 12-hour second look, ${result.notConfirmed} did not hold up against the schedules${heldLine}, ` +
    `${result.alreadyShown} were already shown. ${raised} ${result.alerts} alert(s).${withdrawn}`
  );
}
