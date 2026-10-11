"use client";

import { createContext, useContext, type ReactNode } from "react";
import { hrefWithHamiltonNavigation, type HamiltonNavigationSelection } from "@/lib/hamilton/navigation-context";

const HamiltonNavigationContext = createContext<HamiltonNavigationSelection | null>(null);

export function HamiltonNavigationProvider({ value, children }: { value: HamiltonNavigationSelection; children: ReactNode }) {
  return <HamiltonNavigationContext.Provider value={value}>{children}</HamiltonNavigationContext.Provider>;
}

/** Public chrome reads context only; it never opts static public routes into search-param rendering. */
export function useHamiltonNavigationHref() {
  const selection = useContext(HamiltonNavigationContext);
  return (href: string) => selection ? hrefWithHamiltonNavigation(href, selection) : href;
}
