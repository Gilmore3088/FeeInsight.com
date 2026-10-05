"use client";

import { checkMessageFigures, confidenceFromFigureCheck, type FigureCheckResult } from "@/lib/hamilton/figure-check";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useCallback, useRef, useEffect } from "react";
import { ANALYSIS_FOCUS_TABS, type AnalysisFocus } from "@/lib/hamilton/navigation";
import { saveAnalysis } from "@/app/pro/(hamilton)/analyze/actions";
import { HamiltonViewPanel } from "./HamiltonViewPanel";
import { WhatThisMeansPanel } from "./WhatThisMeansPanel";
import { WhyItMattersPanel } from "./WhyItMattersPanel";
import { EvidencePanel } from "./EvidencePanel";
import { ExploreFurtherPanel } from "./ExploreFurtherPanel";
import { AnalyzeCTABar } from "./AnalyzeCTABar";
import { AnalysisInputBar } from "./AnalysisInputBar";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { parseAnalyzeResponse, shapeHamiltonView, type ParsedResponse } from "./parse-response";
import { inferFeeCategory } from "@/lib/hamilton/infer-category";
import { basketItemId } from "@/lib/hamilton/report-basket";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";

function extractTextFromMessage(message: { parts?: Array<{ type: string; text?: string }> }): string {
  return (
    message.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("") ?? ""
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface AnalyzeWorkspaceProps {
  userId: number;
  institutionId: string | null;
  selectedInstitution?: HamiltonSelectedInstitutionContext | null;
  initialIntent?: string | null;
  /** Pre-populated analysis loaded from hamilton_saved_analyses via ?analysis= searchParam */
  initialAnalysis?: AnalyzeResponse | null;
  initialAnalysisId?: string | null;
  /** A question handed over from another page ("Ask about this"); filled in, never auto-sent */
  initialQuestion?: string | null;
}

/**
 * AnalyzeWorkspace — Main client shell for the /pro/analyze screen.
 * Owns: analysis focus tab state, useChat streaming, section parsing,
 * explore-further navigation, and auto-save on completion.
 *
 * Uses @ai-sdk/react v3 API: DefaultChatTransport, sendMessage, status.
 * Screen boundary rule enforced at two levels:
 * 1. System prompt via buildAnalyzeModeSuffix (API route)
 * 2. AnalyzeCTABar has no "Recommended Position" element (ARCH-05)
 *
 * When initialAnalysis is provided (via ?analysis= searchParam), parsedResponse
 * is pre-populated so the full analysis UI renders immediately on page load.
 */
export function AnalyzeWorkspace({
  userId,
  institutionId,
  selectedInstitution,
  initialIntent,
  initialAnalysis,
  initialAnalysisId = null,
  initialQuestion = null,
}: AnalyzeWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<AnalysisFocus>(() => focusForIntent(initialIntent));
  const [parsedResponse, setParsedResponse] = useState<ParsedResponse | null>(() => {
    if (!initialAnalysis) return null;
    return {
      hamiltonView: initialAnalysis.hamiltonView,
      whatThisMeans: initialAnalysis.whatThisMeans,
      whyItMatters: initialAnalysis.whyItMatters,
      evidence: initialAnalysis.evidence.metrics,
      exploreFurther: initialAnalysis.exploreFurther,
    };
  });
  // If restoring a saved analysis, mark it already saved to prevent duplicate auto-save
  const [isSaved, setIsSaved] = useState(!!initialAnalysis);
  const [input, setInput] = useState(() => {
    if (initialQuestion && !initialAnalysis) return initialQuestion;
    if (!selectedInstitution || initialAnalysis) return "";
    if (selectedInstitution.insightReadiness === "source_needed") {
      return `Build a diligence path for ${selectedInstitution.name}. Explain what is known, what is missing, and what source evidence is needed before making fee claims.`;
    }
    if (initialIntent === "institution") {
      return `Analyze ${selectedInstitution.name}'s fee readiness, peer position, financial context, risks, and next diligence questions.`;
    }
    return "";
  });
  const [isExporting, setIsExporting] = useState(false);
  const [savedAnalysisId, setSavedAnalysisId] = useState<string | null>(initialAnalysisId);
  const [figureCheck, setFigureCheck] = useState<FigureCheckResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Ref to always have latest activeTab inside async callbacks
  const activeTabRef = useRef<AnalysisFocus>(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Track the last prompt submitted for saving alongside the response
  const lastPromptRef = useRef<string>("");

  const { messages, sendMessage, status, setMessages, error: chatError, clearError } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/research/hamilton",
      body: () => ({
        mode: "analyze",
        analysisFocus: activeTabRef.current,
        institutionId: selectedInstitution?.id ?? null,
        intent: initialIntent ?? "analyze",
        evidencePolicy: "provisional-first",
      }),
    }),
    onFinish: async ({ message }) => {
      const content = extractTextFromMessage(message);
      const parsed = parseAnalyzeResponse(content);
      // Every $ and % must trace to the tool data Hamilton was given.
      const check = checkMessageFigures(message.parts as ReadonlyArray<{ type: string; text?: string; output?: unknown }>);
      setFigureCheck(check);
      setParsedResponse(parsed);
      setIsSaved(false);
      setSavedAnalysisId(null);

      // Auto-save if user context is available
      if (userId) {
        const canonicalInstitutionId = normalizeCanonicalInstitutionId(
          selectedInstitution?.id ?? institutionId,
        );
        const result = await saveAnalysis({
          institutionId: canonicalInstitutionId ?? "",
          analysisFocus: activeTabRef.current,
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
        if ("id" in result) {
          setIsSaved(true);
          setSavedAnalysisId(result.id);
        }
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

  const handleRetry = useCallback(() => {
    const prompt = lastPromptRef.current;
    if (!prompt) return;
    clearError();
    setInput("");
    sendMessage({ text: prompt });
  }, [clearError, sendMessage]);

  const handleAnalysisSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    lastPromptRef.current = trimmed;
    setParsedResponse(null);
    setIsSaved(false);
    sendMessage({ text: trimmed });
    setInput("");
  }, [input, isLoading, sendMessage]);

  const handleExploreFurther = useCallback(
    (prompt: string) => {
      lastPromptRef.current = prompt;
      setParsedResponse(null);
      setIsSaved(false);
      setMessages([]);
      sendMessage({ text: prompt });
    },
    [sendMessage, setMessages]
  );

  const handleViewRiskDrivers = useCallback(() => {
    setActiveTab("Risk");
    setInput("What are the main risk drivers behind this position, and which one should we address first?");
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }, []);

  const handleExportPdf = useCallback(async () => {
    if (!parsedResponse || isExporting) return;
    if (!savedAnalysisId) {
      setExportError("This analysis is still being saved. Try the export again in a moment.");
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
      a.download = `hamilton-analysis-${new Date().toISOString().split("T")[0]}.pdf`;
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

  // CTA bar should only show when Hamilton delivered an actual analysis,
  // not an info-request like "I need to identify your institution." Use
  // structured-section presence as the signal — info-requests have content
  // in hamiltonView but no whyItMatters/evidence sections.
  const hasAnalysisStructure =
    parsedResponse !== null &&
    (parsedResponse.whyItMatters.length > 0 ||
      parsedResponse.evidence.length > 0);
  const analysisComplete = !isLoading && hasAnalysisStructure;

  // Live-parse streaming content for progressive rendering
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant");
  const streamingContent = lastAssistantMessage ? extractTextFromMessage(lastAssistantMessage) : "";
  const liveParsed = isLoading && streamingContent ? parseAnalyzeResponse(streamingContent) : null;
  const displayedResponse = parsedResponse ?? liveParsed;
  const answerLead = displayedResponse ? shapeHamiltonView(displayedResponse.hamiltonView).lead : "";
  const answerCategory = answerLead ? inferFeeCategory(answerLead) : null;

  return (
    <div className="@container flex flex-col gap-6 pb-56">
      {chatError && !isLoading && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"
          style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#7f1d1d" }}
        >
          <span>Hamilton couldn&apos;t finish this analysis. Your question is back in the box below.</span>
          <button type="button" onClick={handleRetry} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}
      {exportError && (
        <p role="alert" className="text-sm" style={{ color: "#7f1d1d" }}>
          {exportError}
        </p>
      )}
      {/* Analysis prompt title when active */}
      {displayedResponse && (
        <div className="flex items-center gap-4 mb-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: "var(--hamilton-primary)", opacity: 0.6 }} aria-hidden="true">
            <path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <h1
            className="text-3xl italic tracking-tight"
            style={{
              fontFamily: "var(--hamilton-font-serif)",
              color: "var(--hamilton-text-primary)",
            }}
          >
            {activeTab} Assessment
          </h1>
        </div>
      )}

      {/* Empty state */}
      {!displayedResponse && !isLoading && messages.length === 0 && (
        <div className="py-8">
          {selectedInstitution ? (
            <div
              className="mx-auto max-w-4xl rounded-xl border p-5 text-left"
              style={{
                backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
                borderColor: "rgba(216,194,184,0.35)",
              }}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p
                    className="text-[10px] uppercase tracking-[0.18em]"
                    style={{ color: "var(--hamilton-text-tertiary)" }}
                  >
                    Selected Institution
                  </p>
                  <h1
                    className="mt-1 text-3xl italic tracking-tight"
                    style={{
                      fontFamily: "var(--hamilton-font-serif)",
                      color: "var(--hamilton-text-primary)",
                    }}
                  >
                    {selectedInstitution.name}
                  </h1>
                  <p className="mt-2 text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
                    {selectedInstitution.confidenceSummary}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 md:min-w-[360px]">
                  <ContextStat label="Status" value={selectedInstitution.feePublicationLabel} />
                  <ContextStat label="Verified" value={selectedInstitution.publishedFeeCount.toLocaleString()} />
                  <ContextStat label="Provisional" value={selectedInstitution.provisionalFeeCount.toLocaleString()} />
                  <ContextStat label="Assets" value={selectedInstitution.assetSizeLabel ?? "N/A"} />
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {[
                  `Summarize ${selectedInstitution.name}'s fee evidence and data caveats.`,
                  `Compare ${selectedInstitution.name}'s service charge income and peer position.`,
                  `List the diligence questions needed before a board-ready brief for ${selectedInstitution.name}.`,
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="rounded-full px-3 py-1.5 text-xs transition-colors"
                    style={{
                      border: "1px solid rgba(216,194,184,0.5)",
                      color: "var(--hamilton-text-primary)",
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-16" style={{ color: "var(--hamilton-text-secondary)" }}>
              <p className="text-base mb-1" style={{ fontFamily: "var(--hamilton-font-serif)" }}>
                Ask Hamilton to analyze a fee category or competitive position
              </p>
              <p className="text-sm">
                Currently viewing:{" "}
                <span style={{ color: "var(--hamilton-accent)" }}>{activeTab}</span> analysis
              </p>
            </div>
          )}
        </div>
      )}

      {/* Intelligence architecture */}
      {displayedResponse && (
        <div className="space-y-6 max-w-5xl">
          {/* Hamilton's View card — contains What This Means inline */}
          <div
            className="p-10 rounded-xl border-l-4"
            style={{
              backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
              border: "1px solid rgba(216,194,184,0.3)",
              borderLeftWidth: "4px",
              borderLeftColor: "var(--hamilton-primary)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.02)",
            }}
          >
            <HamiltonViewPanel
              content={displayedResponse.hamiltonView}
              confidence={null}
              isStreaming={isLoading}
            />
            {(displayedResponse.whatThisMeans || isLoading) && (
              <WhatThisMeansPanel content={displayedResponse.whatThisMeans} isStreaming={isLoading} />
            )}
          </div>

          {!isLoading && figureCheck && figureCheck.unmatched.length > 0 && (
            <p
              role="status"
              className="text-sm rounded-lg px-4 py-3"
              style={{
                backgroundColor: "var(--hamilton-surface-container-low, #fbf3ee)",
                border: "1px solid rgba(180,83,9,0.35)",
                color: "var(--hamilton-text-primary)",
              }}
            >
              <strong>Check these figures:</strong> {figureCheck.unmatched.join(", ")} could not be traced to
              the data Hamilton retrieved for this answer. Treat them as unverified.
            </p>
          )}

          {/* CTA row — shown after stream completes */}
          <AnalyzeCTABar
            isVisible={analysisComplete}
            institutionId={normalizeCanonicalInstitutionId(selectedInstitution?.id ?? institutionId)}
            onExportPdf={handleExportPdf}
            isExporting={isExporting}
            feeCategory={answerCategory}
            onViewRiskDrivers={handleViewRiskDrivers}
            basketItem={
              displayedResponse && answerLead
                ? {
                    id: basketItemId("Ask", selectedInstitution?.id ?? institutionId, answerLead),
                    source: "Ask",
                    title: answerLead,
                    detail: [shapeHamiltonView(displayedResponse.hamiltonView).paragraphs.join(" "), displayedResponse.whatThisMeans]
                      .filter(Boolean)
                      .join(" "),
                    feeCategory: answerCategory,
                    institutionId: normalizeCanonicalInstitutionId(selectedInstitution?.id ?? institutionId),
                  }
                : null
            }
          />

          {/* Why It Matters */}
          {(displayedResponse.whyItMatters.length > 0 || isLoading) && (
            <WhyItMattersPanel items={displayedResponse.whyItMatters} isStreaming={isLoading} />
          )}

          {/* Evidence */}
          {(displayedResponse.evidence.length > 0 || isLoading) && (
            <EvidencePanel metrics={displayedResponse.evidence} isStreaming={isLoading} />
          )}

          {/* Follow-up questions sit in the page flow so they never cover the answer */}
          <ExploreFurtherPanel
            prompts={parsedResponse?.exploreFurther ?? []}
            onPromptSelect={handleExploreFurther}
            isVisible={analysisComplete}
          />

          {/* Save confirmation */}
          {isSaved && (
            <p className="text-xs text-center" style={{ color: "var(--hamilton-text-secondary)" }}>
              Analysis saved to workspace
            </p>
          )}
        </div>
      )}

      {/* Focus tabs + floating input — always at bottom */}
      <div
        className="@container fixed bottom-0 left-0 lg:left-72 right-0 z-20 px-4 @lg:px-8 @xl:px-12 py-10"
        style={{
          background: "linear-gradient(to top, var(--hamilton-surface) 60%, transparent)",
        }}
      >
        <div className="max-w-4xl mx-auto flex flex-col gap-6">
          <div role="tablist" aria-label="Analysis focus" className="flex flex-wrap gap-2">
            {ANALYSIS_FOCUS_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={tab === activeTab}
                onClick={() => setActiveTab(tab)}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  backgroundColor: tab === activeTab ? "var(--hamilton-primary)" : "var(--hamilton-surface-container-low)",
                  color: tab === activeTab ? "#fff" : "var(--hamilton-text-secondary)",
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <AnalysisInputBar
            value={input}
            onChange={setInput}
            onSubmit={handleAnalysisSubmit}
            isLoading={isLoading}
            placeholder={`Analyze from the ${activeTab} lens…`}
          />
        </div>
      </div>
    </div>
  );
}

/** The focus tab a deep link asks for (?intent=benchmark → Peer Position, etc.). */
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

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ backgroundColor: "var(--hamilton-surface-container-low)" }}
    >
      <p
        className="text-[9px] uppercase tracking-[0.14em]"
        style={{ color: "var(--hamilton-text-tertiary)" }}
      >
        {label}
      </p>
      <p
        className="mt-1 truncate font-semibold"
        style={{ color: "var(--hamilton-text-primary)" }}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
