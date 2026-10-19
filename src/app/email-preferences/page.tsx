import type { Metadata } from "next";
import Link from "next/link";
import { isAccountUnsubscribeAction, isSubscriptionAction } from "@/lib/email/subscription-token";
import { SubscriptionActionForm } from "./subscription-action-form";
import { UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_CARD, UTILITY_LINK } from "@/components/utility/form-style";

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
  const uid = first(params.uid);
  const isAccountLink = isAccountUnsubscribeAction(action);
  const valid =
    (isSubscriptionAction(action) || (isAccountLink && Boolean(uid))) && Boolean(email) && Boolean(token);

  return (
    <UtilityShell>
      <UtilityHeading title="Email preferences" />
      {valid && action && email && token ? (
        <SubscriptionActionForm
          action={isAccountLink ? action : (action as "confirm" | "unsubscribe")}
          email={email}
          token={token}
          uid={uid}
        />
      ) : (
        <div className={UTILITY_CARD}>
          <p className="text-[15px] leading-relaxed text-ink-soft">
            This link is incomplete. Use the link from your email, or{" "}
            <Link href="/contact" className={UTILITY_LINK}>
              contact us
            </Link>{" "}
            and we&apos;ll update your preferences.
          </p>
        </div>
      )}
    </UtilityShell>
  );
}
