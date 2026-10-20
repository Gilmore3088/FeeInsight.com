"use client";

import { ArrowRight } from "lucide-react";
import { TrackLink } from "@/components/track-link";
import { useSessionChrome } from "@/components/use-session-chrome";
import { handoffHref, type HamiltonHandoff } from "@/lib/hamilton-handoff";

/**
 * The panel's Hamilton hand-offs. The cached page renders every visitor's shape (to the plans,
 * carrying the Pro address as `from`); a Pro reader's links switch to Hamilton once the session
 * answers. Props are plain data: a server page cannot pass a function to a client component.
 */
export function HandoffLinks({ institutionId, handoffs }: { institutionId: number; handoffs: HamiltonHandoff[] }) {
  const session = useSessionChrome();
  const isPro = Boolean(session?.isPro);
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {handoffs.map((handoff, index) => (
        <li key={handoff.key} className="min-w-0">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: `institution_panel_${handoff.key}`, pro: isPro }}
            href={handoffHref(handoff.proHref, institutionId, { isPro })}
            className={`group flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-[15px] font-medium leading-snug transition-colors duration-200 ${
              index === 0
                ? "border-brick bg-brick text-on-ink hover:opacity-90"
                : "border-border bg-surface-0 text-ink hover:border-ink"
            }`}
          >
            <span>{handoff.label}</span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </TrackLink>
        </li>
      ))}
    </ul>
  );
}
