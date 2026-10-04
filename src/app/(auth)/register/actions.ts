"use server";

import { createUserWithSession } from "@/lib/auth";
import { resolvePostLoginRedirect, sanitizeInternalRedirect } from "@/lib/safe-redirect";

export interface RegisterResult {
  success: boolean;
  error?: string;
  redirect?: string;
  /** Set when the email already has an account: where "Sign in instead" should go. */
  loginHref?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Creates a free account and signs the reader in.
 *
 * The user row comes first and Stripe is not called at all: a free signup must not fail
 * because a payment provider is unavailable. A Stripe customer is created only when the
 * user reaches checkout (see `ensureStripeCustomer`).
 */
export async function register(formData: FormData, redirectTo?: string): Promise<RegisterResult> {
  const email = formData.get("email");
  const password = formData.get("password");
  const name = optionalString(formData.get("name"));

  if (typeof email !== "string" || !email.trim()) {
    return { success: false, error: "Email is required" };
  }
  if (typeof password !== "string" || password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters" };
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(trimmedEmail)) {
    return { success: false, error: "Invalid email format" };
  }

  const destination = sanitizeInternalRedirect(redirectTo, "/account");
  const result = await createUserWithSession({
    email: trimmedEmail,
    password,
    // The consumer form does not ask for a name; the email's local part stands in and can
    // be changed on /account.
    displayName: name ?? trimmedEmail.split("@")[0],
    institutionName: optionalString(formData.get("institution_name")),
    institutionType: optionalString(formData.get("institution_type")),
    assetTier: optionalString(formData.get("asset_tier")),
    stateCode: optionalString(formData.get("state_code")),
    jobRole: optionalString(formData.get("job_role")),
  });

  if (!result.ok) {
    if (result.code === "duplicate") {
      return {
        success: false,
        error: "An account with this email already exists.",
        loginHref: `/login?from=${encodeURIComponent(destination)}`,
      };
    }
    return { success: false, error: result.message };
  }

  return { success: true, redirect: resolvePostLoginRedirect(destination, "viewer") };
}
