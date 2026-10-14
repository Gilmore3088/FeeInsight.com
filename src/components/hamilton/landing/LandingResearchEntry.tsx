import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { redirect } from "next/navigation";
import { decodeLandingResearch, landingResearchHref, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import { LandingResearchResults } from "./LandingResearchResults";
import { LandingReportConfirmation } from "./LandingReportConfirmation";

/** Mounted before generic workspace resolution: research never changes the saved bank. */
export async function LandingResearchEntry({ raw, task, conflictingArtifact = false }: {
  raw: unknown; task: LandingResearchHandoff["task"]; conflictingArtifact?: boolean;
}) {
  let selection: LandingResearchHandoff | null;
  try {
    selection = decodeLandingResearch(raw);
    if (!selection || selection.task !== task || conflictingArtifact) throw new Error("Open the research selection separately from a saved artifact.");
  } catch (error) {
    return <p role="alert">{error instanceof Error ? error.message : "Choose the research again."}</p>;
  }
  const user = await getCurrentUser();
  const from = encodeURIComponent(landingResearchHref(selection));
  if (!user) redirect(`/login?from=${from}`);
  if (!canAccessPremium(user)) redirect(`/subscribe?from=${from}&reason=pro_required`);
  return task === "compare" ? <LandingResearchResults selection={selection} /> : <LandingReportConfirmation key={JSON.stringify(selection)} selection={selection} />;
}
