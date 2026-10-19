"use server";

import { getCurrentUser } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { canAccessPremium } from "@/lib/access";
import { adoptInstitution } from "@/lib/hamilton/adopt-institution";
import { PRE_CHECKOUT_INTENT } from "@/lib/pro-checkout-institution";

export async function updateProfile(formData: FormData): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const institutionName = formData.get("institution_name") as string | null;
  const institutionType = formData.get("institution_type") as string | null;
  const assetTier = formData.get("asset_tier") as string | null;
  const stateCode = formData.get("state_code") as string | null;
  const jobRole = formData.get("job_role") as string | null;

  try {
    await sql`
      UPDATE users SET institution_name = ${institutionName?.trim() || null},
       institution_type = ${institutionType || null},
       asset_tier = ${assetTier || null},
       state_code = ${stateCode || null},
       job_role = ${jobRole || null}
       WHERE id = ${user.id}`;
    return { success: true };
  } catch {
    return { success: false, error: "Failed to update profile" };
  }
}

/**
 * Onboarding step 1: the user's role, plus either a real institution picked from search
 * (which fills the profile and saves it as the Hamilton bank) or, for people outside banks
 * and credit unions, a free-text organization. Before paying, the saved bank is what
 * /subscribe prices, so it isn't asked for twice (#1958); checkout's own pick replaces it.
 */
export async function saveOnboardingProfile(formData: FormData): Promise<{
  success: boolean;
  error?: string;
  institutionName?: string;
  institutionId?: number;
}> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const jobRole = (formData.get("job_role") as string | null) || null;
  const rawInstitutionId = Number(formData.get("institution_id"));
  const institutionId = Number.isInteger(rawInstitutionId) && rawInstitutionId > 0 ? rawInstitutionId : null;

  try {
    await sql`UPDATE users SET job_role = ${jobRole} WHERE id = ${user.id}`;
    if (institutionId) {
      const institution = await adoptInstitution({
        userId: user.id,
        institutionId,
        setWorkspace: true,
        source: "profile",
        intent: canAccessPremium(user) ? "onboarding" : PRE_CHECKOUT_INTENT,
      });
      if (!institution) return { success: false, error: "That institution could not be found. Search again." };
      return { success: true, institutionName: institution.name, institutionId: institution.id };
    }

    const organization = (formData.get("institution_name") as string | null)?.trim() || null;
    const organizationType = (formData.get("institution_type") as string | null) || null;
    await sql`
      UPDATE users SET institution_name = ${organization},
       institution_type = ${organizationType}
       WHERE id = ${user.id}`;
    return { success: true };
  } catch {
    return { success: false, error: "Failed to save your profile. Try again." };
  }
}
