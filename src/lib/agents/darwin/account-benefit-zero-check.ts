import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { accountBenefitZeroOf, type AccountBenefitKind } from "@/lib/account-benefit-zero";
import { storedLine } from "./rate-floor-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of $0 fees that are one named account's benefit, not the bank's price (#1397;
 * decision 2026-10-15, "Darwin re-checks every live fee against today's rules").
 * Knox v156 holds such a $0 for review and Darwin's verify refuses it (`account_benefit_zero`), both
 * through `accountBenefitZeroOf` in `@/lib/account-benefit-zero`; the ones read before stay live. One
 * credit union's live incoming wire fee is $0 because its rates page says "PremiumSpend Checking
 * Account owners are provided the following free services: ... free incoming domestic wire transfers".
 * The tier-perk rule (`tier-perk.ts`) reads only a tier's own document or a fee named for a tier's
 * account, so a benefit list inside a general page passed it.
 *
 * Each verify step reads every live $0 fee whose stored line is a free item ("free ...", "no fee for
 * ...", "no charge for ...", "complimentary ...", "waived ...") with up to three windows of the text
 * Knox read (the extraction note's artifact), each the 450 characters before a place the text prints
 * the line, the line, and the 60 characters after it. `accountBenefitZeroOf` decides (a "waived ..."
 * line passes the SQL but is never a free item to it). An institution-scoped run reads that
 * institution's only. Switched on (`DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE=true`), a match goes through the
 * shared 12-hour second look (check `darwin.account_benefit_zero`) and is archived on its second
 * failure: rolled back with `account_benefit_zero: <kind>, <account>`, its verified row rejected with
 * the `account_benefit_zero` flag so publish does not bring it back, never deleted, and a
 * `darwin.account_benefit_zero_takedown` event lists them. In a dry run, or with the switch off (the
 * default), it only reports.
 *
 * Dry run, prod read-only, 2026-11-01 (fixture `__fixtures__/account-benefit-zero-live-2026-11-01.json`,
 * this module's own SQL): of the 3,439 live $0 fees, 142 have a free-item stored line, and 16 match at 5
 * institutions, each read against its bank's stored text and each traced by `checkFeeAgainstSource` to
 * the benefit list itself (the shared check passes them; it does not read whose benefit a line is).
 * In the core categories, 3 incoming domestic wire fees: 100941 (institution 6914, Business Basic
 * Checking's feature list), 152991 (8495, "PremiumSpend Checking Account owners are provided the
 * following free services") and 159066 (550, "As long as you have an active Relationship Rewards
 * Checking account, the following fee waivers will be offered"; the same bank prices incoming wires on
 * two live rows). The other 13: 56942, 56943, 56945 (6914), 65227 (763, Heritage Checking's features),
 * 93919, 93920 (550), 141651, 141652 (8379, Seniors' Savers Club), 152992, 152993, 152995, 152996,
 * 152997 (8495): mobile deposit, bill pay, notary, money order, cashier's check and non-network ATM.
 */
export const ACCOUNT_BENEFIT_ZERO_CHECK = "darwin.account_benefit_zero";
export const ACCOUNT_BENEFIT_ZERO_CHECK_VERSION = 1;
export const ACCOUNT_BENEFIT_ZERO_REASON = "account_benefit_zero";
export const ACCOUNT_BENEFIT_ZERO_FLAG = "account_benefit_zero";
export const ACCOUNT_BENEFIT_ZERO_LIMIT = 1_000;
export const ACCOUNT_BENEFIT_ZERO_SAMPLES = 20;

/** The switch, read from the environment: on only for "true"; off (report only) by default. */
export function accountBenefitZeroLive(raw: string | undefined = process.env.DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE): boolean {
  return (raw ?? "").trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase() === "true";
}

export interface AccountBenefitZeroRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  canonical_fee_key: string | null;
  /** Knox's extraction note, whose excerpt is the stored line. */
  source_line: string | null;
  /** Up to three windows of the text Knox read, each ending with the line, joined by " | ". */
  document_lines: string | null;
}

export interface AccountBenefitZeroMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  canonicalFeeKey: string | null;
  kind: AccountBenefitKind;
  account: string;
  evidence: string;
  reason: string;
}

export interface AccountBenefitZeroFindings {
  checked: number;
  matched: number;
  institutions: number;
  byKind: Record<AccountBenefitKind, number>;
  samples: AccountBenefitZeroMatch[];
}

export interface AccountBenefitZeroResult extends AccountBenefitZeroFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: the matches among the rows the read selected. `accountBenefitZeroOf` decides, the test Knox applies. */
export function findAccountBenefitZeros(rows: AccountBenefitZeroRow[]): AccountBenefitZeroFindings & { matches: AccountBenefitZeroMatch[] } {
  const matches: AccountBenefitZeroMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const name = (row.fee_name ?? "").trim();
    const benefit = accountBenefitZeroOf({
      line: row.source_line ? storedLine(row.source_line) : null,
      documentText: row.document_lines,
      feeName: name,
    });
    if (!benefit) continue;
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      canonicalFeeKey: row.canonical_fee_key,
      kind: benefit.kind,
      account: benefit.account,
      evidence: benefit.evidence,
      reason: `${ACCOUNT_BENEFIT_ZERO_REASON}: ${benefit.kind}, ${benefit.account}`,
    });
  }
  return {
    checked: seen.size,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    byKind: {
      holder_grant: matches.filter((fee) => fee.kind === "holder_grant").length,
      account_waivers: matches.filter((fee) => fee.kind === "account_waivers").length,
      feature_list: matches.filter((fee) => fee.kind === "feature_list").length,
    },
    samples: matches.slice(0, ACCOUNT_BENEFIT_ZERO_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live $0 fee whose stored line is a free item, Knox's name and note for it, and up
 * to three windows of the text Knox read (the artifact its extraction note names), each the 450
 * characters before a place that text prints the line, through the line.
 */
export function accountBenefitZeroRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? ACCOUNT_BENEFIT_ZERO_LIMIT, 5_000));
  return db<AccountBenefitZeroRow[]>`
    WITH c AS (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.fee_name,
             fp.canonical_fee_key, fr.extraction_note AS source_line,
             lower(substring(fr.extraction_note FROM 'excerpt="(.*)"$')) AS le,
             (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint AS artifact_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount = 0
         AND substring(fr.extraction_note FROM 'excerpt="(.*)"$') ~* '(^|[,;:]\\s*)(free|no (fee|charge|cost)|complimentary|waived)\\y'
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
       ORDER BY fp.fee_published_id
       LIMIT ${limit}::int
    ), t AS (
      SELECT c.*, adt.normalized_text AS tx, lower(adt.normalized_text) AS lt
        FROM c LEFT JOIN agent_source_texts adt ON adt.id = c.artifact_id
    ), p1 AS (
      SELECT t.*, CASE WHEN length(le) > 0 THEN strpos(lt, le) ELSE 0 END AS a1 FROM t
    ), p2 AS (
      SELECT p1.*, CASE WHEN a1 > 0 AND strpos(substr(lt, a1 + length(le)), le) > 0
                        THEN a1 + length(le) - 1 + strpos(substr(lt, a1 + length(le)), le) ELSE 0 END AS a2 FROM p1
    ), p3 AS (
      SELECT p2.*, CASE WHEN a2 > 0 AND strpos(substr(lt, a2 + length(le)), le) > 0
                        THEN a2 + length(le) - 1 + strpos(substr(lt, a2 + length(le)), le) ELSE 0 END AS a3 FROM p2
    )
    SELECT fee_published_id, fee_verified_id, institution_id, fee_name, canonical_fee_key, source_line,
           concat_ws(' | ',
             CASE WHEN a1 > 0 THEN substr(tx, greatest(1, a1 - 450), least(a1, 451) - 1 + length(le) + 60) END,
             CASE WHEN a2 > 0 THEN substr(tx, greatest(1, a2 - 450), least(a2, 451) - 1 + length(le) + 60) END,
             CASE WHEN a3 > 0 THEN substr(tx, greatest(1, a3 - 450), least(a3, 451) - 1 + length(le) + 60) END
           ) AS document_lines
      FROM p3
     ORDER BY fee_published_id
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckAccountBenefitZeros(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<AccountBenefitZeroResult> {
  const live = options.live ?? accountBenefitZeroLive();
  const result: AccountBenefitZeroResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, matched: 0, institutions: 0, byKind: { holder_grant: 0, account_waivers: 0, feature_list: 0 },
    samples: [], flagged: 0, waiting: 0, takenDown: [],
  };

  let rows: AccountBenefitZeroRow[];
  try {
    rows = await inSavepoint(db, (scope) => accountBenefitZeroRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] account benefit zero check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findAccountBenefitZeros(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: ACCOUNT_BENEFIT_ZERO_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && result.matched > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${ACCOUNT_BENEFIT_ZERO_CHECK}, 'completed',
          ${`Read live $0 fees for one account's benefit: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(accountBenefitZeroDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] account benefit zero check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: AccountBenefitZeroMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-account-benefit-zero-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${ACCOUNT_BENEFIT_ZERO_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${ACCOUNT_BENEFIT_ZERO_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] account benefit zero takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: AccountBenefitZeroMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.account_benefit_zero_takedown', 'completed',
        ${`Archived ${archived.length} live $0 fee(s) that are one account's benefit, on their second look`},
        ${JSON.stringify({ version: ACCOUNT_BENEFIT_ZERO_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] account benefit zero takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: AccountBenefitZeroMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    canonical_fee_key: fee.canonicalFeeKey,
    kind: fee.kind,
    account: fee.account,
    evidence: fee.evidence,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function accountBenefitZeroDetail(result: AccountBenefitZeroResult) {
  return {
    check: ACCOUNT_BENEFIT_ZERO_CHECK,
    version: ACCOUNT_BENEFIT_ZERO_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    matched: result.matched,
    institutions: result.institutions,
    by_kind: result.byKind,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
