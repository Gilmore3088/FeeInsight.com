"use server";

/**
 * Carry a saved Ask answer into ongoing work (#2045): add it to the decision on its fee. The
 * event points at the saved answer by id, so its sources, peer group and dataset stamps travel
 * with it; the answer itself is never copied or changed.
 */

import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { sql } from "@/lib/data-store/connection";
import { addDecisionEvents, findOrOpenDecision, workspaceSchemaReady } from "@/lib/data-store/hamilton-workspace";
import { readSavedOutputFeeRefs } from "@/lib/data-store/saved-output-fee-refs";
import { getFeeFamily } from "@/lib/fee-taxonomy";
import { proseFeeName } from "@/lib/hamilton/workspace/names";
import { loadAnalysisRecord } from "./actions";

export type AddAnswerToDecisionResult =
  | { ok: true; decisionId: string; title: string; institutionId: string; /** The fee as a sentence reads it: "overdraft fee". */ feeName: string }
  | { ok: false; error: string };

/** The decision title the Ask engine gives a fee, so both land on the same decision. */
function decisionTitle(feeCategory: string): string {
  const name = proseFeeName(feeCategory);
  return `${name[0].toUpperCase()}${name.slice(1)} fee`;
}

export async function addAnswerToDecision(analysisId: string, feeCategory: string): Promise<AddAnswerToDecisionResult> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return { ok: false, error: "An active Hamilton subscription is required." };
  if (typeof feeCategory !== "string" || !getFeeFamily(feeCategory)) {
    return { ok: false, error: "This answer is not about one fee, so it cannot join a decision." };
  }
  // Scoped to the reader: another account's answer loads as null.
  const record = typeof analysisId === "string" ? await loadAnalysisRecord(analysisId) : null;
  if (!record) return { ok: false, error: "That saved answer could not be found." };
  const institutionId = Number(record.institutionId);
  if (!Number.isInteger(institutionId) || institutionId <= 0) {
    return { ok: false, error: "This answer is not about one institution, so it cannot join a decision." };
  }
  if (!(await workspaceSchemaReady())) return { ok: false, error: "Decisions are not available right now." };

  const actor = `user:${user.id}`;
  const title = decisionTitle(feeCategory);
  const { decision } = await findOrOpenDecision({ userId: user.id, institutionId, feeCategory, title, actor });
  const response = record.responseJson;
  const feeRefs = await readSavedOutputFeeRefs(sql, "analysis", record.id);
  await addDecisionEvents(decision.id, [
    {
      // The same kind the Ask engine logs for an answer, pointing at the saved copy.
      kind: "question_asked",
      detail: {
        question: record.prompt,
        shortAnswer: response.title,
        savedAnalysisId: record.id,
        addedBy: "reader",
        peerBaseline: response.identityContext?.peerBaselineLabel ?? null,
        datasetStamps: response.datasetStamps ?? [],
        feeRefCount: feeRefs?.length ?? 0,
      },
      actor,
    },
  ]);
  return { ok: true, decisionId: decision.id, title: decision.title, institutionId: String(institutionId), feeName: `${proseFeeName(feeCategory)} fee` };
}
