import { JOURNEY_STAGES, type JourneyStage } from "@/lib/outreach-journey";

/** An outreach journey stage as a score: its place on the journey, 1 (sent) to 5 (purchase). */
export const JOURNEY_SCORE: Record<JourneyStage, number> = Object.fromEntries(
  JOURNEY_STAGES.map((stage, index) => [stage.key, index + 1]),
) as Record<JourneyStage, number>;

/** How the growth pages read a score: the journey stage for an outreach email, tracked visits otherwise. */
export function scoreLabel(kind: string, score: number): string {
  if (kind === "outreach_email") {
    const stage = JOURNEY_STAGES[score - 1];
    return stage ? `reached "${stage.label}" in the week after sending` : "no response recorded in the week after sending";
  }
  return `${score} tracked visit${score === 1 ? "" : "s"} in the week after posting`;
}
