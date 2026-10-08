"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** The six rooms, in the top bar. Scrolls sideways on a phone. */
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
    <nav ref={navRef} aria-label="Admin rooms" className="admin-nav-inline flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
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

/**
 * The same screens as a row of chips at the top of the page on a phone. It scrolls away with
 * the page, so the only bar that stays on screen is the top bar. Hidden when the room has one screen.
 * Less-used screens wait behind a "More" chip; the one you are on always shows.
 */
export function AdminNavInline({ badges }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  const room = roomForPath(pathname);
  const activePage = findRoomPage(pathname)?.page;
  const [showMore, setShowMore] = useState(false);
  if (room.pages.length < 2) return null;
  const { more } = splitPages(room.pages);
  const shown = showMore ? room.pages : room.pages.filter((page) => !page.more || page === activePage);
  const hidden = room.pages.length - shown.length;
  return (
    <nav
      aria-label={`${room.label} screens`}
      className="admin-nav-inline -mx-5 mb-4 flex min-w-0 items-center gap-1 overflow-x-auto px-5 md:hidden"
    >
      {shown.map((page) => {
        const active = page === activePage;
        return (
          <Link
            key={page.href}
            href={page.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            aria-label={`${page.label}: ${page.role}`}
            className={`inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold transition-colors ${
              active
                ? "border-gray-900 bg-gray-900 text-white dark:border-white/15 dark:bg-white/15"
                : "border-black/[0.08] bg-white text-gray-600 hover:text-gray-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300"
            }`}
          >
            {page.label}
            <Badge count={badgeFor(page, badges)} active={active} />
          </Link>
        );
      })}
      {more.length > 0 && (showMore || hidden > 0) ? (
        <button
          type="button"
          onClick={() => setShowMore((open) => !open)}
          aria-expanded={showMore}
          className="inline-flex min-h-9 items-center whitespace-nowrap rounded-full border border-dashed border-black/[0.15] px-3 text-[12px] font-semibold text-gray-500 dark:border-white/[0.15] dark:text-gray-400"
        >
          {showMore ? "Fewer" : `More (${hidden})`}
        </button>
      ) : null}
    </nav>
  );
}
