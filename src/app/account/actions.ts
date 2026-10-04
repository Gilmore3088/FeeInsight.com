"use server";

import { logout, getCurrentUser } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { canAccessPremium } from "@/lib/access";
import { adoptInstitution } from "@/lib/hamilton/adopt-institution";

export async function logoutAction() {
  await logout();
}

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
 * (which fills the profile and, for Pro, anchors the Hamilton workspace) or, for people
 * outside banks and credit unions, a free-text organization.
 */
export async function saveOnboardingProfile(formData: FormData): Promise<{
  success: boolean;
  error?: string;
  institutionName?: string;
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
        setWorkspace: canAccessPremium(user),
        source: "profile",
        intent: "onboarding",
      });
      if (!institution) return { success: false, error: "That institution could not be found. Search again." };
      return { success: true, institutionName: institution.name };
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
