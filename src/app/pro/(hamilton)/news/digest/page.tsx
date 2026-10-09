export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getWatchedStates } from "@/lib/data-store/wire-watch";
import { getWireDigest } from "@/lib/data-store/wire-digest";
import { DigestView } from "./digest-view";

export const metadata: Metadata = {
  title: "Wire digest",
};

/** The weekly Regulatory Wire digest for the reader's watched states. Read only; nothing is sent. */
export default async function WireDigestPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent("/pro/news/digest")}`);
  if (!canAccessPremium(user)) redirect(`/subscribe?from=${encodeURIComponent("/pro/news/digest")}`);

  const now = new Date();
  const watched = await getWatchedStates(user.id);
  const { digest, failed } = await getWireDigest(
    watched.map((w) => w.stateCode),
    now,
  );
  return <DigestView digest={digest} now={now} failed={failed} />;
}
