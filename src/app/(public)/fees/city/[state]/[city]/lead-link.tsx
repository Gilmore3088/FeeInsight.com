"use client";

import { FEE_SELECT_EVENT, type CitySort, type FeeSelectDetail } from "./format";

/**
 * A link from the opening finding to the institutions behind it. With script it tells the table
 * to switch and scrolls to it; the table also applies a linked fee and order when the page opens
 * (the cached page reads them in the browser, so without script the link opens the default view).
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
