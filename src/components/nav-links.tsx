"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { EXPLORE_NAV_HREFS, EXPLORE_NAV_LABEL, isActivePath, navItemsFor, type NavItem } from "./nav-items";
import { useSessionChrome } from "./use-session-chrome";

const ITEM_CLASS =
  "text-[13px] font-medium text-[#6B6255] transition-colors hover:text-[#1A1815] aria-[current=page]:text-[#1A1815]";

/**
 * Desktop nav items. A client island so the header can be rendered into static pages:
 * it draws the signed-out shape (which matches the server HTML) until the session is
 * known, then swaps in the Pro workspace items for Pro users. Public data destinations
 * sit under one "Explore data" menu, placed where the first of them would have been.
 */
export function NavLinks() {
  const session = useSessionChrome();
  const pathname = usePathname();
  const items = navItemsFor(session);
  const explore = items.filter((item) => EXPLORE_NAV_HREFS.includes(item.href));
  const firstExplore = items.findIndex((item) => EXPLORE_NAV_HREFS.includes(item.href));

  return (
    <nav className="hidden items-center gap-5 lg:flex" aria-label="Main navigation">
      {items.map((item, index) => {
        if (EXPLORE_NAV_HREFS.includes(item.href)) {
          return index === firstExplore && explore.length > 1 ? (
            <ExploreMenu key="explore" items={explore} pathname={pathname} />
          ) : explore.length > 1 ? null : (
            <NavItemLink key={item.href} item={item} pathname={pathname} />
          );
        }
        return <NavItemLink key={item.href} item={item} pathname={pathname} />;
      })}
    </nav>
  );
}

function NavItemLink({ item, pathname }: { item: NavItem; pathname: string | null }) {
  return (
    <Link
      href={item.href}
      aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
      className={ITEM_CLASS}
    >
      {item.label}
    </Link>
  );
}

function ExploreMenu({ items, pathname }: { items: NavItem[]; pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const inSection = items.some((item) => isActivePath(pathname, item.href));

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex items-center gap-1 text-[13px] font-medium transition-colors hover:text-[#1A1815] ${
          inSection || open ? "text-[#1A1815]" : "text-[#6B6255]"
        }`}
      >
        {EXPLORE_NAV_LABEL}
        <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <ul
        id={menuId}
        hidden={!open}
        className="absolute left-0 top-full z-50 mt-3 w-56 rounded-lg border border-[#E0D7C9] bg-white p-1.5 shadow-lg shadow-[#1A1815]/10"
      >
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-[13px] font-medium text-[#3D3830] hover:bg-[#FAF7F2] hover:text-[#1A1815] aria-[current=page]:text-[#A93D25]"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
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
