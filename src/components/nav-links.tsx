"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { isActivePath, menuLinks, navItemsFor, type NavItem } from "./nav-items";
import { useSessionChrome } from "./use-session-chrome";
import { useHamiltonNavigationHref } from "./hamilton/layout/hamilton-navigation-context";

const ITEM_CLASS =
  "text-[13px] font-medium text-ink-muted transition-colors hover:text-ink aria-[current=page]:text-ink";

/**
 * Desktop nav items. A client island so the header can be rendered into static pages:
 * it draws the signed-out shape (which matches the server HTML) until the session is
 * known, then swaps in the Pro workspace items for Pro users. Product and Resources are
 * menus whose links are in the server HTML (a `hidden` list), so crawlers still reach them.
 */
export function NavLinks() {
  const session = useSessionChrome();
  const pathname = usePathname();
  const items = navItemsFor(session);

  return (
    <nav className="hidden items-center gap-5 lg:flex" aria-label="Main navigation">
      {items.map((item) =>
        item.groups ? (
          <NavMenu key={item.label} item={item} pathname={pathname} />
        ) : (
          <NavItemLink key={item.href} item={item} pathname={pathname} />
        ),
      )}
    </nav>
  );
}

function NavItemLink({ item, pathname }: { item: NavItem; pathname: string | null }) {
  const contextHref = useHamiltonNavigationHref();
  return (
    <Link
      href={contextHref(item.href)}
      aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
      className={ITEM_CLASS}
    >
      {item.label}
    </Link>
  );
}

function NavMenu({ item, pathname }: { item: NavItem; pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const groups = item.groups ?? [];
  const inSection = menuLinks(item).some((link) => isActivePath(pathname, link.href));
  const columns = groups.length;

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
        className={`inline-flex items-center gap-1 text-[13px] font-medium transition-colors hover:text-ink ${
          inSection || open ? "text-ink" : "text-ink-muted"
        }`}
      >
        {item.label}
        <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div
        id={menuId}
        hidden={!open}
        className={`absolute left-0 top-full z-50 mt-3 rounded-lg border border-border bg-surface-0 shadow-lg shadow-[#132338]/10 ${
          columns > 1 ? "w-[640px] p-4" : "w-60 p-1.5"
        }`}
      >
        <div className={columns > 1 ? "grid grid-cols-3 gap-4" : ""}>
          {groups.map((group, index) => (
            <div key={group.heading ?? index}>
              {group.heading ? (
                <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
                  {group.heading}
                </p>
              ) : null}
              <ul>
                {group.items.map((link) => (
                  <li key={`${link.href}:${link.label}`}>
                    <Link
                      href={link.href}
                      aria-current={isActivePath(pathname, link.href) ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-3 py-2 hover:bg-paper aria-[current=page]:bg-paper"
                    >
                      <span className="block text-[13px] font-medium text-ink">{link.label}</span>
                      {link.description ? (
                        <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">{link.description}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Pro" tag beside the wordmark, only once the session says so. */
export function ProBadge() {
  const session = useSessionChrome();
  if (!session?.isPro) return null;
  return (
    <span className="inline-flex items-center rounded bg-brick/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brick">
      Pro
    </span>
  );
}
