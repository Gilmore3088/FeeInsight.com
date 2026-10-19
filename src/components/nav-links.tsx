"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { isActivePath, menuLinks, navItemsFor, type NavGroup, type NavItem } from "./nav-items";
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
  const cards = groups.some((group) => group.title);

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
        className={`absolute top-full z-50 mt-3 rounded-lg border border-border bg-surface-0 shadow-lg shadow-[#132338]/10 ${
          cards ? "-left-36 w-[min(960px,calc(100vw-2rem))] p-4" : columns > 1 ? "left-0 w-[640px] p-4" : "left-0 w-60 p-1.5"
        }`}
      >
        {cards ? (
          <div className="grid grid-cols-3 gap-3">
            {groups.map((group) => (
              <MenuCard key={group.title?.href} group={group} pathname={pathname} onNavigate={() => setOpen(false)} />
            ))}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}

/**
 * One Product menu card: a title link with its line, a small drawing and the card's links. The
 * drawings carry no figures; they only show what each part of the product looks like.
 */
function MenuCard({ group, pathname, onNavigate }: { group: NavGroup; pathname: string | null; onNavigate: () => void }) {
  const title = group.title;
  if (!title) return null;
  const dark = group.feature === true;
  const [primary, ...rest] = group.items;
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg p-4 ${dark ? "bg-ink text-on-ink" : "border border-border bg-paper"}`}
    >
      <Link
        href={title.href}
        onClick={onNavigate}
        aria-current={isActivePath(pathname, title.href) ? "page" : undefined}
        className="group block"
      >
        <span
          className={`block text-[17px] font-semibold leading-tight group-hover:underline ${dark ? "text-on-ink" : "text-ink"}`}
        >
          {title.label}
        </span>
        {title.description ? (
          <span className={`mt-1.5 block text-[12.5px] leading-snug ${dark ? "text-on-ink/75" : "text-ink-muted"}`}>
            {title.description}
          </span>
        ) : null}
      </Link>
      {group.exhibit ? <MenuExhibit kind={group.exhibit} /> : null}
      {dark ? (
        <div className="mt-auto flex flex-wrap items-center gap-3 text-[13px]">
          {primary ? (
            <Link
              href={primary.href}
              onClick={onNavigate}
              className="rounded-md bg-brick px-3.5 py-2 font-semibold text-on-brick hover:opacity-90"
            >
              {primary.label}
            </Link>
          ) : null}
          {rest.map((link) => (
            <Link key={link.href} href={link.href} onClick={onNavigate} className="text-on-ink underline underline-offset-4">
              {link.label}
            </Link>
          ))}
        </div>
      ) : (
        <ul className="mt-auto">
          {group.items.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={onNavigate}
                aria-current={isActivePath(pathname, link.href) ? "page" : undefined}
                className="block py-1 text-[13px] font-semibold text-ink hover:underline"
              >
                {link.label} <span aria-hidden="true" className="text-ink-muted">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RANGE_ROWS = [
  { label: "Overdraft", band: [22, 70], mark: 48 },
  { label: "Wire, out", band: [30, 82], mark: 55 },
  { label: "Maintenance", band: [12, 58], mark: 32 },
] as const;

/** Decorative drawings (no data): fee ranges, the three market layers, a question to Hamilton. */
function MenuExhibit({ kind }: { kind: NonNullable<NavGroup["exhibit"]> }) {
  if (kind === "ranges") {
    return (
      <div aria-hidden="true" className="space-y-2 rounded-md border border-border bg-surface-0 p-3">
        {RANGE_ROWS.map((row) => (
          <div key={row.label} className="grid grid-cols-[72px_1fr] items-center gap-2 text-[11px] text-ink-muted">
            {row.label}
            <div className="relative h-1.5 rounded-full bg-surface-200">
              <div
                className="absolute inset-y-0 rounded-full bg-ink/25"
                style={{ left: `${row.band[0]}%`, right: `${100 - row.band[1]}%` }}
              />
              <div className="absolute -top-1 h-3.5 w-0.5 rounded bg-brick" style={{ left: `${row.mark}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "layers") {
    return (
      <div aria-hidden="true" className="flex h-[78px] items-end gap-2 rounded-md border border-border bg-surface-0 px-3 pb-2 pt-3">
        {[
          { label: "State", height: 30, accent: true },
          { label: "District", height: 42, accent: false },
          { label: "Nation", height: 36, accent: false },
        ].map((bar) => (
          <div key={bar.label} className="flex flex-1 flex-col items-center gap-1 text-[10.5px] text-ink-muted">
            <div className={`w-full rounded-t-sm ${bar.accent ? "bg-brick" : "bg-ink/25"}`} style={{ height: bar.height }} />
            {bar.label}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="self-end rounded-xl rounded-br-sm bg-on-ink/15 px-3 py-2 text-[12px] leading-snug text-on-ink">
        How does our overdraft fee compare with our peers?
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl rounded-bl-sm bg-on-ink/10 p-2.5">
        <div className="h-1.5 w-[92%] rounded-full bg-on-ink/25" />
        <div className="h-1.5 w-[78%] rounded-full bg-on-ink/25" />
        <div className="mt-1 flex gap-1">
          {["Fee schedule", "Call report", "Peer group"].map((chip) => (
            <span key={chip} className="whitespace-nowrap rounded-full border border-brick-on-navy/50 px-1.5 py-0.5 text-[10px] text-brick-on-navy">
              {chip}
            </span>
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
