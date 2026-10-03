"use server";

import { getStripe } from "@/lib/stripe";
import { hashPassword } from "@/lib/passwords";
import { withTransaction } from "@/lib/data-store/connection";
import { issueSession, setSessionCookie } from "@/lib/auth";
import { resolvePostLoginRedirect, sanitizeInternalRedirect } from "@/lib/safe-redirect";

export async function register(
  formData: FormData,
  redirectTo?: string,
): Promise<{
  success: boolean;
  error?: string;
  redirect?: string;
}> {
  const email = formData.get("email");
  const password = formData.get("password");
  const name = formData.get("name");
  const institutionName = formData.get("institution_name") as string | null;
  const institutionType = formData.get("institution_type") as string | null;
  const assetTier = formData.get("asset_tier") as string | null;
  const stateCode = formData.get("state_code") as string | null;
  const jobRole = formData.get("job_role") as string | null;

  if (typeof email !== "string" || !email.trim()) {
    return { success: false, error: "Email is required" };
  }
  if (typeof password !== "string" || password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters" };
  }
  if (typeof name !== "string" || !name.trim()) {
    return { success: false, error: "Name is required" };
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { success: false, error: "Invalid email format" };
  }

  const hashedPw = await hashPassword(password);

  let stripeCustomer;
  try {
    const stripe = getStripe();
    stripeCustomer = await stripe.customers.create({
      email: trimmedEmail,
      name: name.trim(),
    });
  } catch (e) {
    console.error("[register] Stripe customer creation failed:", e);
    return { success: false, error: "Registration failed. Please try again." };
  }

  let signedSession = "";

  try {
    try {
      await withTransaction(async (tx) => {
        const [insertRow] = await tx`
          INSERT INTO users (username, email, password_hash, display_name, role,
           stripe_customer_id, subscription_status, is_active, created_at,
           institution_name, institution_type, asset_tier, state_code, job_role)
          VALUES (${trimmedEmail}, ${trimmedEmail}, ${hashedPw}, ${name.trim()}, 'viewer',
                  ${stripeCustomer.id}, 'none', ${true}, NOW(),
                  ${institutionName?.trim() || null}, ${institutionType || null},
                  ${assetTier || null}, ${stateCode || null}, ${jobRole || null})
          RETURNING id
        `;

        signedSession = (await issueSession(Number(insertRow.id), tx)).signed;
      });
    } catch (e: unknown) {
      try {
        const stripe = getStripe();
        await stripe.customers.del(stripeCustomer.id);
      } catch { /* best effort cleanup */ }

      if (e instanceof Error && (e.message.includes("unique") || e.message.includes("duplicate"))) {
        return { success: false, error: "An account with this email already exists" };
      }
      throw e;
    }

    await setSessionCookie(signedSession);

    const destination = sanitizeInternalRedirect(redirectTo, "/account");
    return { success: true, redirect: resolvePostLoginRedirect(destination, "viewer") };
  } catch (e) {
    console.error("[register] Error:", e);
    return { success: false, error: "Registration failed. Please try again." };
  }
}
