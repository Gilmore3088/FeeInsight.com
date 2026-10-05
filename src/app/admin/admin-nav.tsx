"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  BookOpenText,
  Compass,
  ContactRound,
  Database,
  Dna,
  FileCheck2,
  FileText,
  Gauge,
  Map,
  Orbit,
  ShieldCheck,
  Target,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  role: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
  badgeKey?: string;
  activePrefixes?: string[];
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Atlas Control",
    items: [
      { href: "/admin", label: "Crew", role: "Your agents", icon: Orbit, exact: true },
      { href: "/admin/atlas/details", label: "Atlas", role: "Run controls", icon: Orbit },
      {
        href: "/admin/states",
        label: "State Lanes",
        role: "State queues",
        icon: Map,
      },
      {
        href: "/admin/quality",
        label: "Trust Review",
        role: "Source review",
        icon: FileCheck2,
        badgeKey: "trustPending",
        activePrefixes: ["/admin/data-quality"],
      },
      {
        href: "/admin/scoreboard",
        label: "Scoreboard",
        role: "Answer key + daily score",
        icon: Target,
        activePrefixes: ["/admin/answer-key"],
      },
      {
        href: "/admin/api-trust",
        label: "API Trust",
        role: "Spend guard",
        icon: Gauge,
      },
    ],
  },
  {
    label: "Agent Lane",
    items: [
      {
        href: "/admin/magellan",
        label: "Magellan",
        role: "1 Discover + fetch",
        icon: Compass,
        activePrefixes: ["/admin/coverage"],
      },
      { href: "/admin/rosetta", label: "Rosetta", role: "2 Read sources", icon: FileText },
      {
        href: "/admin/knox",
        label: "Knox",
        role: "3 Extract + exceptions",
        icon: ShieldCheck,
        badgeKey: "knoxPending",
        activePrefixes: ["/admin/review", "/admin/verify", "/admin/agents/knox"],
      },
      { href: "/admin/darwin", label: "Darwin", role: "4 Verify fees", icon: Dna },
    ],
  },
  {
    label: "Output",
    items: [
      {
        href: "/admin/data",
        label: "Published Data",
        role: "Hamilton output",
        icon: Database,
        activePrefixes: [
          "/admin/institutions", "/admin/institution", "/admin/index", "/admin/market",
          "/admin/peers", "/admin/fees", "/admin/districts", "/admin/query", "/admin/national",
        ],
      },
      {
        href: "/admin/hamilton",
        label: "Hamilton",
        role: "Research",
        icon: BookOpenText,
        activePrefixes: ["/admin/research", "/admin/scout", "/admin/methodology"],
      },
      { href: "/admin/leads", label: "Leads", role: "Sales", icon: ContactRound },
    ],
  },
];

function isItemActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  if (pathname.startsWith(item.href)) return true;
  return item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)) ?? false;
}

export function AdminNav({ badges }: { badges?: Record<string, number> }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="admin-sidebar-nav flex flex-col gap-0.5 px-2.5 py-1">
      {NAV_GROUPS.map((group, groupIndex) => (
        <div key={group.label}>
          {groupIndex > 0 && <div className="mx-2 my-2 h-px bg-black/[0.04] dark:bg-white/[0.04]" />}
          <span className="mb-1 block px-2 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">
            {group.label}
          </span>
          {group.items.map((item) => {
            const active = isItemActive(pathname, item);
            const badgeCount = item.badgeKey ? badges?.[item.badgeKey] ?? 0 : 0;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                  active
                    ? "bg-gray-900 text-white dark:bg-white/10 dark:text-gray-100"
                    : "text-gray-600 hover:bg-black/[0.03] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-gray-200"
                }`}
              >
                <Icon className="h-[14px] w-[14px] shrink-0" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[12px] font-semibold">{item.label}</span>
                  <span className={`block truncate text-[9px] ${active ? "text-white/60" : "text-gray-400"}`}>
                    {item.role}
                  </span>
                </span>
                {badgeCount > 0 && (
                  <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                    active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  }`}>
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AdminNavInline() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="admin-nav-inline relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:hidden">
      {NAV_GROUPS.flatMap((group) => group.items).map((item) => {
        const active = isItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            aria-label={`${item.label}: ${item.role}`}
            className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-2.5 py-2 text-[11px] font-semibold transition-colors ${
              active ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
