/**
 * What a reader sees when the AI provider refuses Hamilton's paid calls for a usage or
 * billing limit (isProviderLimitError in src/lib/ai-provider.ts). Client-safe: no provider
 * SDK here, so browser components can match and show it.
 */
export const HAMILTON_PAUSED_MESSAGE =
  "Hamilton's written answers are paused right now. Try again later. Everything else on Fee Insight still works.";

/** True when text (an error message or response body) carries the paused line. */
export function isHamiltonPausedText(text: string | null | undefined): boolean {
  return Boolean(text && text.includes(HAMILTON_PAUSED_MESSAGE));
}

/**
 * What a reader sees when the provider errs, times out or stops short mid-answer (V5 T6). The
 * answer never passed the evidence gate, so none of its draft is shown.
 */
export const UNFINISHED_ANSWER_MESSAGE = "Hamilton couldn't finish this answer, so none of it is shown. Try again in a moment.";

/**
 * What a reader sees when Hamilton's paid calls are stopped on purpose: the provider stop, the
 * spend breaker or the provider budget (V5 T6). The internal reason is never shown.
 */
export const HAMILTON_STOPPED_MESSAGE =
  "Hamilton's AI is paused right now while spending is checked, so it can't answer. Everything else on Fee Insight still works.";
