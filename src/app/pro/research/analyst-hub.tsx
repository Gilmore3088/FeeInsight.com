"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { simpleMarkdown, extractTableData, extractMetrics } from "@/lib/research/markdown";
import { extractChartData } from "@/lib/research/chart-utils";
import {
  markdownTablesToCsv,
  hasMarkdownTable,
  downloadFile,
  buildReportHtml,
} from "@/app/admin/hamilton/research/[agentId]/export-utils";

const CHART_COLORS = [
  "#C44B2E", "#E8845C", "#D4A574", "#7A7062",
  "#5A5347", "#A09788", "#1A1815", "#D4C9BA",
  "#B8A08C", "#8B6F5C", "#C9B8A8", "#6B6355",
];

interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: string;
}

interface AnalystHubProps {
  agentId: string;
  agentName: string;
  conversations: ConversationSummary[];
  queriesToday: number;
  dailyLimit: number;
  queryMonth: number;
  institutionContext?: ResearchInstitutionContext | null;
  institutionError?: string | null;
  initialAction?: ResearchPromptAction | null;
}

export type ResearchPromptAction = "competitive-brief" | "institution";

export interface ResearchInstitutionContext {
  id: number;
  name: string;
  city: string | null;
  stateCode: string | null;
  charterType: string | null;
  assetSize: number | null;
  assetSizeLabel: string | null;
  assetTier: string | null;
  assetTierLabel: string | null;
  fedDistrict: number | null;
  districtName: string | null;
  feePublicationStatus: "verified" | "provisional" | "under_review" | "unavailable";
  feePublicationLabel: string;
  publishedFeeCount: number;
  provisionalFeeCount: number;
  qualityLabel: string | null;
  latestSourceStatus: string | null;
  latestSourceCollectedAt: string | null;
}

type OutputTab = "chart" | "report" | "slides";

const AI_ACTIONS = [
  {
    icon: "M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
    label: "Ask a question",
    prompt: "",
  },
  {
    icon: "M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z",
    label: "Compare metrics",
    prompt: "Compare overdraft fees between banks and credit unions across all asset tiers",
  },
  {
    icon: "M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941",
    label: "Generate a chart",
    prompt: "Create a chart comparing the top 10 fee categories by national median amount",
  },
  {
    icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
    label: "Draft a report",
    prompt: "Write an executive summary report on the current state of overdraft fees nationally, including trends by charter type and asset tier",
  },
  {
    icon: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25",
    label: "Explain regulations",
    prompt: "Explain the current regulatory landscape around overdraft and NSF fee pricing, including recent CFPB guidance",
  },
];

const SUGGESTIONS = [
  "Compare overdraft pricing for community banks in District 7 vs the national median",
  "Which asset tier has the highest fee-to-revenue dependency?",
  "Identify the top 10 institutions with the most fees above the 75th percentile",
  "How do credit union NSF fees in the Southeast compare to bank NSF fees?",
];

function buildInstitutionPrompt(
  context: ResearchInstitutionContext,
  action: ResearchPromptAction,
): string {
  const descriptor = [
    context.city,
    context.stateCode,
    context.charterType?.replace(/_/g, " "),
    context.assetTierLabel,
    context.districtName,
  ].filter(Boolean).join("; ");

  if (action === "competitive-brief") {
    return `Generate an investor-grade competitive brief for ${context.name} (institution ID ${context.id}${descriptor ? `; ${descriptor}` : ""}). Start from the selected institution context. Use the institution tool for identity, verified and provisional fee rows, financials, revenue trend, peer ranking, and quality signals. Clearly separate verified evidence from provisional evidence, exclude provisional rows from benchmark conclusions unless labeled, and end with diligence questions an analyst should resolve next.`;
  }

  return `Analyze ${context.name} (institution ID ${context.id}) using the selected institution context. Summarize fee data status, available verified or provisional fee observations, financial context, peer positioning, data quality caveats, and the most useful next questions for this institution.`;
}

function contextSuggestions(context: ResearchInstitutionContext | null | undefined): string[] {
  if (!context) return SUGGESTIONS;
  return [
    `What fee observations are available for ${context.name}, and which are verified versus provisional?`,
    `How does ${context.name}'s service charge income compare with its peer group?`,
    `Generate a diligence checklist for validating ${context.name}'s fee schedule evidence.`,
    `What would a competitor brief for ${context.name} emphasize to a bank strategy team?`,
  ];
}

function contextStatusClass(status: ResearchInstitutionContext["feePublicationStatus"]): string {
  switch (status) {
    case "verified":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "provisional":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "under_review":
      return "border-warm-200 bg-warm-100 text-warm-700";
    case "unavailable":
      return "border-warm-200 bg-white text-warm-500";
  }
}

export function AnalystHub({
  agentName,
  conversations,
  queriesToday,
  dailyLimit,
  queryMonth,
  institutionContext = null,
  institutionError = null,
  initialAction = null,
}: AnalystHubProps) {
  const seedPrompt =
    institutionContext && initialAction
      ? buildInstitutionPrompt(institutionContext, initialAction)
      : "";
  const [input, setInput] = useState(() =>
    initialAction === "institution" ? seedPrompt : "",
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<OutputTab>(() =>
    initialAction === "competitive-brief" ? "report" : "chart",
  );
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seededRef = useRef(false);
  const selectedInstitutionId = institutionContext?.id ?? null;
  const suggestions = useMemo(() => contextSuggestions(institutionContext), [institutionContext]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/research/hamilton",
        body: selectedInstitutionId ? { institutionId: selectedInstitutionId } : {},
      }),
    [selectedInstitutionId],
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    onError: (err) => {
      const msg = err?.message || "";
      if (msg.includes("429")) setError("Rate limit exceeded. Please wait.");
      else if (msg.includes("503")) setError("AI service temporarily unavailable.");
      else if (msg.includes("401") || msg.includes("403")) setError("Authentication error. Please refresh.");
      else setError("Something went wrong. Please try again.");
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (!institutionContext || !initialAction || seededRef.current) return;
    seededRef.current = true;

    if (initialAction === "competitive-brief") {
      sendMessage({ text: seedPrompt });
    } else {
      inputRef.current?.focus();
    }
  }, [initialAction, institutionContext, seedPrompt, sendMessage]);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Extract result data from latest assistant message
  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        const content = messages[i].parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n") ?? "";
        return content;
      }
    }
    return "";
  }, [messages]);

  const chartData = useMemo(() => lastAssistant ? extractChartData(lastAssistant) : null, [lastAssistant]);
  const tableData = useMemo(() => lastAssistant ? extractTableData(lastAssistant) : [], [lastAssistant]);
  const metrics = useMemo(() => lastAssistant ? extractMetrics(lastAssistant) : [], [lastAssistant]);
  const hasTable = lastAssistant ? hasMarkdownTable(lastAssistant) : false;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    setError(null);
    sendMessage({ text: input });
    setInput("");
  }

  function injectPrompt(prompt: string) {
    if (prompt) {
      setInput(prompt);
      inputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }

  function handleExportCsv() {
    if (!lastAssistant) return;
    const csv = markdownTablesToCsv(lastAssistant);
    downloadFile(csv, "bank-fee-index-export.csv", "text/csv");
  }

  function handleExportReport() {
    if (!lastAssistant) return;
    const html = buildReportHtml(lastAssistant, agentName);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  }

  function handleCopy() {
    if (!lastAssistant) return;
    navigator.clipboard.writeText(lastAssistant);
  }

  const hasResults = lastAssistant.length > 0;

  return (
    <div className="flex h-[calc(100vh-57px)] overflow-hidden">
      {/* ── Left Sidebar ── */}
      <div
        className={`shrink-0 border-r border-warm-200 bg-white/50 transition-all duration-300 overflow-y-auto ${
          sidebarOpen ? "w-56" : "w-0"
        }`}
      >
        {sidebarOpen && (
          <div className="p-4">
            {/* AI Actions */}
            <div className="mb-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-3">
                AI Actions
              </p>
              <div className="space-y-1">
                {AI_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => injectPrompt(action.prompt)}
                    className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-left text-[13px] text-warm-700 hover:bg-warm-100 hover:text-warm-900 transition-colors"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      className="h-4 w-4 shrink-0 text-terra/60"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d={action.icon} />
                    </svg>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            {/* History toggle */}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-[13px] text-warm-700 hover:bg-warm-100 hover:text-warm-900 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-warm-500" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              View query history
            </button>

            {/* Conversation history */}
            {showHistory && conversations.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-2 px-3">
                  Recent
                </p>
                {conversations.slice(0, 15).map((c) => (
                  <div
                    key={c.id}
                    className="px-3 py-1.5 rounded text-[11px] text-warm-600 truncate hover:bg-warm-100 cursor-default"
                    title={c.title}
                  >
                    {c.title}
                  </div>
                ))}
              </div>
            )}

            {/* Usage */}
            <div className="mt-6 pt-4 border-t border-warm-200">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-2">
                Usage
              </p>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-warm-600">Today</span>
                  <span className="tabular-nums text-warm-900 font-medium">{queriesToday} / {dailyLimit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-warm-600">This month</span>
                  <span className="tabular-nums text-warm-900 font-medium">{queryMonth}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Center: Chat ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-warm-200 bg-warm-50">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-warm-600 hover:bg-warm-200/40 transition-colors"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
          <span
            className="text-[13px] font-medium text-warm-900"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            {agentName}
          </span>
          <span className="h-3 w-px bg-warm-200 mx-1" />
          <span className="text-[11px] text-warm-500">
            {queriesToday}/{dailyLimit} queries today
          </span>
        </div>

        {(institutionContext || institutionError) && (
          <div className="border-b border-warm-200 bg-white px-4 py-3">
            {institutionContext ? (
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${contextStatusClass(institutionContext.feePublicationStatus)}`}>
                      {institutionContext.feePublicationLabel}
                    </span>
                    <span className="text-[12px] font-semibold text-warm-900 break-words">
                      {institutionContext.name}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-warm-500">
                    {[institutionContext.city, institutionContext.stateCode].filter(Boolean).length > 0 && (
                      <span>{[institutionContext.city, institutionContext.stateCode].filter(Boolean).join(", ")}</span>
                    )}
                    {institutionContext.assetTierLabel && <span>{institutionContext.assetTierLabel}</span>}
                    {institutionContext.districtName && <span>{institutionContext.districtName}</span>}
                    <span>{institutionContext.publishedFeeCount} verified</span>
                    <span>{institutionContext.provisionalFeeCount} provisional</span>
                  </div>
                </div>
                <div className="shrink-0 text-[11px] text-warm-500">
                  Action:{" "}
                  <span className="font-medium text-warm-700">
                    {initialAction === "competitive-brief"
                      ? "Competitive brief"
                      : initialAction === "institution"
                        ? "Institution analysis"
                        : "Open research"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {institutionError}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <p className="text-[14px] text-warm-600 mb-6">
                {institutionContext
                  ? `Hamilton is focused on ${institutionContext.name}. Ask a question, or try one of these:`
                  : "Ask a question to get started, or try one of these:"}
              </p>
              <div className="flex flex-col gap-2 max-w-xl">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                    className="rounded-xl border border-warm-200 bg-white/70 px-4 py-2.5 text-[13px] text-warm-700 hover:border-terra/30 hover:text-warm-900 transition-all text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl">
              {messages.map((msg) => {
                if (msg.role === "user") {
                  const text = msg.parts
                    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
                    .map((p) => p.text)
                    .join("") ?? "";
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="rounded-xl bg-warm-900 px-4 py-2.5 text-[13px] text-white max-w-[80%]">
                        {text}
                      </div>
                    </div>
                  );
                }

                if (msg.role === "assistant") {
                  return (
                    <div key={msg.id} className="space-y-2">
                      {msg.parts?.map((part, pi) => {
                        if (part.type === "text" && part.text) {
                          return (
                            <div
                              key={pi}
                              className="prose-hub text-[13px] leading-relaxed text-warm-900"
                              dangerouslySetInnerHTML={{ __html: simpleMarkdown(part.text) }}
                            />
                          );
                        }
                        if (part.type.startsWith("tool-")) {
                          const toolPart = part as { type: string; toolCallId: string; toolName?: string; state?: string };
                          return (
                            <div
                              key={pi}
                              className="rounded-lg border border-warm-200/60 bg-warm-100/50 px-3 py-2 text-[11px] text-warm-500"
                            >
                              <span className="font-medium text-warm-600">
                                {toolPart.toolName ?? "tool"}
                              </span>
                              {toolPart.state === "result" && (
                                <span className="ml-2 text-emerald-600">done</span>
                              )}
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  );
                }
                return null;
              })}

              {isLoading && (
                <div className="flex items-center gap-2 text-[12px] text-warm-500">
                  <div className="h-4 w-4 border-2 border-warm-200 border-t-terra rounded-full animate-spin" />
                  Analyzing...
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50/50 px-4 py-3 text-[13px] text-red-600">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-warm-200 bg-warm-50 px-4 py-3">
          <div className="flex items-center gap-2 max-w-3xl mx-auto">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              disabled={isLoading}
              className="flex-1 rounded-xl border border-warm-200 bg-white px-4 py-2.5 text-[13px] text-warm-900 placeholder:text-warm-500 focus:outline-none focus:ring-2 focus:ring-terra/30 focus:border-transparent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="rounded-xl bg-terra px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-terra-dark disabled:opacity-40 transition-colors"
            >
              Send
            </button>
          </div>
        </form>
      </div>

      {/* ── Right Panel: Results ── */}
      {hasResults && (
        <div className="hidden lg:flex w-80 shrink-0 flex-col border-l border-warm-200 bg-white/50 overflow-hidden">
          {/* Output tabs */}
          <div className="flex items-center border-b border-warm-200 bg-warm-50">
            {(["chart", "report", "slides"] as OutputTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-[12px] font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? "border-b-2 border-terra text-warm-900"
                    : "text-warm-500 hover:text-warm-700"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === "chart" && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-3">
                  Result
                </p>

                {/* Metric cards */}
                {metrics.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {metrics.map((m, i) => (
                      <div key={i} className="rounded-lg border border-warm-200/60 bg-warm-100/50 px-3 py-2">
                        <p className="text-[10px] text-warm-500 truncate">{m.label}</p>
                        <p
                          className="text-[18px] font-light text-warm-900 tabular-nums"
                          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                        >
                          {m.value}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Chart */}
                {chartData && chartData.length > 0 && (
                  <div className="rounded-xl border border-warm-200/60 bg-warm-100/30 p-3 mb-4">
                    <ResponsiveContainer width="100%" height={Math.max(chartData.length * 28, 120)}>
                      <BarChart
                        data={chartData}
                        layout="vertical"
                        margin={{ top: 4, right: 30, bottom: 4, left: 80 }}
                      >
                        <XAxis type="number" tick={{ fontSize: 10, fill: "#A09788" }} axisLine={false} tickLine={false} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          tick={{ fontSize: 10, fill: "#5A5347" }}
                          axisLine={false}
                          tickLine={false}
                          width={80}
                        />
                        <Tooltip
                          contentStyle={{
                            fontSize: 12,
                            borderRadius: 8,
                            border: "1px solid #E8DFD1",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                          }}
                          formatter={(value) => [Number(value).toLocaleString(), ""]}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                          {chartData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Data table preview */}
                {tableData.length > 0 && (
                  <div className="rounded-xl border border-warm-200/60 overflow-hidden mb-4">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-warm-100/60 border-b border-warm-200/40">
                          {tableData[0].headers.slice(0, 3).map((h, i) => (
                            <th key={i} className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-warm-500 ${i > 0 ? "text-right" : "text-left"}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-warm-200/30">
                        {tableData[0].rows.slice(0, 8).map((row, ri) => (
                          <tr key={ri} className="hover:bg-warm-100/40">
                            {row.slice(0, 3).map((cell, ci) => (
                              <td key={ci} className={`px-2.5 py-1.5 ${ci > 0 ? "text-right tabular-nums text-warm-700" : "text-warm-900 font-medium"}`}>
                                {cell.replace(/\*\*/g, "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {tableData[0].rows.length > 8 && (
                      <div className="px-2.5 py-1.5 text-[10px] text-warm-500 bg-warm-100/30 border-t border-warm-200/30">
                        +{tableData[0].rows.length - 8} more rows
                      </div>
                    )}
                  </div>
                )}

                {!chartData && tableData.length === 0 && metrics.length === 0 && (
                  <p className="text-[12px] text-warm-500 text-center py-8">
                    No structured data in this response. Try asking for a comparison or data table.
                  </p>
                )}
              </div>
            )}

            {activeTab === "report" && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-3">
                  Report Preview
                </p>
                <div
                  className="prose-hub text-[12px] leading-relaxed text-warm-900"
                  dangerouslySetInnerHTML={{ __html: simpleMarkdown(lastAssistant) }}
                />
              </div>
            )}

            {activeTab === "slides" && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-3">
                  Slide Cards
                </p>
                <div className="space-y-3">
                  {lastAssistant.split(/(?=^#{1,3}\s)/m).filter(Boolean).map((section, i) => {
                    const titleMatch = section.match(/^#{1,3}\s+(.+)/m);
                    const title = titleMatch ? titleMatch[1] : `Section ${i + 1}`;
                    const body = section.replace(/^#{1,3}\s+.+\n?/, "").trim();
                    if (!body) return null;
                    return (
                      <div key={i} className="rounded-xl border border-warm-200/60 bg-warm-100/30 p-4">
                        <h3
                          className="text-[13px] font-semibold text-warm-900 mb-2"
                          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                        >
                          {title}
                        </h3>
                        <div
                          className="text-[11px] text-warm-700 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: simpleMarkdown(body.substring(0, 300)) }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Export bar */}
          <div className="border-t border-warm-200 bg-warm-50 px-4 py-2.5 flex items-center gap-2">
            {hasTable && (
              <button
                onClick={handleExportCsv}
                className="rounded-lg border border-warm-200 px-3 py-1.5 text-[11px] font-medium text-warm-700 hover:border-terra/30 hover:text-terra transition-colors"
              >
                Download CSV
              </button>
            )}
            <button
              onClick={handleExportReport}
              className="rounded-lg border border-warm-200 px-3 py-1.5 text-[11px] font-medium text-warm-700 hover:border-terra/30 hover:text-terra transition-colors"
            >
              Export
            </button>
            <button
              onClick={handleCopy}
              className="rounded-lg border border-warm-200 px-3 py-1.5 text-[11px] font-medium text-warm-700 hover:border-terra/30 hover:text-terra transition-colors ml-auto"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
