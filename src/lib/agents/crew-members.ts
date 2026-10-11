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
  { agent: "rosetta", name: "Rosetta", role: "Reads PDFs and web pages", href: "/admin/rosetta" },
  { agent: "knox", name: "Knox", role: "Pulls fees out of documents", href: "/admin/knox" },
  { agent: "darwin", name: "Darwin", role: "Checks every fee before it counts", href: "/admin/darwin" },
  { agent: "hamilton", name: "Hamilton", role: "Publishes fees and runs the index", href: "/admin/hamilton" },
  { agent: "growth", name: "Growth", role: "Drafts marketing posts and emails for James to approve", href: "/admin/customers/content" },
];

export function crewMember(agent: string): CrewMemberMeta | undefined {
  return CREW.find((member) => member.agent === agent);
}

