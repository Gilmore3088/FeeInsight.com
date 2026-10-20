"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Activity, Calculator, ChartNoAxesColumnIncreasing, FileText, Menu, MessageCircle, Search, Settings, X } from "lucide-react";
import { HAMILTON_ALERTS_NAV, HAMILTON_WORKSPACE_NAV, isWorkspaceNavActive, workspaceSubnav } from "@/lib/hamilton/navigation";
import { NavAccount } from "@/components/nav-account";
import { InstitutionPicker } from "@/components/hamilton/InstitutionPicker";
import { marketSwitchHref, subjectSwitchHref } from "@/lib/hamilton/navigation-context";
import { encodeLandingResearch } from "@/lib/hamilton/landing-research-handoff";
import { MARKET_BRIEF_CATEGORIES } from "@/lib/hamilton/market-question";
import { useHamiltonNavigationHref } from "./hamilton-navigation-context";

const icons = { Activity, Calculator, ChartNoAxesColumnIncreasing, FileText, MessageCircle, Search, Settings };

/**
 * The workspace's left navigation and institution bar, from #1011 (James's Oct 11 unified
 * workspace). One sidebar serves desktop and, behind the menu button, phones. The context bar
 * (#2043) leads with what every screen reads: the institution or market being researched, its
 * state, charter and size, and whether it is the reader's own. Below it: the peer group and
 * whether it was saved or picked by Hamilton, the reader's own institution, and the switch to
 * another institution or the U.S. market, which keeps the reader on the same screen.
 */
export function WorkspaceNavigation({ pathname, isAdmin, accountLabel, researchLabel, researchFacts = null, researchIsMarket = false, subjectNotLinked = false, homeName = null, homeHref = "/pro/research", accountUnlinked = false, accountNeedsInfo = false, researchIsHome = false, peerLabel }: {
  pathname: string; isAdmin: boolean; accountLabel: string; researchLabel: string | null;
  /** The subject's state, charter and size, e.g. "Florida · Community bank, $1B to $10B". */
  researchFacts?: string | null;
  /** The subject is a market (U.S. or a state), not one institution. */
  researchIsMarket?: boolean;
  /** The subject is an institution the account is known not to be linked to. */
  subjectNotLinked?: boolean;
  /** The reader's own institution, when their account is linked to exactly one. */
  homeName?: string | null;
  /** No membership links the account to an institution yet (not ambiguous, not a load error). */
  accountUnlinked?: boolean;
  /** The pending link request waits on more from the user; Settings says what. */
  accountNeedsInfo?: boolean;
  /** The reader's own institution page (Your institution), where "Back to" returns. */
  homeHref?: string;
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
          return <Link key={item.href} href={hrefFor(item.href)} aria-current={isWorkspaceNavActive(pathname, item) ? "page" : undefined} onClick={() => setOpen(false)}>
            <Icon size={21} aria-hidden /><span>{item.label}</span>
          </Link>;
        })}
      </nav>
      <Link href={hrefFor(HAMILTON_ALERTS_NAV.href)} className="workspace-settings workspace-alerts" aria-current={isWorkspaceNavActive(pathname, HAMILTON_ALERTS_NAV) ? "page" : undefined} onClick={() => setOpen(false)}><Activity size={18} aria-hidden />{HAMILTON_ALERTS_NAV.label}</Link>
      <Link href={hrefFor("/pro/settings")} className="workspace-settings" onClick={() => setOpen(false)}><Settings size={18} aria-hidden />Settings & account</Link>
    </aside>
    <section aria-label="Institution context">
      <header className="workspace-topbar print:hidden">
        {researchLabel ? <div className="workspace-subject">
          <span>{researchIsMarket ? "Market view" : "Researching"}: <strong>{researchLabel}</strong>{researchIsHome ? " (your institution)" : null}</span>
          {researchFacts ? <span className="workspace-muted">{researchFacts}</span> : null}
          {subjectNotLinked ? <span className="workspace-tag">Not linked to your account</span> : null}
        </div> : <div>
          <span className="workspace-muted">Your institution: </span><strong>{accountLabel}</strong>
          {accountUnlinked ? <> · <Link href="/pro/settings#account-institution">Link your institution</Link></> : null}
          {accountNeedsInfo ? <> · <Link href="/pro/settings#account-institution">More information needed</Link></> : null}
        </div>}
        <NavAccount />
      </header>
      {researchLabel ? <div className="workspace-research-context print:hidden">
        {peerLabel === undefined ? null : peerLabel
          ? <span>Compared with: <strong>{peerLabel}</strong>, a saved peer group</span>
          : <span>Compared with: peers Hamilton picks for this institution · <Link href="/pro/settings#peer-sets">Save your own</Link></span>}
        {researchIsHome ? null : <span>
          Your institution: {homeName ? <Link href={homeHref}>{homeName}</Link> : <strong>{accountLabel}</strong>}
          {accountUnlinked ? <> · <Link href="/pro/settings#account-institution">Link your institution</Link></> : null}
          {accountNeedsInfo ? <> · <Link href="/pro/settings#account-institution">More information needed</Link></> : null}
        </span>}
        <SubjectSwitch pathname={pathname} showMarket={!(researchIsMarket && researchLabel === "U.S. market")} />
      </div> : null}
      <WorkspaceSubnav pathname={pathname} institutionName={researchIsMarket ? null : researchLabel} />
    </section>
  </>;
}

/** The two pages of Research, or of Try a price, as tabs above the content (#2044). */
function WorkspaceSubnav({ pathname, institutionName }: { pathname: string; institutionName: string | null }) {
  const hrefFor = useHamiltonNavigationHref();
  const params = useSearchParams();
  const subnav = workspaceSubnav(pathname, institutionName, params?.get("view") ?? null);
  if (!subnav) return null;
  return <nav aria-label={subnav.ariaLabel} className="workspace-subnav print:hidden">
    {subnav.tabs.map(tab => <Link key={tab.href} href={hrefFor(tab.href)} aria-current={tab.current ? "page" : undefined}>{tab.label}</Link>)}
  </nav>;
}

const NATIONAL_RESEARCH = encodeLandingResearch({ version: 1, task: "compare", scope: { kind: "national" }, charter: "all", categories: [...MARKET_BRIEF_CATEGORIES] });

/** Research another institution on the same screen, or open the U.S. market view (#2043). */
function SubjectSwitch({ pathname, showMarket }: { pathname: string; showMarket: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  return <div className="workspace-switch">
    <button type="button" aria-expanded={open} aria-controls={open ? "workspace-switch-picker" : undefined} onClick={() => setOpen(!open)}>Research another institution</button>
    {showMarket ? <Link href={marketSwitchHref(pathname, NATIONAL_RESEARCH)}>U.S. market</Link> : null}
    {open ? <div id="workspace-switch-picker" className="workspace-switch-picker">
      <InstitutionPicker inputId="workspace-switch-institution" label="Institution" help="Pick a match to open it on this screen." autoFocus onEscape={() => setOpen(false)}
        onSelect={(result) => { if (result) { setOpen(false); router.push(subjectSwitchHref(pathname, result.id, new URLSearchParams(params?.toString() ?? ""))); } }} />
    </div> : null}
  </div>;
}
