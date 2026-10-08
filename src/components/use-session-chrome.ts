"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";

export interface SessionChrome {
  signedIn: boolean;
  initial?: string;
  isStaff?: boolean;
  /** Active subscription or staff: sees the Hamilton workspace items instead of the public nav. */
  isPro?: boolean;
  role?: string;
}

// One fetch per page load, shared by every chrome island that asks. Resolves to null when
// the session could not be read, so a failed fetch never overwrites a known session.
let inflight: Promise<SessionChrome | null> | null = null;
// Mounted islands, so a sign-in or sign-out on the client updates the header in place.
const listeners = new Set<(state: SessionChrome | null) => void>();

function load(): Promise<SessionChrome | null> {
  if (!inflight) {
    inflight = fetch("/api/session", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<SessionChrome>) : null))
      .catch(() => null);
  }
  return inflight;
}

const SessionChromeSeed = createContext<SessionChrome | null>(null);

/**
 * Hands the header a session a server layout already knows (Hamilton reads the user before
 * rendering), so the chrome draws the right shape on first paint instead of the public one,
 * and keeps it if /api/session fails.
 */
export function SessionChromeProvider({ value, children }: { value: SessionChrome; children: ReactNode }) {
  return createElement(SessionChromeSeed.Provider, { value }, children);
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
 * swap in the signed-in shape without a flash of the wrong state. Under a
 * SessionChromeProvider it starts from the server's session instead.
 */
export function useSessionChrome(): SessionChrome | null {
  const seed = useContext(SessionChromeSeed);
  const [state, setState] = useState<SessionChrome | null>(seed);
  useEffect(() => {
    let live = true;
    const listener = (next: SessionChrome | null) => {
      if (live && next) setState(next);
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
