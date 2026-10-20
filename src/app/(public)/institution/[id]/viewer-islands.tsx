"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { useSessionChrome } from "@/components/use-session-chrome";
import { buildPublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { FeeAlertControl, type FeeAlertControlProps } from "./fee-alert-control";
import { loadAlertSubscription, loadProFinancialProfile } from "./viewer-actions";
import type { ProFinancialProfileData } from "./financial-profile-data";

// The client owns the component tree. Returning it from the server action referenced
// charts missing from the route's client manifest and crashed the page after hydration.
// Keep the heavy Pro charts lazy so signed-out visitors never load them.
const FinancialProfileSection = dynamic(
  () => import("./financial-profile-section").then((module) => module.FinancialProfileSection),
  { ssr: false },
);

/**
 * Client islands for the parts of the cached institution profile that depend on who is
 * looking (#1811, #1919). The server renders the signed-out shape for every visitor; these
 * swap in the signed-in or Pro shape once /api/session answers.
 */

interface InstitutionRef {
  institutionId: number;
  institutionName: string;
}

/**
 * "Explore Hamilton" for everyone, "Open in Hamilton" for Pro; signed-in readers go straight to Hamilton,
 * signed-out readers to the Pro plans with that screen as `from`. `to` picks the screen (analysis by
 * default, or the institution's peer sets). `label` is a plain string and `children` plain markup:
 * this is a client component, so a server page cannot pass it a function.
 */
export function HamiltonLink({
  institutionId,
  institutionName,
  className,
  label,
  to = "analyze",
  children,
}: InstitutionRef & { className: string; label?: string; to?: "analyze" | "peerSets"; children?: ReactNode }) {
  const session = useSessionChrome();
  const isPro = Boolean(session?.isPro);
  const links = buildPublicInstitutionProfileLinks({
    institutionId,
    institutionName,
    isAuthenticated: Boolean(session?.signedIn),
  });
  return (
    <Link href={to === "peerSets" ? links.peerSetsHref : links.analyzeHref} className={className}>
      {children ?? label ?? (isPro ? "Open in Hamilton" : "Explore Hamilton")}
    </Link>
  );
}

/** Shown to everyone except a known Pro reader (who already has the full profile). */
export function FreeOnly({ children }: { children: ReactNode }) {
  const session = useSessionChrome();
  return session?.isPro ? null : <>{children}</>;
}

/** Shown only once the session says Pro. Never put Pro data here: the children are in the cached page. */
export function ProOnly({ children }: { children: ReactNode }) {
  const session = useSessionChrome();
  return session?.isPro ? <>{children}</> : null;
}

/** The Pro financial profile, read per request by a server action and only for a Pro session. */
export function ProFinancialProfile(props: InstitutionRef & { charterLabel: string }) {
  const session = useSessionChrome();
  const isPro = Boolean(session?.isPro);
  const [profile, setProfile] = useState<ProFinancialProfileData | null>(null);
  const { institutionId, institutionName, charterLabel } = props;
  useEffect(() => {
    if (!isPro) return;
    let live = true;
    loadProFinancialProfile({ institutionId, institutionName, charterLabel })
      .then((data) => {
        if (live) setProfile(data);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isPro, institutionId, institutionName, charterLabel]);
  if (!isPro || profile?.institutionId !== institutionId) return null;
  return (
    <FinancialProfileSection
      isPro
      points={profile.points}
      peers={profile.peers}
      insights={profile.insights}
      regulatoryWatch={profile.regulatoryWatch}
      charterLabel={charterLabel}
      institutionName={institutionName}
      exportHref={`/api/v1/institutions?id=${institutionId}&view=benchmark&format=csv`}
    />
  );
}

/** The fee alert, starting signed out and remounted with the reader's own alert once known. */
export function FeeAlertIsland(props: Omit<FeeAlertControlProps, "initial">) {
  const session = useSessionChrome();
  const signedIn = Boolean(session?.signedIn);
  const [initial, setInitial] = useState<FeeAlertControlProps["initial"] | null>(null);
  const { institutionId } = props;
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    loadAlertSubscription(institutionId)
      .then((next) => {
        if (live) setInitial(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signedIn, institutionId]);
  const state = initial ?? { signedIn, saved: false, feeCategories: null };
  // The control keeps its own state after mount; a new key starts it from the known session.
  const key = initial ? `known-${initial.saved}` : `session-${signedIn}`;
  return <FeeAlertControl key={key} {...props} initial={state} />;
}
