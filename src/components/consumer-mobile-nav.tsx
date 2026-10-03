"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_NAME } from "@/lib/constants";
import { navItemsFor, REQUEST_REPORT_NAV } from "./nav-items";
import { openSearch } from "./public/search-events";
import { useSessionChrome } from "./use-session-chrome";

/** 44px open/close controls: the minimum comfortable touch target. */
const ICON_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-lg text-[#5A5347] hover:bg-[#E8DFD1]/40 transition-colors";
const DRAWER_LINK =
  "block rounded-lg px-3 py-2.5 text-[14px] font-medium text-[#5A5347] hover:bg-[#E8DFD1]/40 hover:text-[#1A1815] transition-colors";

/**
 * Takes no session props: the drawer resolves the session client-side (see
 * `use-session-chrome.ts`) so the header can be rendered into static pages.
 */
export function ConsumerMobileNav() {
  const session = useSessionChrome();
  const isLoggedIn = session?.signedIn === true;
  const displayItems = navItemsFor(session);

  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(!open)}
        className={ICON_BUTTON}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          )}
        </svg>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-[#1A1815]/20 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div className="fixed top-0 right-0 z-50 h-full w-[min(18rem,calc(100vw-1rem))] bg-[#FAF7F2] border-l border-[#E8DFD1] shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex h-14 items-center justify-between border-b border-[#E8DFD1] pl-6 pr-3">
              <span
                className="text-[14px] font-medium text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                Menu
              </span>
              <button onClick={() => setOpen(false)} className={ICON_BUTTON} aria-label="Close menu">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="px-4 py-4" aria-label="Mobile navigation">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openSearch();
                }}
                className="mb-3 flex w-full items-center gap-2 rounded-lg border border-[#E8DFD1] bg-white px-3 py-2.5 text-left text-[14px] text-[#6B6255] transition-colors hover:border-[#C44B2E]/30"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                Search banks, fees and guides
              </button>
              <ul className="space-y-1">
                {displayItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={
                          isActive
                            ? "block rounded-lg bg-[#C44B2E]/8 px-3 py-2.5 text-[14px] font-medium text-[#A93D25] transition-colors"
                            : DRAWER_LINK
                        }
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 border-t border-[#E8DFD1] pt-4">
                {isLoggedIn ? (
                  <Link href="/account" onClick={() => setOpen(false)} className={DRAWER_LINK}>
                    Account
                  </Link>
                ) : (
                  <>
                    <Link href="/login" onClick={() => setOpen(false)} className={DRAWER_LINK}>
                      Sign in
                    </Link>
                    <Link
                      href={REQUEST_REPORT_NAV.href}
                      onClick={() => setOpen(false)}
                      className="mt-2 block rounded-md bg-[#C44B2E] px-3 py-2.5 text-center text-[14px] font-semibold text-white transition-colors hover:bg-[#A93D25]"
                    >
                      {REQUEST_REPORT_NAV.label}
                    </Link>
                  </>
                )}
              </div>
            </nav>

            <div className="absolute bottom-0 left-0 right-0 border-t border-[#E8DFD1] px-6 py-4">
              <div className="flex items-center gap-2 text-[#6B6255]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-4 w-4 text-[#C44B2E]/50"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <rect x="4" y="13" width="4" height="8" rx="1" />
                  <rect x="10" y="8" width="4" height="13" rx="1" />
                  <rect x="16" y="3" width="4" height="18" rx="1" />
                </svg>
                <span className="text-[11px]">{SITE_NAME}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
