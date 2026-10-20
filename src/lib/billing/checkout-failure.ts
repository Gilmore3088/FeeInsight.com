/** What failed, for the log: Stripe's error type, code and request id, or a database error code. Never the request body. */
export function checkoutFailure(error: unknown): Record<string, string> {
  if (!error || typeof error !== "object") return { error: String(error) };
  const fields: Record<string, string> = {};
  for (const key of ["name", "type", "code", "statusCode", "requestId", "message"] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== "") fields[key] = String(value).slice(0, 300);
  }
  return fields;
}
