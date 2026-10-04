import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql, withTransaction } from "@/lib/data-store/connection";

export const SESSION_COOKIE = "fsh_session";
/** Sessions last 30 days and slide: any visit with under 15 days left renews them. */
/** Keep in step with the `interval '30 days'` renewal in `getCurrentUser`. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_RENEW_BELOW_MS = 15 * 24 * 60 * 60 * 1000;
function getCookieSecret(): string {
  const secret = process.env.BFI_COOKIE_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BFI_COOKIE_SECRET must be set in production");
  }
  return secret || "dev-secret-change-in-production";
}

function signSessionId(sessionId: string): string {
  const sig = crypto
    .createHmac("sha256", getCookieSecret())
    .update(sessionId)
    .digest("hex");
  return `${sessionId}.${sig}`;
}

function verifyAndExtractSessionId(signed: string): string | null {
  const dotIdx = signed.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const sessionId = signed.substring(0, dotIdx);
  const sig = signed.substring(dotIdx + 1);
  if (!sessionId || !sig || sig.length !== 64) return null;
  try {
    const expected = crypto
      .createHmac("sha256", getCookieSecret())
      .update(sessionId)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
    return sessionId;
  } catch {
    return null;
  }
}

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: "viewer" | "analyst" | "admin" | "premium";
  email: string | null;
  stripe_customer_id: string | null;
  subscription_status: "none" | "active" | "past_due" | "canceled";
  institution_name: string | null;
  institution_type: string | null;
  asset_tier: string | null;
  state_code: string | null;
  fed_district: number | null;
  job_role: string | null;
  interests: string | null;
}

export type Permission =
  | "view"
  | "approve"
  | "reject"
  | "edit"
  | "bulk_approve"
  | "manage_users"
  | "trigger_jobs"
  | "cancel_jobs"
  | "research"
  /** Operator console (/admin pages, actions and APIs): admin and analyst only. */
  | "operate";

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  viewer: ["view"],
  premium: ["view", "research"],
  analyst: ["view", "approve", "reject", "research", "operate"],
  admin: ["view", "approve", "reject", "edit", "bulk_approve", "manage_users", "trigger_jobs", "cancel_jobs", "research", "operate"],
};

type SqlClient = typeof sql;

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  };
}

/**
 * Inserts a session row and returns its signed cookie value. Does not touch cookies, so it
 * can run inside a transaction; call `setSessionCookie` afterwards where cookies are
 * writable (a Server Action or Route Handler).
 */
export async function issueSession(
  userId: number,
  db: SqlClient = sql,
): Promise<{ sessionId: string; signed: string; expiresAt: Date }> {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  // Sign first: a missing cookie secret must fail before a session row exists.
  const signed = signSessionId(sessionId);
  await db`
    INSERT INTO sessions (id, user_id, expires_at) VALUES (${sessionId}, ${userId}, ${expiresAt})
  `;
  return { sessionId, signed, expiresAt };
}

export async function setSessionCookie(signed: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signed, sessionCookieOptions());
}

/**
 * Re-issues the current session cookie with a fresh 30-day lifetime. The database row
 * slides in `getCurrentUser`; this keeps the browser's copy in step. Only callable where
 * cookies are writable. No-op without a valid cookie.
 */
export async function renewSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw || !verifyAndExtractSessionId(raw)) return;
  cookieStore.set(SESSION_COOKIE, raw, sessionCookieOptions());
}

export interface NewUserInput {
  email: string;
  password: string;
  displayName: string;
  institutionName?: string | null;
  institutionType?: string | null;
  assetTier?: string | null;
  stateCode?: string | null;
  jobRole?: string | null;
}

export type CreateUserResult =
  | { ok: true; userId: number }
  | { ok: false; code: "duplicate" | "error"; message: string };

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  const message = error instanceof Error ? error.message : "";
  return message.includes("unique") || message.includes("duplicate");
}

/**
 * Creates a free account and signs it in: the user row and its session in one
 * transaction, then the cookie. No Stripe call — a customer is created lazily the first
 * time the user reaches checkout or billing (see `ensureStripeCustomer`).
 */
export async function createUserWithSession(input: NewUserInput): Promise<CreateUserResult> {
  const { hashPassword } = await import("@/lib/passwords");
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  try {
    const { userId, signed } = await withTransaction(async (tx) => {
      const [row] = await tx`
        INSERT INTO users (username, email, password_hash, display_name, role,
         stripe_customer_id, subscription_status, is_active, created_at,
         institution_name, institution_type, asset_tier, state_code, job_role)
        VALUES (${email}, ${email}, ${passwordHash}, ${input.displayName.trim()}, 'viewer',
                ${null}, 'none', ${true}, NOW(),
                ${input.institutionName?.trim() || null}, ${input.institutionType || null},
                ${input.assetTier || null}, ${input.stateCode || null}, ${input.jobRole || null})
        RETURNING id
      `;
      const userId = Number(row.id);
      const session = await issueSession(userId, tx);
      return { userId, signed: session.signed };
    });
    await setSessionCookie(signed);
    return { ok: true, userId };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, code: "duplicate", message: "An account with this email already exists." };
    }
    console.error("[auth] createUserWithSession failed:", error);
    return { ok: false, code: "error", message: "Registration failed. Please try again." };
  }
}

export async function login(
  username: string,
  password: string
): Promise<User | null> {
  const rows = await sql`
    SELECT id, username, display_name, role, password_hash, email,
           stripe_customer_id,
           COALESCE(subscription_status, 'none') as subscription_status,
           institution_name, institution_type, asset_tier, state_code,
           fed_district, job_role, interests
    FROM users WHERE (username = ${username} OR email = ${username}) AND is_active = true
  `;
  const row = rows[0] as (User & { password_hash: string }) | undefined;

  if (!row) return null;

  const { verifyPassword: verifyPw } = await import("@/lib/passwords");
  const { valid } = await verifyPw(password, row.password_hash);
  if (!valid) return null;

  const { signed } = await issueSession(row.id);
  await setSessionCookie(signed);

  const { password_hash: _, ...user } = row;
  return user;
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  const sessionId = raw ? verifyAndExtractSessionId(raw) : null;

  if (sessionId) {
    await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const sessionId = verifyAndExtractSessionId(raw);
  if (!sessionId) return null;

  const rows = await sql`
    SELECT u.id, u.username, u.display_name, u.role,
           u.email, u.stripe_customer_id,
           COALESCE(u.subscription_status, 'none') as subscription_status,
           u.institution_name, u.institution_type, u.asset_tier,
           u.state_code, u.fed_district, u.job_role, u.interests,
           s.expires_at AS session_expires_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ${sessionId} AND s.expires_at > NOW() AND u.is_active = true
  `;

  const row = rows[0] as (User & { session_expires_at?: string | Date | null }) | undefined;
  if (!row) return null;
  const { session_expires_at: sessionExpiresAt, ...user } = row;
  if (shouldRenewSession(sessionExpiresAt)) {
    // Sliding expiry. A database write is allowed during render; the cookie is refreshed
    // separately by `/api/session` (`renewSessionCookie`). Never blocks or fails the read.
    sql`
      UPDATE sessions SET expires_at = NOW() + interval '30 days'
      WHERE id = ${sessionId}
    `.catch(() => {});
  }
  return user as User;
}

/** True when a session has less than 15 days left and should be extended to 30. */
export function shouldRenewSession(expiresAt: string | Date | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms - now < SESSION_RENEW_BELOW_MS;
}

export function hasPermission(user: User, permission: Permission): boolean {
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export async function requireAuth(permission?: Permission): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (permission && !hasPermission(user, permission)) {
    redirect("/admin?error=forbidden");
  }
  return user;
}
