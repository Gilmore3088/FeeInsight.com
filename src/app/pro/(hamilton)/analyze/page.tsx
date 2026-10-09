// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
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
 * A saved answer's user-scoped record is authoritative for its research subject.
 * URL parameters and today's workspace preference may not relabel that answer.
 */
export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ analysis?: string; instId?: string; intent?: string; q?: string; send?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const params = await searchParams;
  const analysisId = params.analysis?.trim();
  const [initialAnalysisRecord, recent] = await Promise.all([
    analysisId ? loadAnalysisRecord(analysisId) : null,
    // Only the start screen lists them; an answer page doesn't need the read.
    !analysisId && !params.q ? listSavedAnalyses(6) : [],
  ]);
  // Missing, inaccessible or invalid saved IDs must not silently become a new query.
  if (analysisId && !initialAnalysisRecord) notFound();
  const isArtifactContext = Boolean(initialAnalysisRecord);
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: params.instId,
    artifactInstitutionId: initialAnalysisRecord?.institutionId,
    preferArtifact: isArtifactContext,
  });
  // A legacy unscoped answer stays unscoped. Calling the resolver with null here
  // would incorrectly borrow the user's current workspace institution.
  const resolved = isArtifactContext && !contextInstitutionId
    ? null
    : await resolveHamiltonInstitutionContext({
        userId: user.id,
        instId: contextInstitutionId,
        intent: isArtifactContext ? "analyze" : params.intent ?? "analyze",
        persistUrlSelection: isArtifactContext ? false : shouldPersistUrlInstitutionSelection(params.instId),
        transientSource: isArtifactContext ? "artifact" : undefined,
      });
  const selectedInstitution = resolved?.institution ?? null;
  const institutionId = selectedInstitution?.id.toString() ?? null;
  const readOnlyReason = isArtifactContext && !selectedInstitution
    ? contextInstitutionId
      ? "The institution recorded with this saved answer could not be loaded. Its original content is shown without substituting another institution."
      : "No institution was recorded with this saved answer. Its original content is shown without assigning today's workspace institution."
    : !selectedInstitution && resolved?.error ? resolved.error : null;

  return (
    <AnalyzeWorkspace
      userId={user.id}
      institutionId={institutionId}
      initialAnalysis={initialAnalysisRecord?.responseJson ?? null}
      initialAnalysisId={initialAnalysisRecord?.id ?? null}
      initialAnalysisPrompt={initialAnalysisRecord?.prompt ?? null}
      recent={recent}
      selectedInstitution={selectedInstitution}
      initialIntent={isArtifactContext ? null : params.intent ?? null}
      initialQuestion={!isArtifactContext && params.q ? params.q.slice(0, 500) : null}
      autoSend={!isArtifactContext && params.send === "1"}
      readOnlyReason={readOnlyReason}
    />
  );
}
