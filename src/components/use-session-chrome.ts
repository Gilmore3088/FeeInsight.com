"use client";

import { useEffect, useState } from "react";

export interface SessionChrome {
  signedIn: boolean;
  initial?: string;
  isStaff?: boolean;
  /** Active subscription or staff: sees the Hamilton workspace items instead of the public nav. */
  isPro?: boolean;
  role?: string;
}

const SIGNED_OUT: SessionChrome = { signedIn: false };

// One fetch per page load, shared by every chrome island that asks.
let inflight: Promise<SessionChrome> | null = null;
// Mounted islands, so a sign-in or sign-out on the client updates the header in place.
const listeners = new Set<(state: SessionChrome) => void>();

function load(): Promise<SessionChrome> {
  if (!inflight) {
    inflight = fetch("/api/session", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : SIGNED_OUT))
      .catch(() => SIGNED_OUT);
  }
  return inflight;
}

/**
 * Forget the cached session so the next chrome island re-fetches it. Call after signing
 * in, registering or signing out on the client.
 */
export function resetSessionChrome(): void {
  inflight = null;
  if (listeners.size === 0) return;
  load().then((state) => {
    for (const listener of listeners) listener(state);
  });
}

/**
 * Session state for site chrome, resolved after hydration.
 *
 * Returns `null` until known, so callers can render the signed-out shape immediately and
 * swap in the signed-in shape without a flash of the wrong state.
 */
export function useSessionChrome(): SessionChrome | null {
  const [state, setState] = useState<SessionChrome | null>(null);
  useEffect(() => {
    let live = true;
    const listener = (next: SessionChrome) => {
      if (live) setState(next);
    };
    listeners.add(listener);
    load().then(listener);
    return () => {
      live = false;
      listeners.delete(listener);
    };
  }, []);
  return state;
}
