"use client";

import { useState } from "react";
import { Logo } from "@/brand/components";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { isActivePath, MOBILE_NAV_SECTIONS, navItemsFor, PRIMARY_CTA_NAV, type NavGroup } from "./nav-items";

export { isActivePath };
import { openSearch } from "./public/search-events";
import { SignOutForm } from "./sign-out-form";
import { useSessionChrome } from "./use-session-chrome";
import { HAMILTON_ACCOUNT_NAV, HAMILTON_REFERENCE_NAV } from "@/lib/hamilton/navigation";
import { useHamiltonNavigationHref } from "./hamilton/layout/hamilton-navigation-context";

/** 44px open/close controls: the minimum comfortable touch target. */
const ICON_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-border/40 transition-colors";
const DRAWER_LINK =
  "block rounded-lg px-3 py-2.5 text-[14px] font-medium text-ink-soft hover:bg-border/40 hover:text-ink transition-colors";

/**
 * The phone menu, as a modal dialog: focus moves into it and is trapped there, Escape and
 * the overlay close it, focus returns to the menu button, and the page behind does not
 * scroll. Session state is resolved client-side so the header can be static.
 */
export function ConsumerMobileNav() {
  const session = useSessionChrome();
  const isLoggedIn = session?.signedIn === true;
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
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none" />

          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed top-0 right-0 z-50 flex h-dvh w-[min(18rem,calc(100vw-1rem))] flex-col bg-paper border-l border-border shadow-xl animate-in slide-in-from-right duration-200 motion-reduce:animate-none focus:outline-none"
          >
            <div className="flex h-14 items-center justify-between border-b border-border pl-6 pr-3">
              <DialogPrimitive.Title
                className="text-[14px] font-semibold text-ink"
                style={{ fontFamily: "var(--fi-font-sans)" }}
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
                className="mb-3 flex w-full items-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-left text-[14px] text-ink-muted transition-colors hover:border-brick/30"
              >
                <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                Search banks, fees and guides
              </button>
              {session?.isPro ? (
                <DrawerList items={navItemsFor(session)} pathname={pathname} onNavigate={close} />
              ) : (
                MOBILE_NAV_SECTIONS.map((section: NavGroup, index) => (
                  <div key={section.heading ?? index} className={index > 0 ? "mt-3" : undefined}>
                    {section.heading ? (
                      <p className="px-3 pb-1 pt-1 text-[11px] uppercase tracking-[0.1em] text-ink-muted">{section.heading}</p>
                    ) : null}
                    <DrawerList items={section.items} pathname={pathname} onNavigate={close} />
                  </div>
                ))
              )}

              <div className="mt-4 border-t border-border pt-4">
                {session?.isPro ? (
                  <ProAccountLinks isStaff={session.isStaff === true} onNavigate={close} />
                ) : isLoggedIn ? (
                  <>
                    <Link href="/account" onClick={close} className={DRAWER_LINK}>
                      Account
                    </Link>
                    <SignOutForm buttonClassName={`${DRAWER_LINK} w-full text-left`} />
                  </>
                ) : (
                  <>
                    <Link href="/login" onClick={close} className={DRAWER_LINK}>
                      Sign in
                    </Link>
                    <Link
                      href={PRIMARY_CTA_NAV.href}
                      onClick={close}
                      className="mt-2 block rounded-md bg-ink px-3 py-2.5 text-center text-[14px] font-semibold text-on-ink transition-opacity hover:opacity-90"
                    >
                      {PRIMARY_CTA_NAV.label}
                    </Link>
                  </>
                )}
              </div>
            </nav>

            <div className="border-t border-border px-6 py-4">
              <div className="flex items-center gap-2 text-ink-muted">
                <Logo mark="fee-insight-oneline" height={22} />
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

function DrawerList({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly { label: string; href: string }[];
  pathname: string | null;
  onNavigate: () => void;
}) {
  const contextHref = useHamiltonNavigationHref();
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const isActive = isActivePath(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={contextHref(item.href)}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "block rounded-lg bg-ink/5 px-3 py-2.5 text-[14px] font-semibold text-ink transition-colors"
                  : DRAWER_LINK
              }
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * On phones the desktop account menu is hidden, so Pro readers get its items here: the bank
 * and its data, all changes, the Reference pages, Admin for staff, account and sign out.
 */
function ProAccountLinks({ isStaff, onNavigate }: { isStaff: boolean; onNavigate: () => void }) {
  const contextHref = useHamiltonNavigationHref();
  return (
    <>
      {HAMILTON_ACCOUNT_NAV.map((item) => (
        <Link key={item.href} href={contextHref(item.href)} onClick={onNavigate} className={DRAWER_LINK}>
          {item.label}
        </Link>
      ))}
      <p className="px-3 pb-1 pt-3 text-[11px] uppercase tracking-[0.1em] text-ink-muted">Reference</p>
      {HAMILTON_REFERENCE_NAV.map((item) => (
        <Link key={item.href} href={item.href} onClick={onNavigate} className={DRAWER_LINK}>
          {item.label}
        </Link>
      ))}
      <div className="mt-3 border-t border-border pt-3">
        {isStaff ? (
          <Link href="/admin" onClick={onNavigate} className={DRAWER_LINK}>
            Admin
          </Link>
        ) : null}
        <Link href="/account" onClick={onNavigate} className={DRAWER_LINK}>
          Account and billing
        </Link>
        <SignOutForm buttonClassName={`${DRAWER_LINK} w-full text-left`} />
      </div>
    </>
  );
}
