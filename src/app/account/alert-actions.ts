"use server";

import { revalidatePath } from "next/cache";
import { createUserWithSession, getCurrentUser } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import {
  addAlertSubscription,
  normalizeAlertCategories,
  removeAlertSubscription,
  replaceAlertSubscription,
} from "@/lib/data-store/alerts";

/**
 * Saving a bank or credit union and its fee-change alerts, for signed-in readers and for
 * signed-out readers who create a free account in the same step. Every mutation is scoped
 * to the session's numeric user id.
 */

export type AlertActionResult =
  | { ok: true; feeCategories: string[] | null }
  | { ok: false; error: string; loginHref?: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function institutionExists(institutionId: number): Promise<boolean> {
  if (!Number.isInteger(institutionId) || institutionId <= 0) return false;
  const rows = await sql`SELECT 1 FROM institution_sources WHERE id = ${institutionId} LIMIT 1`;
  return rows.length > 0;
}

function categoriesFor(feeCategory: string | null | undefined, allFees: boolean | undefined) {
  if (allFees) return normalizeAlertCategories(null);
  return normalizeAlertCategories(feeCategory ? [feeCategory] : null);
}

function refresh(institutionId: number) {
  revalidatePath("/account");
  revalidatePath(`/institution/${institutionId}`);
}

/** Save an institution for the signed-in reader, adding `feeCategory` to what they follow. */
export async function saveInstitutionAlert(input: {
  institutionId: number;
  feeCategory?: string | null;
  allFees?: boolean;
}): Promise<AlertActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to save this institution." };

  const categories = categoriesFor(input.feeCategory, input.allFees);
  if (!categories.ok) return { ok: false, error: categories.error };
  if (!(await institutionExists(input.institutionId))) return { ok: false, error: "Institution not found." };

  // "All fees" replaces whatever was followed; a single fee is added to it.
  const saved = input.allFees
    ? await replaceAlertSubscription(user.id, input.institutionId, null)
    : await addAlertSubscription(user.id, input.institutionId, categories.categories);
  refresh(input.institutionId);
  return { ok: true, feeCategories: saved.fee_categories };
}

export async function removeInstitutionAlert(institutionId: number): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to change your alerts." };
  const removed = await removeAlertSubscription(user.id, institutionId);
  refresh(institutionId);
  return removed ? { ok: true } : { ok: false, error: "That institution was not saved." };
}

/**
 * The signed-out path on an institution page: create a free account from email and
 * password, sign in, and save the institution, in one step and without leaving the page.
 * `website` is a honeypot that real readers never fill in.
 */
export async function registerConsumerAndSaveAlert(input: {
  email: string;
  password: string;
  institutionId: number;
  feeCategory?: string | null;
  website?: string;
}): Promise<AlertActionResult> {
  if (input.website) return { ok: false, error: "Could not create the account." };

  const email = input.email?.trim().toLowerCase() ?? "";
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (typeof input.password !== "string" || input.password.length < 8) {
    return { ok: false, error: "Choose a password of at least 8 characters." };
  }

  const categories = categoriesFor(input.feeCategory, false);
  if (!categories.ok) return { ok: false, error: categories.error };
  if (!(await institutionExists(input.institutionId))) return { ok: false, error: "Institution not found." };

  const created = await createUserWithSession({
    email,
    password: input.password,
    displayName: email.split("@")[0],
  });
  if (!created.ok) {
    if (created.code === "duplicate") {
      const back = `/institution/${input.institutionId}${categories.categories ? `?fee=${categories.categories[0]}` : ""}`;
      return {
        ok: false,
        error: "You already have an account with this email.",
        loginHref: `/login?from=${encodeURIComponent(back)}`,
      };
    }
    return { ok: false, error: created.message };
  }

  const saved = await addAlertSubscription(created.userId, input.institutionId, categories.categories);
  refresh(input.institutionId);
  return { ok: true, feeCategories: saved.fee_categories };
}
