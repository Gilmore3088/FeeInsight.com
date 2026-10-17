"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server HTML and during hydration, true once React has taken over the page.
 * Forms that handle credentials disable their submit button until then: a form submitted
 * before hydration falls back to the browser's native submit, which never runs our handler.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
