"use client";

import { openSearch } from "@/components/public/search-events";

/** The header search button: icon-only on phones, labelled with its shortcut on wider screens. */
export function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={openSearch}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-[#5A5347] transition-colors hover:bg-[#E8DFD1]/40 md:h-auto md:w-auto md:gap-2 md:border md:border-[#E8DFD1] md:bg-white/60 md:px-3 md:py-1.5 md:text-[12px] md:text-[#6B6255] md:hover:border-[#C44B2E]/30 md:hover:bg-white/60 md:hover:text-[#5A5347]"
      aria-label="Search banks, credit unions, fees and guides"
      aria-keyshortcuts="Meta+K Control+K"
    >
      <svg
        className="h-5 w-5 md:h-3.5 md:w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <span className="hidden md:inline" aria-hidden="true">
        Search
      </span>
      <kbd aria-hidden="true" className="ml-1 hidden h-4 items-center rounded bg-[#E8DFD1]/50 px-1 text-[9px] font-medium md:inline-flex">
        &#8984;K
      </kbd>
    </button>
  );
}
