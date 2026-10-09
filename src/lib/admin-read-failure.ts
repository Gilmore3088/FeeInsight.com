import { randomUUID } from "node:crypto";

/**
 * When an admin section's read fails, the page names the section, the error code and a short
 * reference that is also written to the server log, so the log line for that failure can be found.
 */
export interface ReadFailure {
  /** Postgres SQLSTATE, Stripe error code, or the error's name when it has neither. */
  code: string;
  /** Short id printed on the page and in the server log line. */
  ref: string;
}

export function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; type?: unknown; name?: unknown };
    if (typeof record.code === "string" && record.code) return record.code;
    if (typeof record.type === "string" && record.type) return record.type;
    if (typeof record.name === "string" && record.name && record.name !== "Error") return record.name;
  }
  return "unknown";
}

export function logReadFailure(section: string, error: unknown): ReadFailure {
  const failure = { code: errorCode(error), ref: randomUUID().slice(0, 8) };
  console.error(`[admin-read ${failure.ref}] ${section} could not be read (${failure.code})`, error);
  return failure;
}
