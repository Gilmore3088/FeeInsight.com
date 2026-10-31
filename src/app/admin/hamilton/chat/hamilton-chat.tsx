"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect } from "react";
import { HAMILTON_VERSION } from "@/lib/hamilton/voice";
import { messageText } from "@/lib/hamilton/message-text";
import { ChatMessage } from "./chat-message";
import type { ConversationSummary } from "@/lib/hamilton/chat-memory";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";

interface HamiltonChatProps {
  initialConversations: ConversationSummary[];
  selectedInstitution?: HamiltonSelectedInstitutionContext | null;
  selectedInstitutionError?: string | null;
  initialIntent?: string | null;
}

const EXAMPLE_PROMPTS = [
  "What's the national overdraft median this quarter?",
  "Compare Kansas bank fees to the national index",
  "What's the 10th district Beige Book saying about deposits?",
  "Which states have the highest wire transfer fees?",
  "Generate a state index report for Texas",
];

export function HamiltonChat({
  initialConversations,
  selectedInstitution,
  selectedInstitutionError,
  initialIntent,
}: HamiltonChatProps) {
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [showSidebar, setShowSidebar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/hamilton/chat",
    }),
    onError: (err) => {
      const msg = err?.message || "";
      if (msg.includes("429") || msg.includes("rate limit")) {
        setError("Rate limit exceeded. Please wait before sending more queries.");
      } else if (msg.includes("503")) {
        setError("Hamilton is temporarily unavailable. Daily cost limit may have been reached.");
      } else if (msg.includes("401") || msg.includes("403")) {
        setError("Authentication error. Please refresh the page.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Refresh conversation list when streaming completes
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      fetch("/api/hamilton/conversations")
        .then((r) => r.json())
        .then((data: { conversations?: ConversationSummary[] }) => {
          if (data.conversations) {
            setConversations(data.conversations);
          }
        })
        .catch(() => {});
    }
  }, [status, messages.length]);

  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId;
    try {
      const res = await fetch("/api/hamilton/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New conversation" }),
      });
      if (res.ok) {
        const data = await res.json();
        const newId = data.id ?? data.conversation_id;
        if (newId) {
          setConversationId(newId);
          return newId;
        }
      }
    } catch {}
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    setError(null);
    const activeConversationId = await ensureConversation();
    sendMessage(
      { text: input },
      {
        body: {
          conversation_id: activeConversationId ?? undefined,
          institutionId: selectedInstitution?.id ?? null,
          intent: initialIntent ?? "admin-chat",
          evidencePolicy: "provisional-first",
        },
      },
    );
    setInput("");
  }

  async function handleSuggestion(q: string) {
    setError(null);
    const activeConversationId = await ensureConversation();
    sendMessage(
      { text: q },
      {
        body: {
          conversation_id: activeConversationId ?? undefined,
          institutionId: selectedInstitution?.id ?? null,
          intent: initialIntent ?? "admin-chat",
          evidencePolicy: "provisional-first",
        },
      },
    );
  }

  function handleNewChat() {
    setMessages([]);
    setConversationId(null);
    inputRef.current?.focus();
  }

  function handleGenerateReport() {
    setError(null);
    sendMessage(
      { text: "Generate a formal report for this analysis" },
      {
        body: {
          conversation_id: conversationId ?? undefined,
          institutionId: selectedInstitution?.id ?? null,
          intent: "report",
          evidencePolicy: "provisional-first",
        },
      },
    );
  }

  async function handleLoadConversation(convId: string) {
    try {
      const res = await fetch(`/api/hamilton/conversations/${convId}/messages`);
      const data = (await res.json()) as {
        messages?: Array<{ role: "user" | "assistant"; content: string }>;
      };
      if (data.messages && data.messages.length > 0) {
        setMessages(
          data.messages.map((m, i) => ({
            id: `loaded-${i}`,
            role: m.role,
            parts: [{ type: "text" as const, text: m.content }],
          }))
        );
        setConversationId(convId);
      }
    } catch {
      setError("Failed to load conversation history.");
    }
  }

  const lastAssistantIndex = messages.reduce((last, m, i) => {
    return m.role === "assistant" ? i : last;
  }, -1);

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
              aria-label="Close sidebar"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <button
            onClick={handleNewChat}
            className="mb-3 w-full rounded-md border border-gray-200 px-2 py-1.5 text-left text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            + New Chat
          </button>

          {conversations.length === 0 ? (
            <p className="text-[11px] text-gray-400">No conversations yet</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => handleLoadConversation(c.id)}
                    className={`w-full rounded px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      conversationId === c.id
                        ? "bg-amber-50 dark:bg-amber-900/20"
                        : ""
                    }`}
                  >
                    <p className="truncate font-medium text-gray-700 dark:text-gray-300">
                      {c.title || "New conversation"}
                    </p>
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
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  Hamilton
                </h1>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-gray-800">
                  v{HAMILTON_VERSION}
                </span>
              </div>
              <p className="text-[11px] text-gray-400">
                Senior research analyst — Fee Insight
              </p>
              {selectedInstitution && (
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Active institution:{" "}
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    {selectedInstitution.name}
                  </span>{" "}
                  - {selectedInstitution.feePublicationLabel} -{" "}
                  {selectedInstitution.publishedFeeCount} verified /{" "}
                  {selectedInstitution.provisionalFeeCount} provisional
                </p>
              )}
              {selectedInstitutionError && (
                <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Institution context unavailable: {selectedInstitutionError}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              title="Toggle conversation history"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {messages.length > 0 && (
              <button
                onClick={handleNewChat}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
              >
                New Chat
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {/* Empty state */}
          {messages.length === 0 && (
            <div className="mx-auto max-w-2xl pt-8 text-center">
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                Hamilton
              </h2>
              <p className="mt-2 text-[13px] text-gray-500">
                Your senior research analyst — ask about fees, institutions,
                Fed districts, or request a report.
              </p>

              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {EXAMPLE_PROMPTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSuggestion(q)}
                    disabled={isLoading}
                    className="rounded-full border border-gray-200 px-3 py-1.5 text-[11px] text-gray-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-amber-700 dark:hover:bg-amber-900/20"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((message, index) => {
            const textContent = messageText(message);

            const isLastMessage = index === messages.length - 1;
            const isLastAssistant = index === lastAssistantIndex;

            return (
              <ChatMessage
                key={message.id}
                role={message.role as "user" | "assistant"}
                content={textContent}
                isLast={isLastAssistant}
                isLoading={isLastMessage && isLoading}
                onGenerateReport={
                  isLastAssistant && message.role === "assistant"
                    ? handleGenerateReport
                    : undefined
                }
              />
            );
          })}

          {/* Thinking indicator when first streaming */}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="mb-4">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Hamilton
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 [animation-delay:150ms]" />
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 [animation-delay:300ms]" />
                <span className="ml-1">Analyzing...</span>
              </div>
            </div>
          )}

          {/* Error banner */}
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
              placeholder="Ask Hamilton a question..."
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
