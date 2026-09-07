"use client";

import Link from "next/link";
import { navItemsFor } from "./nav-items";
import { useSessionChrome } from "./use-session-chrome";

/**
 * Desktop nav items. A client island so the header can be rendered into static pages:
 * it draws the signed-out shape (which matches the server HTML) until the session is
 * known, then swaps in the Pro workspace items for Pro users.
 */
export function NavLinks() {
  const session = useSessionChrome();
  return (
    <nav className="hidden items-center gap-5 lg:flex" aria-label="Main navigation">
      {navItemsFor(session).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="text-[13px] font-medium text-[#6B6255] transition-colors hover:text-[#1A1815]"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** "Pro" tag beside the wordmark, only once the session says so. */
export function ProBadge() {
  const session = useSessionChrome();
  if (!session?.isPro) return null;
  return (
    <span className="inline-flex items-center rounded bg-[#C44B2E]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#A93D25]">
      Pro
    </span>
  );
}
