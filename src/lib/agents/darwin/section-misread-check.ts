import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { classifyFeeText, returnedItemServiceName, waiverAdviceName, waiverAdvicePrefix, wireServiceSubscription } from "@/lib/agents/knox/rules";
import { accountlessMonthlyExcerpt } from "@/lib/agents/knox/accountless-monthly";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { frontMatterName } from "@/lib/agents/knox/specialists";
import { iraSectionClosingFee } from "@/lib/custom-report/ira-section-fee";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees Knox v177 no longer reads as they are live (Knox re-read backlog dry run 8,
 * Nov 3; decision 2026-10-15, "Darwin re-checks every live fee against today's rules"). Each was named or filed
 * by words from another part of the page than the fee's own row. Knox v177 reads new ones right; the ones read
 * before stay live:
 *
 * - `waiver_column_name`: a name that is a waiver column's advice ("Use Online BillPay, HonorPay or
 *   Account-To-Account Transfers"), alone or composed with the next column's item, live under another category
 *   than its own words file (`waiverAdviceName`, `waiverAdvicePrefix`). Honor FCU's "Use Online BillPay, HonorPay
 *   or Account-To-Account Transfers: Verification of Deposits" $25 is live as bill_pay (77750).
 * - `front_matter_name`: a name read from a page's front matter ("meta-fb:pages: meta-generator: WordPress
 *   7.1.4 ...", `frontMatterName`), Citizens Bank's 167014 and 101378.
 * - `wire_subscription`: a wire service's monthly module or package filed as a wire's price
 *   (`wireServiceSubscription`): "International Wire Module | $20.00 | Per Month" (152355), "Premium Package (per
 *   month) (includes ACH & Domestic Wire access)" (85500).
 * - `ira_section_closing`: an early closure fee printed only in an IRA's own section, the IRA's closing fee
 *   (`iraSectionClosingFee`, read on the text Knox read): Progressions CU's "INDIVIDUAL RETIREMENT ACCOUNT (IRA)
 *   FEES" / "Account Closure Fee $25.00" (94053).
 *
 * Version 2 (Knox v178, re-read backlog dry run 9, Nov 3) adds two rules Knox v178 holds new reads by:
 *
 * - `returned_item_service`: an NSF fee whose name is a returned item's handling service, which no type holds
 *   (`returnedItemServiceName`: special handling, a re-clear, a reroute, or a service fee priced per month, in a
 *   name that does not say NSF): "Returned Item Special Handling Item" $10 (21594).
 * - `accountless_monthly_sentence`: a monthly maintenance fee whose stored line is a reward bullet ("Waived $10
 *   monthly maintenance fee", 117986) or a "Your $12 monthly maintenance fee ..." sentence
 *   (`accountlessMonthlyExcerpt`, on Knox's stored `excerpt="..."`).
 *
 * Each verify step reads the live flat fees each rule could match (`sectionMisreadRowsSql`: the name pre-filters,
 * and for the IRA rule a text that names an IRA). An admin-corrected fee is never read; an IRA candidate whose
 * text is gone is not judged. An institution-scoped run reads that institution's only. Switched on
 * (`SECTION_MISREAD_TAKEDOWN_LIVE`), a match goes through the shared 12-hour second look (check
 * `darwin.section_misread`) and is archived on its second failure: rolled back with its reason, its verified row
 * rejected with the reason's flag so publish does not bring it back, never deleted, and a
 * `darwin.section_misread_takedown` event lists them. The fee is not re-filed in place: the bank's next read
 * files the row by Knox v177. In a dry run, or with the switch off (the default), it only reports.
 *
 * Dry run, prod read-only, 2026-11-03: see docs/project/findings/2026-11-03-knox-backlog-dry-run-8-misreads.md.
 */
export const SECTION_MISREAD_CHECK = "darwin.section_misread";
export const SECTION_MISREAD_CHECK_VERSION = 2;
/** The switch: off, the step only reports; on, matches come down after the second look. */
export const SECTION_MISREAD_TAKEDOWN_LIVE = false;
export const WAIVER_COLUMN_NAME_REASON = "waiver_column_name";
export const FRONT_MATTER_NAME_REASON = "front_matter_name";
export const WIRE_SUBSCRIPTION_REASON = "wire_subscription";
export const IRA_SECTION_CLOSING_REASON = "ira_section_closing";
export const RETURNED_ITEM_SERVICE_REASON = "returned_item_service";
export const ACCOUNTLESS_MONTHLY_REASON = "accountless_monthly_sentence";
export const SECTION_MISREAD_REASONS = [WAIVER_COLUMN_NAME_REASON, FRONT_MATTER_NAME_REASON, WIRE_SUBSCRIPTION_REASON, IRA_SECTION_CLOSING_REASON, RETURNED_ITEM_SERVICE_REASON, ACCOUNTLESS_MONTHLY_REASON] as const;
export type SectionMisreadKind = (typeof SECTION_MISREAD_REASONS)[number];
export const SECTION_MISREAD_LIMIT = 5_000;
export const SECTION_MISREAD_SAMPLES = 20;
export const SECTION_MISREAD_MAX_ROWS = 10_000;
const TEXT_CHUNK = 50;

/** Postgres pre-filters, each a superset of its Knox rule. */
export const WAIVER_ADVICE_NAME_SQL = String.raw`^\W*(use|enroll\s+in|sign\s+up\s+for|switch\s+to|maintain|keep)\s`;
export const FRONT_MATTER_NAME_SQL = String.raw`^\s*(meta-[a-z0-9_.:-]*|canonical)\s*:`;
export const WIRE_SUBSCRIPTION_NAME_SQL = String.raw`(module|package|subscription)`;
export const IRA_TEXT_SQL = String.raw`(\mIRAs?\M|individual\s+retirement|retirement\s+(account|plan|savings))`;
export const RETURNED_ITEM_SERVICE_NAME_SQL = String.raw`(special\s+handling|re-?clear|re-?rout|service\s+(fee|charge))`;
export const ACCOUNTLESS_MONTHLY_LINE_SQL = String.raw`excerpt="?\W*(waived|no|free|your)\s+\$`;

export interface SectionMisreadRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  /** The artifact Knox's note names: the text Knox read. */
  artifact_id: number | string | null;
  /** The live fee's frequency (version 2's returned item service rule). */
  frequency?: string | null;
  /** Knox's note, with the stored `excerpt="..."` (version 2's monthly sentence rule). */
  source_line?: string | null;
}

export interface SectionMisreadMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  kind: SectionMisreadKind;
  reason: string;
}

export interface SectionMisreadFindings {
  checked: number;
  /** IRA candidates whose text is gone: not judged. */
  noText: number;
  matched: number;
  byKind: Record<SectionMisreadKind, number>;
  institutions: number;
  samples: SectionMisreadMatch[];
}

export interface SectionMisreadResult extends SectionMisreadFindings {
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

function emptyKinds(): Record<SectionMisreadKind, number> {
  return { waiver_column_name: 0, front_matter_name: 0, wire_subscription: 0, ira_section_closing: 0, returned_item_service: 0, accountless_monthly_sentence: 0 };
}

/** The name's last words, two or more, file under `key` on their own: the item after the advice is the live fee's. */
function tailFilesUnder(name: string, key: string | null): boolean {
  if (!key) return false;
  const words = name.trim().split(/\s+/);
  for (let at = words.length - 2; at >= 1; at -= 1) {
    if (classifyFeeText(words.slice(at).join(" ")) === key) return true;
  }
  return false;
}

/** Pure: the rule a live fee's name and key match, without its text. */
export function nameMisreadKind(name: string, key: string | null, frequency?: string | null): { kind: SectionMisreadKind; evidence: string } | null {
  if (frontMatterName(name)) return { kind: FRONT_MATTER_NAME_REASON, evidence: name.slice(0, 60) };
  // A name composed from the advice and the next column's item ("...: Verification of Deposits") is judged by
  // the item's own words; any other advice name by its whole words. A name that still files under the live
  // category ("Use Online BillPay, HonorPay or Account-To-Account Transfers Verification of Deposits" live as
  // account_verification, 18786) names the right fee in a long name: it stays.
  const prefixed = waiverAdvicePrefix(name);
  if (prefixed) {
    const own = classifyFeeText(prefixed.item);
    if (own !== key) return { kind: WAIVER_COLUMN_NAME_REASON, evidence: `${prefixed.item.slice(0, 60)} is ${own ?? "no type"}, not ${key ?? "none"}` };
  } else if (waiverAdviceName(name) && !tailFilesUnder(name, key)) {
    const own = classifyFeeText(name);
    if (own !== key) return { kind: WAIVER_COLUMN_NAME_REASON, evidence: `${name.slice(0, 60)} is ${own ?? "no type"}, not ${key ?? "none"}` };
  }
  if (key?.startsWith("wire_") && wireServiceSubscription(name)) return { kind: WIRE_SUBSCRIPTION_REASON, evidence: name.slice(0, 80) };
  if (key === "nsf" && returnedItemServiceName(name, frequency)) return { kind: RETURNED_ITEM_SERVICE_REASON, evidence: name.slice(0, 80) };
  return null;
}

/** Pure: the matches among the rows the read selected, the IRA rule on each row's own text (by artifact id). */
export function findSectionMisreads(
  rows: readonly SectionMisreadRow[],
  texts: ReadonlyMap<number, string>,
): SectionMisreadFindings & { matches: SectionMisreadMatch[] } {
  const matches: SectionMisreadMatch[] = [];
  const seen = new Set<number>();
  let noText = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const amount = num(row.amount);
    if (amount == null || amount < 0) continue;
    const name = (row.fee_name ?? "").trim();
    const base = {
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      amount,
      canonicalFeeKey: row.canonical_fee_key,
    };
    const named = nameMisreadKind(name, row.canonical_fee_key, row.frequency);
    if (named) {
      matches.push({ ...base, kind: named.kind, reason: `${named.kind}: "${named.evidence}"` });
      continue;
    }
    if (row.canonical_fee_key === "monthly_maintenance") {
      const line = excerptOf(row.source_line);
      if (accountlessMonthlyExcerpt(line)) matches.push({ ...base, kind: ACCOUNTLESS_MONTHLY_REASON, reason: `${ACCOUNTLESS_MONTHLY_REASON}: "${(line ?? "").slice(0, 80)}"` });
      continue;
    }
    if (row.canonical_fee_key !== "early_closure") continue;
    const artifactId = num(row.artifact_id);
    const text = artifactId == null ? undefined : texts.get(artifactId);
    if (!text) {
      noText += 1;
      continue;
    }
    if (!iraSectionClosingFee(text, name, amount, row.canonical_fee_key)) continue;
    matches.push({ ...base, kind: IRA_SECTION_CLOSING_REASON, reason: `${IRA_SECTION_CLOSING_REASON}: "${name.slice(0, 80)}" #${artifactId}` });
  }
  const byKind = emptyKinds();
  for (const match of matches) byKind[match.kind] += 1;
  return {
    checked: seen.size,
    noText,
    matched: matches.length,
    byKind,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, SECTION_MISREAD_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live flat fee whose name a rule above could match, and every live flat early closure fee
 * whose text names an IRA, with the artifact Knox read.
 */
export function sectionMisreadRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const ids = options.institutionId != null ? [options.institutionId] : null;
  const scoped = ids != null;
  const limit = Math.max(1, Math.min(options.limit ?? SECTION_MISREAD_LIMIT, SECTION_MISREAD_MAX_ROWS));
  return db<SectionMisreadRow[]>`
    WITH live AS (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fp.frequency, fr.extraction_note AS source_line,
             (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint AS artifact_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.amount >= 0
         -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
         AND (${!scoped} OR fp.institution_id = ANY(${ids ?? [0]}::bigint[]))
    ),
    named AS (
      SELECT * FROM live
       WHERE live.fee_name ~* ${WAIVER_ADVICE_NAME_SQL}
          OR live.fee_name ~* ${FRONT_MATTER_NAME_SQL}
          OR (live.canonical_fee_key LIKE 'wire\_%' AND live.fee_name ~* ${WIRE_SUBSCRIPTION_NAME_SQL})
          OR (live.canonical_fee_key = 'nsf' AND live.fee_name ~* ${RETURNED_ITEM_SERVICE_NAME_SQL})
          OR (live.canonical_fee_key = 'monthly_maintenance' AND live.source_line ~* ${ACCOUNTLESS_MONTHLY_LINE_SQL})
    ),
    closing AS (
      SELECT live.* FROM live
        JOIN agent_source_texts a ON a.id = live.artifact_id
       WHERE live.canonical_fee_key = 'early_closure'
         AND a.normalized_text ~* ${IRA_TEXT_SQL}
    )
    SELECT * FROM named
    UNION
    SELECT * FROM closing
     ORDER BY fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Read-only: the texts Knox read, by artifact id. */
export async function sectionMisreadTexts(db: SqlTag, artifactIds: readonly number[]): Promise<Map<number, string>> {
  const texts = new Map<number, string>();
  const ids = [...new Set(artifactIds)];
  for (let start = 0; start < ids.length; start += TEXT_CHUNK) {
    const chunk = ids.slice(start, start + TEXT_CHUNK);
    const rows = await db<{ id: number | string; normalized_text: string | null }[]>`
      SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${chunk}::bigint[]) AND normalized_text IS NOT NULL
    `;
    for (const row of rows) if (row.normalized_text) texts.set(Number(row.id), row.normalized_text);
  }
  return texts;
}

function emptyResult(live: boolean, dryRun: boolean, scoped: boolean): SectionMisreadResult {
  return { live, dryRun, scoped, checked: 0, noText: 0, matched: 0, byKind: emptyKinds(), institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [] };
}

/** One step's re-check (see the module note). Never throws: a failed read reports nothing, and a failed write leaves the fees as they were. */
export async function recheckSectionMisreads(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<SectionMisreadResult> {
  const live = options.live ?? SECTION_MISREAD_TAKEDOWN_LIVE;
  const result = emptyResult(live, options.dryRun, options.institutionId != null);

  let rows: SectionMisreadRow[];
  let texts: Map<number, string>;
  try {
    rows = await inSavepoint(db, (scope) => sectionMisreadRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
    const artifactIds = rows
      .filter((row) => row.canonical_fee_key === "early_closure" && !nameMisreadKind((row.fee_name ?? "").trim(), row.canonical_fee_key, row.frequency))
      .map((row) => num(row.artifact_id))
      .filter((id): id is number => id != null);
    texts = await inSavepoint(db, (scope) => sectionMisreadTexts(scope, artifactIds));
  } catch (error) {
    console.warn("[darwin] section misread check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findSectionMisreads(rows, texts);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: SECTION_MISREAD_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${SECTION_MISREAD_CHECK}, 'completed',
          ${`Read live fees named or filed by another part of the page or a held read's words: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s) (${SECTION_MISREAD_REASONS.map((kind) => `${result.byKind[kind]} ${kind}`).join(", ")}); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(sectionMisreadDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] section misread check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the reason's flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: SectionMisreadMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-section-misread-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      for (const kind of SECTION_MISREAD_REASONS) {
        const verified = fees.filter((fee) => fee.kind === kind && ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
        if (verified.length === 0) continue;
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${kind} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${kind}::text)
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
    console.error("[darwin] section misread takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: SectionMisreadMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.section_misread_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) named or filed by another part of the page, on their second look`},
        ${JSON.stringify({ version: SECTION_MISREAD_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] section misread takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: SectionMisreadMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    kind: fee.kind,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function sectionMisreadDetail(result: SectionMisreadResult) {
  return {
    check: SECTION_MISREAD_CHECK,
    version: SECTION_MISREAD_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    no_text: result.noText,
    matched: result.matched,
    by_kind: result.byKind,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
