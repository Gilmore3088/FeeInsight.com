"use client";

import Link from "next/link";
import { REQUEST_REPORT_NAV } from "./nav-items";
import { useSessionChrome } from "./use-session-chrome";

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

  if (session?.signedIn) {
    return (
      <Link
        href="/account"
        className="flex items-center gap-2 text-[13px] font-medium text-[#6B6255] transition-colors hover:text-[#1A1815]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1A1815] text-[10px] font-bold text-white">
          {session.initial ?? "U"}
        </span>
        <span className="hidden lg:inline">Account</span>
      </Link>
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
