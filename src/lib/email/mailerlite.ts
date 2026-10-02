/**
 * Optional MailerLite sync for confirmed email-capture leads. Off unless
 * MAILERLITE_SYNC_ENABLED=true and MAILERLITE_API_KEY is set. Leads sync only
 * after double opt-in (confirm) and are marked unsubscribed on unsubscribe, so
 * MailerLite never holds an address that has not confirmed.
 *
 * Plain fetch, no SDK. Never throws into request paths.
 */
const MAILERLITE_SUBSCRIBERS_ENDPOINT = "https://connect.mailerlite.com/api/subscribers";

export type MailerLiteSyncResult =
  | { status: "synced"; subscriberId: string | null }
  | { status: "disabled"; reason: string }
  | { status: "failed"; error: string };

export interface MailerLiteLeadInput {
  email: string;
  subscribed: boolean;
  /** Comma-separated lead sources, stored on a MailerLite custom field when configured. */
  source?: string | null;
}

export function isMailerLiteSyncEnabled() {
  return (
    (process.env.MAILERLITE_SYNC_ENABLED || "").trim().toLowerCase() === "true" &&
    Boolean((process.env.MAILERLITE_API_KEY || "").trim())
  );
}

export function buildMailerLitePayload(input: MailerLiteLeadInput) {
  const groupId = (process.env.MAILERLITE_GROUP_ID || "").trim();
  const sourceField = (process.env.MAILERLITE_SOURCE_FIELD || "").trim();
  const payload: Record<string, unknown> = {
    email: input.email,
    status: input.subscribed ? "active" : "unsubscribed",
  };
  if (input.subscribed && groupId) payload.groups = [groupId];
  if (sourceField && input.source) payload.fields = { [sourceField]: input.source };
  return payload;
}

/** Upserts the subscriber (MailerLite's POST /subscribers is create-or-update). */
export async function syncLeadToMailerLite(input: MailerLiteLeadInput): Promise<MailerLiteSyncResult> {
  if (!isMailerLiteSyncEnabled()) {
    return { status: "disabled", reason: "MAILERLITE_SYNC_ENABLED is not true or MAILERLITE_API_KEY is missing." };
  }
  try {
    const response = await fetch(process.env.MAILERLITE_SUBSCRIBERS_ENDPOINT || MAILERLITE_SUBSCRIBERS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(process.env.MAILERLITE_API_KEY || "").trim()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildMailerLitePayload(input)),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: { id?: unknown };
      message?: unknown;
    } | null;
    if (!response.ok) {
      const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
      return { status: "failed", error: `MailerLite sync failed: ${message}` };
    }
    const id = body?.data?.id;
    return { status: "synced", subscriberId: typeof id === "string" ? id : null };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "MailerLite sync failed.",
    };
  }
}
