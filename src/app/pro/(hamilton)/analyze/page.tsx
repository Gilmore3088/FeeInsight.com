// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import { LandingResearchResults } from "@/components/hamilton/landing/LandingResearchResults";
import { decodeLandingResearch, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AnalyzeWorkspace } from "@/components/hamilton/analyze/AnalyzeWorkspace";
import { listSavedAnalyses, loadAnalysisRecord } from "./actions";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import {
  resolveArtifactContextInstitutionId,
  shouldPersistUrlInstitutionSelection,
} from "@/lib/hamilton/artifact-context";

export const metadata: Metadata = { title: "Ask Hamilton" };

/**
 * AnalyzePage — Server component that gates and hydrates the Analyze workspace.
 * Auth enforced at the layout level (canAccessPremium), but we also verify here
 * to ensure server-side redirect on direct navigation.
 * Reads optional ?analysis= searchParam to restore a saved analysis on load.
 * Passes userId, institutionId, and initialAnalysis to the client workspace shell.
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
  const analysisId = hasResearch ? undefined : params.analysis;
  const [initialAnalysisRecord, recent] = await Promise.all([
    analysisId ? loadAnalysisRecord(analysisId) : null,
    // Only the start screen lists them; an answer page doesn't need the read.
    !analysisId && !params.q ? listSavedAnalyses(6) : [],
  ]);
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: hasResearch
      ? landingResearch?.scope.kind === "local" ? String(landingResearch.scope.institutionId) : undefined
      : params.instId,
    artifactInstitutionId: initialAnalysisRecord?.institutionId,
  });
  const isArtifactContext = !hasResearch && !params.instId && Boolean(contextInstitutionId);
  const { institution: selectedInstitution } = hasResearch && !contextInstitutionId
    ? { institution: null }
    : await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: contextInstitutionId,
    intent: params.intent ?? "analyze",
    persistUrlSelection: hasResearch ? false : shouldPersistUrlInstitutionSelection(params.instId),
    transientSource: isArtifactContext ? "artifact" : undefined,
  });

  const institutionId = selectedInstitution?.id.toString() ?? null;

  return (
    <>
      {landingResearch ? (
        <div className="mb-6">
          <LandingResearchResults selection={landingResearch} />
        </div>
      ) : null}
      <AnalyzeWorkspace
        key={`${user.id}:${hasResearch ? JSON.stringify(landingResearch) : institutionId}:${analysisId ?? "new"}`}
        userId={user.id}
        institutionId={institutionId}
        initialAnalysis={initialAnalysisRecord?.responseJson ?? null}
        initialAnalysisId={initialAnalysisRecord?.id ?? null}
        initialAnalysisPrompt={initialAnalysisRecord?.prompt ?? null}
        recent={recent}
        selectedInstitution={selectedInstitution}
        initialIntent={params.intent ?? null}
        initialQuestion={!hasResearch && params.q ? params.q.slice(0, 500) : null}
        autoSend={!hasResearch && params.send === "1"}
      />
    </>
  );
}
