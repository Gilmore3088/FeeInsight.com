import * as React from "react";
import { AppIcon } from "./AppIcon";

export interface ChatMessageProps {
  from: "hamilton" | "user";
  children: React.ReactNode;
  /** Hamilton only: where the numbers came from. */
  source?: string;
  className?: string;
}

/** One message in the Hamilton chat. Wrap figures in <Figure> to set them in Geist Mono. */
export function ChatMessage({ from, children, source, className }: ChatMessageProps) {
  const isUser = from === "user";
  return (
    <div className={["fi-chat", isUser ? "user" : "hamilton", className].filter(Boolean).join(" ")}>
      {isUser ? null : <AppIcon brand="hamilton" size={32} title="" />}
      <div className="fi-chat-bubble">
        {children}
        {source && !isUser ? <span className="fi-chat-source">{source}</span> : null}
      </div>
    </div>
  );
}

export function Figure({ children }: { children: React.ReactNode }) {
  return <span className="fi-chat-fig">{children}</span>;
}
