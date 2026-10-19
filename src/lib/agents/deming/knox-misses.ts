import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { normalizeDocumentUrl } from "@/lib/agents/answer-key-score";
import { gateKeyFor, gateReads } from "@/lib/agents/knox/answer-key-gate";
import { latestFinishedStep } from "@/lib/data-store/agent-quality";
import { severityFor } from "./severity";
import { eligibleReferences, loadReferenceOrigins, referenceFeeFingerprint, readReferenceEligibility, type ReferenceEligibilitySnapshot } from "@/lib/data-store/answer-key-reference-store";
import { referenceKeyFingerprint } from "@/lib/data-store/answer-key-eligibility";

/**
 * Deming's daily replay of Knox's answer-key misses (#1099). Every hand-checked answer-key fee
 * that today's free Knox team does not read from its bank's right document, where Rosetta stored a
 * completed text of that document, becomes a labeled case in `eval_cases` (dataset `golden`,
 * label `answer_key`, check `knox.answer_key_read`). Every case is replayed each day against the
 * rules on `main`:
 *
 *   read     today's free team reads the fee (same category and price, scored as the Knox gate
 *            scores it: `gateKeyFor` / `gateReads`). A candidate that is read becomes `active`.
 *   missed   it does not. An `active` case that is missed again is a regression.
 *   no_text  the bank's right document has no completed text this run (not Knox's miss).
 *   not_scored  the gate does not score the fee (a price that varies, or an unplaced line).
 *
 * A case whose key fee is no longer confirmed is retired; if the fee is confirmed again, the case
 * reopens (a candidate when missed, active when read). Inputs are frozen at insert (the key's
 * source line, category, price, document and text hash); a replay reads the document's newest
 * completed text. The step writes only `eval_cases`; it never touches a fee row. Deterministic,
 * no model calls. Its own daily run (`/api/admin/crew/knox-misses`), so the replay's reading time
 * never holds up the scoreboard; a run that reaches its deadline leaves the rest for the next day,
 * least recently checked banks first.
 */

type SqlTag = typeof sql;

export const KNOX_MISSES_VERSION = 1;
export const KNOX_MISS_CHECK = "knox.answer_key_read";
export const KNOX_MISS_ERROR_CLASS = "missed_fee";
/** Stop starting banks this long after the step began (the route allows 300 s). */
export const KNOX_MISSES_BUDGET_MS = 200_000;
/** Regressions and examples listed in the step detail. */
const DETAIL_LIST = 25;

export type KnoxMissVerdict = "read" | "missed" | "no_text" | "not_scored";

interface KeyFeeRow {
  reference_fingerprint: string;
  reference_fee_fingerprint: string;
  reference_event_id: number;
  fee_id: number | string;
  institution_id: number | string;
  document_url: string;
  document_type: string;
  content_hash: string | null;
  canonical_key: string;
  amount: number | string | null;
  amount_kind: string;
  source_line: string | null;
}

interface DocumentRow {
  id: number | string;
  institution_id: number | string;
  document_url: string | null;
  content_hash: string | null;
}

interface TextRow {
  id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  text_hash: string | null;
  normalized_text: string | null;
}

interface CaseRow {
  case_key: string;
  status: string;
  institution_id: number | string | null;
  last_checked_at: string | null;
  input?: Record<string, unknown>;
}

export interface KeyFee {
  referenceFingerprint?: string;
  referenceFeeFingerprint?: string;
  referenceEventId?: number;
  feeId: number;
  institutionId: number;
  documentUrl: string;
  documentType: string;
  canonicalKey: string;
  amount: number | null;
  amountKind: string;
  sourceLine: string | null;
}

export interface BankText {
  textId: number;
  sourceDocumentId: number;
  textHash: string | null;
  text: string;
}

export interface FeeVerdict {
  fee: KeyFee;
  /** The gate's key for the fee (`category:cents`), or null when the gate does not score it. */
  gateKey: string | null;
  verdict: KnoxMissVerdict;
}

export interface MissCount {
  expected: number;
  missed: number;
  missRate: number | null;
}

export interface KnoxMissesResult {
  referenceExcludedBanks?: number;
  referenceExcludedFees?: number;
  referenceExcludedCases?: number;
  version: number;
  ready: boolean;
  dryRun: boolean;
  banksRead: number;
  banksLeft: number;
  banksNoText: number;
  feesScored: number;
  feesRead: number;
  feesMissed: number;
  missRate: number | null;
  byCategory: Record<string, MissCount>;
  byDocumentType: Record<string, MissCount>;
  newCases: number;
  activated: number;
  regressions: Array<{ caseKey: string; institutionId: number; fee: string }>;
  retired: number;
  /** Retired cases whose key fee was confirmed again. */
  reopened: number;
  stillMissing: number;
  /** Banks the run did not reach before its deadline; the next run starts with them. */
  banksLeftIds: number[];
}

export const caseKeyFor = (feeId: number, fingerprint?: string) => `answer_key_read:${feeId}${fingerprint ? `:reference:${fingerprint}` : ""}`;

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

/** The price the gate compares: a free fee is $0, a varying one has none. */
function keyAmount(fee: KeyFee): number | null {
  if (fee.amountKind === "free") return 0;
  if (fee.amountKind === "varies") return null;
  return fee.amount;
}

/** The bank's stored copies of the key's document: same address, or the same bytes as it (as the answer-key score picks them). Pure. */
export function rightDocumentIds(
  documentUrl: string,
  contentHash: string | null,
  documents: Array<{ id: number; url: string | null; contentHash: string | null }>,
): number[] {
  const target = normalizeDocumentUrl(documentUrl);
  const hashes = new Set<string>();
  if (contentHash) hashes.add(contentHash);
  for (const doc of documents) if (doc.contentHash && normalizeDocumentUrl(doc.url) === target) hashes.add(doc.contentHash);
  return documents
    .filter((doc) => normalizeDocumentUrl(doc.url) === target || (doc.contentHash != null && hashes.has(doc.contentHash)))
    .map((doc) => doc.id);
}

/** Each key fee of one bank against today's free reads of its text. Pure, apart from reading the text. */
export function judgeBank(fees: KeyFee[], text: BankText | null): FeeVerdict[] {
  if (!text) return fees.map((fee) => ({ fee, gateKey: null, verdict: "no_text" }));
  const reads = gateReads(text.text);
  return fees.map((fee) => {
    const gateKey = gateKeyFor({ key: fee.canonicalKey, amount: keyAmount(fee), source_line: fee.sourceLine }, text.text);
    return { fee, gateKey, verdict: gateKey == null ? "not_scored" : reads.has(gateKey) ? "read" : "missed" };
  });
}

function count(target: Record<string, { expected: number; missed: number }>, key: string, missed: boolean) {
  const bucket = (target[key] ??= { expected: 0, missed: 0 });
  bucket.expected += 1;
  if (missed) bucket.missed += 1;
}

function finish(counts: Record<string, { expected: number; missed: number }>): Record<string, MissCount> {
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, { ...value, missRate: ratio(value.missed, value.expected) }]),
  );
}

async function schemaReady(db: SqlTag): Promise<boolean> {
  const [row] = await db<Array<{ ready: boolean }>>`
    SELECT to_regclass('eval_cases') IS NOT NULL
       AND to_regclass('answer_key_fees') IS NOT NULL
       AND to_regclass('answer_key_institutions') IS NOT NULL AS ready
  `;
  return Boolean(row?.ready);
}

export async function runKnoxMisses({
  db = sql,
  runId = null,
  dryRun = false,
  now = () => Date.now(),
  budgetMs = KNOX_MISSES_BUDGET_MS,
  eligibility,
}: { db?: SqlTag; runId?: number | null; dryRun?: boolean; now?: () => number; budgetMs?: number; eligibility?: ReferenceEligibilitySnapshot } = {}): Promise<KnoxMissesResult> {
  const result: KnoxMissesResult = {
    version: KNOX_MISSES_VERSION, ready: false, dryRun, banksRead: 0, banksLeft: 0, banksNoText: 0,
    feesScored: 0, feesRead: 0, feesMissed: 0, missRate: null, byCategory: {}, byDocumentType: {},
    newCases: 0, activated: 0, regressions: [], retired: 0, reopened: 0, stillMissing: 0, banksLeftIds: [],
  };
  if (!(await schemaReady(db))) return result;
  result.ready = true;
  const started = now();

  const reference = eligibility ?? await readReferenceEligibility(db);
  const keyRows: KeyFeeRow[] = eligibleReferences(reference).flatMap(({ input: { key }, eventId }) => key.fees
    .filter((fee) => fee.canonicalKey !== "unmapped").map((fee) => ({
      fee_id: fee.id, institution_id: key.institutionId, document_url: key.documentUrl,
      document_type: key.documentType, content_hash: key.contentHash,
      canonical_key: fee.canonicalKey, amount: fee.amount, amount_kind: fee.amountKind,
      source_line: fee.sourceLine, reference_fingerprint: referenceKeyFingerprint(key),
      reference_fee_fingerprint: referenceFeeFingerprint(key, fee.id), reference_event_id: eventId!,
    })));
  // Retired cases too: a key fee confirmed again reopens its case rather than leaving it retired.
  const existing = await db<CaseRow[]>`
    SELECT case_key, status, institution_id, last_checked_at, input
      FROM eval_cases
     WHERE check_name = ${KNOX_MISS_CHECK}
  `;
  const expectedByCase = new Map(keyRows.map((row) => [caseKeyFor(Number(row.fee_id), row.reference_fingerprint), row]));
  const origins = await loadReferenceOrigins(db, existing.map((row) => Number(row.input?.reference_event_id)));
  const trustedExisting = existing.filter((row) => {
    const fee = expectedByCase.get(row.case_key), input = row.input;
    const origin = origins.get(Number(input?.reference_event_id));
    return fee && input && origin && input.kind === "knox_answer_key_read" && input.reference_protocol === reference.protocol
      && input.reference_key_fingerprint === fee.reference_fingerprint
      && input.reference_fee_fingerprint === fee.reference_fee_fingerprint
      && origin.keyFingerprint === fee.reference_fingerprint && origin.institutionId === Number(fee.institution_id)
      && input.answer_key_fee_id === Number(fee.fee_id) && Number(row.institution_id) === Number(fee.institution_id)
      && input.institution_id === Number(fee.institution_id) && input.document_url === fee.document_url
      && input.document_type === fee.document_type && input.canonical_key === fee.canonical_key
      && input.amount === (fee.amount == null ? null : Number(fee.amount)) && input.amount_kind === fee.amount_kind
      && input.source_line === fee.source_line;
  });
  const caseByKey = new Map(trustedExisting.map((row) => [row.case_key, row]));
  result.referenceExcludedBanks = reference.cohort.excludedBanks;
  result.referenceExcludedFees = reference.cohort.excludedFees;
  result.referenceExcludedCases = existing.length - trustedExisting.length;
  const previous = await inSavepoint(db, (scope) => latestFinishedStep(scope, "deming-knox-misses")).catch(() => null);

  const banks = new Map<number, { url: string; type: string; hash: string | null; fees: KeyFee[] }>();
  for (const row of keyRows) {
    const institutionId = Number(row.institution_id);
    const bank = banks.get(institutionId) ?? { url: row.document_url, type: row.document_type, hash: row.content_hash, fees: [] };
    bank.fees.push({
      feeId: Number(row.fee_id),
      referenceFingerprint: row.reference_fingerprint,
      referenceFeeFingerprint: row.reference_fee_fingerprint, referenceEventId: row.reference_event_id,
      institutionId,
      documentUrl: row.document_url,
      documentType: row.document_type,
      canonicalKey: row.canonical_key,
      amount: row.amount == null ? null : Number(row.amount),
      amountKind: row.amount_kind,
      sourceLine: row.source_line,
    });
    banks.set(institutionId, bank);
  }

  // Retire cases whose key fee is no longer confirmed.
  const confirmedFeeIds = new Set(reference.keys.flatMap((row) => row.input.key.fees
    .filter((fee) => fee.canonicalKey !== "unmapped").map((fee) => fee.id)));
  const toRetire = reference.readError ? [] : existing.filter((row) => {
    const match = /^answer_key_read:([0-9]+)(?::reference:[a-f0-9]{64})?$/.exec(row.case_key);
    return row.status !== "retired" && match && !confirmedFeeIds.has(Number(match[1]));
  }).map((row) => row.case_key);
  const order = rotationOrder([...banks.keys()], trustedExisting, previous);

  const ids = order;
  const documents = ids.length === 0 ? [] : await db<DocumentRow[]>`
    SELECT id, institution_id, document_url, content_hash
      FROM source_documents
     WHERE institution_id = ANY(${ids}::bigint[]) AND status <> 'failed'
  `;
  const docsByBank = new Map<number, Array<{ id: number; url: string | null; contentHash: string | null }>>();
  for (const row of documents) {
    const list = docsByBank.get(Number(row.institution_id)) ?? [];
    list.push({ id: Number(row.id), url: row.document_url, contentHash: row.content_hash });
    docsByBank.set(Number(row.institution_id), list);
  }

  const byCategory: Record<string, { expected: number; missed: number }> = {};
  const byType: Record<string, { expected: number; missed: number }> = {};
  const newCases: Array<Record<string, unknown>> = [];
  const replays: Array<{ case_key: string; verdict: KnoxMissVerdict }> = [];

  for (const institutionId of order) {
    if (now() - started > budgetMs) {
      result.banksLeft += 1;
      result.banksLeftIds.push(institutionId);
      continue;
    }
    const bank = banks.get(institutionId)!;
    const right = rightDocumentIds(bank.url, bank.hash, (docsByBank.get(institutionId) ?? []).filter((doc) => doc.contentHash === bank.hash));
    // The newest completed text of the key's document.
    const [row] = right.length === 0 ? [] : await db<TextRow[]>`
      SELECT id, institution_id, source_document_id, text_hash, normalized_text
        FROM agent_source_texts
       WHERE source_document_id = ANY(${right}::bigint[])
         AND status = 'completed' AND COALESCE(normalized_text, '') <> ''
       ORDER BY updated_at DESC, id DESC
       LIMIT 1
    `;
    const text: BankText | null = row
      ? { textId: Number(row.id), sourceDocumentId: Number(row.source_document_id), textHash: row.text_hash, text: row.normalized_text ?? "" }
      : null;
    if (!text) result.banksNoText += 1;
    else result.banksRead += 1;
    for (const { fee, gateKey, verdict } of judgeBank(bank.fees, text)) {
      const key = caseKeyFor(fee.feeId, fee.referenceFingerprint);
      const prior = caseByKey.get(key);
      if (verdict === "not_scored") {
        // Still replayed, so its check time moves and its bank does not sort first for ever.
        if (prior && prior.status !== "retired") replays.push({ case_key: key, verdict });
        continue;
      }
      if (verdict !== "no_text") {
        result.feesScored += 1;
        const missed = verdict === "missed";
        if (missed) result.feesMissed += 1;
        else result.feesRead += 1;
        count(byCategory, fee.canonicalKey, missed);
        count(byType, fee.documentType, missed);
        if (missed && prior?.status === "retired") result.reopened += 1;
        if (missed && !prior) {
          newCases.push({
            case_key: key,
            institution_id: fee.institutionId,
            source_document_id: text!.sourceDocumentId,
            source_url: fee.documentUrl,
            source_text_hash: text!.textHash,
            input: {
              kind: "knox_answer_key_read",
              answer_key_fee_id: fee.feeId,
              reference_key_fingerprint: fee.referenceFingerprint,
              reference_fee_fingerprint: fee.referenceFeeFingerprint,
              reference_protocol: reference.protocol, reference_event_id: fee.referenceEventId,
              institution_id: fee.institutionId,
              document_url: fee.documentUrl,
              document_type: fee.documentType,
              source_document_id: text!.sourceDocumentId,
              text_id: text!.textId,
              text_hash: text!.textHash,
              canonical_key: fee.canonicalKey,
              amount: fee.amount,
              amount_kind: fee.amountKind,
              source_line: fee.sourceLine,
            },
            expected: { read: true, gate_key: gateKey },
          });
        }
      }
      if (prior && prior.status === "retired" && verdict === "read") result.reopened += 1;
      if (prior) {
        replays.push({ case_key: key, verdict });
        if (prior.status === "candidate" && verdict === "read") result.activated += 1;
        if (prior.status === "active" && verdict === "missed" && result.regressions.length < DETAIL_LIST) {
          result.regressions.push({ caseKey: key, institutionId: fee.institutionId, fee: `${fee.canonicalKey} ${fee.amount ?? fee.amountKind}` });
        }
        if (prior.status === "candidate" && verdict !== "read") result.stillMissing += 1;
      }
    }
  }
  result.missRate = ratio(result.feesMissed, result.feesScored);
  result.byCategory = finish(byCategory);
  result.byDocumentType = finish(byType);
  result.newCases = newCases.length;
  result.retired = toRetire.length;
  if (dryRun) return result;

  const severity = severityFor(KNOX_MISS_CHECK, KNOX_MISS_ERROR_CLASS);
  if (newCases.length > 0) {
    const inserted = await inSavepoint(db, (scope) => scope<{ id: number }[]>`
      INSERT INTO eval_cases (
        case_key, dataset, status, agent, check_name, error_class, severity, institution_id,
        source_document_id, source_url, source_text_hash, input, expected, label_provenance, agent_run_id,
        last_checked_at, last_caught, last_verdict, last_run_id
      )
      SELECT case_key, 'golden', 'candidate', 'knox', ${KNOX_MISS_CHECK}, ${KNOX_MISS_ERROR_CLASS}, ${severity},
             institution_id, source_document_id, source_url, source_text_hash, input, expected, 'answer_key', ${runId},
             NOW(), FALSE, 'missed', ${runId}
        FROM jsonb_to_recordset(${JSON.stringify(newCases)}::jsonb) AS c(
          case_key text, institution_id bigint, source_document_id bigint, source_url text,
          source_text_hash text, input jsonb, expected jsonb
        )
      ON CONFLICT (case_key) DO NOTHING
      RETURNING id
    `);
    result.newCases = inserted.length;
  }
  if (replays.length > 0) {
    await inSavepoint(db, (scope) => scope`
      UPDATE eval_cases e
         SET last_checked_at = NOW(),
             last_caught = CASE r.verdict WHEN 'read' THEN TRUE WHEN 'missed' THEN FALSE ELSE NULL END,
             last_verdict = r.verdict,
             last_run_id = ${runId},
             -- A candidate read becomes active; a retired case whose key fee is confirmed again reopens.
             status = CASE
               WHEN e.status = 'candidate' AND r.verdict = 'read' THEN 'active'
               WHEN e.status = 'retired' AND r.verdict = 'read' THEN 'active'
               WHEN e.status = 'retired' AND r.verdict = 'missed' THEN 'candidate'
               ELSE e.status
             END,
             updated_at = NOW()
        FROM jsonb_to_recordset(${JSON.stringify(replays)}::jsonb) AS r(case_key text, verdict text)
       WHERE e.case_key = r.case_key AND e.check_name = ${KNOX_MISS_CHECK}
    `);
  }
  if (toRetire.length > 0) {
    await inSavepoint(db, (scope) => scope`
      UPDATE eval_cases
         SET status = 'retired', last_verdict = 'key_fee_removed', updated_at = NOW()
       WHERE case_key = ANY(${toRetire}::text[]) AND check_name = ${KNOX_MISS_CHECK}
    `);
  }
  return result;
}

/**
 * The order the run reads banks in, so a run that hits its deadline rotates: banks the previous
 * run did not reach come first, then the rest by their oldest case check. A bank with no case
 * (Knox read every key fee) counts as checked when the previous run finished, not as never
 * checked, so it does not always go first. Pure.
 */
export function rotationOrder(
  bankIds: number[],
  cases: Array<Pick<CaseRow, "institution_id" | "last_checked_at" | "status">>,
  previous: { at: string; detail?: Record<string, unknown> | null } | null,
): number[] {
  const lastRun = previous?.at ? Date.parse(previous.at) : 0;
  const left = new Set(
    Array.isArray(previous?.detail?.banks_left_ids) ? (previous!.detail!.banks_left_ids as unknown[]).map(Number) : [],
  );
  const checked = new Map<number, number>();
  for (const row of cases) {
    if (row.status === "retired") continue;
    const id = Number(row.institution_id);
    const at = row.last_checked_at ? Date.parse(row.last_checked_at) : 0;
    checked.set(id, Math.min(checked.get(id) ?? Number.POSITIVE_INFINITY, at));
  }
  const when = (id: number) => (left.has(id) ? Number.NEGATIVE_INFINITY : checked.get(id) ?? lastRun);
  return [...bankIds].sort((a, b) => when(a) - when(b) || a - b);
}

function percent(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function summarizeKnoxMisses(result: KnoxMissesResult): string {
  if (!result.ready) return "Deming could not replay Knox's answer-key misses: the case store or the answer key is not there.";
  const top = Object.entries(result.byCategory)
    .filter(([, value]) => value.missed > 0)
    .sort(([a, x], [b, y]) => y.missed - x.missed || a.localeCompare(b))
    .slice(0, 3)
    .map(([key, value]) => `${key} ${value.missed}/${value.expected}`)
    .join(", ");
  const regressions = result.regressions.length === 0 ? "no regressions" : `${result.regressions.length} REGRESSION${result.regressions.length === 1 ? "" : "S"}`;
  const left = result.banksLeft > 0 ? ` ${result.banksLeft} banks left for tomorrow.` : "";
  const excluded = ` ${result.referenceExcludedBanks ?? 0} reference banks and ${result.referenceExcludedCases ?? 0} unbound or incompatible historical cases excluded.`;
  return `Deming replayed the answer key against today's Knox on ${result.banksRead} banks: ${result.feesMissed} of ${result.feesScored} key fees missed (${percent(result.missRate)})${top ? `, most in ${top}` : ""}. ${result.newCases} new missed-fee cases, ${result.activated} now read, ${regressions}${result.retired ? `, ${result.retired} retired` : ""}.${left}${excluded}`;
}

export function knoxMissesDetail(result: KnoxMissesResult) {
  return {
    version: result.version,
    reference_excluded_banks: result.referenceExcludedBanks ?? 0,
    reference_excluded_fees: result.referenceExcludedFees ?? 0,
    reference_excluded_cases: result.referenceExcludedCases ?? 0,
    ready: result.ready,
    dry_run: result.dryRun,
    banks_read: result.banksRead,
    banks_left: result.banksLeft,
    banks_no_text: result.banksNoText,
    fees_scored: result.feesScored,
    fees_read: result.feesRead,
    fees_missed: result.feesMissed,
    miss_rate: result.missRate,
    by_category: result.byCategory,
    by_document_type: result.byDocumentType,
    new_cases: result.newCases,
    activated: result.activated,
    still_missing: result.stillMissing,
    regressions: result.regressions,
    retired: result.retired,
    reopened: result.reopened,
    banks_left_ids: result.banksLeftIds,
  };
}
