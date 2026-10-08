import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { describeLeadEmailConfig } from "@/lib/email/lead-notification";
import { getResendApiKey } from "@/lib/email/resend";
import { getSubscriptionTokenSecret } from "@/lib/email/subscription-token";
import { sendEmailConfirmation } from "@/lib/email/email-confirm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Admin check for outgoing email (password reset, email confirmation, alerts). Shows which
 * From address and key the server uses (key: last 4 characters only), asks Resend which
 * sending domains that key can use and whether they are verified, and with ?send=1 emails the
 * admin their own confirmation link, returning Resend's exact answer. Nothing else is sent.
 */
async function handleGET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = describeLeadEmailConfig();
  const key = getResendApiKey();
  const fromDomain = /@([^>\s]+)>?\s*$/.exec(config.from)?.[1]?.toLowerCase() ?? null;

  let domains: { name: string; status: string }[] | null = null;
  let domainsError: string | null = null;
  if (key) {
    try {
      const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
      const body = (await response.json().catch(() => null)) as { data?: { name: string; status: string }[]; message?: string } | null;
      if (response.ok) domains = (body?.data ?? []).map((d) => ({ name: d.name, status: d.status }));
      else domainsError = `${response.status} ${body?.message ?? ""}`.trim();
    } catch (err) {
      domainsError = err instanceof Error ? err.message : String(err);
    }
  }

  const send = request.nextUrl.searchParams.get("send") === "1";
  const test = send && user.email ? await sendEmailConfirmation(user.id, user.email) : null;

  return NextResponse.json({
    resendKeySet: Boolean(key),
    resendKeyLast4: key ? key.slice(-4) : null,
    from: config.from,
    fromSource: config.fromSource,
    fromDomain,
    fromDomainVerified: domains && fromDomain ? domains.some((d) => d.name === fromDomain && d.status === "verified") : null,
    domains,
    domainsError,
    tokenSecretSet: Boolean(getSubscriptionTokenSecret()),
    adminHasEmail: Boolean(user.email),
    testSend: send ? (test ?? { status: "skipped", reason: "this admin account has no email" }) : "add ?send=1 to email yourself a confirmation link",
    checkedAt: new Date().toISOString(),
  });
}

export const GET = withApiRoutePolicy("api.admin.email_check", "GET", handleGET);
