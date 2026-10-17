"use client";

import { FEE_SELECT_EVENT, type CitySort, type FeeSelectDetail } from "./format";

/**
 * A link from the opening finding to the institutions behind it. Without script it reloads the
 * page with that fee and order; with script it tells the table to switch and scrolls to it.
 */
export function LeadLink({ fee, sort, href, target, children }: { fee: string; sort: CitySort; href: string; target: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        const el = document.getElementById(target);
        if (!el) return;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent<FeeSelectDetail>(FEE_SELECT_EVENT, { detail: { fee, sort } }));
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
    >
      {children}
      <span aria-hidden="true">&darr;</span>
    </a>
  );
}
