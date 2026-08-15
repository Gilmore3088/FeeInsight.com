"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getDisplayName, DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { GUIDES } from "@/lib/guides";

interface InstitutionResult {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  fee_count: number;
}

interface SearchItem {
  type: "institution" | "category" | "guide";
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

const FEE_CATEGORIES = Object.keys(DISPLAY_NAMES).map((key) => ({
  type: "category" as const,
  id: key,
  label: getDisplayName(key),
  sublabel: "Fee category",
  href: `/fees/${key}`,
}));

// Search is a client component, so it indexes the typed catalog rather than the database.
// That is the published set; a guide added only in Postgres appears on /guides and in the
// sitemap immediately, and here on the next deploy.
const GUIDE_ITEMS: SearchItem[] = GUIDES.map((g) => ({
  type: "guide" as const,
  id: g.slug,
  label: g.title,
  sublabel: g.audience === "professional" ? "Professional guide" : "Consumer guide",
  href:
    g.audience === "professional" ? `/guides/pro/${g.slug}` : `/guides/${g.slug}`,
}));

export function SearchModal() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const router = useRouter();

  // Cmd+K listener
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Prevent body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const search = useCallback((value: string) => {
    setQuery(value);
    setSelectedIndex(0);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      return;
    }

    const lower = value.toLowerCase();

    // Instant: filter fee categories and guides
    const categoryMatches = FEE_CATEGORIES.filter(
      (c) => c.label.toLowerCase().includes(lower) || c.id.includes(lower)
    ).slice(0, 4);

    const guideMatches = GUIDE_ITEMS.filter(
      (g) => g.label.toLowerCase().includes(lower) || g.id.includes(lower)
    ).slice(0, 3);

    setResults([...categoryMatches, ...guideMatches]);
    setLoading(true);

    // Debounced: search institutions via API
    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/institutions?q=${encodeURIComponent(value.trim())}`);
        const data: InstitutionResult[] = await resp.json();
        const institutionItems: SearchItem[] = data.slice(0, 6).map((r) => ({
          type: "institution",
          id: String(r.id),
          label: r.institution_name,
          sublabel: [r.city, r.state_code].filter(Boolean).join(", ") +
            (r.charter_type ? ` · ${r.charter_type === "bank" ? "Bank" : "CU"}` : "") +
            (r.fee_count > 0 ? ` · ${r.fee_count} fees` : ""),
          href: `/institution/${r.id}`,
        }));

        // Re-filter categories and guides with current query
        const catMatches = FEE_CATEGORIES.filter(
          (c) => c.label.toLowerCase().includes(lower) || c.id.includes(lower)
        ).slice(0, 4);
        const guideHits = GUIDE_ITEMS.filter(
          (g) => g.label.toLowerCase().includes(lower) || g.id.includes(lower)
        ).slice(0, 3);

        setResults([...institutionItems, ...catMatches, ...guideHits]);
      } catch {
        // Keep category results
      } finally {
        setLoading(false);
      }
    }, 200);
  }, []);

  function handleSelect(item: SearchItem) {
    setOpen(false);
    router.push(item.href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  }

  if (!open) return null;

  const institutions = results.filter((r) => r.type === "institution");
  const categories = results.filter((r) => r.type === "category");
  const guides = results.filter((r) => r.type === "guide");

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#1A1815]/30 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative mx-auto mt-[15vh] w-full max-w-lg px-4">
        <div className="rounded-2xl border border-[#E8DFD1] bg-[#FFFDF9] shadow-2xl shadow-[#1A1815]/10 overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-[#E8DFD1] px-4 py-3">
            <svg
              className="h-5 w-5 text-[#6B6255] shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search institutions, fees, or guides..."
              className="flex-1 bg-transparent text-[14px] text-[#1A1815] placeholder:text-[#A09788] outline-none"
              aria-label="Search"
              role="combobox"
              aria-expanded={results.length > 0}
            />
            {loading && (
              <div className="h-4 w-4 border-2 border-[#E8DFD1] border-t-[#C44B2E] rounded-full animate-spin shrink-0" />
            )}
            <kbd className="hidden sm:inline-flex h-5 items-center rounded bg-[#E8DFD1]/50 px-1.5 text-[10px] font-medium text-[#6B6255]">
              ESC
            </kbd>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="max-h-[50vh] overflow-y-auto py-2" role="listbox">
              {institutions.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                    Institutions
                  </p>
                  {institutions.map((item, i) => {
                    const globalIdx = results.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item)}
                        role="option"
                        aria-selected={globalIdx === selectedIndex}
                        className={`w-full text-left px-4 py-2.5 transition-colors ${
                          globalIdx === selectedIndex
                            ? "bg-[#C44B2E]/8 text-[#C44B2E]"
                            : "text-[#1A1815] hover:bg-[#FAF7F2]"
                        }`}
                      >
                        <div className="text-[13px] font-medium">{item.label}</div>
                        <div className="text-[11px] text-[#6B6255] mt-0.5">{item.sublabel}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {categories.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mt-1">
                    Fee Categories
                  </p>
                  {categories.map((item) => {
                    const globalIdx = results.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item)}
                        role="option"
                        aria-selected={globalIdx === selectedIndex}
                        className={`w-full text-left px-4 py-2.5 transition-colors ${
                          globalIdx === selectedIndex
                            ? "bg-[#C44B2E]/8 text-[#C44B2E]"
                            : "text-[#1A1815] hover:bg-[#FAF7F2]"
                        }`}
                      >
                        <div className="text-[13px] font-medium">{item.label}</div>
                        <div className="text-[11px] text-[#6B6255] mt-0.5">{item.sublabel}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {guides.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mt-1">
                    Guides
                  </p>
                  {guides.map((item) => {
                    const globalIdx = results.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item)}
                        role="option"
                        aria-selected={globalIdx === selectedIndex}
                        className={`w-full text-left px-4 py-2.5 transition-colors ${
                          globalIdx === selectedIndex
                            ? "bg-[#C44B2E]/8 text-[#C44B2E]"
                            : "text-[#1A1815] hover:bg-[#FAF7F2]"
                        }`}
                      >
                        <div className="text-[13px] font-medium">{item.label}</div>
                        <div className="text-[11px] text-[#6B6255] mt-0.5">{item.sublabel}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {query.trim().length >= 2 && results.length === 0 && !loading && (
            <div className="px-4 py-6 text-center">
              <p className="text-[13px] text-[#6B6255]">No results for &ldquo;{query}&rdquo;</p>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#E8DFD1] px-4 py-2 text-[10px] text-[#6B6255]">
            <span>Search institutions, fees, or guides</span>
            <div className="hidden sm:flex items-center gap-1.5">
              <kbd className="inline-flex h-4 items-center rounded bg-[#E8DFD1]/50 px-1 text-[9px]">&uarr;&darr;</kbd>
              <span>navigate</span>
              <kbd className="inline-flex h-4 items-center rounded bg-[#E8DFD1]/50 px-1 text-[9px] ml-2">&crarr;</kbd>
              <span>select</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
