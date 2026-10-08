"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ROOMS, findRoomPage, roomForPath, type RoomPage } from "@/lib/admin-rooms";

function badgeFor(page: RoomPage, badges?: Record<string, number>): number {
  return page.badgeKey ? badges?.[page.badgeKey] ?? 0 : 0;
}

function Badge({ count, active }: { count: number; active: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
        active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The six rooms, in the top bar on wider screens. A phone gets AdminRoomMenu instead. */
export function AdminRoomTabs({ badges }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  const current = roomForPath(pathname);
  const navRef = useRef<HTMLElement>(null);
  // On a narrow screen the later rooms sit off to the right; bring the current one into view.
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current.key]);
  return (
    <nav ref={navRef} aria-label="Admin rooms" className="admin-nav-inline hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
      {ROOMS.map((room) => {
        const active = room.key === current.key;
        const count = room.pages.reduce((sum, page) => sum + badgeFor(page, badges), 0);
        return (
          <Link
            key={room.key}
            href={room.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12px] font-semibold transition-colors ${
              active
                ? "bg-gray-900 text-white dark:bg-white/15 dark:text-gray-100"
                : "text-gray-500 hover:bg-black/[0.04] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.05] dark:hover:text-gray-200"
            }`}
          >
            {room.label}
            <Badge count={count} active={active} />
          </Link>
        );
      })}
    </nav>
  );
}

/** The room's screens split into the main list and the ones under "More". */
function splitPages(pages: RoomPage[]): { main: RoomPage[]; more: RoomPage[] } {
  return { main: pages.filter((page) => !page.more), more: pages.filter((page) => page.more) };
}

function SideLink({ page, active, badges }: { page: RoomPage; active: boolean; badges?: Record<string, number> }) {
  return (
    <Link
      href={page.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
        active
          ? "bg-gray-900 text-white dark:bg-white/10 dark:text-gray-100"
          : "text-gray-600 hover:bg-black/[0.03] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-gray-200"
      }`}
    >
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12px] font-semibold">{page.label}</span>
        <span className={`block truncate text-[9px] ${active ? "text-white/60" : "text-gray-400"}`}>{page.role}</span>
      </span>
      <Badge count={badgeFor(page, badges)} active={active} />
    </Link>
  );
}

/** The screens of the current room, down the side on wider screens. Less-used ones fold under "More". */
export function AdminNav({ badges }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  const room = roomForPath(pathname);
  const activePage = findRoomPage(pathname)?.page;
  const { main, more } = splitPages(room.pages);
  const moreBadges = more.reduce((sum, page) => sum + badgeFor(page, badges), 0);
  return (
    <nav aria-label={`${room.label} screens`} className="admin-sidebar-nav flex flex-col gap-0.5 px-2.5 py-1">
      <span className="mb-1 block px-2 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">{room.label}</span>
      {main.map((page) => (
        <SideLink key={page.href} page={page} active={page === activePage} badges={badges} />
      ))}
      {more.length > 0 ? (
        <details
          key={room.key}
          open={activePage ? more.includes(activePage) : false}
          className="group mt-1 border-t border-black/[0.05] pt-1 dark:border-white/[0.05]"
        >
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-[11px] font-semibold text-gray-500 hover:bg-black/[0.03] hover:text-gray-900 dark:hover:bg-white/[0.04] dark:hover:text-gray-200 [&::-webkit-details-marker]:hidden">
            <span className="flex-1">More ({more.length})</span>
            <Badge count={moreBadges} active={false} />
            <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
          </summary>
          <div className="mt-0.5 flex flex-col gap-0.5">
            {more.map((page) => (
              <SideLink key={page.href} page={page} active={page === activePage} badges={badges} />
            ))}
          </div>
        </details>
      ) : null}
    </nav>
  );
}

/** The side column. Left out for a one-screen room (Today) so its page gets the full width. */
export function AdminSidebar({ badges, footer }: { badges?: Record<string, number>; footer?: ReactNode }) {
  const pathname = usePathname();
  if (roomForPath(pathname).pages.length < 2) return null;
  return (
    <aside className="hidden md:flex flex-col w-[180px] shrink-0 sticky top-[var(--admin-nav-h)] h-[calc(100vh-var(--admin-nav-h))] border-r border-black/[0.04] dark:border-white/[0.04] bg-white/60 dark:bg-[oklch(0.15_0_0)]/60 backdrop-blur-sm overflow-y-auto">
      <div className="flex-1 py-2.5">
        <AdminNav badges={badges} />
      </div>
      {footer}
    </aside>
  );
}

function isLanding(pathname: string, roomHref: string): boolean {
  return (pathname.replace(/\/+$/, "") || "/admin") === roomHref;
}

/**
 * The phone's only navigation, in the header. On a room's landing page it names the room and
 * opens a list of the six rooms; on a screen inside a room it is the way back to that room.
 * Wider screens use the room tabs and the side menu instead.
 */
export function AdminRoomMenu({ badges }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  const room = roomForPath(pathname);
  // The list is open on the page it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenOn(null);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (room.pages.length > 1 && !isLanding(pathname, room.href)) {
    return (
      <Link
        href={room.href}
        prefetch={false}
        className="inline-flex min-h-11 min-w-11 items-center gap-1 px-1 text-[15px] font-semibold text-[var(--brand-primary)] md:hidden"
      >
        <span aria-hidden="true" className="text-lg leading-none">‹</span> {room.label}
      </Link>
    );
  }

  const roomCount = (key: string) =>
    ROOMS.find((candidate) => candidate.key === key)!.pages.reduce((sum, page) => sum + badgeFor(page, badges), 0);
  const waiting = ROOMS.some((candidate) => roomCount(candidate.key) > 0);
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="admin-room-menu"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold text-gray-900 hover:bg-black/[0.04] dark:text-gray-100 dark:hover:bg-white/[0.05]"
      >
        {room.label}
        {waiting ? <span aria-label="Something is waiting" className="size-2 rounded-full bg-amber-500" /> : null}
        <span aria-hidden="true" className={`text-xs text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <>
          <button
            type="button"
            aria-label="Close the room list"
            onClick={() => setOpen(false)}
            className="fixed inset-x-0 bottom-0 top-[var(--admin-nav-h)] z-50 bg-black/30 md:hidden"
          />
          <nav
            id="admin-room-menu"
            aria-label="Choose a room"
            className="fixed inset-x-0 top-[var(--admin-nav-h)] z-[60] max-h-[calc(100vh-var(--admin-nav-h))] overflow-y-auto border-b border-black/[0.06] bg-white shadow-lg dark:border-white/[0.08] dark:bg-[oklch(0.18_0_0)] md:hidden"
          >
            <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              {ROOMS.map((candidate) => {
                const active = candidate.key === room.key;
                const count = roomCount(candidate.key);
                return (
                  <li key={candidate.key}>
                    <Link
                      href={candidate.href}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className="flex min-h-14 items-center gap-3 px-4 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-gray-900 dark:text-gray-100">{candidate.label}</span>
                        <span className="block text-[12px] text-gray-500">{candidate.question}</span>
                      </span>
                      <Badge count={count} active={false} />
                      {active ? <span aria-hidden="true" className="text-[15px] font-bold text-[var(--brand-primary)]">✓</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>,
        document.body,
      ) : null}
    </div>
  );
}

/**
 * On a phone, a room's landing page lists its other screens in one fold under the heading, so
 * every screen is one tap from the room without a second row of tabs. Screens the page already
 * shows as cards (the agents) are left out, and the less-used ones come last.
 */
/** Review counts from the layout, for screens drawn inside a page (the phone screen list). */
const AdminBadges = createContext<Record<string, number> | undefined>(undefined);

export function AdminBadgesProvider({ badges, children }: { badges: Record<string, number>; children: ReactNode }) {
  return <AdminBadges.Provider value={badges}>{children}</AdminBadges.Provider>;
}

export function AdminRoomScreens({ badges: given }: { badges?: Record<string, number> }) {
  const context = useContext(AdminBadges);
  const badges = given ?? context;
  const pathname = usePathname();
  const room = roomForPath(pathname);
  if (room.pages.length < 2 || !isLanding(pathname, room.href)) return null;
  const listed = room.pages.filter((page) => page.href !== room.href && !page.card);
  if (listed.length === 0) return null;
  const { main, more } = splitPages(listed);
  const row = (page: RoomPage) => (
    <li key={page.href}>
      <Link href={page.href} prefetch={false} className="flex min-h-12 items-center gap-3 border-b border-black/[0.05] px-1 py-2 dark:border-white/[0.06]">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-gray-900 dark:text-gray-100">{page.label}</span>
          <span className="block text-[12px] text-gray-500">{page.role}</span>
        </span>
        <Badge count={badgeFor(page, badges)} active={false} />
        <span aria-hidden="true" className="text-gray-400">›</span>
      </Link>
    </li>
  );
  return (
    <details className="group md:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-[14px] font-semibold text-[var(--brand-primary)] [&::-webkit-details-marker]:hidden">
        {listed.length} more screens
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
      </summary>
      <ul className="mt-1">{main.map(row)}</ul>
      {more.length > 0 ? (
        <>
          <p className="admin-section-title mt-4">Less used</p>
          <ul className="mt-1">{more.map(row)}</ul>
        </>
      ) : null}
    </details>
  );
}
