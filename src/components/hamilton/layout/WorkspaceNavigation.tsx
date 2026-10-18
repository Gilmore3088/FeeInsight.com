"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, Bookmark, Calculator, ChartNoAxesColumnIncreasing, FileText, Landmark, Menu, MessageCircle, Search, Settings, X } from "lucide-react";
import { HAMILTON_WORKSPACE_NAV, isWorkspaceNavActive } from "@/lib/hamilton/navigation";
import { NavAccount } from "@/components/nav-account";
import { useHamiltonNavigationHref } from "./hamilton-navigation-context";

const icons = { Activity, Bookmark, Calculator, ChartNoAxesColumnIncreasing, FileText, Landmark, MessageCircle, Search, Settings };

/**
 * The workspace's left navigation and institution bar, from #1011 (James's Oct 11 unified
 * workspace). One sidebar serves desktop and, behind the menu button, phones. The bar names
 * three things separately: the reader's own institution, the institution being researched and
 * the peer group it is compared with.
 */
export function WorkspaceNavigation({ pathname, isAdmin, accountLabel, researchLabel, homeName = null, accountUnlinked = false, researchIsHome = false, peerLabel }: {
  pathname: string; isAdmin: boolean; accountLabel: string; researchLabel: string | null;
  /** The reader's own institution, when their account is linked to exactly one. */
  homeName?: string | null;
  /** No membership links the account to an institution yet (not ambiguous, not a load error). */
  accountUnlinked?: boolean;
  /** The subject is the reader's own institution. */
  researchIsHome?: boolean;
  /** The subject's saved peer group: a name, null for none saved, undefined when not shown. */
  peerLabel?: string | null;
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
        {HAMILTON_WORKSPACE_NAV.filter(item => isAdmin || item.label !== "Admin").map(item => {
          const Icon = icons[item.icon];
          return <Link key={item.href} href={hrefFor(item.href)} aria-current={isWorkspaceNavActive(pathname, item) ? "page" : undefined} className={item.label === "Saved analyses" ? "workspace-saved-link" : undefined} onClick={() => setOpen(false)}>
            <Icon size={21} aria-hidden /><span>{item.label}</span>
          </Link>;
        })}
      </nav>
      <Link href={hrefFor("/pro/settings")} className="workspace-settings" onClick={() => setOpen(false)}><Settings size={18} aria-hidden />Settings & account</Link>
    </aside>
    <section aria-label="Institution context">
      <header className="workspace-topbar print:hidden">
        <div>
          <span className="workspace-muted">Your institution: </span><strong>{accountLabel}</strong>
          {accountUnlinked ? <> · <Link href="/pro/settings#account-institution">Link your institution</Link></> : null}
        </div>
        <NavAccount />
      </header>
      {researchLabel ? <div className="workspace-research-context print:hidden">
        <span>Researching: <strong>{researchLabel}</strong>{researchIsHome ? " (your institution)" : null}</span>
        {peerLabel === undefined ? null : peerLabel
          ? <span>Compared with: <strong>{peerLabel}</strong></span>
          : <span>Compared with: no peer group saved · <Link href="/pro/settings#peer-sets">Choose peers</Link></span>}
        {homeName && !researchIsHome && !researchLabel.endsWith(" market") ? <Link href="/pro/hamilton">Back to {homeName}</Link> : null}
      </div> : null}
    </section>
  </>;
}
