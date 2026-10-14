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
