/**
 * Saved outputs made before a fee changed (H03-T09, #978). A saved answer, report or briefing
 * keeps the figures it showed when it was made: nothing here rewrites one, and a file already
 * downloaded cannot change. What changes is the notice beside it: when a fee for the saved
 * output's institution was corrected, reversed, held or released after it was saved, the reader
 * is told so and offered a fresh answer from current data.
 *
 * A saved output records the published fee rows it read, and their source documents
 * (`hamilton_saved_output_fee_refs`, written by `src/lib/data-store/saved-output-fee-refs.ts`), so
 * a change to any of those rows finds it, including an answer that used the institution only as a
 * peer. An output saved before that record existed (or one that read no identifiable fee row,
 * such as a quarterly briefing) is still matched by the institution it is about.
 *
 * Pure: no database imports. The reader is `src/lib/data-store/fee-correction-audit.ts`.
 */

export type FeeChangeKind = "correct" | "reverse" | "hold" | "release";

export interface FeeChangeSince {
  kind: FeeChangeKind;
  at: string;
}

export interface SavedOutputNotice {
  /** Plain text for the reader. Never names a fee value or a pipeline step. */
  text: string;
  latestAt: string;
  count: number;
}

/** A published fee row a saved output used, with the source document version it was read from. */
export interface SavedFeeRef {
  feePublishedId: number;
  institutionId: number | null;
  sourceDocumentId: number | null;
  sourceContentHash: string | null;
}

/** How a saved output was matched to fee changes: by the fee rows it recorded, or by its institution. */
export type NoticeBasis = "fees" | "institution";

/** The most fee rows one saved output records (the table's check allows no more). */
export const MAX_SAVED_FEE_REFS = 2000;

function positiveId(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function hashOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

/**
 * The published fee rows found in what a saved output was built from: the institution's own rows
 * (`ownRows`), evidence facts read from `published_fee_catalog`, the catalog rows of an
 * institution profile (`identity` with `fees.verified` / `fees.provisional` rows carrying
 * `record_id`), and named peers or competitors that carry `feePublishedIds`. Every row read
 * counts, not only the rows a sentence rests on, as for a storyline. Market layers (state, district, national) are aggregates and are
 * skipped. First sighting of a row wins, then one that names its document fills the gap. Capped
 * at MAX_SAVED_FEE_REFS. Pure.
 */
/**
 * The fee refs a written answer saves. A correction matches an output with refs by its fee rows
 * only, and one with none by its institution. So refs that hold none of the research subject's own
 * rows (it read only a peer's profile, or the subject's prices came from an aggregate such as
 * `getLocalCompetitors`) are not saved, and the answer keeps its match on the subject. With no
 * subject there is no institution match to keep. Pure.
 */
export function writtenAnswerFeeRefs(refs: SavedFeeRef[], subjectId: number | null): SavedFeeRef[] {
  if (subjectId == null) return refs;
  return refs.some((ref) => ref.institutionId === subjectId) ? refs : [];
}

export function collectFeeRefs(...values: unknown[]): SavedFeeRef[] {
  const refs = new Map<number, SavedFeeRef>();
  const seen = new WeakSet<object>();
  const add = (id: unknown, institutionId: unknown, documentId: unknown, hash: unknown) => {
    const feePublishedId = positiveId(id);
    if (feePublishedId == null) return;
    const existing = refs.get(feePublishedId);
    if (existing) {
      if (existing.sourceDocumentId == null && positiveId(documentId) != null) {
        existing.sourceDocumentId = positiveId(documentId);
        existing.sourceContentHash = hashOf(hash);
      }
      return;
    }
    if (refs.size >= MAX_SAVED_FEE_REFS) return;
    refs.set(feePublishedId, {
      feePublishedId,
      institutionId: positiveId(institutionId),
      sourceDocumentId: positiveId(documentId),
      sourceContentHash: hashOf(hash),
    });
  };
  const single = (ids: unknown): unknown => (Array.isArray(ids) && ids.length === 1 ? ids[0] : null);
  const walk = (value: unknown, depth: number) => {
    if (depth > 16 || value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.ownRows)) {
      for (const row of obj.ownRows as Record<string, unknown>[]) {
        if (row && typeof row === "object") add(row.id, obj.institutionId, row.sourceDocumentId, row.sourceContentHash);
      }
    }
    const source = obj.source as Record<string, unknown> | undefined;
    if (source && typeof source === "object" && source.table === "published_fee_catalog") {
      const scope = obj.scope as Record<string, unknown> | undefined;
      add(source.recordId, scope?.institutionId, single(source.sourceDocumentIds), source.documentContentHash);
    }
    // An institution profile as a written answer's `getInstitution` read returns it
    // (`src/lib/research/tools.ts`): `identity.id` and catalog rows under `fees.verified` and
    // `fees.provisional`, each with its `record_id` and `source_document_id` (#1077, defect 4).
    // The same shape the written answer's binding reads its fee records from. A pipeline preview
    // row (`pipeline_stage`) is no published row and has no `record_id`; it records nothing.
    const identity = obj.identity as Record<string, unknown> | undefined;
    const profileFees = obj.fees as Record<string, unknown> | undefined;
    if (identity && typeof identity === "object" && profileFees && typeof profileFees === "object" && !Array.isArray(profileFees)) {
      for (const list of [profileFees.verified, profileFees.provisional]) {
        if (!Array.isArray(list)) continue;
        for (const row of list as Record<string, unknown>[]) {
          if (!row || typeof row !== "object" || row.pipeline_stage) continue;
          add(row.record_id, identity.id, row.source_document_id, null);
        }
      }
    }
    const peerIds = obj.feePublishedIds ?? obj.fee_published_ids;
    if (Array.isArray(peerIds)) {
      const docs = obj.sourceDocumentIds ?? obj.source_document_ids;
      for (const id of peerIds) add(id, obj.institutionId ?? obj.institution_id, single(docs), null);
    }
    for (const [key, child] of Object.entries(obj)) {
      if (key === "layers") continue;
      walk(child, depth + 1);
    }
  };
  for (const value of values) walk(value, 0);
  return [...refs.values()];
}

/** Saved outputs about one institution made before an operator's change. Null when the table could not be read. */
export interface AffectedSavedOutputs {
  analyses: number | null;
  reports: number | null;
  briefings: number | null;
}

const PHRASE: Record<FeeChangeKind, [string, string]> = {
  correct: ["fee corrected", "fees corrected"],
  reverse: ["correction reversed", "corrections reversed"],
  hold: ["fee taken out for review", "fees taken out for review"],
  release: ["fee returned after review", "fees returned after review"],
};

/** "Oct 16, 2026", in UTC so the server and the reader agree. */
export function noticeDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

function time(iso: string): number {
  const at = new Date(iso).getTime();
  return Number.isFinite(at) ? at : NaN;
}

/**
 * The notice for a saved output, or null when no fee it used (basis "fees") or no fee for its
 * institution (basis "institution") changed after it was saved. Changes at or before `savedAt`
 * are ignored. Pure.
 */
export function savedOutputNotice(
  changes: FeeChangeSince[],
  savedAt: string,
  noun = "answer",
  basis: NoticeBasis = "institution",
): SavedOutputNotice | null {
  const saved = time(savedAt);
  if (!Number.isFinite(saved)) return null;
  const after = changes.filter((change) => time(change.at) > saved);
  if (after.length === 0) return null;
  const latestAt = after.reduce((newest, change) => (time(change.at) > time(newest) ? change.at : newest), after[0].at);
  const counts = new Map<FeeChangeKind, number>();
  for (const change of after) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  const parts = (["correct", "reverse", "hold", "release"] as const)
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const n = counts.get(kind) ?? 0;
      return `${n} ${PHRASE[kind][n === 1 ? 0 : 1]}`;
    });
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const when = after.length === 1 ? ` on ${noticeDate(latestAt)}` : `, the latest on ${noticeDate(latestAt)}`;
  return {
    text:
      `${basis === "fees" ? `Fee data this ${noun} used` : "This institution's fee data"} changed after this ${noun} was saved: ${list}${when}. ` +
      `This ${noun} still shows the figures from when it was saved.`,
    latestAt,
    count: after.length,
  };
}

/** "3 saved answers, 1 report" for the admin audit view; "none" or "unknown" otherwise. Pure. */
export function affectedSavedOutputsLabel(outputs: AffectedSavedOutputs | null): string {
  if (!outputs) return "unknown";
  const parts: string[] = [];
  const add = (n: number | null, one: string, many: string) => {
    if (n != null && n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(outputs.analyses, "saved answer", "saved answers");
  add(outputs.reports, "report", "reports");
  add(outputs.briefings, "briefing", "briefings");
  const unknown = [outputs.analyses, outputs.reports, outputs.briefings].some((n) => n == null);
  if (parts.length === 0) return unknown ? "unknown" : "none";
  return unknown ? `${parts.join(", ")} (some unreadable)` : parts.join(", ");
}
