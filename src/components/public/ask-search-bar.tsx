"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect } from "react";

export function AskSearchBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/research/ask" }),
    onError: (err) => {
      const msg = err?.message || "";
      if (msg.includes("429") || msg.includes("rate limit")) {
        setError("Query limit reached. Please try again later.");
      } else if (msg.includes("503")) {
        setError("AI service is temporarily unavailable.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";
  const hasResult = messages.length > 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    setError(null);
    sendMessage({ text: input });
    setInput("");
  }

  return (
    <div className="w-full">
      {/* Search input */}
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <svg aria-hidden="true"
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about bank fees... e.g. &quot;What is the median overdraft fee?&quot;"
            disabled={isLoading}
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-20 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            {isLoading ? "Asking..." : "Ask"}
          </button>
        </div>
      </form>

      {/* Results area — only shows when there's a response */}
      {hasResult && (
        <div
          ref={scrollRef}
          className="mt-3 max-h-[400px] overflow-y-auto rounded-lg border border-slate-200 bg-white"
        >
          <div className="px-4 py-3 space-y-3">
            {messages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="text-[12px] font-medium text-slate-500">
                    Q: {message.parts
                      .filter((p) => p.type === "text")
                      .map((p) => (p as { type: "text"; text: string }).text)
                      .join("")}
                  </div>
                );
              }

              return (
                <div key={message.id}>
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <div
                          key={i}
                          className="prose prose-sm prose-slate max-w-none text-[13px] leading-relaxed [&_table]:text-[11px] [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:border [&_th]:border [&_td]:border [&_th]:bg-slate-50"
                          dangerouslySetInnerHTML={{
                            __html: simpleMarkdown(
                              (part as { type: "text"; text: string }).text
                            ),
                          }}
                        />
                      );
                    }
                    if (part.type.startsWith("tool-")) {
                      const toolPart = part as {
                        type: string;
                        toolCallId: string;
                        toolName?: string;
                        state?: string;
                      };
                      if (toolPart.state === "call") {
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 text-[11px] text-slate-400"
                          >
                            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                            Querying {toolPart.toolName ?? "data"}...
                          </div>
                        );
                      }
                      return null;
                    }
                    return null;
                  })}
                </div>
              );
            })}

            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex items-center gap-1.5 text-[12px] text-slate-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                Analyzing...
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
            Data from published fee schedules. Not financial advice.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

function simpleMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

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

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-slate-100 px-1 text-[11px]">$1</code>'
  );
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-blue-600 underline">$1</a>'
  );
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  return html;
}
