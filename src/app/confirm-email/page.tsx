import type { Metadata } from "next";
import Link from "next/link";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { CONTACT_EMAIL } from "@/lib/constants";
import { markEmailConfirmed, verifyEmailConfirmToken } from "@/lib/email/email-confirm";

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
    return (await markEmailConfirmed(userId, email)) ? "confirmed" : "invalid";
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
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />
      <main id="main-content" className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1
          className="text-[1.75rem] leading-[1.15] tracking-[-0.02em] text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          {copy.title}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#5A5347]">{copy.body}</p>
        <Link
          href="/account"
          className="mt-6 inline-flex min-h-11 items-center rounded-md bg-[#C44B2E] px-5 text-[14px] font-semibold text-white no-underline hover:bg-[#A93D25]"
        >
          Go to your account
        </Link>
        <p className="mt-6 text-[13px] text-[#6B6255]">
          Questions? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#A93D25] hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
