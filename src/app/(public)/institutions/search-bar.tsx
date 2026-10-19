"use client";

import { useState, useEffect, useId, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { directoryHref } from "./directory-view";

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
  /** The search already run (?q= on /institutions), so the box shows what was searched. */
  initialQuery?: string;
  /**
   * Where a pick and an Enter search land. Unset: the institution page and /institutions.
   * "/check": `/check?id=<id>` and `/check?q=<query>`, so the answer opens on the same page.
   */
  resultPath?: "/check";
}

/** Set by a pick on /check; the answer reads it once to move focus to its heading. */
export const CHECK_FOCUS_KEY = "fi-check-focus";

function InstitutionSearchBarInner({
  autoFocus = false,
  ariaLabel = "Search institutions",
  variant = "light",
  placeholder = "Search your bank or credit union...",
  initialQuery = "",
  resultPath,
}: InstitutionSearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Result[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  /** The suggestion ArrowUp/ArrowDown has moved to; -1 means none (Enter runs a full search). */
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputId = `${listboxId}-input`;
  /** A pick on /check: the answer streams in while this is true. */
  const [navigating, startNavigation] = useTransition();
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const requestIdRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isDark = variant === "dark";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChange(value: string) {
    const requestId = ++requestIdRef.current;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Editing invalidates every old suggestion, including a highlighted or single result.
    // Enter can still search the new text while its lookup is waiting on the debounce.
    setResults([]);
    setActiveIndex(-1);
    setShowResults(false);

    if (value.trim().length < 2) {
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/institutions?q=${encodeURIComponent(value.trim())}`);
        const data = await resp.json();
        if (requestId !== requestIdRef.current) return;
        setResults(data);
        setActiveIndex(-1);
        setShowResults(true);
      } catch {
        if (requestId === requestIdRef.current) setResults([]);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
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
    if (resultPath) {
      // The answer heading takes focus once it renders (CheckAnswerFocus on /check).
      try {
        window.sessionStorage.setItem(CHECK_FOCUS_KEY, "1");
      } catch {
        // Storage blocked: the answer still renders, focus just stays put.
      }
      startNavigation(() => router.push(`${resultPath}?id=${id}`));
      return;
    }
    router.push(fee ? `/institution/${id}?fee=${encodeURIComponent(fee)}#fee-${fee}` : `/institution/${id}`);
  }

  const expanded = showResults && results.length > 0;
  const noMatches = showResults && results.length === 0 && query.trim().length >= 2 && !loading;
  // Read by the polite live region; always rendered so screen readers hear each change.
  const statusMessage =
    loading || navigating
      ? "Loading"
      : expanded
        ? `${results.length} ${results.length === 1 ? "suggestion" : "suggestions"}`
        : noMatches
          ? "No institutions found"
          : "";
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  // Combobox keys (WAI-ARIA pattern): arrows move through the suggestions while focus stays in
  // the input, Enter opens the highlighted bank, Escape closes the list. With nothing highlighted,
  // Enter runs a full search rather than doing nothing.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      if (!showResults) {
        setShowResults(true);
        setActiveIndex(e.key === "ArrowDown" ? 0 : results.length - 1);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) =>
        current === -1
          ? step === 1 ? 0 : results.length - 1
          : (current + step + results.length) % results.length,
      );
      return;
    }
    if ((e.key === "Home" || e.key === "End") && expanded) {
      e.preventDefault();
      setActiveIndex(e.key === "Home" ? 0 : results.length - 1);
      return;
    }
    if (e.key === "Tab") {
      setShowResults(false);
      setActiveIndex(-1);
      return;
    }
    if (e.key === "Escape") {
      if (!showResults) return;
      e.preventDefault();
      setShowResults(false);
      setActiveIndex(-1);
      return;
    }
    if (e.key !== "Enter") return;
    if (expanded && activeIndex >= 0 && activeIndex < results.length) {
      e.preventDefault();
      handleSelect(results[activeIndex].id);
      return;
    }
    const q = query.trim();
    if (q.length < 2) return;
    e.preventDefault();
    // On /check, a search with one match is that institution: answer it directly.
    if (resultPath && results.length === 1) {
      handleSelect(results[0].id);
      return;
    }
    setShowResults(false);
    if (resultPath) {
      router.push(`${resultPath}?${new URLSearchParams({ q }).toString()}`);
      return;
    }
    // A new search keeps the state and the institution type already picked on /institutions.
    router.push(
      directoryHref({
        q,
        state: searchParams?.get("state") ?? "",
        charter: searchParams?.get("charter") ?? "",
        fee,
        fees: searchParams?.get("fees") === "1",
      }),
    );
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <label htmlFor={inputId} className="sr-only">
        {ariaLabel}
      </label>
      <p role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </p>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-ink-muted"
          strokeWidth={1.75}
        />
        <input
          id={inputId}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setShowResults(true)}
          onBlur={() => {
            setShowResults(false);
            setActiveIndex(-1);
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={
            isDark
              ? "w-full rounded-md border border-ink bg-[#1a2c44] pl-10 pr-4 py-3 text-base text-paper placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brick"
              : "min-h-12 w-full rounded-full border border-control-border bg-surface-0 pl-11 pr-10 py-3 text-base text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brick"
          }
        />
        {(loading || navigating) && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <div
              className={`h-4 w-4 border-2 ${isDark ? "border-ink" : "border-border"} border-t-brick rounded-full animate-spin`}
            />
          </div>
        )}
      </div>

      <ul
        id={listboxId}
        role="listbox"
        aria-label="Matching institutions"
        hidden={!expanded}
        className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-surface-0 shadow-lg"
      >
        {expanded && results.map((r, index) => (
          <li
            key={r.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            // mousedown would blur the input first; keep focus in the combobox.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => handleSelect(r.id)}
            className={`fi-row-interaction w-full cursor-pointer border-b border-border px-4 py-3 text-left last:border-0 ${index === activeIndex ? "bg-surface-200" : ""}`}
          >
            <div className="text-sm font-medium text-ink">
              {r.institution_name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
              {[r.city, r.state_code].filter(Boolean).join(", ")}
              {r.charter_type && (
                <span className="text-ink-muted">
                  {r.charter_type === "bank" ? "Bank" : "Credit Union"}
                </span>
              )}
              {(r.published_fee_count ?? 0) > 0 && (
                <span className="rounded-sm border border-brick/30 bg-brick-tint px-1.5 py-0.5 text-[11px] font-semibold text-brick-ink">
                  {r.published_fee_count} fees published
                </span>
              )}
              {(r.published_fee_count ?? 0) === 0 && (r.provisional_fee_count ?? 0) > 0 && (
                <span className="rounded-sm border border-border bg-surface-200 px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">
                  {r.provisional_fee_count} fees under review
                </span>
              )}
              {(r.published_fee_count ?? 0) === 0 && (r.provisional_fee_count ?? 0) === 0 && (
                <span className="rounded-sm border border-border bg-surface-0 px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted">
                  {r.fee_publication_status === "under_review" ? "Under review" : "No published schedule found"}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {noMatches && (
        // mousedown would blur the input and close this panel before the link's click lands.
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-surface-0 px-4 pb-2 pt-4 shadow-lg"
        >
          <p className="text-sm text-ink-muted">No institutions found for {query}</p>
          <Link
            href={`/submit-fees?${new URLSearchParams({ institutionName: query.trim() }).toString()}`}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brick underline-offset-2 hover:underline"
          >
            Send its fee schedule
          </Link>
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
    <Suspense fallback={<div className="h-12 w-full rounded-full border border-border bg-surface-0" aria-hidden="true" />}>
      <InstitutionSearchBarInner {...props} />
    </Suspense>
  );
}
