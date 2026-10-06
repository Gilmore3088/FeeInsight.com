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
import { humanizeAnswerText, parseAnalyzeResponse, shapeHamiltonView, type ParsedResponse } from "./parse-response";
import { renderInline } from "./markdown";
import { inferFeeCategory } from "@/lib/hamilton/infer-category";
import { basketItemId } from "@/lib/hamilton/report-basket";
import { HAMILTON_VERSION } from "@/lib/hamilton/voice";
import { STANDARD_METHOD, type AuditTrail } from "@/lib/hamilton/audit-trail";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import { AddToReportButton } from "@/components/hamilton/basket/AddToReportButton";
import { StructuredAsk } from "./StructuredAsk";
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
        ? [{ label: "Your institution", detail: `${input.institutionName}'s published fees and filings.`, asOf: null }]
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
  /** A question handed over from another page or the Ask bar */
  initialQuestion?: string | null;
  /** True when the question came from the Ask bar, so it is sent on arrival rather than retyped */
  autoSend?: boolean;
}

/**
 * Ask Hamilton: one question, one memo. The answer reads like the rest of the workspace: the
 * question as the heading, Hamilton's answer, why it matters, the evidence, where to look next
 * and how it was built. Hamilton shows evidence; it never recommends a price.
 */
export function AnalyzeWorkspace({
  userId,
  institutionId,
  selectedInstitution,
  initialIntent,
  initialAnalysis,
  initialAnalysisId = null,
  initialQuestion = null,
  autoSend = false,
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
  const [figureCheck, setFigureCheck] = useState<FigureCheckResult | null>(null);
  const [lookups, setLookups] = useState<string[]>([]);
  const [answeredAt, setAnsweredAt] = useState<string>(() => new Date().toISOString());
  const [exportError, setExportError] = useState<string | null>(null);
  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  const lastPromptRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, setMessages, error: chatError, clearError } = useChat({
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
      if (isError || isAbort || !content.trim()) return;
      const parsed = parseAnalyzeResponse(content);
      const parts = message.parts as ReadonlyArray<MessagePart>;
      const check = checkMessageFigures(parts);
      setFigureCheck(check);
      setLookups(lookupsUsed(parts));
      setAnsweredAt(new Date().toISOString());
      setParsedResponse(parsed);
      setSavedAnalysisId(null);

      if (userId) {
        const result = await saveAnalysis({
          institutionId: normalizeCanonicalInstitutionId(selectedInstitution?.id ?? institutionId) ?? "",
          analysisFocus: focus.current,
          prompt: lastPromptRef.current,
          responseJson: {
            title: parsed.hamiltonView.slice(0, 80),
            confidence: confidenceFromFigureCheck(check),
            hamiltonView: parsed.hamiltonView,
            whatThisMeans: parsed.whatThisMeans,
            whyItMatters: parsed.whyItMatters,
            evidence: { metrics: parsed.evidence },
            exploreFurther: parsed.exploreFurther,
          } satisfies AnalyzeResponse,
        });
        if ("id" in result) setSavedAnalysisId(result.id);
      }
    },
  });

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

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isLoading) return;
      lastPromptRef.current = trimmed;
      clearError();
      setParsedResponse(null);
      setFigureCheck(null);
      setAskedQuestion(trimmed);
      setMessages([]);
      sendMessage({ text: trimmed });
      setInput("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [clearError, isLoading, sendMessage, setMessages],
  );

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  }

  const handleExportPdf = useCallback(async () => {
    if (!parsedResponse || isExporting) return;
    if (!savedAnalysisId) {
      setExportError("This answer is still being saved. Try the download again in a moment.");
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
  }, [parsedResponse, isExporting, savedAnalysisId]);

  // Live-parse streaming content for progressive rendering. Only the reply to the question just
  // sent counts; an earlier answer must not stand in for it.
  const lastMessage = messages[messages.length - 1];
  const streamingContent = lastMessage?.role === "assistant" ? extractTextFromMessage(lastMessage) : "";
  const liveParsed = isLoading && streamingContent ? parseAnalyzeResponse(streamingContent) : null;
  const shown = chatError && !isLoading ? null : (parsedResponse ?? liveParsed);
  const view = shown ? shapeHamiltonView(shown.hamiltonView) : { lead: "", paragraphs: [] };
  const feeCategory = view.lead ? inferFeeCategory(view.lead) : null;
  const feeName = feeCategory ? getDisplayName(feeCategory).replace(/\s*\([^)]*\)\s*$/, "").toLowerCase() : null;
  const instId = normalizeCanonicalInstitutionId(selectedInstitution?.id ?? institutionId);
  const complete = !isLoading && parsedResponse !== null && Boolean(view.lead);
  const instName = selectedInstitution?.name ?? null;
  const suggestions = [
    "How does our overdraft fee compare with banks in our counties?",
    "Which of our fees sit furthest from our peers, and by how much?",
    "Who in our state changed their NSF fee this year?",
  ];

  return (
    <MemoPage>
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

      {askedQuestion || shown ? (
        <MemoHeader
          kicker={instName ? `You asked · ${instName}` : "You asked"}
          title={askedQuestion ?? "A saved answer"}
        />
      ) : (
        <>
          <MemoHeader
            kicker="Ask Hamilton"
            title={instName ? `Ask anything about ${instName}'s fees` : "Ask anything about your fees and your market"}
            dek="Answers from published fee schedules and regulator filings, with every figure checked."
          />
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
        </>
      )}

      {askedQuestion ? (
        <MemoSection title="The figures">
          <StructuredAsk
            question={askedQuestion}
            institutionId={instId}
            modelHrefFor={(fee, tested) => hrefWithInstitutionContext(`/pro/simulate?fee=${encodeURIComponent(fee)}&prices=${tested}`, instId)}
          />
        </MemoSection>
      ) : null}

      {isLoading && !shown ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-3">
          <p className="text-sm text-warm-700">Hamilton is reading the fee data and filings for this answer…</p>
          <div className="space-y-2" aria-hidden="true">
            <div className="skeleton h-6 w-full rounded" />
            <div className="skeleton h-6 w-4/6 rounded" />
            <div className="skeleton h-4 w-5/6 rounded" />
          </div>
        </div>
      ) : null}

      {shown && view.lead ? (
        <>
          <article className="flex max-w-[68ch] flex-col gap-4">
            <p className="text-2xl leading-snug text-warm-900 sm:text-[1.7rem]" style={SERIF}>
              {renderInline(view.lead)}
            </p>
            {view.paragraphs.slice(0, 1).map((para, i) => (
              <p key={i} className="text-[17px] leading-relaxed text-warm-800 [font-variant-numeric:tabular-nums]">
                {renderInline(para)}
              </p>
            ))}
            {view.paragraphs.length > 1 || shown.whatThisMeans || shown.whyItMatters.length > 0 ? (
              <More label="Read the full answer">
                {view.paragraphs.slice(1).map((para, i) => (
                  <p key={i} className="text-[17px] leading-relaxed text-warm-800 [font-variant-numeric:tabular-nums]">
                    {renderInline(para)}
                  </p>
                ))}
                {shown.whatThisMeans ? (
                  <p className="text-[17px] leading-relaxed text-warm-800">{renderInline(shown.whatThisMeans)}</p>
                ) : null}
                {shown.whyItMatters.length > 0 ? (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">Why it matters</h3>
                    <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] text-warm-800">
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


          {shown.evidence.length > 0 ? (
            <MemoSection title="The evidence">
              <dl className="divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50 px-4">
                {shown.evidence.map((m, i) => {
                  const label = m.label.replace(/^\*+|\*+$/g, "").trim();
                  const value = m.value.replace(/^\*\*\s*|\s*\*\*$/g, "").trim();
                  if (!value && !m.note) {
                    return (
                      <dt key={i} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-warm-600">
                        {label}
                      </dt>
                    );
                  }
                  return (
                    <div key={i} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-6">
                      <dt className="text-sm text-warm-600">{label}</dt>
                      <dd className="text-sm text-warm-900 [font-variant-numeric:tabular-nums]">
                        {renderInline(value)}
                        {m.note ? <> {renderInline(m.note)}</> : null}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </MemoSection>
          ) : null}

          {complete ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <LinkButton
                  href={hrefWithInstitutionContext(feeCategory ? `/pro/research?fee=${encodeURIComponent(feeCategory)}` : "/pro/research", instId)}
                  primary
                >
                  {feeName ? `Look closer at ${feeName}` : "Look closer in My fees"}
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
                  }}
                />
              </div>
              {exportError ? (
                <p role="alert" className="text-sm text-terra-text">
                  {exportError}
                </p>
              ) : null}

              {shown.exploreFurther.length > 0 ? (
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
              {savedAnalysisId ? <p className="text-xs text-warm-600">Saved to your workspace.</p> : null}
            </>
          ) : null}
        </>
      ) : null}

      <div className="sticky bottom-4 z-30 print:hidden">
        <form
          onSubmit={handleSubmit}
          aria-label="Ask Hamilton"
          className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border border-warm-ink-700 bg-warm-ink-900 p-2 pl-4 shadow-2xl"
        >
          <span aria-hidden className="pb-2 text-sm text-warm-ink-50" style={SERIF}>
            H
          </span>
          <label htmlFor="hamilton-ask-page" className="sr-only">
            Ask Hamilton
          </label>
          <textarea
            id="hamilton-ask-page"
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={500}
            disabled={isLoading}
            placeholder={askedQuestion ? "Ask a follow-up…" : "Ask Hamilton about your fees or your market"}
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-warm-ink-50 placeholder:text-warm-ink-300 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label="Ask"
            className="flex items-center gap-1.5 rounded-lg bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            Ask
          </button>
        </form>
      </div>
    </MemoPage>
  );
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
