// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import { LandingResearchResults } from "@/components/hamilton/landing/LandingResearchResults";
import { decodeLandingResearch, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AnalyzeWorkspace } from "@/components/hamilton/analyze/AnalyzeWorkspace";
import { listSavedAnalyses, loadAnalysisRecord } from "./actions";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import {
  resolveArtifactContextInstitutionId,
} from "@/lib/hamilton/artifact-context";

export const metadata: Metadata = { title: "Ask Hamilton" };

/**
 * AnalyzePage — Server component that gates and hydrates the Analyze workspace.
 * Auth enforced at the layout level (canAccessPremium), but we also verify here
 * to ensure server-side redirect on direct navigation.
 * A saved answer's user-scoped record is authoritative for its research subject.
 * URL parameters and today's workspace preference may not relabel that answer.
 */
export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ analysis?: string; instId?: string; intent?: string; q?: string; send?: string; research?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") query.set(key, value);
    }
    redirect(`/login?from=${encodeURIComponent(`/pro/analyze?${query}`)}`);
  }

  let landingResearch: LandingResearchHandoff | null = null;
  let landingResearchError: string | null = null;
  if (params.research !== undefined) {
    try {
      landingResearch = decodeLandingResearch(params.research);
      if (!landingResearch || landingResearch.task !== "compare" || Boolean(params.analysis)) {
        throw new Error("Open the research selection separately from a saved artifact.");
      }
    } catch (error) {
      landingResearchError = error instanceof Error ? error.message : "Choose the research again.";
    }
  }
  // A research URL is never permission to load a different artifact, adopt a
  // saved bank, or auto-send a provider question. Invalid research fails closed.
  const hasResearch = params.research !== undefined;
  if (landingResearchError) return <p role="alert">{landingResearchError}</p>;
  const analysisId = hasResearch ? undefined : params.analysis?.trim();
  const [initialAnalysisRecord, recent] = await Promise.all([
    analysisId ? loadAnalysisRecord(analysisId) : null,
    // Only the start screen lists them; an answer page doesn't need the read.
    !analysisId && !params.q ? listSavedAnalyses(6) : [],
  ]);
  // Missing, inaccessible or invalid saved IDs must not silently become a new query.
  if (analysisId && !initialAnalysisRecord) notFound();
  const isArtifactContext = Boolean(initialAnalysisRecord);
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: hasResearch
      ? landingResearch?.scope.kind === "local" ? String(landingResearch.scope.institutionId) : undefined
      : params.instId,
    artifactInstitutionId: initialAnalysisRecord?.institutionId,
    preferArtifact: isArtifactContext,
  });
  // A legacy unscoped answer stays unscoped. Calling the resolver with null here
  // would incorrectly borrow the user's current workspace institution.
  const resolved = (isArtifactContext || hasResearch) && !contextInstitutionId
    ? null
    : await resolveHamiltonInstitutionContext({
        userId: user.id,
        instId: contextInstitutionId,
        intent: isArtifactContext ? "analyze" : params.intent ?? "analyze",
        persistUrlSelection: false,
        transientSource: isArtifactContext ? "artifact" : undefined,
      });
  const selectedInstitution = resolved?.institution ?? null;
  const institutionId = selectedInstitution?.id.toString() ?? null;
  const readOnlyReason = isArtifactContext && !selectedInstitution
    ? contextInstitutionId
      ? "The institution recorded with this saved answer could not be loaded. Its original content is shown without substituting another institution."
      : "No institution was recorded with this saved answer. Its original content is shown without assigning today's workspace institution."
    : !selectedInstitution && resolved?.error ? resolved.error : null;

  const workspace = (
      <AnalyzeWorkspace
        key={`${user.id}:${hasResearch ? JSON.stringify(landingResearch) : institutionId}:${analysisId ?? "new"}`}
        userId={user.id}
        institutionId={institutionId}
        initialAnalysis={initialAnalysisRecord?.responseJson ?? null}
        initialAnalysisId={initialAnalysisRecord?.id ?? null}
        initialAnalysisPrompt={initialAnalysisRecord?.prompt ?? null}
        recent={recent}
        selectedInstitution={selectedInstitution}
        initialIntent={isArtifactContext ? null : params.intent ?? null}
        initialQuestion={!isArtifactContext && !hasResearch && params.q ? params.q.slice(0, 500) : null}
        autoSend={!isArtifactContext && !hasResearch && params.send === "1"}
        readOnlyReason={readOnlyReason}
      />
  );
  return landingResearch ? <>
    <div className="mb-6"><LandingResearchResults selection={landingResearch} /></div>
    {workspace}
  </> : workspace;
}
