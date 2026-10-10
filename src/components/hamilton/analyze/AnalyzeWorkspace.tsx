"use client";

import { checkMessageFigures, confidenceFromFigureCheck, type FigureCheckResult } from "@/lib/hamilton/figure-check";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useCallback, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { ANALYSIS_FOCUS_TABS, type AnalysisFocus } from "@/lib/hamilton/navigation";
import { saveAnalysis } from "@/app/pro/(hamilton)/analyze/actions";
import { hrefWithInstitutionContext, normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { hamiltonIdentityLines, readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";
import { analyzeWorkspaceKey } from "@/lib/hamilton/artifact-context";
import { answerTitle, humanizeAnswerText, parseAnalyzeResponse, shapeHamiltonView, type ParsedResponse } from "./parse-response";
import { renderInline } from "./markdown";
import { inferFeeCategory } from "@/lib/hamilton/infer-category";
import { basketItemId } from "@/lib/hamilton/report-basket";
import { HAMILTON_VERSION } from "@/lib/hamilton/voice";
import { HAMILTON_PAUSED_MESSAGE, isHamiltonPausedText } from "@/lib/hamilton/provider-paused";
import { STANDARD_METHOD, type AuditTrail } from "@/lib/hamilton/audit-trail";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import { AddToReportButton } from "@/components/hamilton/basket/AddToReportButton";
import { DownloadAnswerPdf } from "./StructuredAsk";
import { PeerAwareStructuredAsk as StructuredAsk } from "./PeerAwareStructuredAsk";
import { StorylineView } from "@/components/hamilton/storyline/StorylineView";
import { ExhibitFrame } from "@/components/hamilton/memo/exhibit-view";
import { AuditPanel, Callout, LinkButton, MemoHeader, MemoPage, MemoSection, More, SERIF } from "@/components/hamilton/memo/memo";

type MessagePart = { type: string; text?: string; output?: unknown };

function extractTextFromMessage(message: { parts?: Array<{ type: string; text?: string }> }): string {
  return (
    message.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("") ?? ""
  );
}

/** The data lookups Hamilton made for an answer, named in plain words ("tool-getPeerFees" -> "peer fees"). */
export function lookupsUsed(parts: ReadonlyArray<MessagePart> | undefined): string[] {
  const names = new Set<string>();
  for (const p of parts ?? []) {
    if (!p.type.startsWith("tool-")) continue;
    const words = p.type
      .slice(5)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .toLowerCase()
      .replace(/^(get|search|lookup|fetch|load|query)\s+/, "")
      .trim();
    if (words) names.add(words);
  }
  return [...names];
}

/**
 * Plain words for a failed request. The server answers with JSON `{ error }`; the AI SDK hands it
 * over as the error's message text.
 */
export function askErrorMessage(error: Error | undefined): string {
  let text = error?.message ?? "";
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    text = parsed.error ?? parsed.message ?? text;
  } catch {
    // Not JSON: keep the text.
  }
  if (/AI service not configured|ANTHROPIC_API_KEY/i.test(text)) {
    return "Hamilton's AI isn't switched on in this preview copy of the site, so it can't answer here. Questions work on feeinsight.com.";
  }
  if (/Hamilton AI requests for today/.test(text)) return text;
  // The provider's usage or billing limit (sent by the route as the paused line).
  if (isHamiltonPausedText(text) || /usage limit|credit balance is too low/i.test(text)) return HAMILTON_PAUSED_MESSAGE;
  if (/Emergency stop|budget|circuit/i.test(text)) {
    return "Hamilton's AI is paused right now while spending is checked, so it can't answer. Everything else on Fee Insight still works.";
  }
  return "Hamilton couldn't finish this answer. Your question is back in the box below.";
}

/** The trail under an answer: what Hamilton read, how its figures were checked, and when. */
export function answerAuditTrail(input: {
  lookups: string[];
  figureCheck: FigureCheckResult | null;
  institutionName: string | null;
  preparedAt: string;
}): AuditTrail {
  const { figureCheck } = input;
  return {
    evidence: "Market data only",
    sources: [
      {
        label: "Bank Fee Index data",
        detail: input.lookups.length
          ? `Looked up for this answer: ${input.lookups.join(", ")}.`
          : "Published fee schedules, peer groups, call reports and complaints, read through Hamilton's data tools.",
        asOf: input.preparedAt.slice(0, 10),
      },
      ...(input.institutionName
        ? [{ label: "Research subject", detail: `${input.institutionName}'s published fees and filings.`, asOf: null }]
        : []),
    ],
    method: [
      "Hamilton answers only from its data tools. It doesn't browse the web or use figures from memory.",
      "Every dollar amount and percentage in the answer is checked against what those tools returned; any that don't match are flagged above the answer.",
      ...STANDARD_METHOD.slice(0, 2),
    ],
    assumptions: figureCheck
      ? [
          figureCheck.checked === 0
            ? "The answer states no dollar amounts or percentages to check."
            : figureCheck.unmatched.length === 0
              ? `All ${figureCheck.checked} figures in the answer traced to the data Hamilton looked up.`
              : `${figureCheck.checked - figureCheck.unmatched.length} of ${figureCheck.checked} figures traced to the data; ${figureCheck.unmatched.join(", ")} did not.`,
        ]
      : ["This answer was saved earlier; its figure check isn't stored with it."],
    ownFeeRows: [],
    clientFacts: [],
    peerGroup: null,
    engineVersion: `Ask, voice ${HAMILTON_VERSION}`,
    preparedAt: input.preparedAt,
  };
}

interface AnalyzeWorkspaceProps {
  userId: number;
  institutionId: string | null;
  selectedInstitution?: HamiltonSelectedInstitutionContext | null;
  initialIntent?: string | null;
  /** Pre-populated analysis loaded from hamilton_saved_analyses via ?analysis= searchParam */
  initialAnalysis?: AnalyzeResponse | null;
  initialAnalysisId?: string | null;
  /** The question a reopened saved answer was asked with */
  initialAnalysisPrompt?: string | null;
  /** The reader's latest saved answers, listed on the Ask start screen to reopen. */
  recent?: Array<{ id: string; title: string; updated_at: string }>;
  /** A question handed over from another page or the Ask bar */
  initialQuestion?: string | null;
  /** True when the question came from the Ask bar, so it is sent on arrival rather than retyped */
  autoSend?: boolean;
  /** Keep saved content readable without guessing a missing or unavailable subject. */
  readOnlyReason?: string | null;
}

/**
 * Ask Hamilton: one question, one memo. The answer reads like the rest of the workspace: the
 * question as the heading, Hamilton's answer, why it matters, the evidence, where to look next
 * and how it was built. Hamilton shows evidence; it never recommends a price.
 */
/**
 * Each Ask starts a fresh written answer, so a follow-up ("how does this compare nationally?")
 * carries the question before it; otherwise "this" has nothing to point at.
 */
export function withEarlierQuestion(question: string, earlier: string): string {
  if (!earlier || earlier === question) return question;
  return `${question}\n\n(For context, my previous question was: "${earlier}")`;
}

/**
 * The Evidence rows ("- Label: Value — note") drawn as figure tiles in the shared exhibit frame;
 * a row with no value is a group heading. The figures are the answer's own, unchanged.
 */
export function EvidenceExhibit({ rows }: { rows: ParsedResponse["evidence"] }) {
  const groups: { heading: string | null; items: { label: string; value: string; note?: string }[] }[] = [];
  for (const m of rows) {
    const label = m.label.replace(/^\*+|\*+$/g, "").trim();
    const value = m.value.replace(/^\*\*\s*|\s*\*\*$/g, "").trim();
    if (!value && !m.note) {
      groups.push({ heading: label, items: [] });
      continue;
    }
    if (groups.length === 0) groups.push({ heading: null, items: [] });
    groups[groups.length - 1].items.push({ label, value, note: m.note });
  }
  return (
    <ExhibitFrame title="The figures behind this answer" sources={[]}>
      <div className="flex flex-col gap-4">
        {groups
          .filter((g) => g.items.length > 0)
          .map((g, gi) => (
            <section key={gi} className="flex flex-col gap-2">
              {g.heading ? <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-warm-600">{g.heading}</h3> : null}
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((m, i) => (
                  <div key={i} className="flex min-w-0 flex-col gap-1 rounded-lg border border-warm-200 bg-warm-100/50 px-4 py-3">
                    <dt className="text-xs leading-tight text-warm-600">{m.label}</dt>
                    <dd className="text-2xl leading-tight text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                      {m.value ? renderInline(m.value) : null}
                    </dd>
                    {m.note ? <dd className="text-xs leading-snug text-warm-700">{renderInline(m.note)}</dd> : null}
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>
    </ExhibitFrame>
  );
}

const ASK_STAGES = [
  { key: "reading", label: "Reading the data" },
  { key: "writing", label: "Writing it up" },
] as const;

/**
 * One progress strip for the whole ask, from the moment it is sent: the stage it is at, one clock
 * that never restarts between stages, and Stop while an answer is being written. No step is
 * claimed done that the server has not reported.
 */
export function WrittenAnswerProgress({
  stage = "writing",
  startedAt,
  onStop,
}: {
  stage?: "reading" | "writing";
  /** When the question was sent; the clock counts from here across both stages. */
  startedAt?: number | null;
  onStop?: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = startedAt ?? Date.now();
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const at = ASK_STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warm-200 bg-warm-100/60 px-4 py-4">
      <ol aria-label="Progress" className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em]">
        {ASK_STAGES.map((s, i) => (
          <li key={s.key} className={`flex items-center gap-2 ${i <= at ? "text-terra-text" : "text-warm-500"}`}>
            {i > 0 ? <span aria-hidden className={`h-px w-6 ${i <= at ? "bg-terra" : "bg-warm-300"}`} /> : null}
            <span aria-current={i === at ? "step" : undefined}>{s.label}</span>
          </li>
        ))}
      </ol>
      {/* Only the sentence is announced; a counter in a live region is read out every second. */}
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-warm-900">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin text-terra" />
        {stage === "reading"
          ? "Hamilton is reading the selected institution and market data."
          : "Hamilton is writing this answer from the fee data and filings."}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-warm-700">
        <p>
          {stage === "reading" ? "Most answers start within a few seconds." : "Written answers can take up to a minute."}{" "}
          <span aria-hidden="true" className="[font-variant-numeric:tabular-nums]">{seconds}s so far.</span>
        </p>
        {onStop ? (
          <button type="button" onClick={onStop} className="min-h-11 rounded-md border border-warm-300 bg-warm-50 px-3 text-sm text-warm-800 hover:border-warm-500 sm:min-h-9">
            Stop
          </button>
        ) : null}
      </div>
      <div className="space-y-2" aria-hidden="true">
        <div className="skeleton h-5 w-full rounded" />
        <div className="skeleton h-5 w-4/6 rounded" />
        <div className="skeleton h-4 w-5/6 rounded" />
      </div>
    </div>
  );
}

/** State belongs to a user, research subject and saved answer, never just a screen position. */
export function AnalyzeWorkspace(props: AnalyzeWorkspaceProps) {
  return <AnalyzeConversationWorkspace key={analyzeWorkspaceKey({
    userId: props.userId,
    institutionId: props.selectedInstitution?.id ?? props.institutionId,
    analysisId: props.initialAnalysisId,
    question: props.initialQuestion,
    intent: props.initialIntent,
    readOnly: Boolean(props.readOnlyReason),
  })} {...props} />;
}

function AnalyzeConversationWorkspace({
  userId,
  institutionId,
  selectedInstitution,
  initialIntent,
  initialAnalysis,
  initialAnalysisId = null,
  initialAnalysisPrompt = null,
  recent = [],
  initialQuestion = null,
  autoSend = false,
  readOnlyReason = null,
}: AnalyzeWorkspaceProps) {
  // The focus lens still shapes the prompt from deep links; there are no lens tabs on screen.
  const focus = useRef<AnalysisFocus>(focusForIntent(initialIntent));
  const [parsedResponse, setParsedResponse] = useState<ParsedResponse | null>(() => {
    if (!initialAnalysis) return null;
    return {
      hamiltonView: humanizeAnswerText(initialAnalysis.hamiltonView),
      whatThisMeans: humanizeAnswerText(initialAnalysis.whatThisMeans),
      whyItMatters: initialAnalysis.whyItMatters.map(humanizeAnswerText),
      evidence: initialAnalysis.evidence.metrics.map((m) => ({
        ...m,
        label: humanizeAnswerText(m.label),
        value: humanizeAnswerText(m.value),
      })),
      exploreFurther: initialAnalysis.exploreFurther,
    };
  });
  const [input, setInput] = useState(() => (initialQuestion && !initialAnalysis ? initialQuestion : ""));
  const [isExporting, setIsExporting] = useState(false);
  const [savedAnalysisId, setSavedAnalysisId] = useState<string | null>(initialAnalysisId);
  const [answerIdentity, setAnswerIdentity] = useState(() => readHamiltonIdentitySnapshot(initialAnalysis?.identityContext));
  const [figureCheck, setFigureCheck] = useState<FigureCheckResult | null>(null);
  const [lookups, setLookups] = useState<string[]>([]);
  const [answeredAt, setAnsweredAt] = useState<string>(() => new Date().toISOString());
  const [exportError, setExportError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  // Bumped on every ask, so asking the same question again (or Try again) really asks again.
  const [askSeq, setAskSeq] = useState(0);
  // A new conversation drops the engine's decision context along with the earlier answers.
  const [conversation, setConversation] = useState(0);
  // Earlier questions in this conversation and their one-line answers, oldest first.
  const [thread, setThread] = useState<Array<{ question: string; lead: string | null }>>([]);
  const [engineBusy, setEngineBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [storyLead, setStoryLead] = useState<string | null>(null);
  const currentLeadRef = useRef<string | null>(null);
  const answerHeadingRef = useRef<HTMLDivElement>(null);
  const lastPromptRef = useRef<string>("");
  // The question before this one, so a follow-up's written answer knows what "this" refers to.
  const previousPromptRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const active = useRef(true);
  const answerGeneration = useRef(0);

  const { messages, sendMessage, status, setMessages, error: chatError, clearError, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/research/hamilton",
      body: () => ({
        mode: "analyze",
        analysisFocus: focus.current,
        institutionId: selectedInstitution?.id ?? null,
        intent: initialIntent ?? "analyze",
        evidencePolicy: "provisional-first",
      }),
    }),
    onFinish: async ({ message, isError, isAbort }) => {
      const content = extractTextFromMessage(message);
      // A failed or empty reply is never shown as an answer, and never saved.
      if (!active.current || readOnlyReason || isError || isAbort || !content.trim()) return;
      const generation = answerGeneration.current;
      const parsed = parseAnalyzeResponse(content);
      const parts = message.parts as ReadonlyArray<MessagePart>;
      const check = checkMessageFigures(parts);
      setFigureCheck(check);
      setLookups(lookupsUsed(parts));
      setAnsweredAt(new Date().toISOString());
      setParsedResponse(parsed);
      setAnswerIdentity(readHamiltonIdentitySnapshot((message.metadata as { hamiltonIdentity?: unknown } | undefined)?.hamiltonIdentity));
      setSavedAnalysisId(null);
      setSaveError(null);

      // The route saves the answer itself and sends the row's id, so a reload mid-stream loses
      // nothing; the browser saves only when an older route sent no id.
      const serverSaved = (message.metadata as { savedAnalysisId?: string } | undefined)?.savedAnalysisId;
      if (serverSaved) {
        setSavedAnalysisId(serverSaved);
        return;
      }
      if (userId) {
        const result = await saveAnalysis({
          institutionId: normalizeCanonicalInstitutionId(selectedInstitution?.id ?? institutionId) ?? "",
          analysisFocus: focus.current,
          prompt: lastPromptRef.current,
          responseJson: {
            title: answerTitle(parsed.hamiltonView),
            confidence: confidenceFromFigureCheck(check),
            hamiltonView: parsed.hamiltonView,
            whatThisMeans: parsed.whatThisMeans,
            whyItMatters: parsed.whyItMatters,
            evidence: { metrics: parsed.evidence },
            exploreFurther: parsed.exploreFurther,
          } satisfies AnalyzeResponse,
        });
        if (!active.current || generation !== answerGeneration.current) return;
        if ("id" in result) setSavedAnalysisId(result.id);
        else setSaveError("This answer couldn't be saved to your history.");
      }
    },
  });

  // Unmounted conversations cannot send a late fallback or update a newer view.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      stop();
    };
  }, [stop]);

  const isLoading = status === "streaming" || status === "submitted";

  // A failed request must never lose the question: put it back in the input.
  useEffect(() => {
    if (chatError && lastPromptRef.current) {
      setInput((current) => current || lastPromptRef.current);
    }
  }, [chatError]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  const answerInProse = useCallback(
    (question: string) => {
      if (!active.current || readOnlyReason || question !== lastPromptRef.current) return;
      sendMessage({ text: withEarlierQuestion(question, previousPromptRef.current) });
    },
    [sendMessage, readOnlyReason],
  );

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!active.current || readOnlyReason || !trimmed || isLoading || engineBusy) return;
      answerGeneration.current += 1;
      if (lastPromptRef.current && lastPromptRef.current !== trimmed) {
        previousPromptRef.current = lastPromptRef.current;
        // The answer just read moves up into the conversation, collapsed to its question and lead.
        const earlier = lastPromptRef.current;
        setThread((t) => [...t, { question: earlier, lead: currentLeadRef.current }]);
      }
      lastPromptRef.current = trimmed;
      setStartedAt(Date.now());
      setStoryLead(null);
      clearError();
      setParsedResponse(null);
      setAnswerIdentity(null);
      setFigureCheck(null);
      setAskedQuestion(trimmed);
      setAskSeq((n) => n + 1);
      setMessages([]);
      // The engine answers first. A storyline answer gets Hamilton's memo in place; only a
      // question without one is sent on for a written answer (onNoStoryline below), so one
      // question never pays for two write-ups.
      setInput("");
      // On a phone the keyboard fights a scroll, so it closes first.
      if (window.innerWidth < 640) textareaRef.current?.blur();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [clearError, isLoading, engineBusy, readOnlyReason, setMessages],
  );

  /** Starts over: no earlier answers, no carried context, the start screen. */
  const newQuestion = useCallback(() => {
    if (isLoading) stop();
    answerGeneration.current += 1;
    clearError();
    setThread([]);
    previousPromptRef.current = "";
    lastPromptRef.current = "";
    setEngineBusy(false);
    setAskedQuestion(null);
    setParsedResponse(null);
    setAnswerIdentity(null);
    setStoryLead(null);
    setMessages([]);
    setConversation((c) => c + 1);
    setInput("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    textareaRef.current?.focus();
  }, [clearError, isLoading, setMessages, stop]);

  // A storyline answer for a fee picked after a written answer replaces that answer.
  const dropWrittenAnswer = useCallback(() => {
    if (isLoading) stop();
    setParsedResponse(null);
    setMessages([]);
  }, [isLoading, setMessages, stop]);

  // A question typed in the Ask bar on another screen is answered here without retyping it.
  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSend && initialQuestion && !initialAnalysis && !autoSent.current) {
      autoSent.current = true;
      // Drop send=1 from the address so a reload doesn't ask (and pay) again.
      const url = new URL(window.location.href);
      url.searchParams.delete("send");
      window.history.replaceState(null, "", url.toString());
      ask(initialQuestion);
    }
  }, [autoSend, initialQuestion, initialAnalysis, ask]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    ask(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter that confirms an IME composition (Japanese, Chinese) is not a send.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(input);
    }
  }

  const handleExportPdf = useCallback(async () => {
    if (readOnlyReason || !parsedResponse || isExporting) return;
    if (!savedAnalysisId) {
      setExportError(
        saveError
          ? "This answer wasn't saved, so it can't be made into a PDF. Ask it again to save it."
          : "This answer is still being saved. Try the download again in a moment.",
      );
      return;
    }
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/pro/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "analysis", analysisId: savedAnalysisId }),
      });
      if (!res.ok) {
        setExportError("The PDF couldn't be created. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hamilton-answer-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setExportError("The PDF couldn't be created. Check your connection and try again.");
    } finally {
      setIsExporting(false);
    }
  }, [parsedResponse, isExporting, savedAnalysisId, saveError, readOnlyReason]);

  // Live-parse streaming content for progressive rendering. Only the reply to the question just
  // sent counts; an earlier answer must not stand in for it.
  const lastMessage = messages[messages.length - 1];
  const streamingContent = lastMessage?.role === "assistant" ? extractTextFromMessage(lastMessage) : "";
  // A stream that so far holds only a section heading has nothing to read yet; the progress note stays.
  const streamingHasText = streamingContent.replace(/^#+[^\n]*$/gm, "").trim().length > 0;
  const liveParsed = isLoading && streamingHasText ? parseAnalyzeResponse(streamingContent) : null;
  const shown = chatError && !isLoading ? null : (parsedResponse ?? liveParsed);
  const view = shown ? shapeHamiltonView(shown.hamiltonView) : { lead: "", paragraphs: [] };
  const feeCategory = view.lead ? inferFeeCategory(view.lead) : null;
  const feeName = feeCategory ? getDisplayName(feeCategory).replace(/\s*\([^)]*\)\s*$/, "").toLowerCase() : null;
  const instId = normalizeCanonicalInstitutionId(selectedInstitution?.id ?? institutionId);
  const complete = !isLoading && parsedResponse !== null && Boolean(view.lead);
  const instName = answerIdentity?.researchInstitutionName ?? selectedInstitution?.name ?? null;
  currentLeadRef.current = view.lead || storyLead || null;
  // A reopened storyline answer is shown with its charts, as it was first answered.
  const reopenedStory = conversation === 0 && !askedQuestion && initialAnalysis?.storyline ? initialAnalysis.storyline : null;
  const proseActive = isLoading || Boolean(shown && view.lead);
  const showProgress = Boolean(askedQuestion) && (engineBusy || (isLoading && !(shown && view.lead)));
  const longQuestion = (askedQuestion ?? initialAnalysisPrompt ?? "").length > 120;
  const suggestions = [
    "How does this institution's overdraft fee compare with local competitors?",
    "Which of this institution's fees sit furthest from its peers, and by how much?",
    "Who in this institution's state changed their NSF fee this year?",
  ];

  // The ask box sits in the page, never over it: under the heading before the first question,
  // and after the answer once there is one, so it never covers a line of the answer.
  const askBox = readOnlyReason ? null : (
    <form
      id="hamilton-ask"
      onSubmit={handleSubmit}
      aria-label="Ask Hamilton"
      className="flex scroll-mb-8 flex-col gap-2 rounded-xl border-2 border-terra bg-terra-soft p-3 shadow-sm print:hidden sm:p-4"
    >
      <label htmlFor="hamilton-ask-page" className="text-sm font-semibold text-terra-text">
        {askedQuestion || shown ? "Ask a follow-up" : "Your question"}
      </label>
      <div className="flex items-end gap-2 rounded-lg border border-terra/40 bg-white p-2 pl-3 focus-within:border-terra">
        <textarea
          id="hamilton-ask-page"
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={500}
          placeholder={askedQuestion || shown ? "What about this institution’s NSF fee?" : "Ask about the selected institution or market"}
          className="min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-relaxed text-warm-900 placeholder:text-warm-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isLoading || engineBusy || !input.trim()}
          aria-label="Ask"
          className="flex min-h-11 items-center gap-1.5 rounded-md bg-terra px-4 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-50 sm:min-h-9"
        >
          {isLoading || engineBusy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <ArrowUp aria-hidden className="h-4 w-4" />}
          Ask
        </button>
      </div>
    </form>
  );

  return (
    <MemoPage>
      {readOnlyReason ? (
        <Callout>
          <p>{readOnlyReason} Follow-ups and exports are disabled for this view.</p>
          <a href="/pro/analyze" className="font-medium text-terra-text underline">Start a new question</a>
        </Callout>
      ) : null}
      {chatError && !isLoading ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-terra bg-terra-soft px-4 py-3 text-sm text-warm-900">
          <span>{askErrorMessage(chatError)}</span>
          {lastPromptRef.current ? (
            <button type="button" onClick={() => ask(lastPromptRef.current)} className="font-medium text-terra-text underline">
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {thread.length > 0 && askedQuestion ? (
        <section aria-label="Earlier in this conversation" className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-warm-600">Earlier in this conversation</p>
          <ol className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50">
            {thread.map((t, i) => (
              <li key={i} className="flex flex-col gap-0.5 px-4 py-3">
                <p className="text-warm-900" style={SERIF}>{t.question}</p>
                {t.lead ? <p className="line-clamp-2 text-sm text-warm-700">{renderInline(t.lead)}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {askedQuestion || shown ? (
        <div ref={answerHeadingRef} tabIndex={-1} className="focus:outline-none">
          <MemoHeader
            kicker={instName ? `You asked · ${instName}` : "You asked"}
            title={askedQuestion ?? initialAnalysisPrompt ?? "A saved answer"}
            compact={longQuestion}
            dek={thread.length > 0 && askedQuestion ? `Following up on: “${thread[thread.length - 1].question}”` : undefined}
            actions={readOnlyReason ? undefined : (
              <div className="flex flex-wrap gap-2">
              <a
                href="#hamilton-ask"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById("hamilton-ask")?.scrollIntoView({ behavior: "smooth", block: "end" });
                  textareaRef.current?.focus({ preventScroll: true });
                }}
                className="inline-flex min-h-11 items-center rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 no-underline hover:border-warm-500 sm:min-h-9"
              >
                Ask a follow-up
              </a>
              <button
                type="button"
                onClick={newQuestion}
                className="inline-flex min-h-11 items-center rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 hover:border-warm-500 sm:min-h-9"
              >
                New question
              </button>
              </div>
            )}
          />
        </div>
      ) : (
        <>
          <MemoHeader
            kicker="Ask Hamilton"
            title={instName ? `Ask anything about ${instName}'s fees` : "Ask about bank and credit union fees"}
            dek="Answers from published fee schedules and regulator filings, with every figure checked."
          />
          {/* Wide screens: ask and starters on the left, recent answers on the right. */}
          <div className={`grid gap-8 ${recent.length > 0 ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" : ""}`}>
            <div className="flex min-w-0 flex-col gap-8">
              {askBox}
              <MemoSection title="Questions bankers start with">
                <ul className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50">
                  {suggestions.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => {
                          setInput(s);
                          textareaRef.current?.focus();
                        }}
                        className="w-full px-4 py-3 text-left text-warm-900 hover:bg-warm-100"
                        style={SERIF}
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </MemoSection>
            </div>
            {recent.length > 0 ? (
              <MemoSection title="Your recent questions">
                <ul className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <a
                        href={hrefWithInstitutionContext(`/pro/analyze?analysis=${encodeURIComponent(r.id)}`, instId)}
                        className="flex min-h-11 items-baseline justify-between gap-4 px-4 py-3 text-warm-900 no-underline hover:bg-warm-100"
                      >
                        <span className="min-w-0" style={SERIF}>{r.title}</span>
                        <span className="shrink-0 text-xs text-warm-600">{shortDate(r.updated_at)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </MemoSection>
            ) : null}
          </div>
        </>
      )}

      {showProgress ? (
        <WrittenAnswerProgress stage={engineBusy ? "reading" : "writing"} startedAt={startedAt} onStop={isLoading ? stop : undefined} />
      ) : !askedQuestion && isLoading && !(shown && view.lead) ? (
        <WrittenAnswerProgress />
      ) : null}
      <p role="status" className="sr-only">
        {complete ? "Answer ready." : ""}
      </p>

      {answerIdentity && (shown || reopenedStory) ? (
        <aside aria-label="Saved answer institution context" className="text-sm text-warm-700">
          {hamiltonIdentityLines(answerIdentity).map(line => <p key={line}>{line}</p>)}
        </aside>
      ) : initialAnalysis && conversation === 0 && !askedQuestion ? (
        <p className="text-sm text-warm-600">Historical account and peer context was not recorded with this answer.</p>
      ) : null}

      {reopenedStory ? (
        <StorylineView
          story={reopenedStory}
          identityContext={answerIdentity}
          memo={initialAnalysis?.memo ? { state: "written", memo: initialAnalysis.memo } : undefined}
          nextSteps={initialAnalysisId && !readOnlyReason ? <DownloadAnswerPdf analysisId={initialAnalysisId} /> : null}
        />
      ) : null}

      <div className="flex flex-col gap-8">
      {askedQuestion ? (
        <div className={proseActive ? "order-last" : undefined}>
        <StructuredAsk
          key={conversation}
          question={askedQuestion}
          nonce={askSeq}
          onStoryline={dropWrittenAnswer}
          onBusyChange={setEngineBusy}
          onLead={setStoryLead}
          institutionId={instId}
          modelHrefFor={(fee, tested) => hrefWithInstitutionContext(`/pro/simulate?fee=${encodeURIComponent(fee)}&prices=${tested}`, instId)}
          researchHrefFor={(fee) => hrefWithInstitutionContext(`/pro/research?fee=${encodeURIComponent(fee)}`, instId)}
          onNoStoryline={answerInProse}
        />
        </div>
      ) : null}

      {shown && view.lead && !reopenedStory ? (
        <div className="flex flex-col gap-8">
          {/* The figures lead and the prose follows, so a written answer opens on an exhibit. */}
          {shown.evidence.length > 0 ? <EvidenceExhibit rows={shown.evidence} /> : null}
          <article className="flex max-w-[68ch] flex-col gap-4">
            {askedQuestion ? (
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-warm-600">Hamilton&apos;s commentary</h2>
            ) : null}
            <p className={askedQuestion ? "text-xl leading-snug text-warm-900" : "text-2xl leading-snug text-warm-900 sm:text-[1.7rem]"} style={SERIF}>
              {renderInline(view.lead)}
            </p>
            {view.paragraphs.slice(0, 1).map((para, i) => (
              <p key={i} className="text-base leading-relaxed text-warm-800 [font-variant-numeric:tabular-nums]">
                {renderInline(para)}
              </p>
            ))}
            {view.paragraphs.length > 1 || shown.whatThisMeans || shown.whyItMatters.length > 0 ? (
              <More label="Read the full answer">
                {view.paragraphs.slice(1).map((para, i) => (
                  <p key={i} className="text-base leading-relaxed text-warm-800 [font-variant-numeric:tabular-nums]">
                    {renderInline(para)}
                  </p>
                ))}
                {shown.whatThisMeans ? (
                  <p className="text-base leading-relaxed text-warm-800">{renderInline(shown.whatThisMeans)}</p>
                ) : null}
                {shown.whyItMatters.length > 0 ? (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">Why it matters</h3>
                    <ul className="flex list-disc flex-col gap-2 pl-5 text-base text-warm-800">
                      {shown.whyItMatters.map((item, i) => (
                        <li key={i}>{renderInline(item)}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </More>
            ) : null}
          </article>

          {complete && figureCheck && figureCheck.unmatched.length > 0 ? (
            <Callout>
              <strong>Check these figures:</strong> {figureCheck.unmatched.join(", ")} could not be traced to the data
              Hamilton looked up for this answer. Treat them as unverified.
            </Callout>
          ) : null}


          {complete ? (
            <>
              {!readOnlyReason ? <div className="flex flex-wrap items-center gap-3">
                <LinkButton
                  href={hrefWithInstitutionContext(feeCategory ? `/pro/research?fee=${encodeURIComponent(feeCategory)}` : "/pro/research", instId)}
                  primary
                >
                  {feeName ? `Look closer at ${feeName}` : "Look closer at this institution"}
                </LinkButton>
                <LinkButton href={hrefWithInstitutionContext(feeCategory ? `/pro/simulate?fee=${encodeURIComponent(feeCategory)}` : "/pro/simulate", instId)}>
                  Try a price
                </LinkButton>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={isExporting}
                  className="rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm text-warm-800 hover:border-warm-500 disabled:opacity-50"
                >
                  {isExporting ? "Preparing the PDF…" : "Download PDF"}
                </button>
                <AddToReportButton
                  variant="link"
                  item={{
                    id: basketItemId("Ask", instId, view.lead),
                    source: "Ask",
                    title: view.lead,
                    detail: [view.paragraphs.join(" "), shown.whatThisMeans].filter(Boolean).join(" "),
                    feeCategory,
                    institutionId: instId,
                    savedAnalysisId,
                    ...(answerIdentity ? { identityContext: answerIdentity } : {}),
                  }}
                />
              </div> : null}
              {exportError ? (
                <p role="alert" className="text-sm text-terra-text">
                  {exportError}
                </p>
              ) : null}
              {saveError ? <p className="text-xs text-warm-600">{saveError}</p> : null}

              {!readOnlyReason && shown.exploreFurther.length > 0 ? (
                <MemoSection title="Ask next">
                  <ul className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50">
                    {shown.exploreFurther.map((q) => (
                      <li key={q}>
                        <button type="button" onClick={() => ask(q)} className="w-full px-4 py-3 text-left text-warm-900 hover:bg-warm-100">
                          {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                </MemoSection>
              ) : null}

              <AuditPanel
                trail={answerAuditTrail({ lookups, figureCheck, institutionName: instName, preparedAt: answeredAt })}
              />
            </>
          ) : null}
        </div>
      ) : null}
      </div>

      {askedQuestion || shown ? askBox : null}
    </MemoPage>
  );
}

/** "Oct 8" for a saved answer's date; empty when the date can't be read. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The focus a deep link asks for (?intent=benchmark → Peer Position, etc.). */
function focusForIntent(intent: string | null | undefined): AnalysisFocus {
  switch (intent) {
    case "benchmark":
    case "peer":
      return "Peer Position";
    case "risk":
      return "Risk";
    case "trend":
      return "Trend";
    default:
      return ANALYSIS_FOCUS_TABS[0];
  }
}
