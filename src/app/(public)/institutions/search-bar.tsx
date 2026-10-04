"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Search } from "lucide-react";

interface Result {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  fee_count: number;
  published_fee_count?: number;
  provisional_fee_count?: number;
  fee_publication_status?: "verified" | "provisional" | "under_review" | "unavailable";
  fee_publication_label?: string;
  quality_status?: "verified" | "needs_review";
  quality_label?: string;
}

type Variant = "light" | "dark";

interface InstitutionSearchBarProps {
  autoFocus?: boolean;
  ariaLabel?: string;
  /**
   * Visual variant. "light" (default) is the consumer/parchment background.
   * "dark" is for the institutional landing's dark column.
   */
  variant?: Variant;
  placeholder?: string;
}

function InstitutionSearchBarInner({
  autoFocus = false,
  ariaLabel = "Search institutions",
  variant = "light",
  placeholder = "Search your bank or credit union...",
}: InstitutionSearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isDark = variant === "dark";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/institutions?q=${encodeURIComponent(value.trim())}`);
        const data = await resp.json();
        setResults(data);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  // A fee focus (?fee=overdraft) arrives from a consumer guide. Carry it through both
  // the typeahead selection and an Enter-key search, so the reader lands on the fee they
  // came for rather than on a generic page.
  const searchParams = useSearchParams();
  const fee = searchParams?.get("fee") ?? "";

  function handleSelect(id: number) {
    setShowResults(false);
    router.push(fee ? `/institution/${id}?fee=${encodeURIComponent(fee)}#fee-${fee}` : `/institution/${id}`);
  }

  // Enter runs a full search rather than doing nothing. Previously the only way to a
  // result list was clicking a suggestion or hand-editing ?q= into the URL.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = query.trim();
    if (q.length < 2) return;
    e.preventDefault();
    setShowResults(false);
    const params = new URLSearchParams({ q });
    if (fee) params.set("fee", fee);
    router.push(`/institutions?${params.toString()}`);
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-[#6B6255]"
          strokeWidth={1.75}
        />
        <input
          type="text"
          aria-label={ariaLabel}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={
            isDark
              ? "w-full rounded-md border border-[#3D3830] bg-[#2D2A26] pl-10 pr-4 py-3 text-sm text-[#F5EFE6] placeholder:text-[#6B6255] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#C44B2E]"
              : "w-full rounded-md border border-[#D5CBBF] bg-[#FFFDF9] pl-10 pr-4 py-3 text-sm text-[#1A1815] placeholder:text-[#6B6255] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#C44B2E]"
          }
        />
        {loading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <div
              className={`h-4 w-4 border-2 ${isDark ? "border-[#3D3830]" : "border-[#E8DFD1]"} border-t-[#C44B2E] rounded-full animate-spin`}
            />
          </div>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-[#E8DFD1] bg-[#FFFDF9] shadow-lg">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => handleSelect(r.id)}
              className="fi-row-interaction w-full border-b border-[#E8DFD1] px-4 py-3 text-left last:border-0"
            >
              <div className="text-sm font-medium text-[#1A1815]">
                {r.institution_name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6B6255]">
                {[r.city, r.state_code].filter(Boolean).join(", ")}
                {r.charter_type && (
                  <span className="text-[#6B6255]">
                    {r.charter_type === "bank" ? "Bank" : "Credit Union"}
                  </span>
                )}
                {(r.published_fee_count ?? 0) > 0 && (
                  <span className="rounded-sm border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {r.published_fee_count} verified fees
                  </span>
                )}
                {(r.published_fee_count ?? 0) === 0 && (r.provisional_fee_count ?? 0) > 0 && (
                  <span className="rounded-sm border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#9A5A00]">
                    {r.provisional_fee_count} fees under review
                  </span>
                )}
                {(r.published_fee_count ?? 0) === 0 && (r.provisional_fee_count ?? 0) === 0 && (
                  <span className="rounded-sm border border-[#E0D7C9] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#6B6255]">
                    {r.fee_publication_status === "under_review" ? "Under review" : "No published schedule found"}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {showResults && results.length === 0 && query.trim().length >= 2 && !loading && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-[#E8DFD1] bg-[#FFFDF9] p-4 shadow-lg">
          <p className="text-sm text-[#6B6255]">No institutions found for {query}</p>
        </div>
      )}
    </div>
  );
}


/**
 * `useSearchParams()` inside a client component makes a statically prerendered parent
 * bail out to client rendering unless it sits under a Suspense boundary. The home page
 * hero is prerendered, so the boundary lives here rather than at every call site.
 */
export function InstitutionSearchBar(props: Parameters<typeof InstitutionSearchBarInner>[0]) {
  return (
    <Suspense fallback={<div className="h-[46px] w-full max-w-xl rounded-md border border-[#D5CBBF] bg-[#FFFDF9]" aria-hidden="true" />}>
      <InstitutionSearchBarInner {...props} />
    </Suspense>
  );
}
