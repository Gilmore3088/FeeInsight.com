"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getBillingSummary } from "@/lib/billing-summary";
import { API_PLANS_LABEL, apiIncludedInTier } from "@/lib/api-subscriber-access";
import { findApiPayer, issueSubscriberKey, revokeSubscriberKeys } from "@/lib/api-subscriber-keys";

export type ApiKeyActionResult = { key: string } | { error: string };

/**
 * Makes (or replaces) the signed-in user's API key. The person who pays for a plan that
 * includes the API, and each team seat on their workspace, gets one while Pro is active;
 * the payer's plan is read live from Stripe so a stale page can't issue a key.
 */
export async function createAccountApiKey(): Promise<ApiKeyActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in again to make a key." };
  const payer = await findApiPayer(user.id).catch(() => null);
  if (!payer?.stripeCustomerId) {
    return { error: "An active Hamilton subscription is needed to make a key." };
  }
  const billing = await getBillingSummary(payer.stripeCustomerId);
  if (!billing) return { error: "We couldn't check your plan just now. Try again in a minute." };
  if (!apiIncludedInTier(billing.tier)) {
    return { error: `Your plan doesn't include the API. It comes with the ${API_PLANS_LABEL}.` };
  }
  try {
    const { key } = await issueSubscriberKey({ userId: user.id, payer });
    revalidatePath("/account");
    return { key };
  } catch (error) {
    console.error("[account] API key issue failed", error instanceof Error ? error.message : String(error));
    return { error: "The key wasn't made. Try again, or email us." };
  }
}

/** Turns off the signed-in user's subscriber key. */
export async function revokeAccountApiKey(): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in again to turn off the key." };
  try {
    await revokeSubscriberKeys(user.id);
    revalidatePath("/account");
    return { ok: true };
  } catch (error) {
    console.error("[account] API key revoke failed", error instanceof Error ? error.message : String(error));
    return { error: "The key wasn't turned off. Try again, or email us." };
  }
}
