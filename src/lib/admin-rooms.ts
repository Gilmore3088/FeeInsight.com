/**
 * The admin console's map (docs/plans/admin-redesign-2026-10-12.md, #1122): seven rooms, each
 * answering one question, and the screens that live in each. The top bar lists the rooms; the
 * side menu lists the screens of the room you are in. Every admin page belongs to one room and
 * nothing appears in two.
 */

export type RoomKey = "today" | "pipeline" | "work" | "data" | "hamilton" | "growth" | "settings";

export interface RoomPage {
  href: string;
  label: string;
  /** One line under the label: what this screen is for. */
  role: string;
  /** Match only this exact path (used for room landing pages). */
  exact?: boolean;
  /** Other paths that light this page up in the menu. */
  activePrefixes?: string[];
  /** Shown under the room menu's "More" instead of in the main list: real screens, used less often. */
  more?: boolean;
  /** Reached from its card on the room's landing page (the agent cards), so the phone screen list leaves it out. */
  card?: boolean;
  /** Key into the layout's badge counts. */
  badgeKey?: string;
  /** Other words people search for this screen by (⌘K), e.g. "safety" for Controls. */
  aliases?: string[];
}

export interface Room {
  key: RoomKey;
  label: string;
  /** The question the room answers, shown on its landing page. */
  question: string;
  href: string;
  pages: RoomPage[];
}

export const ROOMS: Room[] = [
  {
    key: "today",
    label: "Today",
    question: "Is it healthy, and what needs me?",
    href: "/admin",
    pages: [
      { href: "/admin", label: "Needs you", role: "What needs you, three numbers", exact: true },
      { href: "/admin/scoreboard", label: "Scorecard", role: "The goal, week by week", aliases: ["scoreboard", "accuracy", "coverage"] },
      { href: "/admin/live", label: "Live board", role: "Banks moving through" },
    ],
  },
  {
    key: "pipeline",
    label: "Pipeline",
    question: "How is each agent doing?",
    href: "/admin/agents",
    pages: [
      { href: "/admin/agents", label: "Overview", role: "Every pipeline agent", exact: true },
      { href: "/admin/atlas/details", label: "Atlas", role: "Schedule and run controls", card: true },
      { href: "/admin/states", label: "State lanes", role: "State queues", more: true },
      { href: "/admin/magellan", label: "Magellan", role: "1 Find and fetch", card: true },
      { href: "/admin/rosetta", label: "Rosetta", role: "2 Read", card: true },
      {
        href: "/admin/knox",
        label: "Knox",
        role: "3 Extract",
        card: true,
        activePrefixes: ["/admin/verify/"],
      },
      { href: "/admin/darwin", label: "Darwin", role: "4 Verify", card: true },
      { href: "/admin/agents/learning", label: "Learning", role: "Which methods work", more: true },
      { href: "/admin/agents/health", label: "Health", role: "Done and failed, by day", more: true },
      { href: "/admin/agents/quality", label: "Quality", role: "Regressions, replay and schedules", more: true },
      { href: "/admin/agents/lineage", label: "Lineage", role: "Trace a fee back", more: true },
      { href: "/admin/agents/replay", label: "Replay", role: "Trace a run", more: true },
      { href: "/admin/agents/messages", label: "Messages", role: "Agent to agent", more: true },
    ],
  },
  {
    key: "work",
    label: "Your work",
    question: "What only you can do",
    href: "/admin/work",
    pages: [
      { href: "/admin/work", label: "Overview", role: "Everything waiting for you", exact: true },
      { href: "/admin/answer-key", label: "Answer key", role: "Hand-checked truth" },
      {
        href: "/admin/quality",
        label: "Trust review",
        role: "Sources to review",
        badgeKey: "trustPending",
      },
      { href: "/admin/customers/marketing", label: "Marketing approvals", role: "Monthly emails to approve" },
      { href: "/admin/customers/content", label: "Content approvals", role: "Posts to approve" },
    ],
  },
  {
    key: "data",
    label: "Data",
    question: "What do we hold?",
    href: "/admin/data",
    pages: [
      { href: "/admin/data", label: "Published data", role: "What is live", exact: true },
      { href: "/admin/institutions", label: "Institutions", role: "Every bank and CU", activePrefixes: ["/admin/institution/"] },
      { href: "/admin/fees/catalog", label: "Fee catalog", role: "Fees by category and segment", activePrefixes: ["/admin/fees"] },
      { href: "/admin/market", label: "Local market", role: "One bank's competitors and fees" },
      { href: "/admin/corrections", label: "Corrections", role: "Holds and corrections, with history", more: true, aliases: ["audit", "holds", "reversal"] },
      { href: "/admin/peers", label: "Peers", role: "Peer groups", more: true },
      { href: "/admin/districts", label: "Districts", role: "Fed districts", more: true },
      { href: "/admin/index", label: "Index", role: "National index", more: true },
      { href: "/admin/query", label: "Query", role: "Ask the database", more: true },
    ],
  },
  {
    key: "hamilton",
    label: "Hamilton",
    question: "Is the product ready for a paying customer?",
    href: "/admin/customers",
    pages: [
      { href: "/admin/customers", label: "Overview", role: "Leads, Pro accounts", exact: true },
      { href: "/admin/leads", label: "Leads", role: "Every request" },
      { href: "/admin/publishing", label: "Publishing", role: "Reports, briefs, updates" },
      { href: "/admin/hamilton/reports", label: "Reports", role: "National Index, Pulse, state" },
      { href: "/admin/hamilton/guides", label: "Guides", role: "Consumer guides" },
      {
        href: "/admin/hamilton/research/articles",
        label: "Articles",
        role: "Research articles",
        activePrefixes: ["/admin/research/articles"],
      },
      { href: "/admin/hamilton/chat", label: "Ask Hamilton", role: "Ask Hamilton", activePrefixes: ["/admin/hamilton/scout", "/admin/scout"] },
      { href: "/admin/hamilton/research/usage", label: "Usage", role: "Who asked Hamilton", activePrefixes: ["/admin/research/usage"], more: true },
      { href: "/admin/api-keys", label: "API keys", role: "Invited partners", more: true },
      {
        href: "/admin/hamilton/methodology",
        label: "Methodology",
        role: "How we build it",
        more: true,
      },
      {
        href: "/admin/hamilton/research",
        label: "Research agents",
        role: "Research history",
        more: true,
        activePrefixes: ["/admin/research"],
      },
    ],
  },
  {
    key: "growth",
    label: "Growth",
    question: "What is marketing doing, and what waits for me?",
    href: "/admin/growth",
    pages: [
      { href: "/admin/growth", label: "Board", role: "Plan, drafts and approvals", exact: true },
      { href: "/admin/agents/marketing", label: "Marketing team", role: "Eight marketing agents" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    question: "What are we spending, and how do I stop it?",
    href: "/admin/controls",
    pages: [
      {
        href: "/admin/controls",
        label: "Controls",
        role: "Spend, switches, launch",
        exact: true,
        aliases: ["safety", "stop", "emergency stop", "provider stop", "pause", "pipeline pause", "resume", "budget", "caps"],
      },
      {
        href: "/admin/api-trust",
        label: "Spend guard",
        role: "Caps and blocked calls",
        aliases: ["budget", "budget policy", "blocked calls", "cost", "stop"],
      },
    ],
  },
];

/** True for the path itself and anything below it; a base ending in "/" matches only below it. */
function isUnder(pathname: string, base: string): boolean {
  if (base.endsWith("/")) return pathname.startsWith(base);
  return pathname === base || pathname.startsWith(`${base}/`);
}

function matchesPage(pathname: string, page: RoomPage): boolean {
  if (page.exact) return pathname === page.href;
  return isUnder(pathname, page.href) || (page.activePrefixes?.some((prefix) => isUnder(pathname, prefix)) ?? false);
}

/** The menu entry a path belongs to: the longest matching page wins, so /admin/agents/health beats /admin/agents. */
export function findRoomPage(pathname: string): { room: Room; page: RoomPage } | null {
  const path = pathname.replace(/\/+$/, "") || "/admin";
  let best: { room: Room; page: RoomPage; score: number } | null = null;
  for (const room of ROOMS) {
    for (const page of room.pages) {
      if (!matchesPage(path, page)) continue;
      const score = page.href.length + (path === page.href ? 1000 : 0);
      if (!best || score > best.score) best = { room, page, score };
    }
  }
  return best ? { room: best.room, page: best.page } : null;
}

/** The room a path belongs to; anything unmapped under /admin falls back to Today. */
export function roomForPath(pathname: string): Room {
  return findRoomPage(pathname)?.room ?? ROOMS[0];
}

export interface ScreenMatch {
  href: string;
  label: string;
  room: string;
}

/** Screens whose name, purpose or room contains the query, for the ⌘K search. Name matches rank first. */
export function searchScreens(query: string, limit = 6): ScreenMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<ScreenMatch & { score: number; order: number }> = [];
  let order = 0;
  for (const room of ROOMS) {
    for (const page of room.pages) {
      order += 1;
      if (scored.some((match) => match.href === page.href)) continue;
      const label = page.href === room.href ? room.label : page.label;
      // A room's landing page answers to the room's name and its own (Settings, Controls).
      const names = [label.toLowerCase(), page.label.toLowerCase()];
      const score = names.includes(needle)
        ? 0
        : names.some((name) => name.startsWith(needle))
          ? 1
          : names.some((name) => name.includes(needle))
            ? 2
            : `${page.label} ${page.role} ${room.label} ${(page.aliases ?? []).join(" ")}`.toLowerCase().includes(needle)
              ? 3
              : -1;
      if (score >= 0) scored.push({ href: page.href, label, room: room.label, score, order });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map(({ href, label, room }) => ({ href, label, room }));
}
