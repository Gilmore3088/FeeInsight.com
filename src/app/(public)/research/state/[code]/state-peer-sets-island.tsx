"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/**
 * The state page's peer-group choice, read in the browser. The page is cached (ISR) and never
 * reads its query string, so every group's exhibit is rendered on the server and `?peers=` picks
 * one here. Without JavaScript, or before the address is read, the default group shows.
 */
export function StatePeerSetsIsland({ views, defaultKey }: { views: Record<string, ReactNode>; defaultKey: string }) {
  return (
    <Suspense fallback={views[defaultKey]}>
      <ChosenView views={views} defaultKey={defaultKey} />
    </Suspense>
  );
}

function ChosenView({ views, defaultKey }: { views: Record<string, ReactNode>; defaultKey: string }) {
  const requested = useSearchParams().get("peers");
  const key = requested && Object.hasOwn(views, requested) ? requested : defaultKey;
  return <>{views[key]}</>;
}
