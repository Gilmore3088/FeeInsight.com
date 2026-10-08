"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import {
  HAMILTON_ACCOUNT_NAV,
  HAMILTON_NAV,
  HAMILTON_REFERENCE_NAV,
  HAMILTON_WIRE_NAV,
} from "@/lib/hamilton/navigation";

/** The four tabs, without Admin (admins reach it from their own bar). */
const TABS = HAMILTON_NAV.filter((t) => t.href.startsWith("/pro/"));

/** Which tab a screen belongs to: All changes sits under This month, the studies under Reports. */
export function activeTabHref(pathname: string): string | null {
  if (pathname.startsWith("/pro/monitor")) return "/pro/hamilton";
  if (pathname.startsWith("/pro/studies")) return "/pro/reports";
  return TABS.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href ?? null;
}

const MORE_LINKS = [
  { label: "Ask Hamilton", href: "/pro/analyze" },
  HAMILTON_WIRE_NAV,
  ...HAMILTON_ACCOUNT_NAV,
  ...HAMILTON_REFERENCE_NAV.map(({ label, href }) => ({ label, href })),
];

/**
 * The four tabs on a phone, where the site header folds its links into a drawer: one row of
 * equal segments under the header, always in reach, plus "More" for everything outside them
 * (Ask, the Wire, the bank and its data, Reference). It sticks just under the sticky header
 * (h-14 plus its border). Desktop keeps the tabs in the header.
 */
export function HamiltonTabStrip() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Open only on the screen it was opened on, so a tap on a link closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) =>
    setOpenOn((typeof next === "function" ? next(open) : next) ? pathname : null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const instId = searchParams.get("instId");
  const active = activeTabHref(pathname);
  const withBank = (href: string) => (instId ? `${href}?instId=${encodeURIComponent(instId)}` : href);

  return (
    <nav aria-label="Hamilton" className="sticky top-[57px] z-30 border-b border-warm-300 bg-warm-50/95 backdrop-blur-sm lg:hidden print:hidden">
      <div className="mx-auto flex max-w-6xl">
        {TABS.map((t) => {
          const current = active === t.href;
          return (
            <Link
              key={t.href}
              href={withBank(t.href)}
              aria-current={current ? "page" : undefined}
              className={
                "flex min-h-11 flex-1 items-center justify-center border-b-2 px-1 text-center text-[13px] leading-tight no-underline " +
                (current ? "border-terra font-semibold text-warm-900" : "border-transparent text-warm-700")
              }
            >
              {t.label}
            </Link>
          );
        })}
        <button
          ref={moreRef}
          type="button"
          aria-expanded={open}
          aria-controls="hamilton-more"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 items-center border-b-2 border-transparent px-3 text-[13px] text-warm-700"
        >
          More
        </button>
      </div>
      {open ? (
        <div
          id="hamilton-more"
          className="border-t border-warm-200 bg-warm-50 px-4 py-2 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              moreRef.current?.focus();
            }
          }}
        >
          <ul className="grid grid-cols-2 gap-x-4">
            {MORE_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={withBank(l.href)}
                  aria-current={pathname.startsWith(l.href) ? "page" : undefined}
                  className="flex min-h-11 items-center text-sm text-warm-900 no-underline aria-[current=page]:font-semibold aria-[current=page]:text-terra-text"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}
