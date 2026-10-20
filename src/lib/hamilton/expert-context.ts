/**
 * The state banking context around an institution's fees on the Benchmark page: the
 * state expert, the state regulator, and state medians from published fees. Economy,
 * Beige Book and regulatory news come from the shared getStateEconomicContext reader.
 * Read-only and deterministic: every line is a stored fact, never generated text.
 */

export interface StateMedian {
  median: number;
  p25: number;
  p75: number;
  count: number;
}

export interface ExpertStateContext {
  stateCode: string;
  stateName: string;
  expertName: string | null;
  expertBio: string | null;
  regulator: string | null;
  regulatorUrl: string | null;
  /** Set only where credit unions are chartered by a different agency than banks. */
  creditUnionRegulator: string | null;
  /** State-wide medians by fee category, only where at least PEER_MIN_INSTITUTIONS publish the fee. */
  medians: Record<string, StateMedian>;
}

/** The opening sentences of a Beige Book summary, whole sentences only, about two lines. */
export function beigeBookSummary(content: string, maxLength = 280): string {
  const sentences = content.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  let text = "";
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (text && next.length > maxLength) break;
    text = next;
  }
  return text;
}
