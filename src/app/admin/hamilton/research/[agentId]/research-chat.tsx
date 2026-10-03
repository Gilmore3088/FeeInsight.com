"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { saveArticleFromChat } from "./save-article-action";
import { CONTENT_TEMPLATES } from "@/lib/research/content-templates";
import {
  markdownTablesToCsv,
  hasMarkdownTable,
  downloadFile,
  buildReportHtml,
} from "./export-utils";
import { extractChartData, InlineChart } from "./chat-chart";

interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: string;
}

interface ResearchChatProps {
  agentId: string;
  agentName: string;
  agentDescription: string;
  exampleQuestions: string[];
  conversations: ConversationSummary[];
}

export function ResearchChat({
  agentId,
  agentName,
  agentDescription,
  exampleQuestions,
  conversations,
}: ResearchChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<{ slug: string } | null>(null);
  const [savePending, startSaveTransition] = useTransition();

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/research/hamilton" }),
    onError: (err) => {
      const msg = err?.message || "";
      if (msg.includes("429") || msg.includes("rate limit")) {
        setError("Rate limit exceeded. Please wait before sending more queries.");
      } else if (msg.includes("503")) {
        setError("AI service temporarily unavailable. Daily cost limit may have been reached.");
      } else if (msg.includes("401") || msg.includes("403")) {
        setError("Authentication error. Please refresh the page.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    setError(null);
    sendMessage({ text: input });
    setInput("");
  }

  function handleSuggestion(q: string) {
    setError(null);
    sendMessage({ text: q });
  }

  function handleNewChat() {
    setMessages([]);
    inputRef.current?.focus();
  }

  function toggleTool(key: string) {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSaveAsDraft(messageText: string) {
    startSaveTransition(async () => {
      const result = await saveArticleFromChat(messageText);
      if (result.success && result.slug) {
        setSavedNotice({ slug: result.slug });
        setTimeout(() => setSavedNotice(null), 8000);
      } else {
        setError(result.error || "Failed to save article");
      }
    });
  }

  function handleCopyMarkdown() {
    const md = messages
      .map((m) => {
        const textParts = m.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("");
        return `**${m.role === "user" ? "You" : agentName}:** ${textParts}`;
      })
      .join("\n\n");
    navigator.clipboard.writeText(md);
  }

  return (
    <div className="flex h-[calc(100vh-120px)] gap-4">
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-56 shrink-0 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              History
            </p>
            <button
              onClick={() => setShowSidebar(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          {conversations.length === 0 ? (
            <p className="text-[11px] text-gray-400">No conversations yet</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button className="w-full rounded px-2 py-1.5 text-left text-[11px] text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800">
                    <p className="truncate font-medium">{c.title}</p>
                    <p className="text-[10px] text-gray-400">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Main chat area */}
      <div className="flex flex-1 flex-col rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/hamilton/research"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {agentName}
              </h1>
              <p className="text-[11px] text-gray-400">{agentDescription}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              title="Conversation history"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {messages.length > 0 && (
              <>
                <button
                  onClick={handleCopyMarkdown}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                  title="Copy as markdown"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                <button
                  onClick={handleNewChat}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                >
                  New Chat
                </button>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="mx-auto max-w-2xl pt-8">
              {/* Content templates for content-writer agent */}
              {agentId === "content-writer" && (
                <div className="mb-8">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    Quick Start Templates
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {CONTENT_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          const prompt = t.params
                            ? t.prompt.replace(/\{(\w+)\}/g, (_, key) => {
                                const param = t.params?.find((p) => p.name === key);
                                const val = param ? window.prompt(param.placeholder) : null;
                                return val || `[${key}]`;
                              })
                            : t.prompt;
                          if (prompt) handleSuggestion(prompt);
                        }}
                        disabled={isLoading}
                        className="rounded-lg border border-gray-200 px-3 py-2.5 text-left transition-all hover:border-blue-200 hover:bg-blue-50/30 disabled:opacity-50 dark:border-gray-700 dark:hover:border-gray-600"
                      >
                        <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">
                          {t.name}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-gray-400 capitalize">
                          {t.category}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[13px] text-gray-500 text-center">
                {agentId === "content-writer"
                  ? "Or ask a custom question:"
                  : "Ask a question to get started, or try one of these:"}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {exampleQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSuggestion(q)}
                    disabled={isLoading}
                    className="rounded-full border border-gray-200 px-3 py-1.5 text-[11px] text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-500"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`mb-4 ${message.role === "user" ? "flex justify-end" : ""}`}
            >
              {message.role === "user" ? (
                <div className="max-w-[75%] rounded-lg bg-gray-900 px-3.5 py-2.5 text-[13px] text-white dark:bg-gray-700">
                  {message.parts
                    .filter((p) => p.type === "text")
                    .map((p, i) => (
                      <span key={i}>
                        {(p as { type: "text"; text: string }).text}
                      </span>
                    ))}
                </div>
              ) : (
                <div className="max-w-[90%]">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {agentName}
                  </p>
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      const textContent = (part as { type: "text"; text: string }).text;
                      const isLastAssistantMsg = message === messages.filter(m => m.role === "assistant").at(-1);
                      return (
                        <div key={i}>
                          <div
                            className="prose prose-sm prose-gray max-w-none text-[13px] leading-relaxed dark:prose-invert [&_table]:text-[11px] [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:border-gray-200 [&_th]:border [&_td]:border [&_th]:bg-gray-50 dark:[&_th]:bg-gray-800 dark:[&_table]:border-gray-700"
                            dangerouslySetInnerHTML={{
                              __html: simpleMarkdown(textContent),
                            }}
                          />
                          {!isLoading && (() => {
                            const chartData = extractChartData(textContent);
                            return chartData && chartData.length >= 2 ? (
                              <InlineChart data={chartData} />
                            ) : null;
                          })()}
                          {isLastAssistantMsg && !isLoading && textContent.length > 200 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {agentId === "content-writer" && (
                                <button
                                  onClick={() => handleSaveAsDraft(textContent)}
                                  disabled={savePending}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400 transition-colors"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                                    <polyline points="17 21 17 13 7 13 7 21" />
                                    <polyline points="7 3 7 8 15 8" />
                                  </svg>
                                  {savePending ? "Saving..." : "Save as Draft"}
                                </button>
                              )}
                              {hasMarkdownTable(textContent) && (
                                <button
                                  onClick={() => {
                                    const csv = markdownTablesToCsv(textContent);
                                    if (csv) {
                                      const ts = new Date().toISOString().split("T")[0];
                                      downloadFile(csv, `bfi-data-${ts}.csv`, "text/csv");
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 transition-colors"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  Export CSV
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  const html = buildReportHtml(textContent, agentName);
                                  const win = window.open("", "_blank");
                                  if (win) {
                                    win.document.write(html);
                                    win.document.close();
                                    setTimeout(() => win.print(), 500);
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300 transition-colors"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <polyline points="6 9 6 2 18 2 18 9" />
                                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                                  <rect x="6" y="14" width="12" height="8" />
                                </svg>
                                Export Report
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (part.type.startsWith("tool-")) {
                      const toolPart = part as {
                        type: string;
                        toolCallId: string;
                        toolName?: string;
                        state?: string;
                        input?: unknown;
                        output?: unknown;
                      };
                      const toolKey = `${message.id}-${i}`;
                      const isExpanded = expandedTools.has(toolKey);
                      return (
                        <div
                          key={i}
                          className="my-2 rounded border border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/50"
                        >
                          <button
                            onClick={() => toggleTool(toolKey)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-gray-500"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            >
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                            <span className="font-medium">
                              {toolPart.toolName ?? "tool"}
                            </span>
                            {toolPart.state === "output" && (
                              <span className="text-emerald-500">done</span>
                            )}
                            {toolPart.state === "call" && (
                              <span className="animate-pulse text-amber-500">
                                running...
                              </span>
                            )}
                          </button>
                          {isExpanded && (
                            <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                              <p className="text-[10px] font-semibold text-gray-400">
                                Parameters
                              </p>
                              <pre className="mt-1 overflow-x-auto text-[10px] text-gray-600 dark:text-gray-400">
                                {JSON.stringify(toolPart.input, null, 2)}
                              </pre>
                              {toolPart.output !== undefined && (
                                <>
                                  <p className="mt-2 text-[10px] font-semibold text-gray-400">
                                    Result
                                  </p>
                                  <pre className="mt-1 max-h-40 overflow-auto text-[10px] text-gray-600 dark:text-gray-400">
                                    {JSON.stringify(toolPart.output, null, 2).substring(0, 2000)}
                                  </pre>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="mb-4 flex items-center gap-2 text-[12px] text-gray-400">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gray-400" />
              Analyzing...
            </div>
          )}

          {savedNotice && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400 flex items-center justify-between">
              <span>
                Draft saved.{" "}
                <Link href="/admin/hamilton/research/articles" className="font-semibold underline hover:no-underline">
                  View articles
                </Link>
              </span>
              <button onClick={() => setSavedNotice(null)} className="text-emerald-500 hover:text-emerald-700">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-2 underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-gray-100 px-4 py-3 dark:border-gray-800"
        >
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              disabled={isLoading}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="rounded-lg bg-gray-900 px-4 py-2.5 text-[12px] font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Markdown to HTML with headings, tables, lists, and inline formatting */
function simpleMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Quotes too: links below become href="…" attributes, and a raw " would end the attribute.
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr class="my-4 border-gray-200 dark:border-gray-700" />');

  // Tables
  html = html.replace(
    /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm,
    (_match, header: string, _sep: string, body: string) => {
      const headers = header
        .split("|")
        .filter((c: string) => c.trim())
        .map((c: string) => `<th>${c.trim()}</th>`)
        .join("");
      const rows = body
        .trim()
        .split("\n")
        .map((row: string) => {
          const cells = row
            .split("|")
            .filter((c: string) => c.trim())
            .map((c: string) => `<td>${c.trim()}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  );

  // Headings (must come before bold to avoid ** conflicts)
  html = html.replace(/^#### (.+)$/gm, '<h4 class="text-[13px] font-bold text-gray-800 dark:text-gray-200 mt-4 mb-1">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-[14px] font-bold text-gray-800 dark:text-gray-200 mt-5 mb-1.5">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-[15px] font-bold text-gray-900 dark:text-gray-100 mt-6 mb-2 pb-1 border-b border-gray-100 dark:border-gray-800">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-[16px] font-extrabold text-gray-900 dark:text-gray-100 mt-6 mb-2">$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-gray-100 px-1 text-[11px] dark:bg-gray-800">$1</code>'
  );

  // Links (only allow http/https protocols to prevent XSS via javascript: URIs)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline dark:text-blue-400">$1</a>'
  );

  // Numbered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="list-decimal">$1</li>');
  html = html.replace(
    /(<li class="list-decimal">.*<\/li>\n?)+/g,
    '<ol class="list-decimal ml-4 space-y-0.5">$&</ol>'
  );

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>(?!.*class=).*<\/li>\n?)+/g, '<ul class="list-disc ml-4 space-y-0.5">$&</ul>');

  // Paragraphs (only between non-block elements)
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs around block elements
  html = html.replace(/<p>\s*(<h[1-4]|<table|<ul|<ol|<hr)/g, "$1");
  html = html.replace(/(<\/h[1-4]>|<\/table>|<\/ul>|<\/ol>|<hr[^>]*\/>)\s*<\/p>/g, "$1");
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}
