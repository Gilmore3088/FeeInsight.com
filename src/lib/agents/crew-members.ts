import type { AdminAgent } from "./types";

/** Shared static roster. Must not depend on Atlas scheduling or crew status. */
export interface CrewMemberMeta {
  agent: AdminAgent;
  name: string;
  role: string;
  /** Admin page with this worker's detailed tools. */
  href: string;
}

export const CREW: CrewMemberMeta[] = [
  { agent: "atlas", name: "Atlas", role: "Runs the schedule and coordinates the crew", href: "/admin/atlas/details" },
  { agent: "magellan", name: "Magellan", role: "Finds and downloads fee schedules", href: "/admin/magellan" },
  // Hoovie's registry tools sit on the Magellan admin page until they get their own (#1865).
  { agent: "hoovie", name: "Hoovie", role: "Loads public data: regulator, government and survey datasets", href: "/admin/magellan/registry" },
  { agent: "rosetta", name: "Rosetta", role: "Reads PDFs and web pages", href: "/admin/rosetta" },
  { agent: "knox", name: "Knox", role: "Pulls fees out of documents", href: "/admin/knox" },
  { agent: "darwin", name: "Darwin", role: "Checks every fee before it counts", href: "/admin/darwin" },
  { agent: "hamilton", name: "Hamilton", role: "The Pro workspace: answers, studies, briefings and alerts", href: "/admin/hamilton" },
  // Gutenberg's publisher tools still sit on the Hamilton admin page until #1075 step 3 moves the code.
  { agent: "gutenberg", name: "Gutenberg", role: "Publishes verified fees and keeps the live catalog correct", href: "/admin/hamilton" },
  { agent: "growth", name: "Growth", role: "Drafts marketing posts and emails for James to approve", href: "/admin/customers/content" },
];

export function crewMember(agent: string): CrewMemberMeta | undefined {
  return CREW.find((member) => member.agent === agent);
}

