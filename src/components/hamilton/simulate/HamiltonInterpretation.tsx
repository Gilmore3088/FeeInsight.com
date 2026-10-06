"use client";

interface Props {
  interpretation: string;
  isStreaming: boolean;
  /** What the figures rest on, from describeSimulationBasis; no line when unknown. */
  basis: string | null;
}

export function HamiltonInterpretation({ interpretation, isStreaming, basis }: Props) {
  // Empty and not streaming: placeholder
  if (!isStreaming && !interpretation) {
    return (
      <div
        className="p-6 rounded border"
        style={{
          background: "rgb(250 249 248)",
          borderColor: "rgb(231 229 228)",
        }}
      >
        <p
          className="font-headline text-xl leading-relaxed italic"
          style={{ color: "rgb(120 113 108)" }}
        >
          &ldquo;Commit a fee change above to receive Hamilton&apos;s strategic interpretation.&rdquo;
        </p>
      </div>
    );
  }

  // Streaming but no content yet: skeleton
  if (isStreaming && !interpretation) {
    return (
      <div
        className="p-6 rounded border flex flex-col gap-3"
        style={{
          background: "rgb(250 249 248)",
          borderColor: "rgb(231 229 228)",
        }}
      >
        <div className="skeleton h-5 w-full rounded" />
        <div className="skeleton h-5 w-5/6 rounded" />
        <div className="skeleton h-5 w-4/6 rounded" />
      </div>
    );
  }

  return (
    <div
      className="p-6 rounded border"
      style={{
        background: "rgb(250 249 248)",
        borderColor: "rgb(231 229 228)",
      }}
    >
      <p
        className="font-headline text-xl leading-relaxed italic mb-4"
        style={{ color: "rgb(68 64 60)" }}
      >
        &ldquo;{interpretation}
        {isStreaming && (
          <span
            className="ml-0.5 inline-block animate-pulse"
            style={{ color: "var(--hamilton-primary)" }}
          >
            ▋
          </span>
        )}&rdquo;
      </p>

      {/* Confidence grounding footer */}
      {!isStreaming && interpretation && basis && (
        <div
          className="flex items-center gap-2 pt-4 border-t"
          style={{ borderColor: "rgba(231, 229, 228, 0.6)" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--hamilton-primary)", flexShrink: 0 }}
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
          <span
            className="font-label uppercase tracking-widest"
            style={{ fontSize: "0.6875rem", letterSpacing: "0.07em", color: "rgb(120 113 108)" }}
          >
            {basis}
          </span>
        </div>
      )}
    </div>
  );
}
