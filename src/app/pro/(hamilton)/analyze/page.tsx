// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

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
  searchParams: Promise<{ analysis?: string; instId?: string; intent?: string; q?: string; send?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const params = await searchParams;
  const analysisId = params.analysis;
  const [initialAnalysisRecord, recent] = await Promise.all([
    analysisId ? loadAnalysisRecord(analysisId) : null,
    // Only the start screen lists them; an answer page doesn't need the read.
    !analysisId && !params.q ? listSavedAnalyses(6) : [],
  ]);
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: params.instId,
    artifactInstitutionId: initialAnalysisRecord?.institutionId,
  });
  const isArtifactContext = !params.instId && Boolean(contextInstitutionId);
  const { institution: selectedInstitution } = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: contextInstitutionId,
    intent: params.intent ?? "analyze",
    persistUrlSelection: shouldPersistUrlInstitutionSelection(params.instId),
    transientSource: isArtifactContext ? "artifact" : undefined,
  });

  const institutionId = selectedInstitution?.id.toString() ?? null;

  return (
    <AnalyzeWorkspace
      userId={user.id}
      institutionId={institutionId}
      initialAnalysis={initialAnalysisRecord?.responseJson ?? null}
      initialAnalysisId={initialAnalysisRecord?.id ?? null}
      initialAnalysisPrompt={initialAnalysisRecord?.prompt ?? null}
      recent={recent}
      selectedInstitution={selectedInstitution}
      initialIntent={params.intent ?? null}
      initialQuestion={params.q ? params.q.slice(0, 500) : null}
      autoSend={params.send === "1"}
    />
  );
}
