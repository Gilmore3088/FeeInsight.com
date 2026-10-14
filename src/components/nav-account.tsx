"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HAMILTON_ACCOUNT_NAV, HAMILTON_REFERENCE_NAV } from "@/lib/hamilton/navigation";
import { REQUEST_REPORT_NAV } from "./nav-items";
import { SignOutForm } from "./sign-out-form";
import { useSessionChrome, type SessionChrome } from "./use-session-chrome";
import { useHamiltonNavigationHref } from "./hamilton/layout/hamilton-navigation-context";

/**
 * The account corner of the consumer nav.
 *
 * A client island so the nav — and every static page under it — renders without
 * reading the session. Renders the signed-out shape until the session is known, which
 * is the common case and matches the server HTML exactly, so anonymous readers never see
 * a flash.
 */
export function NavAccount() {
  const session = useSessionChrome();

  if (session?.signedIn && session.isPro) return <ProAccountMenu session={session} />;

  if (session?.signedIn) {
    return (
      <div className="flex items-center gap-4">
        <Link
          href="/account"
          className="flex items-center gap-2 text-[13px] font-medium text-[#6B6255] transition-colors hover:text-[#1A1815]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1A1815] text-[10px] font-bold text-white">
            {session.initial ?? "U"}
          </span>
          <span className="hidden lg:inline">Account</span>
        </Link>
        <SignOutForm buttonClassName="text-[13px] font-medium text-[#6B6255] transition-colors hover:text-[#1A1815]" />
      </div>
    );
  }

  return (
    <>
      <Link
        href="/login"
        className="mr-2 text-[13px] font-medium text-[#6B6255] transition-colors hover:text-[#1A1815]"
      >
        Sign in
      </Link>
      <Link
        href={REQUEST_REPORT_NAV.href}
        className="inline-flex items-center rounded-md bg-[#C44B2E] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#A93D25]"
      >
        {REQUEST_REPORT_NAV.label}
      </Link>
    </>
  );
}

const MENU_LINK = "block px-4 py-1.5 text-[13px] text-[#1A1815] no-underline hover:bg-[#F5EFE6]";

/**
 * For Pro users the account corner holds everything outside Hamilton's four tabs: the bank and
 * its data, all changes, the reference pages, Admin for staff, account and sign out. One header
 * across the site and Pro (James, 2026-10-06), so the tabs stay four.
 */
function ProAccountMenu({ session }: { session: SessionChrome }) {
  const contextHref = useHamiltonNavigationHref();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 text-[13px] font-medium text-[#6B6255] transition-colors hover:text-[#1A1815]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1A1815] text-[10px] font-bold text-white">
          {session.initial ?? "U"}
        </span>
        <span className="hidden lg:inline">Account</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-3 w-60 rounded-lg border border-[#E0D7C9] bg-white py-1.5 shadow-lg shadow-[#1A1815]/10">
          {HAMILTON_ACCOUNT_NAV.map((item) => (
            <Link key={item.href} href={contextHref(item.href)} className={MENU_LINK} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <p className="mt-1 border-t border-[#EDE5D8] px-4 pb-1 pt-2.5 text-[11px] uppercase tracking-[0.1em] text-[#6B6255]">
            Reference
          </p>
          {HAMILTON_REFERENCE_NAV.map((item) => (
            <Link key={item.href} href={item.href} className={MENU_LINK} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <div className="mt-1 border-t border-[#EDE5D8] pt-1">
            {session.isStaff ? (
              <Link href="/admin" className={MENU_LINK} onClick={() => setOpen(false)}>
                Admin
              </Link>
            ) : null}
            <Link href="/account" className={MENU_LINK} onClick={() => setOpen(false)}>
              Account and billing
            </Link>
            <SignOutForm buttonClassName="w-full px-4 py-1.5 text-left text-[13px] text-[#5A5347] hover:bg-[#F5EFE6]" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
