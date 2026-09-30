import type { Metadata } from "next";
import Link from "next/link";
import { isSubscriptionAction } from "@/lib/email/subscription-token";
import { SubscriptionActionForm } from "./subscription-action-form";

export const metadata: Metadata = {
  title: "Email preferences",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EmailPreferencesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const action = first(params.action);
  const email = first(params.email);
  const token = first(params.token);
  const valid = isSubscriptionAction(action) && Boolean(email) && Boolean(token);

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <h1
        className="text-[1.75rem] leading-[1.15] tracking-[-0.02em] text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Email preferences
      </h1>
      {valid && action && email && token ? (
        <SubscriptionActionForm action={action} email={email} token={token} />
      ) : (
        <p className="mt-4 text-[15px] leading-relaxed text-[#5A5347]">
          This link is incomplete. Use the link from your email, or{" "}
          <Link href="/contact" className="text-[#C44B2E] underline">
            contact us
          </Link>{" "}
          and we&apos;ll update your preferences.
        </p>
      )}
    </main>
  );
}
