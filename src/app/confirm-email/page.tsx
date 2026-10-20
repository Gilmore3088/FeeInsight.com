import type { Metadata } from "next";
import Link from "next/link";
import { UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_LINK, utilityButton } from "@/components/utility/form-style";
import { CONTACT_EMAIL } from "@/lib/constants";
import { sql } from "@/lib/data-store/connection";
import { markEmailConfirmed, verifyEmailConfirmToken } from "@/lib/email/email-confirm";
import { linkVerifiedInstitutions } from "@/lib/pro-institution-link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

type Outcome = "confirmed" | "invalid" | "error";

/**
 * The link in the confirmation email. The signed token binds the account id and the address,
 * so opening it proves the inbox; the address must still be the account's for it to count.
 */
async function confirm(params: Record<string, string | string[] | undefined>): Promise<Outcome> {
  const userId = Number(first(params.uid));
  const email = first(params.email);
  const token = first(params.t);
  if (!verifyEmailConfirmToken(userId, email, token)) return "invalid";
  try {
    if (!(await markEmailConfirmed(userId, email))) return "invalid";
    // A Pro buyer's institution links once their confirmed email matches its website (#1405).
    await linkVerifiedInstitutions(sql, userId).catch((error) => console.error("[confirm-email] institution link failed", error));
    return "confirmed";
  } catch {
    return "error";
  }
}

const COPY: Record<Outcome, { title: string; body: string }> = {
  confirmed: {
    title: "Your email is confirmed",
    body: "Reports you buy with this email now show on your account page.",
  },
  invalid: {
    title: "This link didn't work",
    body: "It may have expired, or the account's email has changed. Send a new link from your account page.",
  },
  error: {
    title: "We couldn't confirm your email just now",
    body: "Try the link again in a few minutes.",
  },
};

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await confirm(await searchParams);
  const copy = COPY[outcome];
  return (
    <UtilityShell>
      <UtilityHeading title={copy.title} lede={copy.body} />
      <Link href="/account" className={utilityButton("primary", { block: true })}>
        Go to your account
      </Link>
      <p className="mt-5 text-center text-[13px] text-ink-muted">
        Questions? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className={UTILITY_LINK}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </UtilityShell>
  );
}
