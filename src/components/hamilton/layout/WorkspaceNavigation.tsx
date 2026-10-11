"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, Bookmark, Calculator, ChartNoAxesColumnIncreasing, FileText, Menu, MessageCircle, Search, Settings, UserCircle, X } from "lucide-react";
import { HAMILTON_NAV } from "@/lib/hamilton/navigation";
import { useHamiltonNavigationHref } from "./hamilton-navigation-context";

const icons = { Activity, Bookmark, Calculator, ChartNoAxesColumnIncreasing, FileText, MessageCircle, Search, Settings };

export function WorkspaceNavigation({ pathname, isAdmin, accountLabel, researchLabel }: {
  pathname: string; isAdmin: boolean; accountLabel: string; researchLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const hrefFor = useHamiltonNavigationHref();
  return <>
    <a href="#hamilton-content" className="workspace-skip">Skip to content</a>
    <div className="workspace-mobile-bar print:hidden">
      <Link href={hrefFor("/pro/hamilton")} className="workspace-mobile-brand">Hamilton</Link>
      <button type="button" aria-expanded={open} aria-controls="hamilton-navigation" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen(!open)}>
        {open ? <X aria-hidden size={22} /> : <Menu aria-hidden size={22} />}
      </button>
    </div>
    <aside id="hamilton-navigation" className={`workspace-sidebar print:hidden ${open ? "is-open" : ""}`}>
      <Link href={hrefFor("/pro/hamilton")} className="workspace-brand" onClick={() => setOpen(false)}>Hamilton<span>by Fee Insight</span></Link>
      <nav aria-label="Hamilton workspace">
        {HAMILTON_NAV.filter(item => isAdmin || item.label !== "Admin").map(item => {
          const Icon = icons[item.icon];
          const active = pathname === item.href || (item.label === "Research" && ["/pro/research", "/pro/data", "/pro/market", "/pro/categories", "/pro/districts", "/pro/news"].includes(pathname));
          return <Link key={item.href} href={hrefFor(item.href)} aria-current={active ? "page" : undefined} className={item.label === "Saved analyses" ? "workspace-saved-link" : undefined} onClick={() => setOpen(false)}>
            <Icon size={21} aria-hidden /><span>{item.label}</span>
          </Link>;
        })}
      </nav>
      <Link href={hrefFor("/pro/settings")} className="workspace-settings" onClick={() => setOpen(false)}><Settings size={18} aria-hidden />Settings & account</Link>
    </aside>
    <section aria-label="Institution context">
    <header className="workspace-topbar print:hidden">
      <div><span className="workspace-muted">Your institution: </span><strong>{accountLabel}</strong></div>
      <Link href={hrefFor("/pro/settings")} aria-label="Open account settings"><UserCircle size={24} aria-hidden /></Link>
    </header>
    <div className="workspace-research-context print:hidden"><span>Researching: {researchLabel}</span><Link href={hrefFor("/pro/settings")}>Change context</Link></div>
    </section>
  </>;
}
