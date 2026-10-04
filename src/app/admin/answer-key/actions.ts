"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  addAnswerKeyFee,
  ANSWER_KEY_AMOUNT_KINDS,
  ANSWER_KEY_DOCUMENT_TYPES,
  confirmAnswerKeyInstitution,
  deleteAnswerKeyFee,
  importAnswerKeyPrefill,
  parseAnswerKeyPrefill,
  reopenAnswerKeyInstitution,
  saveAnswerKeyDocument,
  saveAnswerKeyFee,
  type AnswerKeyFeeInput,
} from "@/lib/data-store/answer-key";
import { assertAtlasDispatchReady } from "@/lib/agents/dispatch-readiness";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";

const idSchema = z.coerce.number().int().positive();
const MAX_PREFILL_BYTES = 5_000_000;

function formNumber(formData: FormData, key: string): number | null {
  const parsed = idSchema.safeParse(formData.get(key));
  return parsed.success ? parsed.data : null;
}

function formText(formData: FormData, key: string, max = 2_000): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function feeInput(formData: FormData): AnswerKeyFeeInput {
  const kind = formText(formData, "amount_kind");
  return {
    canonical_key: formText(formData, "canonical_key", 100) ?? "",
    amount: formText(formData, "amount", 40),
    amount_kind: (ANSWER_KEY_AMOUNT_KINDS as readonly string[]).includes(kind ?? "")
      ? (kind as AnswerKeyFeeInput["amount_kind"])
      : null,
    frequency: formText(formData, "frequency", 200),
    conditions: formText(formData, "conditions"),
    source_line: formText(formData, "source_line"),
  };
}

function detailPath(answerKeyId: number, message?: string): string {
  return message
    ? `/admin/answer-key/${answerKeyId}?message=${encodeURIComponent(message)}`
    : `/admin/answer-key/${answerKeyId}`;
}

function refresh(answerKeyId?: number | null): void {
  revalidatePath("/admin/answer-key");
  revalidatePath("/admin/scoreboard");
  if (answerKeyId) revalidatePath(`/admin/answer-key/${answerKeyId}`);
}

/** Loads a prefill JSON file (upload or pasted text). Confirmed banks are never overwritten. */
export async function importAnswerKeyAction(formData: FormData): Promise<void> {
  const user = await requireAuth("edit");
  let text = formText(formData, "prefill_json", MAX_PREFILL_BYTES);
  const file = formData.get("prefill_file");
  if (!text && file instanceof File && file.size > 0) {
    if (file.size > MAX_PREFILL_BYTES) redirect(`/admin/answer-key?message=${encodeURIComponent("File is over 5 MB.")}`);
    text = await file.text();
  }
  if (!text) redirect(`/admin/answer-key?message=${encodeURIComponent("Choose a prefill file or paste its JSON.")}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    redirect(`/admin/answer-key?message=${encodeURIComponent("That is not valid JSON.")}`);
  }
  const parsed = parseAnswerKeyPrefill(json);
  const result = await importAnswerKeyPrefill(parsed, { actor: user.username, source: "admin import" });
  refresh();
  const message = [
    `Imported ${result.inserted} new and ${result.updated} updated banks (${result.fees} fees).`,
    result.skippedConfirmed > 0 ? `${result.skippedConfirmed} confirmed banks left as they were.` : null,
    result.errors.length > 0 ? `${result.errors.length} problems: ${result.errors.slice(0, 3).join(" ")}` : null,
  ].filter(Boolean).join(" ");
  redirect(`/admin/answer-key?message=${encodeURIComponent(message)}`);
}

export async function saveAnswerKeyFeeAction(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const feeId = formNumber(formData, "fee_id");
  const answerKeyId = formNumber(formData, "answer_key_id");
  if (!feeId || !answerKeyId) return;
  const result = await saveAnswerKeyFee(feeId, feeInput(formData), user.username);
  refresh(answerKeyId);
  if (!result.ok) redirect(detailPath(answerKeyId, result.error));
}

export async function addAnswerKeyFeeAction(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const answerKeyId = formNumber(formData, "answer_key_id");
  if (!answerKeyId) return;
  const result = await addAnswerKeyFee(answerKeyId, feeInput(formData), user.username);
  refresh(answerKeyId);
  if (!result.ok) redirect(detailPath(answerKeyId, result.error));
}

export async function deleteAnswerKeyFeeAction(formData: FormData): Promise<void> {
  await requireAuth("approve");
  const feeId = formNumber(formData, "fee_id");
  const answerKeyId = formNumber(formData, "answer_key_id");
  if (!feeId) return;
  await deleteAnswerKeyFee(feeId);
  refresh(answerKeyId);
}

export async function saveAnswerKeyDocumentAction(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const answerKeyId = formNumber(formData, "answer_key_id");
  const documentUrl = formText(formData, "document_url");
  const documentType = formText(formData, "document_type");
  if (!answerKeyId) return;
  if (!documentUrl || !(ANSWER_KEY_DOCUMENT_TYPES as readonly string[]).includes(documentType ?? "")) {
    redirect(detailPath(answerKeyId, "The document needs a URL and a type."));
  }
  await saveAnswerKeyDocument(
    answerKeyId,
    {
      document_url: documentUrl,
      document_type: documentType as (typeof ANSWER_KEY_DOCUMENT_TYPES)[number],
      content_hash: formText(formData, "content_hash", 200),
      notes: formText(formData, "notes"),
    },
    user.username,
  );
  refresh(answerKeyId);
}

/** Confirms the document and every fee row of one bank, then opens the next unconfirmed bank. */
export async function confirmAnswerKeyAction(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const answerKeyId = formNumber(formData, "answer_key_id");
  if (!answerKeyId) return;
  await confirmAnswerKeyInstitution(answerKeyId, user.username);
  refresh(answerKeyId);
  const nextId = formNumber(formData, "next_id");
  redirect(nextId ? detailPath(nextId, "Confirmed. Here is the next bank to check.") : "/admin/answer-key?message=Confirmed.");
}

export async function reopenAnswerKeyAction(formData: FormData): Promise<void> {
  await requireAuth("approve");
  const answerKeyId = formNumber(formData, "answer_key_id");
  if (!answerKeyId) return;
  await reopenAnswerKeyInstitution(answerKeyId);
  refresh(answerKeyId);
}

/** Runs Atlas's score and scoreboard now, as a visible run (same steps as the daily cron). */
export async function runScoreboardNowAction(): Promise<void> {
  const user = await requireAuth("trigger_jobs");
  await assertAtlasDispatchReady();
  const started = await startAgentRun({
    agent: "atlas",
    kind: "workflow",
    title: "Atlas scoreboard (manual)",
    params: { source: "admin.scoreboard" },
    triggeredBy: user.username,
    triggerSource: "admin",
    idempotencyKey: `atlas:scoreboard:manual:${new Date().toISOString().slice(0, 16)}`,
    steps: [
      { key: "score-answer-key", agent: "atlas", title: "Score the pipeline against the answer key" },
      { key: "scoreboard-snapshot", agent: "atlas", title: "Record the daily scoreboard" },
    ],
  });
  if (!started.reused) await executeAgentRun(started.run.id, { maxSteps: 2 });
  refresh();
  redirect(`/admin/scoreboard?message=${encodeURIComponent(`Atlas run #${started.run.id} scored the pipeline.`)}`);
}
