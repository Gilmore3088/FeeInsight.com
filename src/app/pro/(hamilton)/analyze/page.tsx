// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import { LandingResearchResults } from "@/components/hamilton/landing/LandingResearchResults";
import { decodeLandingResearch, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AnalyzeWorkspace } from "@/components/hamilton/analyze/AnalyzeWorkspace";
import { MarketBrief } from "@/components/hamilton/intelligence/MarketBrief";
import { parseMarketQuestion } from "@/lib/hamilton/market-question";
import { listSavedAnalyses, loadAnalysisRecord } from "./actions";
import { withoutSavedClaims } from "@/lib/hamilton/saved-analysis-record";
import { SavedChangeNotice } from "./saved-change-notice";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import {
  resolveArtifactContextInstitutionId,
} from "@/lib/hamilton/artifact-context";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import { loadConversationState, loadConversationStateForSavedAnswer } from "@/lib/hamilton/chat-memory";
import {
  conversationReducer, currentTurn, emptyConversation, isConversationId, switchSubject, type HamiltonConversationState,
} from "@/lib/hamilton/conversation-state";
import { recordAnalyzeConversationAction, startAnalyzeConversationAction } from "./conversation-actions";
import { contextFeeParam } from "@/lib/hamilton/workspace/workbench";

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
  searchParams: Promise<{ analysis?: string; instId?: string; intent?: string; q?: string; send?: string; research?: string; brief?: string; conversation?: string; from_brief?: string; fee?: string }>;
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

  // A market question ("Florida: fee pricing, revenue, complaints") gets a market brief from the
  // governed readers. The server parses the question itself; anything else goes to the Ask engine.
  if (typeof params.brief === "string" && params.brief.trim()) {
    const question = params.brief.trim().slice(0, 500);
    const market = parseMarketQuestion(question);
    if (market) return <MarketBrief question={question} market={market} instId={params.instId ?? null} conversationId={isConversationId(params.conversation) ? params.conversation : null} />;
    redirect(`/pro/analyze?${new URLSearchParams({ q: question, send: "1", ...(params.instId ? { instId: params.instId } : {}) })}`);
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
  // #979 H04-T06: ?conversation= reopens this user's stored conversation (reload, back/forward,
  // or a follow-up handed back from a market brief). Another user's ID loads nothing.
  const conversationParam = !hasResearch && !params.analysis && isConversationId(params.conversation) ? params.conversation : null;
  const storedConversation = conversationParam ? await loadConversationState(conversationParam, user.id).catch(() => null) : null;
  const explicitInstitution = normalizeCanonicalInstitutionId(params.instId);
  // A different institution named in the address starts a new, visibly separate conversation.
  const switchingSubject = Boolean(storedConversation && explicitInstitution && explicitInstitution !== storedConversation.subject.institutionId);
  const resumedConversation = storedConversation && !switchingSubject ? storedConversation : null;
  // A reload shows the last answer the conversation saved; a handed-over follow-up is asked instead.
  const resumedAnswerId = resumedConversation && !params.q ? currentTurn(resumedConversation)?.savedAnalysisId ?? null : null;
  const analysisId = hasResearch ? undefined : params.analysis?.trim() || resumedAnswerId || undefined;
  const [initialAnalysisRecord, recent] = await Promise.all([
    analysisId ? loadAnalysisRecord(analysisId) : null,
    // Only the start screen lists them; an answer page doesn't need the read.
    !analysisId && !params.q ? listSavedAnalyses(6) : [],
  ]);
  // Missing, inaccessible or invalid saved IDs must not silently become a new query.
  if (analysisId && !initialAnalysisRecord && !resumedAnswerId) notFound();
  const isArtifactContext = Boolean(initialAnalysisRecord);
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: hasResearch
      ? landingResearch?.scope.kind === "local" ? String(landingResearch.scope.institutionId) : undefined
      : params.instId,
    // A resumed conversation keeps its own subject; the address or today's preference never relabels it.
    artifactInstitutionId: initialAnalysisRecord?.institutionId ?? resumedConversation?.subject.institutionId,
    preferArtifact: isArtifactContext || Boolean(resumedConversation),
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

  const { conversation: initialConversation, notice: subjectNotice } = await conversationForWorkspace({
    stored: storedConversation,
    switching: switchingSubject,
    savedAnswer: params.analysis && initialAnalysisRecord && !hasResearch
      ? await loadConversationStateForSavedAnswer(initialAnalysisRecord.id, user.id).catch(() => null)
      : null,
    fromBrief: !storedConversation && !isArtifactContext && params.q && typeof params.from_brief === "string" ? params.from_brief : null,
    subject: { institutionId, institutionName: selectedInstitution?.name ?? null },
    userId: user.id,
  });

  const workspace = (
      <AnalyzeWorkspace
        key={`${user.id}:${hasResearch ? JSON.stringify(landingResearch) : institutionId}:${analysisId ?? "new"}:${initialConversation?.conversationId ?? ""}`}
        userId={user.id}
        institutionId={institutionId}
        // A client prop: never the saved claims (#1077 step 6), whichever loader filled it.
        initialAnalysis={initialAnalysisRecord ? withoutSavedClaims(initialAnalysisRecord.responseJson) : null}
        initialAnalysisId={initialAnalysisRecord?.id ?? null}
        initialAnalysisPrompt={initialAnalysisRecord?.prompt ?? null}
        recent={recent}
        selectedInstitution={selectedInstitution}
        initialIntent={isArtifactContext ? null : params.intent ?? null}
        initialQuestion={!isArtifactContext && !hasResearch && params.q ? params.q.slice(0, 500) : null}
        autoSend={!isArtifactContext && !hasResearch && params.send === "1"}
        readOnlyReason={readOnlyReason}
        initialConversation={hasResearch ? null : initialConversation}
        subjectNotice={hasResearch ? null : subjectNotice}
        startConversationAction={startAnalyzeConversationAction}
        recordConversationAction={recordAnalyzeConversationAction}
        // A saved answer keeps its own fee; a fee page's link sets the fee for new questions (#1895).
        contextFee={isArtifactContext || hasResearch ? null : contextFeeParam(params.fee)}
      />
  );
  // H03-T09: a saved answer made before a fee change keeps its figures and says so.
  const changeNotice = initialAnalysisRecord?.changeNotice ?? null;
  const askAgainHref = changeNotice && initialAnalysisRecord?.prompt && institutionId
    ? `/pro/analyze?${new URLSearchParams({ q: initialAnalysisRecord.prompt.slice(0, 500), instId: institutionId, send: "1" })}`
    : null;
  if (changeNotice) return <>
    <SavedChangeNotice notice={changeNotice} askAgainHref={askAgainHref} />
    {workspace}
  </>;
  return landingResearch ? <>
    <div className="mb-6"><LandingResearchResults selection={landingResearch} /></div>
    {workspace}
  </> : workspace;
}

type SubjectNotice = { text: string; href?: string; linkLabel?: string };

/**
 * The conversation the workspace opens with (#979, H04-T06), checked against the institution the
 * page authorized. A stored conversation whose subject is not that institution is never shown
 * under it: a switch named in the address starts a fresh conversation that says so, and anything
 * else is dropped with a notice.
 */
async function conversationForWorkspace(input: {
  stored: HamiltonConversationState | null;
  switching: boolean;
  savedAnswer: HamiltonConversationState | null;
  fromBrief: string | null;
  subject: { institutionId: string | null; institutionName: string | null };
  userId: number;
}): Promise<{ conversation: HamiltonConversationState | null; notice: SubjectNotice | null }> {
  const { stored, subject } = input;
  if (stored && input.switching) {
    const earlierName = stored.subject.institutionName ?? "another institution";
    return {
      conversation: switchSubject(stored, subject),
      notice: {
        text: `The earlier conversation was about ${earlierName}. This is a new conversation about ${subject.institutionName ?? "the institution you chose"}; earlier answers are not carried into it.`,
        href: `/pro/analyze?${new URLSearchParams({ conversation: stored.conversationId ?? "" })}`,
        linkLabel: `Back to the conversation about ${earlierName}`,
      },
    };
  }
  if (stored) {
    if (stored.subject.institutionId !== subject.institutionId) {
      return { conversation: null, notice: { text: "This conversation's institution could not be loaded, so it was not reopened. Ask a new question below." } };
    }
    const conversation = { ...stored, subject };
    // Today's workspace institution may differ; the conversation stays about its own subject.
    const today = await resolveHamiltonInstitutionContext({ userId: input.userId, intent: "analyze", persistUrlSelection: false }).catch(() => null);
    const todayId = today?.institution?.id != null ? String(today.institution.id) : null;
    const notice = todayId && todayId !== subject.institutionId
      ? {
          text: `This conversation is about ${subject.institutionName ?? "an earlier institution"}. Your workspace is now set to ${today?.institution?.name ?? "another institution"}; follow-ups here stay about ${subject.institutionName ?? "the earlier institution"}.`,
          href: `/pro/analyze?${new URLSearchParams({ instId: todayId })}`,
          linkLabel: `Start a new conversation about ${today?.institution?.name ?? "your workspace institution"}`,
        }
      : null;
    return { conversation, notice };
  }
  if (input.savedAnswer && input.savedAnswer.subject.institutionId === subject.institutionId) {
    return { conversation: { ...input.savedAnswer, subject }, notice: null };
  }
  if (input.fromBrief?.trim()) {
    // A follow-up from a market brief opened outside a conversation: the brief is its earlier turn.
    const asked = conversationReducer(emptyConversation(subject), { type: "ask", question: input.fromBrief.slice(0, 500), route: "market_brief" });
    const turn = currentTurn(asked);
    return { conversation: turn ? conversationReducer(asked, { type: "answered", turnId: turn.id }) : asked, notice: null };
  }
  return { conversation: null, notice: null };
}
