"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { searchDashboard, type SearchResult } from "@/app/admin/actions/search";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { searchScreens } from "@/lib/admin-rooms";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cmd+K handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 2) return;

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const data = await searchDashboard(query);
      setResults(data);
      setSelectedIndex(0);
      setLoading(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setResults(null);
      setSelectedIndex(0);
      setLoading(false);
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.length < 2) {
      setResults(null);
      setSelectedIndex(0);
      setLoading(false);
    }
  }

  const flatItems = useCallback((): { label: string; sub: string; href: string }[] => {
    if (!results) return [];
    const items: { label: string; sub: string; href: string }[] = [];

    for (const inst of results.institutions) {
      items.push({
        label: inst.name,
        sub: `${inst.charter === "bank" ? "Bank" : "CU"} | ${inst.state ?? ""}`,
        href: `/admin/institution/${inst.id}`,
      });
    }
    for (const cat of results.categories) {
      items.push({
        label: getDisplayName(cat.fee_category),
        sub: `${cat.count} institutions`,
        href: `/admin/fees/catalog/${cat.fee_category}`,
      });
    }
    for (const fn of results.feeNames) {
      items.push({
        label: fn.fee_name,
        sub: `${fn.count} occurrences`,
        href: `/admin/fees/catalog?search=${encodeURIComponent(fn.fee_name)}`,
      });
    }
    for (const conv of results.conversations ?? []) {
      items.push({
        label: conv.title,
        sub: `${conv.agent_id} conversation`,
        href: `/admin/hamilton/research/${conv.agent_id}`,
      });
    }
    for (const screen of searchScreens(query)) {
      items.push({ label: screen.label, sub: screen.room, href: screen.href });
    }
    return items;
  }, [results, query]);
  const screens = results ? searchScreens(query) : [];

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    const items = flatItems();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && items[selectedIndex]) {
      e.preventDefault();
      navigate(items[selectedIndex].href);
    }
  }

  const items = flatItems();
  let sectionStart = 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* On a phone the box sits at the top so the keyboard never pushes it over the page. */}
      <DialogContent className="top-3 translate-y-0 sm:top-[50%] sm:translate-y-[-50%] sm:max-w-lg p-0 gap-0 overflow-hidden dark:bg-[oklch(0.205_0_0)] dark:border-white/[0.08]">
        <div className="flex items-center border-b px-4 dark:border-white/[0.08]">
          <Search className="mr-2 size-4 shrink-0 text-gray-400 dark:text-gray-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search banks, fees, or any screen..."
            aria-label="Search banks, fees, or any screen"
            className="command-palette-input w-full py-3 pr-8 text-sm outline-none placeholder:text-gray-400 dark:bg-transparent dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin shrink-0 dark:border-gray-600 dark:border-t-blue-400" />
          )}
        </div>

        {results && items.length > 0 && (
          <div className="max-h-72 overflow-y-auto py-2">
            {results.institutions.length > 0 && (
              <>
                <p className="px-4 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Institutions
                </p>
                {results.institutions.map((inst, i) => {
                  const idx = sectionStart + i;
                  return (
                    <button
                      key={`inst-${inst.id}`}
                      onClick={() => navigate(`/admin/institution/${inst.id}`)}
                      className={`w-full px-4 py-2 flex items-center justify-between text-sm text-left hover:bg-gray-50 dark:hover:bg-white/[0.06] ${
                        selectedIndex === idx ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "dark:text-gray-200"
                      }`}
                    >
                      <span className="font-medium">{inst.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {inst.charter === "bank" ? "Bank" : "CU"} | {inst.state}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {(() => {
              sectionStart = results.institutions.length;
              return null;
            })()}

            {results.categories.length > 0 && (
              <>
                <p className="px-4 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-1">
                  Fee Categories
                </p>
                {results.categories.map((cat, i) => {
                  const idx = sectionStart + i;
                  return (
                    <button
                      key={`cat-${cat.fee_category}`}
                      onClick={() =>
                        navigate(`/admin/fees/catalog/${cat.fee_category}`)
                      }
                      className={`w-full px-4 py-2 flex items-center justify-between text-sm text-left hover:bg-gray-50 dark:hover:bg-white/[0.06] ${
                        selectedIndex === idx ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "dark:text-gray-200"
                      }`}
                    >
                      <span className="font-medium">
                        {getDisplayName(cat.fee_category)}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {cat.count} inst.
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {(() => {
              sectionStart += results.categories.length;
              return null;
            })()}

            {results.feeNames.length > 0 && (
              <>
                <p className="px-4 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-1">
                  Fee Names
                </p>
                {results.feeNames.map((fn, i) => {
                  const idx = sectionStart + i;
                  return (
                    <button
                      key={`fn-${fn.fee_name}`}
                      onClick={() => navigate(`/admin/fees/catalog?search=${encodeURIComponent(fn.fee_name)}`)}
                      className={`w-full px-4 py-2 flex items-center justify-between text-sm text-left hover:bg-gray-50 dark:hover:bg-white/[0.06] ${
                        selectedIndex === idx ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "dark:text-gray-200"
                      }`}
                    >
                      <span className="font-medium">{fn.fee_name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {fn.count}x
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {(() => {
              sectionStart += results.feeNames.length;
              return null;
            })()}

            {(results.conversations ?? []).length > 0 && (
              <>
                <p className="px-4 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-1">
                  Research Conversations
                </p>
                {results.conversations.map((conv, i) => {
                  const idx = sectionStart + i;
                  return (
                    <button
                      key={`conv-${conv.id}`}
                      onClick={() =>
                        navigate(`/admin/hamilton/research/${conv.agent_id}`)
                      }
                      className={`w-full px-4 py-2 flex items-center justify-between text-sm text-left hover:bg-gray-50 dark:hover:bg-white/[0.06] ${
                        selectedIndex === idx ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "dark:text-gray-200"
                      }`}
                    >
                      <span className="font-medium">{conv.title}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {conv.agent_id}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {(() => {
              sectionStart += (results.conversations ?? []).length;
              return null;
            })()}

            {screens.length > 0 && (
              <>
                <p className="px-4 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-1">
                  Screens
                </p>
                {screens.map((screen, i) => {
                  const idx = sectionStart + i;
                  return (
                    <button
                      key={`screen-${screen.href}`}
                      onClick={() => navigate(screen.href)}
                      className={`w-full px-4 py-2 flex items-center justify-between text-sm text-left hover:bg-gray-50 dark:hover:bg-white/[0.06] ${
                        selectedIndex === idx ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "dark:text-gray-200"
                      }`}
                    >
                      <span className="font-medium">{screen.label}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{screen.room}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}

        {results && items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No results for &quot;{query}&quot;
          </div>
        )}

        {!results && query.length < 2 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
            Type at least 2 characters to search
          </div>
        )}

        {/* Keyboard hints mean nothing on a touch screen. */}
        <div className="border-t px-4 py-2 hidden sm:flex items-center justify-between text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
          <div className="flex gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 font-mono dark:bg-white/[0.08] dark:text-gray-400">
                ↑↓
              </kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 font-mono dark:bg-white/[0.08] dark:text-gray-400">
                ↵
              </kbd>{" "}
              select
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 font-mono dark:bg-white/[0.08] dark:text-gray-400">
                esc
              </kbd>{" "}
              close
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function openPalette() {
  // Dispatch Cmd+K to open the palette
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
}

/** The search button for a phone, where the wide trigger is hidden. */
export function CommandPaletteIconTrigger() {
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Search"
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 md:hidden dark:hover:bg-white/[0.06]"
    >
      <Search className="size-4" />
    </button>
  );
}

export function CommandPaletteTrigger() {
  return (
    <button
      onClick={openPalette}
      className="hidden md:flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-500
                 hover:bg-gray-100 transition-colors dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-400 dark:hover:bg-white/[0.08]"
    >
      <Search className="size-3.5" />
      Search...
      <kbd className="ml-1 px-1 py-0.5 rounded bg-gray-200 text-[10px] font-mono text-gray-500 dark:bg-white/[0.1] dark:text-gray-400">
        ⌘K
      </kbd>
    </button>
  );
}
