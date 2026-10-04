"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HAMILTON_NAV, HAMILTON_REFERENCE_NAV } from "@/lib/hamilton/navigation";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";

interface HamiltonTopNavProps {
  isAdmin: boolean;
  activeHref: string;
  selectedInstitutionId?: string | null;
  user: {
    display_name: string;
    email: string | null;
    role: string;
  };
}

/**
 * HamiltonTopNav — Client component.
 * Renders the horizontal nav bar with Hamilton wordmark, 6 nav items, and avatar dropdown.
 * Uses usePathname() for live client-side active state; activeHref provides
 * the server-rendered initial active state so the correct item is highlighted
 * in the initial HTML without waiting for client JS (satisfies SC-2).
 * Nav items sourced from HAMILTON_NAV single source of truth (D-16, superseded
 * 2026-04-17 by UX audit H-4 — labels updated, lookups via that constant).
 * Per D-02: Settings link only in avatar dropdown, not in main nav.
 */
export function HamiltonTopNav({ isAdmin, activeHref, selectedInstitutionId, user }: HamiltonTopNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPath = pathname || activeHref;
  const activeInstitutionId = searchParams.get("instId") ?? selectedInstitutionId;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function isActive(href: string): boolean {
    return currentPath === href || currentPath.startsWith(href + "/");
  }

  function getInitials(name: string): string {
    return name
      .split(" ")
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

  return (
    <header
      className="sticky top-0 z-40 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6"
      style={{
        backgroundColor: "var(--hamilton-surface)",
        borderBottom: "1px solid var(--hamilton-border)",
        minHeight: "56px",
      }}
    >
      {/* Hamilton wordmark */}
      <span
        className="min-w-0 shrink-0 text-xl font-bold tracking-tight select-none"
        style={{
          fontFamily: "var(--hamilton-font-serif)",
          color: "var(--hamilton-text-primary)",
        }}
      >
        Hamil<span style={{ color: "var(--hamilton-accent)" }}>ton</span>
      </span>

      {/* Nav items */}
      <nav
        className="order-3 flex w-full min-w-0 flex-wrap items-center gap-1 pb-0.5 md:order-none md:w-auto md:flex-nowrap md:pb-0"
        aria-label="Hamilton workspace"
      >
        {HAMILTON_NAV.map((item) => {
          if (item.label === "Admin" && !isAdmin) return null;

          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={hrefWithInstitutionContext(item.href, activeInstitutionId)}
              className="shrink-0 rounded px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide no-underline transition-colors sm:px-3 sm:text-xs"
              style={{
                fontFamily: "var(--hamilton-font-sans)",
                color: active
                  ? "var(--hamilton-text-primary)"
                  : "var(--hamilton-text-secondary)",
                borderBottom: active
                  ? "2px solid var(--hamilton-accent)"
                  : "2px solid transparent",
              }}
            >
              {item.label}
            </Link>
          );
        })}
        <details className="group relative shrink-0">
          <summary
            className="cursor-pointer list-none rounded px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide sm:px-3 sm:text-xs"
            style={{
              fontFamily: "var(--hamilton-font-sans)",
              color: HAMILTON_REFERENCE_NAV.some((item) => isActive(item.href))
                ? "var(--hamilton-text-primary)"
                : "var(--hamilton-text-secondary)",
            }}
          >
            Reference <span aria-hidden="true">▾</span>
          </summary>
          <div
            className="absolute left-0 z-50 mt-1 w-64 rounded-lg py-1 shadow-lg"
            style={{ backgroundColor: "var(--hamilton-surface)", border: "1px solid var(--hamilton-border)" }}
          >
            {HAMILTON_REFERENCE_NAV.map((item) => (
              <Link
                key={item.href}
                href={hrefWithInstitutionContext(item.href, activeInstitutionId)}
                className="block px-4 py-2 no-underline hover:opacity-80"
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                <span className="block text-sm font-medium" style={{ color: "var(--hamilton-text-primary)" }}>
                  {item.label}
                </span>
                <span className="block text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
                  {item.description}
                </span>
              </Link>
            ))}
          </div>
        </details>
      </nav>

      {/* Avatar dropdown */}
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center justify-center rounded-full text-white text-xs font-bold select-none cursor-pointer border-0 outline-none focus:ring-2"
          style={{
            width: "32px",
            height: "32px",
            backgroundColor: "var(--hamilton-accent)",
          }}
          aria-label="User menu"
          aria-expanded={dropdownOpen}
        >
          {getInitials(user.display_name)}
        </button>

        {dropdownOpen && (
          <div
            className="absolute right-0 mt-2 w-56 rounded-lg shadow-lg z-50"
            style={{
              backgroundColor: "var(--hamilton-surface)",
              border: "1px solid var(--hamilton-border)",
              top: "100%",
            }}
          >
            {/* User info */}
            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--hamilton-border)" }}>
              <p
                className="text-sm font-semibold truncate"
                style={{ color: "var(--hamilton-text-primary)" }}
              >
                {user.display_name}
              </p>
              {user.email && (
                <p
                  className="text-xs truncate mt-0.5"
                  style={{ color: "var(--hamilton-text-secondary)" }}
                >
                  {user.email}
                </p>
              )}
            </div>

            {/* Settings link */}
            <div className="py-1">
              <Link
                href={hrefWithInstitutionContext("/pro/settings", activeInstitutionId)}
                className="flex items-center px-4 py-2 text-sm no-underline transition-colors hover:opacity-80"
                style={{ color: "var(--hamilton-text-primary)" }}
                onClick={() => setDropdownOpen(false)}
              >
                Settings
              </Link>
            </div>

            {/* Sign out */}
            <div className="border-t py-1" style={{ borderColor: "var(--hamilton-border)" }}>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="w-full text-left px-4 py-2 text-sm transition-colors hover:opacity-80 border-0 bg-transparent cursor-pointer"
                  style={{ color: "var(--hamilton-text-secondary)" }}
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
