/** Admin hold rules shared by the server service and the admin UI (no database imports). */

/** Marks a quarantine as an admin hold, so release can tell it from an agent's quarantine. */
export const ADMIN_HOLD_PREFIX = "admin_hold:";
export const FEE_HOLD_CHECK = "admin.fee_hold";
export const MIN_HOLD_REASON = 5;
export const MAX_HOLD_REASON = 500;

export interface FeeHoldActor {
  id: number;
  name: string;
}

export type FeeHoldResult =
  | { ok: true; feePublishedId: number; institutionId: number }
  | { ok: false; error: string };

export interface HeldFee {
  feePublishedId: number;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string;
  heldAt: string;
  reason: string;
  heldBy: string | null;
  /** An agent check also took the fee down; releasing the hold does not put it back live. */
  closedByCheck: boolean;
}

/** The reason an operator typed, trimmed; null when too short or too long. Pure. */
export function cleanHoldReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.replace(/\s+/g, " ").trim();
  return reason.length >= MIN_HOLD_REASON && reason.length <= MAX_HOLD_REASON ? reason : null;
}

export function validFeeId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The operator's reason stored in `quarantine_reason`, and read back. Pure. */
export function holdReasonText(reason: string): string {
  return `${ADMIN_HOLD_PREFIX} ${reason}`;
}

export function readHoldReason(stored: string | null): string | null {
  if (!stored?.startsWith(ADMIN_HOLD_PREFIX)) return null;
  return stored.slice(ADMIN_HOLD_PREFIX.length).trim();
}
