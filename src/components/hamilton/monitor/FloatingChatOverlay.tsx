"use client";

/**
 * FloatingChatOverlay — Collapsible Hamilton chat in bottom-right corner.
 * Minimized by default. Expands on click. Does not disrupt the signal feed.
 * Uses useChat + DefaultChatTransport from @ai-sdk/react v3 for streaming.
 */

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

export function FloatingChatOverlay({ institutionId = null }: { institutionId?: string | null } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/research/hamilton",
      // The institution in view, so answers are about what the user is looking at.
      body: { mode: "monitor", institutionId },
    }),
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when overlay opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  function handleClose() {
    if (isStreaming) stop();
    setIsOpen(false);
  }

  // The React Compiler memoizes this; a manual useCallback conflicted with it.
  function handleSend() {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;
    sendMessage({ text: trimmed });
    setInputValue("");
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Ask Hamilton"
        style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          zIndex: 50,
          width: "3rem",
          height: "3rem",
          borderRadius: "9999px",
          backgroundColor: "var(--hamilton-text-accent, #1d4ed8)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          fontSize: "1.125rem",
        }}
        title="Ask Hamilton"
      >
        ✦
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        zIndex: 50,
        width: "360px",
        height: "480px",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--hamilton-surface-1, #fff)",
        border: "1px solid var(--hamilton-border, #e7e5e4)",
        borderRadius: "0.75rem",
        boxShadow:
          "0 10px 25px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--hamilton-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--hamilton-text-primary)",
            fontFamily: "var(--hamilton-font-serif, serif)",
          }}
        >
          Hamilton
        </span>
        <button
          onClick={handleClose}
          aria-label="Close chat"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--hamilton-text-tertiary)",
            fontSize: "1rem",
            lineHeight: 1,
            padding: "0.25rem",
          }}
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0.875rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        {messages.length === 0 && (
          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--hamilton-text-secondary)",
              lineHeight: 1.6,
              textAlign: "center",
              marginTop: "2rem",
            }}
          >
            Ask Hamilton about what you&rsquo;re seeing in the signal feed.
          </p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "0.5rem 0.75rem",
                borderRadius:
                  msg.role === "user"
                    ? "0.75rem 0.75rem 0.125rem 0.75rem"
                    : "0.75rem 0.75rem 0.75rem 0.125rem",
                backgroundColor:
                  msg.role === "user"
                    ? "var(--hamilton-text-accent, #1d4ed8)"
                    : "var(--hamilton-surface-2, #f5f5f4)",
                color:
                  msg.role === "user"
                    ? "#fff"
                    : "var(--hamilton-text-primary)",
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {msg.parts
                ?.filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("") ||
                (isStreaming && msg.role === "assistant" ? (
                  <span style={{ opacity: 0.5 }}>Thinking...</span>
                ) : null)}
            </div>
          </div>
        ))}
        {error && !isStreaming && (
              <p role="alert" style={{ fontSize: "0.75rem", color: "#b91c1c", padding: "0.25rem 0" }}>
                Hamilton couldn&apos;t answer that just now. Please try again.
              </p>
            )}
            <div ref={messagesEndRef} />
      </div>

      {/* Input row */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          padding: "0.75rem 1rem",
          borderTop: "1px solid var(--hamilton-border)",
          flexShrink: 0,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask Hamilton..."
          disabled={isStreaming}
          style={{
            flex: 1,
            fontSize: "0.8125rem",
            padding: "0.375rem 0.625rem",
            border: "1px solid var(--hamilton-border)",
            borderRadius: "0.375rem",
            backgroundColor: "var(--hamilton-surface-1)",
            color: "var(--hamilton-text-primary)",
            
            minWidth: 0,
          }}
        />
        <button
          onClick={handleSend}
          disabled={isStreaming || !inputValue.trim()}
          style={{
            fontSize: "0.8125rem",
            fontWeight: 500,
            padding: "0.375rem 0.75rem",
            backgroundColor: "var(--hamilton-text-accent, #1d4ed8)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            cursor:
              isStreaming || !inputValue.trim() ? "not-allowed" : "pointer",
            opacity: isStreaming || !inputValue.trim() ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
