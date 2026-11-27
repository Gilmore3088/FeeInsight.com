"use client";

import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";

const categories = new Set(Object.values(FEE_FAMILIES).flat());
const FocusContext = createContext<string | null>(null);

export function readFeeFocus(value: string | null): string | null {
  return value && categories.has(value) ? value : null;
}

export function useProfileFeeFocus() {
  return useContext(FocusContext);
}

function AddressFocus({ onChange }: { onChange: (value: string | null) => void }) {
  const category = readFeeFocus(useSearchParams().get("fee"));
  useEffect(() => onChange(category), [category, onChange]);
  return null;
}

/** Only the URL observer suspends; all profile HTML stays on the one ISR route. */
export function ProfileFeeFocus({ children }: { children: ReactNode }) {
  const [category, setCategory] = useState<string | null>(null);
  return (
    <FocusContext.Provider value={category}>
      <Suspense fallback={null}><AddressFocus onChange={setCategory} /></Suspense>
      {children}
    </FocusContext.Provider>
  );
}

export function keepFeeFocus(href: string, category: string | null): string {
  if (!category || !href.startsWith("/institution/")) return href;
  const url = new URL(href, "https://feeinsight.com");
  if (!url.searchParams.has("fee")) url.searchParams.set("fee", category);
  return url.pathname + url.search + url.hash;
}
