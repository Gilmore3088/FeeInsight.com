"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordPublicCacheRefresh, retryAdminFeeRefresh, type RetryRefreshResult } from "@/lib/fee-admin-run";
import { cleanHoldReason, holdPublishedFee, MIN_HOLD_REASON, releasePublishedFee, validFeeId, type FeeHoldResult } from "@/lib/fee-hold";
import { isFeeErrorCause } from "@/lib/fee-error-cause";
import {
  correctPublishedFee,
  dismissCorrectionConflict,
  reverseFeeCorrection,
  type FeeCorrectionResult,
} from "@/lib/fee-corrections";
import {
  extractInstitutionCommand,
  markInstitutionOfflineCommand,
  setInstitutionFeeUrl,
  setInstitutionWebsiteUrl,
} from "@/lib/institution-commands";

export async function updateFeeUrl(institutionId: number, url: string) {
  const result = await setInstitutionFeeUrl(institutionId, url);
  return result.success ? { ok: true } : { error: result.error };
}

export async function updateWebsiteUrl(institutionId: number, url: string) {
  const result = await setInstitutionWebsiteUrl(institutionId, url);
  return result.success ? { ok: true } : { error: result.error };
}

export async function runExtract(institutionId: number) {
  const result = await extractInstitutionCommand(institutionId);
  return result.success
    ? { ok: true, jobId: result.jobId, reused: result.reused }
    : { error: result.error };
}

export async function markInstitutionOffline(institutionId: number) {
  const result = await markInstitutionOfflineCommand(institutionId);
  return result.success ? { ok: true } : { error: result.error };
}

/**
 * Clears the public read caches after an operator's fee action has committed, and records on its
 * run whether that worked (H03-T08), so the refresh status never claims a cleared cache it did not
 * see. A failure to record is logged and never fails the action, which has already committed.
 */
async function refreshPublicReads(institutionId: number, runId: number | null | undefined): Promise<void> {
  // The action has already committed. A failed page revalidation is recorded as a failed refresh,
  // which the operator can retry, and never thrown: the action must not read "Nothing changed".
  let cleared = invalidatePublicReadCache();
  for (const path of [`/admin/institution/${institutionId}`, `/institution/${institutionId}`, "/admin/corrections"]) {
    try {
      revalidatePath(path);
    } catch (error) {
      cleared = false;
      console.error("[admin] page revalidation failed after a committed fee action", { path, runId, error });
    }
  }
  if (runId == null) return;
  try {
    await recordPublicCacheRefresh(sql, runId, cleared);
  } catch (error) {
    console.error("[admin] cache refresh event not recorded", { runId, error });
  }
}

async function refreshAfterHold(result: FeeHoldResult): Promise<void> {
  if (!result.ok) return;
  await refreshPublicReads(result.institutionId, result.runId);
}

/** H03 step 1: takes one published fee out of every customer-facing read, with a reason. */
export async function holdFee(feePublishedId: number, reason: string, cause?: string): Promise<FeeHoldResult> {
  const user = await requireAuth("approve");
  const id = validFeeId(feePublishedId);
  if (!id) return { ok: false, error: "Choose a fee to hold." };
  const cleanReason = cleanHoldReason(reason);
  if (!cleanReason) return { ok: false, error: `Give a reason of at least ${MIN_HOLD_REASON} characters.` };
  try {
    const result = await holdPublishedFee(sql, id, cleanReason, { id: user.id, name: user.display_name || user.username }, isFeeErrorCause(cause) ? cause : "not_sure");
    await refreshAfterHold(result);
    return result;
  } catch (error) {
    console.error("[admin] fee hold failed", { feePublishedId: id, error });
    return { ok: false, error: "The hold could not be saved. Try again." };
  }
}

/** Puts a held fee back into customer-facing reads. */
export async function releaseFee(feePublishedId: number): Promise<FeeHoldResult> {
  const user = await requireAuth("approve");
  const id = validFeeId(feePublishedId);
  if (!id) return { ok: false, error: "Choose a fee to release." };
  try {
    const result = await releasePublishedFee(sql, id, { id: user.id, name: user.display_name || user.username });
    await refreshAfterHold(result);
    return result;
  } catch (error) {
    console.error("[admin] fee release failed", { feePublishedId: id, error });
    return { ok: false, error: "The release could not be saved. Try again." };
  }
}

function actorOf(user: { id: number; display_name: string | null; username: string; role: string }) {
  return { id: user.id, name: user.display_name || user.username, role: user.role };
}


/** H03: corrects one published fee to a new version, checked against its source. Admin only (checked in the service). */
export async function correctFee(input: Record<string, unknown>): Promise<FeeCorrectionResult> {
  const user = await requireAuth("approve");
  try {
    const result = await correctPublishedFee(sql, input, actorOf(user));
    if (result.ok) await refreshPublicReads(result.institutionId, result.runId);
    return result;
  } catch (error) {
    console.error("[admin] fee correction failed", { feePublishedId: input?.feePublishedId, error });
    return { ok: false, error: "The correction could not be saved. Nothing changed. Try again." };
  }
}

/** H03: reverses a fee's current correction as a new version. Admin only (checked in the service). */
export async function reverseCorrection(input: Record<string, unknown>): Promise<FeeCorrectionResult> {
  const user = await requireAuth("approve");
  try {
    const result = await reverseFeeCorrection(sql, input, actorOf(user));
    if (result.ok) await refreshPublicReads(result.institutionId, result.runId);
    return result;
  } catch (error) {
    console.error("[admin] correction reversal failed", { feePublishedId: input?.feePublishedId, error });
    return { ok: false, error: "The reversal could not be saved. Nothing changed. Try again." };
  }
}

/** H03: dismisses a newer source's conflict with a correction, with a reason. Admin only. */
export async function dismissConflict(conflictId: number, reason: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAuth("approve");
  const id = validFeeId(conflictId);
  if (!id) return { ok: false, error: "Choose a conflict." };
  try {
    const result = await dismissCorrectionConflict(sql, id, String(reason ?? ""), actorOf(user));
    if (result.ok) {
      try {
        revalidatePath(`/admin/institution/${result.institutionId}`);
      } catch (error) {
        console.error("[admin] page revalidation failed after a committed dismissal", { conflictId: id, error });
      }
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    console.error("[admin] conflict dismissal failed", { conflictId: id, error });
    return { ok: false, error: "The dismissal could not be saved. Try again." };
  }
}

/**
 * H03-T08: retries the refresh after an operator's fee action whose national index rebuild or
 * cache clear failed. Admin only (`edit`). It changes no fee: it rebuilds the index in a new run
 * linked to the original, then clears the public caches.
 */
export async function retryFeeRefresh(runId: number): Promise<RetryRefreshResult> {
  const user = await requireAuth("edit");
  const id = validFeeId(runId);
  if (!id) return { ok: false, error: "Choose a run to retry." };
  try {
    const result = await retryAdminFeeRefresh(sql, id, { id: user.id, name: user.display_name || user.username });
    if (result.ok) await refreshPublicReads(result.institutionId, result.runId);
    return result;
  } catch (error) {
    console.error("[admin] fee refresh retry failed", { runId: id, error });
    return { ok: false, error: "The retry could not run. Try again." };
  }
}
