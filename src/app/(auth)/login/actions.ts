"use server";

import { login } from "@/lib/auth";
import { headers } from "next/headers";
import { LOGIN_ATTEMPT_LIMITS, LOGIN_IDENTIFIER_MAX_LENGTH, reserveLoginAttempt } from "@/lib/api-hardening/login-rate-limit";
import { resolvePostLoginRedirect, sanitizeInternalRedirect } from "@/lib/safe-redirect";

const LOGIN_UNAVAILABLE = "Sign-in is temporarily unavailable. Please try again, or contact support if it keeps happening.";

export async function loginAction(
  formData: FormData,
  redirectTo: string,
): Promise<{ success: boolean; redirect?: string; error?: string }> {
  const username = formData.get("username");
  const password = formData.get("password");

  if (!username || !password) {
    return { success: false, error: "Email and password are required" };
  }
  if (typeof username !== "string" || typeof password !== "string" || username.length > LOGIN_IDENTIFIER_MAX_LENGTH || username.includes("\u0000") || !username.trim()) {
    return { success: false, error: "Invalid email or password" };
  }

  let user: Awaited<ReturnType<typeof login>>;
  try {
    const reservation = await reserveLoginAttempt(username, await headers());
    if (reservation === "unavailable") return { success: false, error: LOGIN_UNAVAILABLE };
    if (reservation === "limited") return { success: false, error: `Too many sign-in attempts. Please wait ${LOGIN_ATTEMPT_LIMITS.windowMinutes} minutes and try again.` };
    user = await login(username.trim(), password);
  } catch {
    // Configuration or database failures (e.g. a missing BFI_COOKIE_SECRET) must
    // surface as a message, not an unhandled action error that hangs the form.
    console.error("Login failed with a server error");
    return { success: false, error: LOGIN_UNAVAILABLE };
  }
  if (!user) {
    return { success: false, error: "Invalid email or password" };
  }

  const destination = sanitizeInternalRedirect(redirectTo, "/account");

  return {
    success: true,
    redirect: resolvePostLoginRedirect(destination, user.role),
  };
}
