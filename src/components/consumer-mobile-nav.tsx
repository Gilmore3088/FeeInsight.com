"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HAMILTON_NAV } from "@/lib/hamilton/navigation";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";

const PUBLIC_NAV = [
  { label: "Find Your Institution", href: "/institutions" },
  { label: PRODUCT_NAME, href: "/fees" },
  { label: "Research", href: "/research" },
  { label: "Guides", href: "/guides" },
  { label: "For Institutions", href: "/for-institutions" },
];

const PRO_NAV = HAMILTON_NAV.filter((item) => item.label !== "Admin");
const REQUEST_REPORT = { label: "Request your report", href: "/for-institutions#report" };

/** 44px open/close controls: the minimum comfortable touch target. */
const ICON_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-lg text-[#5A5347] hover:bg-[#E8DFD1]/40 transition-colors";
const DRAWER_LINK =
  "block rounded-lg px-3 py-2.5 text-[14px] font-medium text-[#5A5347] hover:bg-[#E8DFD1]/40 hover:text-[#1A1815] transition-colors";

interface ConsumerMobileNavProps {
  isLoggedIn: boolean;
  isPro?: boolean;
}

export function ConsumerMobileNav({ isLoggedIn, isPro = false }: ConsumerMobileNavProps) {
  const displayItems = isPro
    ? PRO_NAV
    : [...PUBLIC_NAV, ...(isLoggedIn ? [] : [{ label: "Pricing", href: "/subscribe" }])];

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

      {/* Portaled to <body>: the header's backdrop-blur makes it the containing block for
          fixed children, which would clip the drawer to the header's 56px height. */}
      {open && createPortal(
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-[#1A1815]/20 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div className="fixed top-0 right-0 z-50 flex h-dvh w-[min(18rem,calc(100vw-1rem))] flex-col bg-[#FAF7F2] border-l border-[#E8DFD1] shadow-xl animate-in slide-in-from-right duration-200">
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

            <nav className="flex-1 overflow-y-auto px-4 py-4" aria-label="Mobile navigation">
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
                      href={REQUEST_REPORT.href}
                      onClick={() => setOpen(false)}
                      className="mt-2 block rounded-md bg-[#C44B2E] px-3 py-2.5 text-center text-[14px] font-semibold text-white transition-colors hover:bg-[#A93D25]"
                    >
                      {REQUEST_REPORT.label}
                    </Link>
                  </>
                )}
              </div>
            </nav>

            <div className="border-t border-[#E8DFD1] px-6 py-4">
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
        </div>,
        document.body,
      )}
    </div>
  );
}
