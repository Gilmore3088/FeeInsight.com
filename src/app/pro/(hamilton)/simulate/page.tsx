// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { SimulateWorkspace } from "@/components/hamilton/simulate";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { getHamiltonContextSourceLabel } from "@/lib/hamilton/context-source";
import { getSavedPeerSets } from "@/lib/data-store/saved-peers";
import { getHamiltonScenarioById } from "@/lib/hamilton/pro-tables";
import {
  resolveArtifactContextInstitutionId,
  shouldPersistUrlInstitutionSelection,
} from "@/lib/hamilton/artifact-context";

export const metadata: Metadata = { title: "Scenario Modeling" };

/**
 * SimulatePage — Server component that gates and hydrates the Simulate workspace.
 * Auth enforced at the layout level (canAccessPremium) but also verified here
 * to ensure server-side redirect on direct navigation.
 * Passes userId and institutionContext to the client workspace shell.
 */
export default async function SimulatePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; instId?: string; scenario?: string; scenario_id?: string; peerSetId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!canAccessPremium(user)) redirect("/subscribe?from=/pro/simulate");

  const params = await searchParams;
  const initialCategory = params.category || undefined;
  const initialScenarioId = params.scenario_id || params.scenario || undefined;
  const [savedPeerSets, savedScenario] = await Promise.all([
    getSavedPeerSets(String(user.id)).catch(() => []),
    initialScenarioId
      ? getHamiltonScenarioById(initialScenarioId, user.id).catch(() => null)
      : null,
  ]);
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: params.instId,
    artifactInstitutionId: savedScenario?.institution_id,
  });
  const isArtifactContext = !params.instId && Boolean(contextInstitutionId);
  const { institution: selectedInstitution, source: selectedSource } =
    await resolveHamiltonInstitutionContext({
      userId: user.id,
      instId: contextInstitutionId,
      intent: "simulate",
      persistUrlSelection: shouldPersistUrlInstitutionSelection(params.instId),
      transientSource: isArtifactContext ? "artifact" : undefined,
    });

  const institutionId = selectedInstitution?.id.toString() ?? null;

  const institutionContext = selectedInstitution
    ? {
        name: selectedInstitution.name,
        type: selectedInstitution.charterType,
        assetTier: selectedInstitution.assetTier ?? undefined,
        fedDistrict: selectedInstitution.fedDistrict,
      }
    : {
        name: user.institution_name ?? undefined,
        type: user.institution_type ?? undefined,
        assetTier: user.asset_tier ?? undefined,
        fedDistrict: user.fed_district ?? null,
      };

  return (
    <SimulateWorkspace
      userId={user.id}
      institutionId={institutionId}
      institutionContext={institutionContext}
      initialCategory={initialCategory}
      initialScenarioId={initialScenarioId}
      peerSetId={params.peerSetId ?? null}
      savedPeerSets={savedPeerSets}
      selectedSource={selectedSource}
      selectedSourceLabel={getHamiltonContextSourceLabel(selectedSource)}
    />
  );
}
