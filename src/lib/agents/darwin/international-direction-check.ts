import { createHash } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { wireScopeFacts, type InternationalDirectionReview, type OwnWireScope } from "@/lib/custom-report/own-wire-scope";
import { internationalDirectionOutcome } from "./international-verification";
import type { LockedSourceSnapshot, SourceArtifactSnapshot, SourceDocumentSnapshot } from "./locked-raw-source";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of international wire fees against the direction review (#1912; decision
 * 2026-10-15, "Darwin re-checks every live fee against today's rules"). Since the review landed, a new
 * row filed as an international wire is verified only when its own line in the bank's text says it is
 * international and names the direction its category claims (`internationalVerificationDecision`,
 * `international-verification.ts`, over `sourceOwnedWireScope` and `reviewInternationalDirection`,
 * `custom-report/own-wire-scope.ts`). The live recheck (`verified-recheck.ts`) never ran that review, so
 * fees published before it stay live with a direction nothing in their source states: Amarillo
 * National Bank's 118154, an international wire with no direction on its line, is live as
 * wire_intl_outgoing.
 *
 * Each verify step reads the next batch of live wire fees (after a cursor on the run ledger, by
 * published id): every live `wire_intl_*` fee, and every other live `wire_*` fee whose name says
 * international, with the stored text Knox read it from. `internationalDirectionOutcome` (the same
 * function verify calls) decides each one, against the very text the fee was read from (the text named
 * in Knox's extraction note, with the same hash). A fee whose text has changed since, or was never
 * stored, is counted and left as it is: Knox's next read of the page decides it. A fee under Knox's
 * private international-wire eligibility hold is counted and left as it is.
 *
 * A fee the review would hold at verify (`hold`: its own line found once in the text, and that line
 * states no geography or direction, or another one, or an international line filed as domestic) is a
 * match. A fee the review declines (its own line not found exactly once: a name Knox joined to a
 * heading the scope does not reach, a price cell holding several wires, the same table printed twice)
 * is counted as `unproven` and stays live: verify holds such a new row because it cannot prove the
 * direction, but the line it would read is not in hand, so it is no evidence against a live fee (the
 * Oct 27 dry run found such fees right, e.g. "Wire Transfers: Outgoing (International)" under a
 * "Wire Transfers" heading two lines up). Switched on, a match goes through the shared 12-hour second look (check
 * `darwin.international_direction`) and is archived on its second failure: rolled back with
 * `international_direction: <reason>`, its verified row rejected with the `international_direction`
 * flag so publish does not bring it back, never deleted, and a `darwin.international_direction_takedown`
 * event lists them. A takedown never re-files a fee; each match records the category its own line
 * shows when the line names one (`sourceCategory`), for Knox's re-read and the reviewer. A fee that
 * passes clears its pending flag. In a dry run, or with the switch off, the step only reports.
 *
 * v2 (2026-11-02, the switch's sample, PR #2762): a priced "International/Foreign Wire" line that
 * names no direction is the outgoing international wire when the rest of the document gives incoming
 * wires their own line or names no wire direction at all (`undirectedWireReading`): Midwest Coalition
 * of Labor CU prints "- Incoming Wire Transfers | Free" above "- International Wire Transfers |
 * $50.00". Such a fee filed `wire_intl_outgoing` stays live (`undirectedOutgoing`, counted as passing).
 * It is still a match when its own line says the bank does not offer the service ("We Do Not Allow
 * International WU or Wire Transfers": `not_offered`), when another line prices an international
 * wire as outgoing (the undirected one is then not that wire), or when the document names outgoing
 * wires but never incoming ones. Only this live re-check reads it: verify, Knox's eligibility and
 * Hamilton's publication still admit a new international wire only on its own stated direction, and a
 * hold is not a takedown.
 *
 * v3 (2026-11-02, the v2 sample: 17 of 20 still wrong): an undirected international wire filed outgoing
 * is the outgoing price on a schedule that prices only outgoing wires ("Outgoing Wire Fee | $30.00" over
 * "Foreign Wire Fee | $50.00") and beside another line pricing an international wire as outgoing (a
 * duplicate or second tier). Such a fee comes down only when its own line says the bank does not offer
 * the service (`not_offered`), its own words name the other direction (`direction_mismatch`), or the
 * document prices an incoming international wire on its own line at this fee's price (and no outgoing
 * international line at the same price). A fee filed incoming whose line names no direction is still
 * a match: the undirected line is the outgoing price.
 *
 * v4 (2026-11-02, PR #2890 review): an incoming price counts only from a wire line (an international
 * ACH, IAT or app transfer is another service), only the line's first price ("$15.00 plus
 * correspondent bank fees up to $35.00" prices the wire at $15), and an equal incoming price is
 * evidence only when the document also prices an outgoing international wire at another price (a
 * bank may charge the same both ways).
 *
 * The switch is on since 2026-11-02, sampled clean at v3 and v4 (sampled-clean rule, DECISIONS 2026-10-20).
 * Dry runs, prod read-only, 2026-10-27 and 2026-11-02: see `INTERNATIONAL_DIRECTION_DRY_RUN`.
 */
export const INTERNATIONAL_DIRECTION_CHECK = "darwin.international_direction";
export const INTERNATIONAL_DIRECTION_CHECK_VERSION = 4;
/**
 * The switch: on since 2026-11-02 (v3 sampled clean 7 of 7, v4 6 of 6: every match on prod's 2,458
 * live wire fees, PRs #2762 and #2890). On takes matches down after the second look; false only reports.
 */
export const INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE = true;
export const INTERNATIONAL_DIRECTION_REASON = "international_direction";
export const INTERNATIONAL_DIRECTION_FLAG = "international_direction";
/** Live fees read per step; a full batch continues after its last fee on the next step. */
export const INTERNATIONAL_DIRECTION_BATCH = 400;
export const INTERNATIONAL_DIRECTION_SAMPLES = 20;
/** A wire name that says international, for live wire fees filed under another wire category. */
export const INTERNATIONAL_WIRE_NAME_SQL = String.raw`\m(international|foreign|intl|int'?l|outside)\M`;

/**
 * The read-only dry run on prod, 2026-10-27 (see the PR): filled in from the measured counts. Kept
 * beside the switch so whoever turns it on reads what it takes down.
 */
export const INTERNATIONAL_DIRECTION_DRY_RUN =
  "2,423 live wire fees read (1,916 wire_intl_outgoing, 503 wire_intl_incoming, 4 other wire categories with an international name): "
  + "1,286 pass; 423 would be taken down at 407 institutions (421 wire_intl_outgoing: 418 whose own line states no direction, "
  + "3 whose line says incoming; 2 wire_intl_incoming whose line states no direction); 515 unproven and left live "
  + "(405 missing owner, 41 ambiguous owner, 69 unsupported shape); 195 left for Knox's next read (stored text changed or never "
  + "stored); 0 under Knox's eligibility hold. Amarillo 118154 is taken down (direction_missing). None re-filed. "
  + "v2, 2026-11-02, on all 2,458 live wire fees and their stored texts (read-only, every text's sha256 checked): 420 match at v1; "
  + "at v2 65 match at 63 institutions (61 direction_missing: 46 on a schedule that names outgoing wires and never incoming ones, "
  + "13 beside another line pricing an international wire as outgoing, 2 filed incoming; 3 direction_mismatch; 1 not_offered, 137423) "
  + "and 355 undirected wires filed outgoing are kept. Seeded sample (sw-2026-11-02) of the 65: 3 of 20 right, so the switch stayed off. "
  + "v3, 2026-11-02, same rows: 7 match at 7 institutions (3 direction_mismatch: 87860, 100178, 109961; 3 direction_missing: 92821 and "
  + "147524 filed incoming, 152355 priced as the incoming international wire; 1 not_offered, 137423); 413 undirected wires filed outgoing kept, "
  + "510 unproven, 199 left for Knox. Sample (sw-2026-11-02-v3): all 7, every one right, so the switch is on. "
  + "v4, 2026-11-02, same rows: 6 match at 6 institutions (the same minus 152355, kept: its document prices no outgoing "
  + "international wire, so its equal incoming price is no evidence); 414 undirected wires filed outgoing kept, 510 unproven, "
  + "199 left for Knox. All 6 were among the 7 checked right at v3.";

export interface InternationalDirectionRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  canonical_fee_key: string | null;
  published_amount: number | string | null;
  raw_institution_id: number | string | null;
  source_document_id: number | string | null;
  raw_fee_name: string | null;
  raw_amount: number | string | null;
  outlier_flags: unknown;
  extraction_note: string | null;
  conditions: string | null;
  text_id: number | string | null;
  text_institution_id: number | string | null;
  text_status: string | null;
  text_hash: string | null;
  normalized_text: string | null;
  source_url: string | null;
}

export type InternationalDirectionMatchReason =
  | "geography_missing" | "geography_mismatch" | "direction_missing" | "direction_mismatch" | "category_mismatch" | "not_offered";
export type InternationalDirectionUnprovenReason = "missing_owner" | "ambiguous_owner" | "unsupported_shape";

export interface InternationalDirectionMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string;
  sourceDocumentId: number | null;
  match: InternationalDirectionMatchReason;
  /** The category the fee's own line shows, when it names one geography and one direction; never written. */
  sourceCategory: string | null;
  sourceLine: string | null;
  reason: string;
}

export interface InternationalDirectionFindings {
  checked: number;
  passed: number;
  matched: number;
  institutions: number;
  /** The fee's stored text is gone or was re-read since: Knox's next read decides it. */
  textChanged: number;
  /** Under Knox's private eligibility hold: left as it is. */
  eligibilityHeld: number;
  /** Own line not found exactly once in the text: no evidence either way, left live. */
  unproven: number;
  /** v2/v3: an undirected international wire filed outgoing that the document reads as outgoing; left live. */
  undirectedOutgoing: number;
  unprovenByReason: Partial<Record<InternationalDirectionUnprovenReason, number>>;
  byReason: Partial<Record<InternationalDirectionMatchReason, number>>;
  byCategory: Record<string, number>;
  samples: InternationalDirectionMatch[];
}

export interface InternationalDirectionResult extends InternationalDirectionFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  afterId: number;
  nextAfterId: number;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A line saying the bank does not offer the service it prices. */
const NOT_OFFERED = /\b(?:do(?:es)?\s+not|don['’]t|cannot|can['’]t|no\s+longer|unable\s+to)\s+(?:allow|offer|accept|provide|send|process|support|perform|originate)\b|\bnot\s+(?:available|offered|accepted|allowed)\b/i;
const WIRE_WORD = /\b(?:wires?|transfers?)\b/i;
/** v4: only a wire names an incoming wire price; an ACH, IAT or app transfer is another service. */
const WIRE_ONLY = /\bwires?\b/i;
const NOT_A_WIRE = /\b(?:ACH|IAT|Zelle|Remitly|Western\s+Union|MoneyGram)\b/i;
/** Longer lines are prose, not a schedule's priced line. */
const SCHEDULE_LINE_MAX = 160;
const HAS_PRICE = /\$\s*\.?\d|\b\d+\.\d{2}\b|\b(?:free|no charge|no fee|none|n\/c)\b/i;

export type UndirectedWireReading =
  | { kind: "outgoing"; evidence: "no_incoming_international" | "incoming_price_differs" }
  | { kind: "not_offered" }
  | { kind: "held"; why: "incoming_international_price" };

/** Every price a line prints: dollar amounts, bare cents amounts, and "Free"/"No charge" as 0. */
function linePrices(line: string): number[] {
  const prices: number[] = [];
  for (const match of line.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?|\.\d+)|\b(\d+\.\d{2})\b/g)) {
    const value = Number((match[1] ?? match[2]).replace(/,/g, ""));
    if (Number.isFinite(value)) prices.push(value);
  }
  if (/\b(?:free|no charge|no fee|none|n\/c)\b/i.test(line)) prices.push(0);
  return prices;
}

/**
 * v3 (#1912): how a priced international wire line with no direction of its own, filed outgoing,
 * reads in its whole document. Such a line is the outgoing international price: on a schedule that
 * prices only outgoing wires ("Outgoing Wire Fee | $30.00" over "Foreign Wire Fee | $50.00"), on one
 * that lists incoming wires apart, and beside another line pricing an international wire as outgoing
 * (a duplicate or a second tier, not a direction error). It is held only when the document prices an
 * incoming international wire on its own line and this fee's price equals that incoming price, and
 * no outgoing international line prints the same price: then the undirected line is the incoming
 * one. The other lines read are wire lines: a line with a wire
 * word, or one under an unpriced wire heading at most six lines up ("International Wires:" over
 * "Incoming | $15.00", which takes the heading's geography). Each is read with the review's own
 * words (`wireScopeFacts`). `not_offered` when the fee's own line says the bank does not offer it.
 * Pure.
 */
export function undirectedWireReading(
  text: string,
  scope: Extract<OwnWireScope, { kind: "owned" }>,
  amount: number | null,
): UndirectedWireReading {
  if (NOT_OFFERED.test(scope.ownText) || NOT_OFFERED.test(scope.sourceLine)) return { kind: "not_offered" };
  const lines = text.split(/\r?\n/);
  const ownFirst = scope.lineIndex, ownLast = scope.lineIndex + scope.sourceLine.split("\n").length - 1;
  const wireHeading = (at: number): string | null => {
    let seen = 0;
    for (let index = at - 1; index >= 0 && at - index <= 8 && seen < 6; index--) {
      const line = lines[index].trim();
      if (!line) continue;
      seen++;
      if (WIRE_WORD.test(line) && !HAS_PRICE.test(line)) return line;
    }
    return null;
  };
  const priced = { incoming: [] as number[], outgoing: [] as number[] };
  for (let index = 0; index < lines.length; index++) {
    if (index >= ownFirst && index <= ownLast) continue;
    const line = lines[index].trim();
    // A schedule line, not prose: "international wire requirements can vary by ... receiving
    // financial institution" names no incoming price (Embers CU, 139807).
    if (!line || line.length > SCHEDULE_LINE_MAX || !HAS_PRICE.test(line)) continue;
    const heading = WIRE_WORD.test(line) ? null : wireHeading(index);
    if (!WIRE_WORD.test(line) && heading == null) continue;
    const found = wireScopeFacts(line);
    if (!found || found.directions.length !== 1) continue;
    const geography = found.geography === "unspecified" && heading != null ? wireScopeFacts(heading)?.geography : found.geography;
    if (geography !== "international") continue;
    if (found.directions[0] === "outgoing") {
      priced.outgoing.push(...linePrices(line));
      continue;
    }
    // v4 (#2890 review): an incoming price counts only from a wire line ("International ACH
    // transfers received | $25.00" is another service), and only the line's own first price
    // ("$15.00 plus correspondent bank fees up to $35.00" prices the wire at $15).
    if (NOT_A_WIRE.test(line) || (heading != null && NOT_A_WIRE.test(heading))) continue;
    if (!WIRE_ONLY.test(line) && !(heading != null && WIRE_ONLY.test(heading))) continue;
    const first = linePrices(line)[0];
    if (first != null) priced.incoming.push(first);
  }
  if (priced.incoming.length === 0) return { kind: "outgoing", evidence: "no_incoming_international" };
  const same = (prices: number[]) => amount != null && prices.some((price) => Math.abs(price - amount) < 0.005);
  // A price both directions share is no evidence ("Incoming Wire – International | $0.00" and
  // "Outgoing Wire – International Wire (USD) | $0.00" on a fee-free schedule, 139028).
  // v4: the match is evidence only when the document also prices an outgoing international wire, at
  // another price; a bank may charge the same both ways ("International Wire Transfer | $15.00" beside
  // "Incoming International Wire | $15.00" is the outgoing price).
  if (same(priced.incoming) && priced.outgoing.length > 0 && !same(priced.outgoing)) {
    return { kind: "held", why: "incoming_international_price" };
  }
  return { kind: "outgoing", evidence: "incoming_price_differs" };
}

/** The category a fee's own line shows, from the review's scope; null unless one geography and one direction. */
function categoryShown(review: InternationalDirectionReview | undefined): string | null {
  if (!review || (review.kind !== "hold" && review.kind !== "admit")) return null;
  const { geography, directions } = review.scope;
  if (directions.length !== 1 || (geography !== "international" && geography !== "domestic")) return null;
  return `wire_${geography === "international" ? "intl" : "domestic"}_${directions[0]}`;
}

const HASH = /^[a-f0-9]{64}$/;

/**
 * The stored text is the very text Knox read the fee from: the note's header names one text hash, the
 * stored text's hash is that one, and the stored body hashes to it. The artifact id may differ (the same
 * text stored again) and a re-read note may name the artifact twice; the bytes decide.
 */
export function storedTextIsOriginal(row: Pick<InternationalDirectionRow, "extraction_note" | "conditions" | "text_hash" | "normalized_text">): boolean {
  const note = row.extraction_note ?? row.conditions ?? "";
  const header = note.split(/\bexcerpt=/, 1)[0];
  const hashes = new Set([...header.matchAll(/\btext_hash=([a-f0-9]{64});/g)].map((match) => match[1]));
  if (hashes.size !== 1 || !row.text_hash || !HASH.test(row.text_hash) || !hashes.has(row.text_hash) || !row.normalized_text) return false;
  return createHash("sha256").update(row.normalized_text).digest("hex") === row.text_hash;
}

/** The stored text as the locked snapshot shape the shared decision reads (facts only, no locks). */
function sourceOf(row: InternationalDirectionRow): LockedSourceSnapshot | null {
  const artifactId = num(row.text_id), documentId = num(row.source_document_id), institutionId = num(row.text_institution_id);
  if (artifactId == null || documentId == null || institutionId == null || row.text_status !== "completed"
    || !row.normalized_text || !row.text_hash) return null;
  const artifact = { id: artifactId, source_document_id: documentId, institution_id: institutionId, source_url: row.source_url,
    source_hash: null, status: row.text_status, normalized_text: row.normalized_text, text_hash: row.text_hash } satisfies SourceArtifactSnapshot;
  const document = { id: documentId, institution_id: institutionId, document_url: row.source_url, status: "success",
    content_hash: null, superseded_by_id: null, duplicate_of_id: null } satisfies SourceDocumentSnapshot;
  return { artifactId, documentId, institutionId, textHash: row.text_hash, normalizedText: row.normalized_text,
    sourceUrl: row.source_url, document, artifact };
}

/**
 * Pure: the verdict on each row the read selected, by `internationalDirectionOutcome`, the function
 * verify calls on new rows. Only a fee the review holds is a match; one it declines is unproven.
 */
export function findInternationalDirections(rows: InternationalDirectionRow[]): InternationalDirectionFindings & {
  matches: InternationalDirectionMatch[]; passing: number[];
} {
  const matches: InternationalDirectionMatch[] = [];
  const passing: number[] = [];
  const seen = new Set<number>();
  let textChanged = 0, eligibilityHeld = 0, unproven = 0, undirectedOutgoing = 0;
  const unprovenByReason: InternationalDirectionFindings["unprovenByReason"] = {};
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const category = row.canonical_fee_key ?? "";
    const raw = {
      institution_id: row.raw_institution_id ?? row.institution_id, source_document_id: row.source_document_id,
      extraction_note: row.extraction_note, conditions: row.conditions,
      fee_name: row.raw_fee_name ?? "", amount: row.raw_amount, outlier_flags: row.outlier_flags,
    } as Parameters<typeof internationalDirectionOutcome>[0];
    // Only the text the fee was read from is evidence; any other copy is Knox's next read to decide.
    // The proof skips the locked owner match, so the text must also belong to the fee's institution.
    const sameOwner = num(row.text_institution_id) != null && num(row.text_institution_id) === num(raw.institution_id);
    const source = sameOwner && storedTextIsOriginal(row) ? sourceOf(row) : null;
    const outcome = internationalDirectionOutcome(raw, category, category,
      source ? { kind: "bound", source, currentRaw: raw } : { kind: "unavailable" }, { originalTextProved: true });
    if (outcome.kind !== "deferred") {
      if (outcome.kind === "ready") passing.push(feeId);
      continue;
    }
    if (outcome.reason === "private_eligibility_hold") { eligibilityHeld++; continue; }
    if (outcome.reason !== "own_direction_unproven" || !outcome.review) { textChanged++; continue; }
    const review = outcome.review;
    if (review.kind === "decline") {
      unproven++;
      unprovenByReason[review.reason] = (unprovenByReason[review.reason] ?? 0) + 1;
      continue;
    }
    if (review.kind !== "hold") continue;
    // v2/v3: an undirected international wire filed outgoing, read in its whole document.
    let reason: InternationalDirectionMatchReason = review.reason;
    if (review.reason === "direction_missing" && category === "wire_intl_outgoing" && source) {
      const reading = undirectedWireReading(source.normalizedText, review.scope, num(row.published_amount) ?? num(row.raw_amount));
      if (reading.kind === "outgoing") { undirectedOutgoing++; passing.push(feeId); continue; }
      if (reading.kind === "not_offered") reason = "not_offered";
    }
    const shown = categoryShown(review);
    const sourceLine = review.scope.sourceLine.slice(0, 300);
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: (row.raw_fee_name ?? "").trim(),
      amount: num(row.published_amount),
      canonicalFeeKey: category,
      sourceDocumentId: num(row.source_document_id),
      match: reason,
      sourceCategory: shown && shown !== category ? shown : null,
      sourceLine,
      reason: `${INTERNATIONAL_DIRECTION_REASON}: ${reason}`,
    });
  }
  const byReason: InternationalDirectionFindings["byReason"] = {};
  const byCategory: Record<string, number> = {};
  for (const fee of matches) {
    byReason[fee.match] = (byReason[fee.match] ?? 0) + 1;
    byCategory[fee.canonicalFeeKey] = (byCategory[fee.canonicalFeeKey] ?? 0) + 1;
  }
  return {
    checked: seen.size,
    passed: passing.length,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    textChanged,
    eligibilityHeld,
    unproven,
    unprovenByReason,
    undirectedOutgoing,
    byReason,
    byCategory,
    samples: matches.slice(0, INTERNATIONAL_DIRECTION_SAMPLES),
    matches,
    passing,
  };
}

/**
 * Read-only: the next live wire fees after `afterId` (by published id) that the review reads, each
 * with its raw read and its document's stored text. Scoped to one institution, all of its fees.
 */
export function internationalDirectionRowsSql(db: SqlTag, options: { institutionId?: number; afterId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const afterId = scoped ? 0 : Math.max(0, Math.trunc(options.afterId ?? 0));
  const limit = Math.max(1, Math.min(options.limit ?? INTERNATIONAL_DIRECTION_BATCH, 5_000));
  return db<InternationalDirectionRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.canonical_fee_key,
           fp.amount AS published_amount, fr.institution_id AS raw_institution_id, fr.source_document_id,
           fr.fee_name AS raw_fee_name, fr.amount AS raw_amount, fr.outlier_flags, fr.extraction_note, fr.conditions,
           ast.id AS text_id, ast.institution_id AS text_institution_id, ast.status AS text_status, ast.text_hash,
           ast.normalized_text, ast.source_url
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN agent_source_texts ast ON ast.source_document_id = fr.source_document_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND (fp.canonical_fee_key LIKE 'wire_intl_%'
            OR (fp.canonical_fee_key LIKE 'wire_%' AND fr.fee_name ~* ${INTERNATIONAL_WIRE_NAME_SQL}))
       AND fp.fee_published_id > ${afterId}
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

async function readCursor(db: SqlTag): Promise<number> {
  try {
    const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
      SELECT detail->>'next_after_id' AS next_after_id
        FROM agent_run_events
       WHERE event_type = ${INTERNATIONAL_DIRECTION_CHECK}
         AND detail->>'next_after_id' IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    return num(row?.next_after_id ?? null) ?? 0;
  } catch (error) {
    console.warn("[darwin] international direction cursor read failed", error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * One step's share of the re-check (see the module note). Never throws: a failed read reports
 * nothing, and a failed write leaves the fees as they were.
 */
export async function recheckInternationalDirections(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<InternationalDirectionResult> {
  const live = options.live ?? INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE;
  const scoped = options.institutionId != null;
  const { matches: _none, passing: _pass, ...empty } = findInternationalDirections([]);
  void _none; void _pass;
  const afterId = scoped ? 0 : await readCursor(db);
  const result: InternationalDirectionResult = {
    live, dryRun: options.dryRun, scoped, afterId, nextAfterId: afterId, ...empty, flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };

  let rows: InternationalDirectionRow[];
  try {
    rows = await inSavepoint(db, (scope) => internationalDirectionRowsSql(scope, { institutionId: options.institutionId, afterId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] international direction check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, passing, ...findings } = findInternationalDirections(rows);
  Object.assign(result, findings);
  const limit = Math.max(1, Math.min(options.limit ?? INTERNATIONAL_DIRECTION_BATCH, 5_000));
  const lastId = rows.length > 0 ? num(rows[rows.length - 1].fee_published_id) : null;
  // A full batch continues after its last fee; a short one finished the pass.
  result.nextAfterId = scoped ? afterId : rows.length >= limit && lastId != null ? lastId : 0;

  if (live && !options.dryRun && (matches.length > 0 || passing.length > 0)) {
    const look = await secondLook(db, {
      check: INTERNATIONAL_DIRECTION_CHECK, runId: options.runId, failing: matches, passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${INTERNATIONAL_DIRECTION_CHECK}, 'completed',
          ${`Read live international wire fees for a direction their own line states: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s) fail the direction review, ${result.textChanged} with a changed text left as they are; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(internationalDirectionDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] international direction check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: InternationalDirectionMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-international-direction-${runId}`},
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
                   WHEN fv.outlier_flags ? ${INTERNATIONAL_DIRECTION_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${INTERNATIONAL_DIRECTION_FLAG}::text)
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
    console.error("[darwin] international direction takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: InternationalDirectionMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.international_direction_takedown', 'completed',
        ${`Archived ${archived.length} live international wire fee(s) that fail the direction review, on their second look`},
        ${JSON.stringify({ version: INTERNATIONAL_DIRECTION_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] international direction takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: InternationalDirectionMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    match: fee.match,
    source_category: fee.sourceCategory,
    source_line: fee.sourceLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function internationalDirectionDetail(result: InternationalDirectionResult) {
  return {
    check: INTERNATIONAL_DIRECTION_CHECK,
    version: INTERNATIONAL_DIRECTION_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    after_id: result.afterId,
    next_after_id: result.scoped ? null : result.nextAfterId,
    checked: result.checked,
    passed: result.passed,
    matched: result.matched,
    institutions: result.institutions,
    text_changed: result.textChanged,
    eligibility_held: result.eligibilityHeld,
    unproven: result.unproven,
    unproven_by_reason: result.unprovenByReason,
    undirected_outgoing: result.undirectedOutgoing,
    by_reason: result.byReason,
    by_category: result.byCategory,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
