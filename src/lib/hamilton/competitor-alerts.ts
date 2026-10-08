import { sql } from "@/lib/data-store/connection";
import { getInstitutionById } from "@/lib/data-store/core";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { FEE_MOVES_TRACKED_SINCE, getLocalMarketCompetitors } from "@/lib/data-store/local-market";
import { SECOND_LOOK_MIN_MINUTES } from "@/lib/agents/hamilton/second-look";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";
import { confirmFeeChange, type RecordedChangeRow } from "@/lib/report-assemblers/monthly-pulse";

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
 *   - `confirmFeeChange`, the rule Hamilton and the Monthly Pulse share, bears it out
 *     against the two schedule copies.
 * Nothing is emailed. Each bank sees each change once (dedupe key in the signal).
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

/** Pure: the alert one bank should see for one confirmed competitor change. */
export function buildCompetitorAlert(input: {
  bankId: number;
  bankName: string;
  ownAmount: number | null;
  change: NonNullable<ReturnType<typeof confirmFeeChange>>;
  changeId: number;
  competitorId: number;
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
  };
}

/**
 * Pure: alerts for one bank from its competitors' recorded changes. Drops changes that
 * `confirmFeeChange` does not bear out and ones the bank was already shown.
 */
export function planCompetitorAlerts(input: {
  bankId: number;
  bankName: string;
  ownFees: Record<string, number>;
  changes: CompetitorChangeRow[];
  alreadyAlerted: Set<string>;
}): { alerts: CompetitorAlert[]; notConfirmed: number; alreadyShown: number } {
  const alerts: CompetitorAlert[] = [];
  let notConfirmed = 0;
  let alreadyShown = 0;
  for (const row of input.changes) {
    const changeId = Number(row.change_id);
    if (input.alreadyAlerted.has(competitorAlertDedupeKey(input.bankId, changeId))) {
      alreadyShown += 1;
      continue;
    }
    const change = confirmFeeChange(row);
    if (!change) {
      notConfirmed += 1;
      continue;
    }
    alerts.push(
      buildCompetitorAlert({
        bankId: input.bankId,
        bankName: input.bankName,
        ownAmount: input.ownFees[change.fee_category] ?? null,
        change,
        changeId,
        competitorId: Number(row.competitor_id),
      }),
    );
  }
  return { alerts, notConfirmed, alreadyShown };
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
    SELECT c.fee_category, MIN(c.amount) AS amount
      FROM published_fee_catalog c
     WHERE c.institution_id = ${institutionId}
       AND c.review_status = 'approved'
       AND c.amount IS NOT NULL
       AND c.amount_kind IS DISTINCT FROM 'percent'
     GROUP BY c.fee_category
  `;
  return Object.fromEntries(rows.map((row) => [row.fee_category, Number(row.amount)]));
}

/** Recorded dollar changes by these competitors that are past their second look. */
async function loadAgedChanges(competitorIds: number[], categories: string[], now: Date): Promise<CompetitorChangeRow[]> {
  if (competitorIds.length === 0) return [];
  const agedBefore = new Date(now.getTime() - SECOND_LOOK_MIN_MINUTES * 60_000).toISOString();
  return sql<CompetitorChangeRow[]>`
    SELECT c.id AS change_id, c.institution_id AS competitor_id,
           i.institution_name, i.state_code, i.charter_type,
           COALESCE(c.canonical_fee_key, c.fee_category) AS fee_key,
           COALESCE(c.old_amount::float8, c.previous_amount) AS old_amount,
           c.new_amount, COALESCE(c.changed_at, c.detected_at) AS changed_at,
           n.fee_published_id AS new_fee_published_id, n.fee_name, n.source_url,
           o.fee_name AS old_fee_name, o.source_url AS old_source_url,
           (SELECT t.normalized_text FROM agent_source_texts t
             WHERE t.source_document_id = o.source_document_id AND t.status = 'completed'
             ORDER BY t.id DESC LIMIT 1) AS old_document_text,
           (SELECT t.normalized_text FROM agent_source_texts t
             WHERE t.source_document_id = n.source_document_id AND t.status = 'completed'
             ORDER BY t.id DESC LIMIT 1) AS new_document_text
      FROM fee_change_records c
      JOIN institution_sources i ON i.id = c.institution_id
      JOIN LATERAL (
        SELECT fp.fee_published_id, fp.fee_name, fp.source_url, fr.source_document_id
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         -- The pair publish recorded (hamilton/change-pairing.ts), not one guessed by amount.
         WHERE fp.fee_published_id = c.new_fee_published_id
           AND fp.rolled_back_at IS NULL
           AND fv.outlier_flags::text LIKE '%agentic_darwin_verified%'
      ) n ON TRUE
      LEFT JOIN LATERAL (
        SELECT fp.fee_name, fp.source_url, fr.source_document_id
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         WHERE fp.fee_published_id = c.previous_fee_published_id
      ) o ON TRUE
     WHERE c.institution_id = ANY(${competitorIds}::bigint[])
       AND COALESCE(c.canonical_fee_key, c.fee_category) = ANY(${categories}::text[])
       AND c.detected_at >= ${FEE_MOVES_TRACKED_SINCE}::timestamptz
       AND c.detected_at <= ${agedBefore}::timestamptz
       -- One schedule against an older copy of itself (hamilton/change-pairing.ts).
       AND c.like_for_like IS TRUE
       AND c.new_amount IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_feedback f
          WHERE f.fee_published_id = n.fee_published_id AND f.kind = 'takedown_pending'
       )
     ORDER BY c.detected_at
  `;
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

export interface CompetitorAlertsResult {
  dryRun: boolean;
  /** Institutions with an active workspace (or the one asked for). */
  banks: number;
  banksWithMarket: number;
  competitorsChecked: number;
  /** Recorded changes past their second look at those competitors. */
  agedChanges: number;
  notConfirmed: number;
  alreadyShown: number;
  alerts: number;
  /** Member alerts written (alerts x members). */
  memberAlerts: number;
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
    alreadyShown: 0,
    alerts: 0,
    memberAlerts: 0,
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
  return result;
}

export function summarizeCompetitorAlerts(result: CompetitorAlertsResult): string {
  const lead = result.dryRun ? "Dry run: " : "";
  if (result.banks === 0) return `${lead}No institution has an active workspace, so there are no competitor alerts to raise.`;
  const raised = result.dryRun ? "Would raise" : "Raised";
  return (
    `${lead}Checked ${result.competitorsChecked} local competitor(s) for ${result.banksWithMarket} of ${result.banks} institution(s); ` +
    `${result.agedChanges} recorded change(s) were past their 12-hour second look, ${result.notConfirmed} did not hold up against the schedules, ` +
    `${result.alreadyShown} were already shown. ${raised} ${result.alerts} alert(s).`
  );
}
