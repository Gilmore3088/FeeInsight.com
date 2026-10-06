"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HAMILTON_NAV, HAMILTON_REFERENCE_NAV } from "@/lib/hamilton/navigation";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { SITE_NAME } from "@/lib/constants";

interface HamiltonTopNavProps {
  isAdmin: boolean;
  activeHref: string;
  selectedInstitutionId?: string | null;
  /** The bank every screen is working on; null until one is chosen. */
  institutionName?: string | null;
  /** Set when a bank is only being browsed: the link that makes it the user's bank. */
  makeDefaultHref?: string | null;
  user: {
    display_name: string;
    email: string | null;
    role: string;
  };
}

/**
 * The one header Hamilton has (James, 2026-10-06: one nav, nothing else around the page).
 * Wordmark, the six workspace screens, the bank being worked on, and an account menu that holds
 * everything else: reference pages, Admin for admins, and sign out.
 */
export function HamiltonTopNav({
  isAdmin,
  activeHref,
  selectedInstitutionId,
  institutionName = null,
  makeDefaultHref = null,
  user,
}: HamiltonTopNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPath = pathname || activeHref;
  const activeInstitutionId = searchParams.get("instId") ?? selectedInstitutionId;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => currentPath === href || currentPath.startsWith(href + "/");
  const initials = user.display_name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const withBank = (href: string) => hrefWithInstitutionContext(href, activeInstitutionId);

  return (
    <header className="sticky top-0 z-40 border-b border-warm-300 bg-warm-100/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href={withBank("/pro/hamilton")} className="flex items-baseline gap-2 no-underline">
          <span className="text-2xl text-warm-900" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Hamilton
          </span>
          <span className="hidden text-[11px] uppercase tracking-[0.14em] text-warm-600 sm:inline">{SITE_NAME}</span>
        </Link>

        <nav aria-label="Hamilton" className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
          {HAMILTON_NAV.filter((item) => item.label !== "Admin").map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={withBank(item.href)}
                aria-current={active ? "page" : undefined}
                className={
                  "shrink-0 border-b-2 px-2.5 py-1.5 text-sm no-underline transition-colors " +
                  (active ? "border-terra font-medium text-warm-900" : "border-transparent text-warm-700 hover:text-warm-900")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-3">
          {institutionName ? (
            <span className="flex min-w-0 items-baseline gap-2 text-sm">
              <span className="truncate font-medium text-warm-900" title={institutionName}>
                {institutionName}
              </span>
              {makeDefaultHref ? (
                <Link href={makeDefaultHref} className="shrink-0 text-xs text-terra-text no-underline hover:underline">
                  Make this my bank
                </Link>
              ) : (
                <Link href={withBank("/pro/settings")} className="shrink-0 text-xs text-terra-text no-underline hover:underline">
                  Change
                </Link>
              )}
            </span>
          ) : (
            <Link href="/pro/settings" className="text-sm font-medium text-terra-text no-underline hover:underline">
              Choose your bank
            </Link>
          )}

          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-warm-900 text-xs font-semibold text-warm-ink-50"
              aria-label="Account menu"
              aria-expanded={menuOpen}
            >
              {initials}
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-warm-300 bg-warm-50 py-1 text-sm shadow-lg">
                <div className="border-b border-warm-200 px-4 py-3">
                  <p className="truncate font-medium text-warm-900">{user.display_name}</p>
                  {user.email ? <p className="truncate text-xs text-warm-600">{user.email}</p> : null}
                </div>
                <p className="px-4 pb-1 pt-3 text-[11px] uppercase tracking-[0.1em] text-warm-600">Reference</p>
                {HAMILTON_REFERENCE_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={withBank(item.href)}
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-1.5 text-warm-800 no-underline hover:bg-warm-150"
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="mt-1 border-t border-warm-200 py-1">
                  {isAdmin ? (
                    <Link href="/admin" className="block px-4 py-1.5 text-warm-800 no-underline hover:bg-warm-150">
                      Admin
                    </Link>
                  ) : null}
                  <form action="/api/auth/logout" method="POST">
                    <button type="submit" className="w-full px-4 py-1.5 text-left text-warm-700 hover:bg-warm-150">
                      Sign out
                    </button>
                  </form>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
