"use client";

import { useEffect, useSyncExternalStore } from "react";

const THEME_KEY = "bfi-theme";
const LEGACY_KEY = "fi-theme";

function readStoredTheme(): "light" | "dark" | null {
  try {
    const current = localStorage.getItem(THEME_KEY);
    if (current === "dark" || current === "light") return current;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "dark" || legacy === "light") {
      localStorage.setItem(THEME_KEY, legacy);
      localStorage.removeItem(LEGACY_KEY);
      return legacy;
    }
  } catch {
    // localStorage unavailable (privacy mode, ITP, etc.)
  }
  return null;
}

function resolveTheme(): boolean {
  if (document.documentElement.classList.contains("dark")) return true;
  const stored = readStoredTheme();
  if (stored) return stored === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// Every toggle on the page (the header one and the phone footer one) reads the same theme.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener?.("change", listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * The server can't see the browser's stored theme or color scheme, so it renders the light
 * toggle and hydration does too (getServerSnapshot); the stored theme shows right after.
 * Reading it in the first client render made the server and client HTML differ (React #418).
 */
function serverTheme(): boolean {
  return false;
}

export function DarkModeToggle() {
  const dark = useSyncExternalStore(subscribe, resolveTheme, serverTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  function toggle() {
    const next = !dark;
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Preference won't persist but toggle still works for this session
    }
    document.documentElement.classList.toggle("dark", next);
    listeners.forEach((listener) => listener());
  }

  return (
    <button
      onClick={toggle}
      type="button"
      className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-white/[0.06] transition-colors"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
    >
      {dark ? (
        <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M3.75 12.25l1.06-1.06M11.19 4.81l1.06-1.06" />
        </svg>
      ) : (
        <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <path d="M13.5 9.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z" />
        </svg>
      )}
    </button>
  );
}
