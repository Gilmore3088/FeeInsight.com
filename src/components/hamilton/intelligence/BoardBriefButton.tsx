import { encodeLandingResearch, type LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import type { Lens } from "@/lib/hamilton/market-question";
import { createMarketBoardBrief } from "@/app/pro/(hamilton)/reports/board-actions";
import { PendingSubmit } from "./PendingSubmit";

/** One board brief everywhere: saves the exhibits for this view and opens the board brief editor. */
export function BoardBriefButton({ selection, lenses, size }: { selection: LandingResearchHandoff; lenses: readonly Lens[]; size?: string }) {
  return <form action={createMarketBoardBrief}>
    <input type="hidden" name="research" value={encodeLandingResearch({ ...selection, task: "compare" })} />
    <input type="hidden" name="lenses" value={lenses.join(",")} />
    {size && size !== "all" ? <input type="hidden" name="size" value={size} /> : null}
    <PendingSubmit className="fi-btn fi-btn-primary" pendingLabel="Building brief…">Build board brief</PendingSubmit>
  </form>;
}
