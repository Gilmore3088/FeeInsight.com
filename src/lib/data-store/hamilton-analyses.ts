/**
 * Saved Hamilton analyses (hamilton_saved_analyses): the reader's history and the source
 * of "Add to report". The Ask engine files each storyline answer here once, and adds
 * Hamilton's memo to the same row when it is written.
 */

import { createHash } from "node:crypto";
import { sql, withTransaction } from "./connection";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { normalizeLegacyAnalyzeConfidence, type EvidenceBoundAnalyzeResponse } from "@/lib/hamilton/evidence-contract";
import { withMemo } from "@/lib/hamilton/workspace/analysis-record";
import type { StorylineMemo } from "@/lib/hamilton/workspace/storyline-types";
import { collectFeeRefs, type SavedFeeRef } from "@/lib/saved-output-corrections";
import { recordSavedOutputFeeRefs } from "./saved-output-fee-refs";

/**
 * How long a repeat of the same request (same reader, institution, focus and question, and the
 * same full request the server answered) updates the earlier row instead of adding another.
 * Covers a double submit, two tabs, or Try again after the browser lost an answer the server
 * had already saved.
 */
export const DUPLICATE_SAVE_WINDOW_SECONDS = 120;

type SavedAnalysisInput = {
  userId: number;
  institutionId: string;
  title: string;
  analysisFocus: string;
  prompt: string;
  response: AnalyzeResponse;
  /**
   * Update a row saved for the same request within DUPLICATE_SAVE_WINDOW_SECONDS instead of
   * inserting a second one. Left out for saves that must stay immutable.
   *
   * `request` is everything the server answered, not only the saved prompt: for a written
   * answer, the question with the earlier turns carried with it; for an engine storyline,
   * the question with the decision, objective and fee it was read against. Its hash is kept
   * in `response_json.request_hash`, and a row is replaced only when both the hash and the
   * prompt match, so the same follow-up words after two different earlier questions are two
   * rows. Callers prefix the request with its kind ("written", "storyline"), so a storyline
   * and a written answer to the same question stay separate rows.
   */
  replaceRecentDuplicate?: { request: string };
  /**
   * The published fee rows the answer was built from (H03-T09), recorded beside the row so a
   * later correction finds it. Left out, the rows named in `response` are recorded.
   */
  feeRefs?: SavedFeeRef[];
};

/** The hash a saved row carries for the request it answered; case and spacing are ignored. */
export function savedRequestHash(request: string): string {
  return createHash("sha256").update(request.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");
}

/**
 * The response a repeat writes over an existing row: the newer answer, keeping the memo the
 * earlier request already wrote when the newer response has none yet. The rows share a request
 * hash, so the memo was written for the same request.
 */
export function mergeRepeatResponse(existing: unknown, next: AnalyzeResponse): AnalyzeResponse {
  const parsed = typeof existing === "string" ? safeParse(existing) : existing;
  const memo = (parsed as { memo?: StorylineMemo } | null)?.memo;
  if (!memo || (next as { memo?: unknown }).memo) return next;
  return withMemo(next as EvidenceBoundAnalyzeResponse, memo);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function insertSavedAnalysis(input: SavedAnalysisInput): Promise<string | null> {
  const id = await saveRow(input);
  // Best effort, after the save: an answer with no record keeps the institution match.
  if (id) await recordSavedOutputFeeRefs(sql, "analysis", id, input.feeRefs ?? collectFeeRefs(input.response));
  return id;
}

async function saveRow(input: SavedAnalysisInput): Promise<string | null> {
  const repeat = input.replaceRecentDuplicate;
  if (!repeat) return insertRow(sql, input);
  const requestHash = savedRequestHash(repeat.request);
  const response = { ...input.response, request_hash: requestHash } as AnalyzeResponse;
  return withTransaction(async (tx) => {
    // One save at a time per reader and institution, so two answers finishing together
    // cannot both miss each other and insert two rows.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`hamilton_saved_analyses:${input.userId}:${input.institutionId}`}))`;
    const recent = await tx<{ id: string; response_json: unknown }[]>`
      SELECT id::text, response_json FROM hamilton_saved_analyses
       WHERE user_id = ${input.userId} AND institution_id = ${input.institutionId}
         AND analysis_focus = ${input.analysisFocus} AND status = 'active'
         AND jsonb_typeof(response_json) = 'object'
         AND response_json->>'request_hash' = ${requestHash}
         AND lower(btrim(regexp_replace(coalesce(prompt, ''), '[[:space:]]+', ' ', 'g')))
             = lower(btrim(regexp_replace(${input.prompt}::text, '[[:space:]]+', ' ', 'g')))
         AND created_at > NOW() - make_interval(secs => ${DUPLICATE_SAVE_WINDOW_SECONDS}::double precision)
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE
    `;
    const existing = recent[0];
    if (!existing) return insertRow(tx, { ...input, response });
    const merged = mergeRepeatResponse(existing.response_json, response);
    const rows = await tx<{ id: string }[]>`
      UPDATE hamilton_saved_analyses
         SET title = ${input.title}, response_json = ${JSON.stringify(merged)}, updated_at = NOW()
       WHERE id::text = ${existing.id}
      RETURNING id::text
    `;
    return rows[0]?.id ?? null;
  });
}

async function insertRow(db: typeof sql, input: Omit<SavedAnalysisInput, "replaceRecentDuplicate" | "feeRefs">): Promise<string | null> {
  const rows = await db<{ id: string }[]>`
    INSERT INTO hamilton_saved_analyses (user_id, institution_id, title, analysis_focus, prompt, response_json, status)
    VALUES (${input.userId}, ${input.institutionId}, ${input.title}, ${input.analysisFocus}, ${input.prompt},
            ${JSON.stringify(input.response)}, 'active')
    RETURNING id::text
  `;
  return rows[0]?.id ?? null;
}

/** Atomically updates only an active saved answer owned by this user for this research subject. */
export async function updateSavedAnalysisResponse(userId: number, id: string, institutionId: string, response: AnalyzeResponse): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE hamilton_saved_analyses
       SET response_json = ${JSON.stringify(response)}, updated_at = NOW()
     WHERE id::text = ${id} AND user_id = ${String(userId)} AND institution_id::text = ${institutionId} AND status = 'active'
    RETURNING id::text
  `;
  return rows.length > 0;
}

export async function getSavedAnalysisResponse(userId: number, id: string, institutionId: string): Promise<AnalyzeResponse | null> {
  const rows = await sql<{ response_json: AnalyzeResponse | string }[]>`
    SELECT response_json FROM hamilton_saved_analyses
     WHERE id::text = ${id} AND user_id = ${String(userId)} AND institution_id::text = ${institutionId} AND status = 'active'
  `;
  const raw = rows[0]?.response_json;
  if (!raw) return null;
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as AnalyzeResponse) : raw;
  return normalizeLegacyAnalyzeConfidence(parsed);
}

/**
 * One saved answer by id, whoever saved it, for the homepage's Hamilton demonstration: the
 * row is chosen in code (`HAMILTON_SHOWCASE_ANSWER_ID`), never from a request, and only an
 * active row is returned.
 */
export async function getShowcaseAnalysisRow(
  id: string,
): Promise<{ institution_id: string; prompt: string | null; created_at: string; response_json: unknown } | null> {
  const rows = await sql<{ institution_id: string; prompt: string | null; created_at: string; response_json: unknown }[]>`
    SELECT institution_id::text, prompt, created_at::text, response_json FROM hamilton_saved_analyses
     WHERE id::text = ${id} AND status = 'active'
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, response_json: typeof row.response_json === "string" ? safeParse(row.response_json) : row.response_json };
}
