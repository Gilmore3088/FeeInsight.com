"use client";

import { useId, useState } from "react";

export function CodeBlock({
  children,
  title,
  copyLabel = title,
}: {
  children: string;
  title: string;
  copyLabel?: string;
}) {
  const codeId = useId();
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  async function copy() {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(children);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="mt-3 min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{title}</p>
        <button
          type="button"
          aria-label={`Copy ${copyLabel}`}
          aria-controls={codeId}
          disabled={copyState === "copying"}
          className="min-h-11 shrink-0 rounded-md border border-border px-3 text-[12px] font-medium text-ink-soft hover:bg-paper disabled:opacity-60"
          onClick={copy}
        >
          {copyState === "copying" ? "Copying…" : copyState === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        id={codeId}
        tabIndex={0}
        aria-label={title}
        className="max-w-full overflow-x-auto rounded-lg bg-ink px-5 py-4 text-[12px] leading-relaxed text-border"
      >
        <code>{children}</code>
      </pre>
      <p role="status" className="mt-1 text-[12px] text-ink-muted">
        {copyState === "copied" && "Copied to clipboard."}
        {copyState === "failed" && "Copy unavailable. Select the code and copy it manually."}
      </p>
    </div>
  );
}
