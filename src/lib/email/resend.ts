/**
 * Minimal Resend transport shared by transactional senders. Plain fetch, no SDK.
 * Every sender returns a discriminated result and never throws into request paths.
 */
export type EmailDeliveryResult =
  | { status: "sent"; providerId: string | null }
  | { status: "not_configured"; reason: string }
  | { status: "failed"; error: string };

export type EmailDeliveryStatus = EmailDeliveryResult["status"];

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export interface ResendMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  idempotencyKey?: string;
  /** Extra message headers, e.g. List-Unsubscribe for subscription mail. */
  headers?: Record<string, string>;
}

export function getResendApiKey() {
  return (process.env.RESEND_API_KEY || "").trim();
}

/** Generic transactional From address; specific senders layer their own env var on top. */
export function getTransactionalFromAddress() {
  return (process.env.TRANSACTIONAL_EMAIL_FROM || process.env.EMAIL_FROM || "").trim();
}

export function escapeHtml(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function parseProviderResponse(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function providerErrorMessage(payload: Record<string, unknown> | null, fallback: string) {
  if (!payload) return fallback;
  const direct = payload.message || payload.error;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (direct && typeof direct === "object" && "message" in direct) {
    const nested = (direct as { message?: unknown }).message;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return fallback;
}

/**
 * Sends one message through Resend. Callers are responsible for the not_configured
 * checks on their own From address; this only guards the API key.
 */
export async function sendResendEmail(
  message: ResendMessage,
  failureLabel = "the email",
): Promise<EmailDeliveryResult> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    return { status: "not_configured", reason: "RESEND_API_KEY is not configured." };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;

  const body: Record<string, unknown> = {
    from: message.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (message.replyTo) body.reply_to = message.replyTo;
  if (message.headers && Object.keys(message.headers).length > 0) body.headers = message.headers;

  try {
    const response = await fetch(process.env.RESEND_EMAIL_ENDPOINT || RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const payload = await parseProviderResponse(response);
    if (!response.ok) {
      return {
        status: "failed",
        error: providerErrorMessage(
          payload,
          `Resend returned HTTP ${response.status} while sending ${failureLabel}.`,
        ),
      };
    }

    const providerId = typeof payload?.id === "string" ? payload.id : null;
    return { status: "sent", providerId };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : `Sending ${failureLabel} failed.`,
    };
  }
}
