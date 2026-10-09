"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { SITE_NAME } from "@/lib/constants";
import { isActivePath, navItemsFor, REQUEST_REPORT_NAV } from "./nav-items";

export { isActivePath };
import { openSearch } from "./public/search-events";
import { useSessionChrome } from "./use-session-chrome";
import { HAMILTON_ACCOUNT_NAV, HAMILTON_REFERENCE_NAV } from "@/lib/hamilton/navigation";

/** 44px open/close controls: the minimum comfortable touch target. */
const ICON_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-lg text-[#5A5347] hover:bg-[#E8DFD1]/40 transition-colors";
const DRAWER_LINK =
  "block rounded-lg px-3 py-2.5 text-[14px] font-medium text-[#5A5347] hover:bg-[#E8DFD1]/40 hover:text-[#1A1815] transition-colors";

/**
 * The phone menu, as a modal dialog: focus moves into it and is trapped there, Escape and
 * the overlay close it, focus returns to the menu button, and the page behind does not
 * scroll. Session state is resolved client-side so the header can be static.
 */
export function ConsumerMobileNav() {
  const session = useSessionChrome();
  const isLoggedIn = session?.signedIn === true;
  const displayItems = navItemsFor(session);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);

  return (
    <div className="lg:hidden">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger className={ICON_BUTTON} aria-label="Open menu">
          <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
        </DialogPrimitive.Trigger>

        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#1A1815]/20 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none" />

          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed top-0 right-0 z-50 flex h-dvh w-[min(18rem,calc(100vw-1rem))] flex-col bg-[#FAF7F2] border-l border-[#E8DFD1] shadow-xl animate-in slide-in-from-right duration-200 motion-reduce:animate-none focus:outline-none"
          >
            <div className="flex h-14 items-center justify-between border-b border-[#E8DFD1] pl-6 pr-3">
              <DialogPrimitive.Title
                className="text-[14px] font-medium text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                Menu
              </DialogPrimitive.Title>
              <DialogPrimitive.Close className={ICON_BUTTON} aria-label="Close menu">
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </DialogPrimitive.Close>
            </div>

            <nav className="flex-1 overflow-y-auto px-4 py-4" aria-label="Mobile navigation">
              <button
                type="button"
                onClick={() => {
                  close();
                  openSearch();
                }}
                className="mb-3 flex w-full items-center gap-2 rounded-lg border border-[#E8DFD1] bg-white px-3 py-2.5 text-left text-[14px] text-[#6B6255] transition-colors hover:border-[#C44B2E]/30"
              >
                <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                Search banks, fees and guides
              </button>
              <ul className="space-y-1">
                {displayItems.map((item) => {
                  const isActive = isActivePath(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={close}
                        aria-current={isActive ? "page" : undefined}
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
                {session?.isPro ? (
                  <ProAccountLinks isStaff={session.isStaff === true} onNavigate={close} />
                ) : isLoggedIn ? (
                  <Link href="/account" onClick={close} className={DRAWER_LINK}>
                    Account
                  </Link>
                ) : (
                  <>
                    <Link href="/login" onClick={close} className={DRAWER_LINK}>
                      Sign in
                    </Link>
                    <Link
                      href={REQUEST_REPORT_NAV.href}
                      onClick={close}
                      className="mt-2 block rounded-md bg-[#C44B2E] px-3 py-2.5 text-center text-[14px] font-semibold text-white transition-colors hover:bg-[#A93D25]"
                    >
                      {REQUEST_REPORT_NAV.label}
                    </Link>
                  </>
                )}
              </div>
            </nav>

            <div className="border-t border-[#E8DFD1] px-6 py-4">
              <div className="flex items-center gap-2 text-[#6B6255]">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-[#C44B2E]/50" stroke="currentColor" strokeWidth="1.5">
                  <rect x="4" y="13" width="4" height="8" rx="1" />
                  <rect x="10" y="8" width="4" height="13" rx="1" />
                  <rect x="16" y="3" width="4" height="18" rx="1" />
                </svg>
                <span className="text-[11px]">{SITE_NAME}</span>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

/**
 * On phones the desktop account menu is hidden, so Pro readers get its items here: the bank
 * and its data, all changes, the Reference pages, Admin for staff, account and sign out.
 */
function ProAccountLinks({ isStaff, onNavigate }: { isStaff: boolean; onNavigate: () => void }) {
  return (
    <>
      {HAMILTON_ACCOUNT_NAV.map((item) => (
        <Link key={item.href} href={item.href} onClick={onNavigate} className={DRAWER_LINK}>
          {item.label}
        </Link>
      ))}
      <p className="px-3 pb-1 pt-3 text-[11px] uppercase tracking-[0.1em] text-[#6B6255]">Reference</p>
      {HAMILTON_REFERENCE_NAV.map((item) => (
        <Link key={item.href} href={item.href} onClick={onNavigate} className={DRAWER_LINK}>
          {item.label}
        </Link>
      ))}
      <div className="mt-3 border-t border-[#E8DFD1] pt-3">
        {isStaff ? (
          <Link href="/admin" onClick={onNavigate} className={DRAWER_LINK}>
            Admin
          </Link>
        ) : null}
        <Link href="/account" onClick={onNavigate} className={DRAWER_LINK}>
          Account and billing
        </Link>
        <form action="/api/auth/logout" method="POST">
          <button type="submit" className={`${DRAWER_LINK} w-full text-left`}>
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
