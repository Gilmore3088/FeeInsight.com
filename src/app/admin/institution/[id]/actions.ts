"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { cleanHoldReason, holdPublishedFee, MIN_HOLD_REASON, releasePublishedFee, validFeeId, type FeeHoldResult } from "@/lib/fee-hold";
import {
  extractInstitutionCommand,
  markInstitutionOfflineCommand,
  setInstitutionFeeUrl,
} from "@/lib/institution-commands";

export async function updateFeeUrl(institutionId: number, url: string) {
  const result = await setInstitutionFeeUrl(institutionId, url);
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

function refreshAfterHold(result: FeeHoldResult): void {
  if (!result.ok) return;
  invalidatePublicReadCache();
  revalidatePath(`/admin/institution/${result.institutionId}`);
  revalidatePath(`/institution/${result.institutionId}`);
}

/** H03 step 1: takes one published fee out of every customer-facing read, with a reason. */
export async function holdFee(feePublishedId: number, reason: string): Promise<FeeHoldResult> {
  const user = await requireAuth("approve");
  const id = validFeeId(feePublishedId);
  if (!id) return { ok: false, error: "Choose a fee to hold." };
  const cleanReason = cleanHoldReason(reason);
  if (!cleanReason) return { ok: false, error: `Give a reason of at least ${MIN_HOLD_REASON} characters.` };
  try {
    const result = await holdPublishedFee(sql, id, cleanReason, { id: user.id, name: user.display_name || user.username });
    refreshAfterHold(result);
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
    refreshAfterHold(result);
    return result;
  } catch (error) {
    console.error("[admin] fee release failed", { feePublishedId: id, error });
    return { ok: false, error: "The release could not be saved. Try again." };
  }
}
