"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, Bookmark, Calculator, FileText, LineChart, Menu, MessageCircle, Newspaper, Search, Settings, X,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/brand/components";
import {
  HAMILTON_ACCOUNT_NAV, HAMILTON_REFERENCE_NAV, HAMILTON_SAVED_NAV, HAMILTON_SIDEBAR_NAV,
} from "@/lib/hamilton/navigation";
import { isActivePath } from "@/components/nav-items";
import { useHamiltonNavigationHref } from "./hamilton-navigation-context";

const ICONS: Record<string, LucideIcon> = {
  overview: BarChart3,
  ask: MessageCircle,
  research: Search,
  price: Calculator,
  reports: FileText,
  monitor: LineChart,
  wire: Newspaper,
  saved: Bookmark,
};

const SETTINGS_NAV = HAMILTON_ACCOUNT_NAV[0];

/**
 * The Hamilton workspace's left navigation, on the Fee Insight navy (design system, #1285).
 * Desktop: a fixed column. Phones and tablets: a top bar with a menu button that opens the same
 * list as a drawer. Links carry the research subject the way the old header tabs did.
 */
export function HamiltonSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[var(--fi-ink)] text-[var(--fi-on-ink)] lg:flex print:hidden">
        <SidebarBody label="Main navigation" pathname={pathname} />
      </aside>

      <div className="sticky top-0 z-40 flex h-14 items-center justify-between bg-[var(--fi-ink)] px-4 lg:hidden print:hidden">
        <Link href="/pro/hamilton" aria-label="Hamilton home" className="no-underline">
          <Logo mark="hamilton-wordmark" tone="reverse" height={22} title="" />
        </Link>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex h-11 w-11 items-center justify-center rounded-md text-[var(--fi-on-ink)] hover:bg-white/10"
        >
          {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-[var(--fi-ink)] text-[var(--fi-on-ink)]">
            <SidebarBody label="Mobile navigation" pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function SidebarBody({ label, pathname, onNavigate }: { label: string; pathname: string | null; onNavigate?: () => void }) {
  const contextHref = useHamiltonNavigationHref();
  return (
    <>
      <Link href={contextHref("/pro/hamilton")} onClick={onNavigate} className="block px-6 pb-6 pt-7 no-underline" aria-label="Hamilton, powered by Fee Insight">
        <Logo mark="hamilton-lockup" tone="reverse" height={44} title="" />
      </Link>
      <nav aria-label={label} className="flex flex-1 flex-col overflow-y-auto pb-6">
        <ul className="flex flex-col">
          {HAMILTON_SIDEBAR_NAV.map((item) => (
            <li key={item.href}>
              <SidebarLink href={contextHref(item.href)} label={item.label} icon={ICONS[item.icon]}
                active={isActivePath(pathname, item.href)} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <div className="mx-6 my-4 border-t border-white/15" />
        <SidebarLink href={contextHref(HAMILTON_SAVED_NAV.href)} label={HAMILTON_SAVED_NAV.label} icon={ICONS.saved}
          active={false} onNavigate={onNavigate} />
        <p className="px-6 pb-1 pt-6 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">Reference</p>
        <ul className="flex flex-col">
          {HAMILTON_REFERENCE_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
                className="block px-6 py-1.5 text-[13px] text-white/70 no-underline hover:text-white aria-[current=page]:text-white"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-6">
          <SidebarLink href={contextHref(SETTINGS_NAV.href)} label={SETTINGS_NAV.label} icon={Settings}
            active={isActivePath(pathname, SETTINGS_NAV.href)} onNavigate={onNavigate} />
        </div>
      </nav>
    </>
  );
}

function SidebarLink({ href, label, icon: Icon, active, onNavigate }: {
  href: string; label: string; icon: LucideIcon; active: boolean; onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className="relative flex min-h-11 items-center gap-3 px-6 py-2.5 text-[15px] text-white/80 no-underline transition-colors hover:bg-white/5 hover:text-white aria-[current=page]:bg-white/10 aria-[current=page]:font-medium aria-[current=page]:text-white"
    >
      {active ? <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--fi-brick)]" /> : null}
      <Icon aria-hidden className="h-5 w-5 shrink-0" strokeWidth={1.75} />
      {label}
    </Link>
  );
}
