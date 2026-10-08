/**
 * The admin console's map: six rooms, each answering one question, and the
 * screens that live in each. The top bar lists the rooms; the side menu lists
 * the screens of the room you are in. Every admin page belongs to one room.
 */

export type RoomKey = "today" | "agents" | "data" | "customers" | "publishing" | "controls";

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
    question: "Is anything broken, and what needs me?",
    href: "/admin",
    pages: [
      { href: "/admin", label: "Needs you", role: "What needs you, three numbers", exact: true },
    ],
  },
  {
    key: "agents",
    label: "Agents",
    question: "Are the six agents doing the right work at the right cost?",
    href: "/admin/agents",
    pages: [
      { href: "/admin/agents", label: "Overview", role: "All six agents", exact: true },
      { href: "/admin/live", label: "Live board", role: "Banks moving through" },
      { href: "/admin/atlas/details", label: "Atlas", role: "Schedule and run controls", card: true },
      { href: "/admin/states", label: "State lanes", role: "State queues", more: true },
      { href: "/admin/magellan", label: "Magellan", role: "1 Find and fetch", activePrefixes: ["/admin/coverage"], card: true },
      { href: "/admin/rosetta", label: "Rosetta", role: "2 Read", card: true },
      {
        href: "/admin/knox",
        label: "Knox",
        role: "3 Extract",
        card: true,
        badgeKey: "knoxPending",
        activePrefixes: ["/admin/review", "/admin/agents/knox"],
      },
      { href: "/admin/darwin", label: "Darwin", role: "4 Verify", card: true },
      { href: "/admin/agents/learning", label: "Learning", role: "Which methods work", more: true },
      { href: "/admin/agents/health", label: "Health", role: "Done and failed, by day", more: true },
      { href: "/admin/agents/lineage", label: "Lineage", role: "Trace a fee back", more: true },
      { href: "/admin/agents/replay", label: "Replay", role: "Re-run a past step", more: true },
      { href: "/admin/agents/messages", label: "Messages", role: "Agent to agent", more: true },
      { href: "/admin/scoreboard", label: "Scoreboard", role: "Daily score", more: true },
    ],
  },
  {
    key: "data",
    label: "Data",
    question: "How much is live, and how much of it is right?",
    href: "/admin/data",
    pages: [
      { href: "/admin/data", label: "Published data", role: "What is live", exact: true },
      { href: "/admin/institutions", label: "Institutions", role: "Every bank and CU", activePrefixes: ["/admin/institution/"] },
      { href: "/admin/fees/catalog", label: "Fee catalog", role: "Fees by category", activePrefixes: ["/admin/fees"] },
      {
        href: "/admin/quality",
        label: "Trust review",
        role: "Sources to review",
        badgeKey: "trustPending",
        activePrefixes: ["/admin/data-quality"],
      },
      { href: "/admin/verify", label: "Verify", role: "Fees to check by hand" },
      { href: "/admin/answer-key", label: "Answer key", role: "Hand-checked truth" },
      { href: "/admin/peers", label: "Peers", role: "Peer groups", more: true },
      { href: "/admin/market", label: "Market", role: "Local markets", more: true },
      { href: "/admin/districts", label: "Districts", role: "Fed districts", more: true },
      { href: "/admin/index", label: "Index", role: "National index", activePrefixes: ["/admin/national"], more: true },
      { href: "/admin/query", label: "Query", role: "Ask the database", more: true },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    question: "Who asked, who got a reply, and who is close to paying?",
    href: "/admin/customers",
    pages: [
      { href: "/admin/customers", label: "Overview", role: "Leads, Pro accounts", exact: true },
      { href: "/admin/leads", label: "Leads", role: "Every request", activePrefixes: ["/admin/hamilton/leads"] },
      { href: "/admin/customers/marketing", label: "Marketing", role: "Monthly emails to approve" },
      { href: "/admin/customers/content", label: "Content", role: "Posts to approve" },
      { href: "/admin/growth", label: "Growth", role: "Marketing team approvals" },
      { href: "/admin/api-keys", label: "API keys", role: "Invited partners", more: true },
      { href: "/admin/hamilton/research/usage", label: "Hamilton usage", role: "Who asked Hamilton", activePrefixes: ["/admin/research/usage"], more: true },
    ],
  },
  {
    key: "publishing",
    label: "Publishing",
    question: "What have we published, and is it current?",
    href: "/admin/publishing",
    pages: [
      { href: "/admin/publishing", label: "Overview", role: "Reports, briefs, updates", exact: true },
      { href: "/admin/hamilton/reports", label: "Reports", role: "National Index, Pulse, state" },
      { href: "/admin/hamilton/guides", label: "Guides", role: "Consumer guides" },
      {
        href: "/admin/hamilton/research/articles",
        label: "Articles",
        role: "Research articles",
        activePrefixes: ["/admin/research/articles"],
      },
      {
        href: "/admin/hamilton/methodology",
        label: "Methodology",
        role: "How we build it",
        more: true,
        activePrefixes: ["/admin/methodology"],
      },
      { href: "/admin/hamilton/chat", label: "Hamilton", role: "Ask Hamilton", activePrefixes: ["/admin/hamilton/scout", "/admin/scout"] },
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
    key: "controls",
    label: "Controls",
    question: "What are we spending, and how do I stop it?",
    href: "/admin/controls",
    pages: [
      { href: "/admin/controls", label: "Overview", role: "Spend, switches, launch", exact: true },
      { href: "/admin/api-trust", label: "Spend guard", role: "Caps and blocked calls" },
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
      const name = label.toLowerCase();
      const score = name === needle
        ? 0
        : name.startsWith(needle)
          ? 1
          : name.includes(needle)
            ? 2
            : `${page.label} ${page.role} ${room.label}`.toLowerCase().includes(needle)
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
