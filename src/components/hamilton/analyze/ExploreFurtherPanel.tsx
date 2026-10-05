"use client";

const DEFAULT_PROMPTS = [
  "How does this compare to similar-sized banks?",
  "When did we become an outlier?",
  "Which peers moved first?",
  "What's driving complaint alignment?",
];

interface ExploreFurtherPanelProps {
  prompts: string[];
  onPromptSelect: (prompt: string) => void;
  isVisible: boolean;
}

/**
 * ExploreFurtherPanel — Hamilton's suggested follow-up questions, rendered in
 * the page flow under the evidence as a short list of full-width buttons.
 * Falls back to DEFAULT_PROMPTS when Hamilton hasn't returned suggestions yet.
 */
export function ExploreFurtherPanel({
  prompts,
  onPromptSelect,
  isVisible,
}: ExploreFurtherPanelProps) {
  if (!isVisible) return null;

  const displayPrompts = prompts.length > 0 ? prompts : DEFAULT_PROMPTS;

  return (
    <section className="hamilton-card p-5" aria-label="Explore further">
      <h3
        className="text-xs font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--hamilton-text-secondary)" }}
      >
        Ask Hamilton next
      </h3>
      <ul className="flex flex-col gap-2">
        {displayPrompts.map((prompt, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onPromptSelect(prompt)}
              className="group flex w-full items-start justify-between gap-4 rounded-lg border px-4 py-3 text-left text-sm leading-snug transition-colors hover:border-[color:var(--hamilton-primary)] focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
                borderColor: "rgba(216,194,184,0.5)",
                color: "var(--hamilton-text-primary)",
              }}
            >
              <span className="text-pretty">{prompt}</span>
              <span
                aria-hidden="true"
                className="shrink-0 transition-transform group-hover:translate-x-0.5"
                style={{ color: "var(--hamilton-primary)" }}
              >
                &rarr;
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
