// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { loadFeeFingerprint, type FeeFingerprint } from "@/lib/hamilton/fee-fingerprint";
import { FeeFingerprintView } from "@/components/hamilton/benchmark/FeeFingerprint";
import { Callout, LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = { title: "Peer group" };

/**
 * Peer group (#1893, #1894): the peer group every Hamilton screen compares with, the saved peer set
 * from Settings when there is one, and the research institution's fee position against it.
 * Deterministic: no model call on this page.
 */
export default async function PeersPage({ searchParams }: { searchParams: Promise<{ instId?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(hrefWithInstitutionContext("/pro/peers", params.instId ?? null))}`);

  const { institution } = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: params.instId ?? null,
    persistUrlSelection: false,
  }).catch(() => ({ institution: null }));
  const instId = institution ? String(institution.id) : null;

  let fingerprint: FeeFingerprint | null = null;
  let unavailable = false;
  if (institution) {
    try {
      fingerprint = await loadFeeFingerprint({ userId: user.id, institutionId: institution.id });
    } catch (error) {
      console.error("[hamilton-peers] fee fingerprint read failed", { institutionId: institution.id }, error);
      unavailable = true;
    }
  }
  const settingsHref = hrefWithInstitutionContext("/pro/settings#peer-sets", instId);

  return (
    <MemoPage>
      <MemoHeader
        kicker="Peer group"
        title={institution ? `${institution.name} against its peer group` : "Peer group"}
        dek={
          fingerprint
            ? fingerprint.saved
              ? `Every Hamilton screen compares ${institution?.name} with ${fingerprint.peerLabel}, your saved peer group.`
              : `Every Hamilton screen compares ${institution?.name} with ${fingerprint.peerLabel}, the peer group Hamilton picks. Save your own in Settings to use it on every screen.`
            : "Choose an institution to see its fee position against its peer group."
        }
        actions={<LinkButton href={settingsHref}>{fingerprint?.saved ? "Change the peer group" : "Save a peer group"}</LinkButton>}
      />

      {fingerprint ? (
        <FeeFingerprintView fingerprint={fingerprint} institutionId={instId} />
      ) : unavailable ? (
        <p role="status" className="text-sm text-terra-text">
          The fee position for {institution?.name ?? "this institution"} couldn&apos;t load just now. Please try again.
        </p>
      ) : institution ? (
        <Callout>No fee position is available for {institution.name} yet.</Callout>
      ) : (
        <LinkButton href={"/pro/settings"} primary>
          Choose a research institution
        </LinkButton>
      )}
    </MemoPage>
  );
}
