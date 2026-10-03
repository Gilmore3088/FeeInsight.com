"use server";

import { login } from "@/lib/auth";
import { resolvePostLoginRedirect, sanitizeInternalRedirect } from "@/lib/safe-redirect";

const LOGIN_UNAVAILABLE = "Sign-in is temporarily unavailable. Please try again, or contact support if it keeps happening.";

export async function loginAction(
  formData: FormData,
  redirectTo: string,
): Promise<{ success: boolean; redirect?: string; error?: string }> {
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;

  if (!username || !password) {
    return { success: false, error: "Email and password are required" };
  }

  let user: Awaited<ReturnType<typeof login>>;
  try {
    user = await login(username, password);
  } catch (error) {
    // Configuration or database failures (e.g. a missing BFI_COOKIE_SECRET) must
    // surface as a message, not an unhandled action error that hangs the form.
    console.error("Login failed with a server error:", error);
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
