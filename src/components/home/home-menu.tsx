"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

interface HomeMenuProps {
  items: readonly { label: string; href: string }[];
}

/**
 * The phone and tablet menu: one button that shows the four links and sign in.
 * Closes on Escape, on an outside click and after a link is chosen.
 */
export function HomeMenu({ items }: HomeMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[4px] border border-index-line bg-white text-index-navy hover:bg-index-cloud"
      >
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <nav
        id={panelId}
        aria-label="Primary"
        hidden={!open}
        className="absolute inset-x-0 top-16 border-b border-index-line bg-white shadow-[0_12px_24px_-16px_rgba(14,26,43,0.4)]"
      >
        <ul className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                className="block min-h-11 py-3 text-[16px] text-index-navy hover:text-index-green"
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li className="sm:hidden">
            <Link href="/login" onClick={() => setOpen(false)} className="block min-h-11 py-3 text-[16px] text-index-navy hover:text-index-green">
              Sign in
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
