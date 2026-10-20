import { ATLAS_LESSONS } from "@/lib/agents/atlas/role-lessons";
import { DARWIN_LESSONS } from "@/lib/agents/darwin/role-lessons";
import { DEMING_LESSONS } from "@/lib/agents/deming/role-lessons";
import { GUTENBERG_LESSONS } from "@/lib/agents/gutenberg/role-lessons";
import { HAMILTON_LESSONS } from "@/lib/agents/hamilton/role-lessons";
import { HOOVIE_LESSONS } from "@/lib/agents/hoovie/role-lessons";
import { KNOX_LESSONS } from "@/lib/agents/knox/role-lessons";
import { MAGELLAN_LESSONS } from "@/lib/agents/magellan/role-lessons";
import { ROSETTA_LESSONS } from "@/lib/agents/rosetta/role-lessons";
import type { AgentLesson } from "./lesson-types";

/**
 * Every agent's role lessons, in pipeline order. `scripts/ci-guards.sh lesson-kill` fails when an
 * agent's `role-lessons.ts` is not imported here.
 */
export const ALL_AGENT_LESSONS: readonly AgentLesson[] = [
  ...ATLAS_LESSONS,
  ...MAGELLAN_LESSONS,
  ...HOOVIE_LESSONS,
  ...ROSETTA_LESSONS,
  ...KNOX_LESSONS,
  ...DARWIN_LESSONS,
  ...GUTENBERG_LESSONS,
  ...HAMILTON_LESSONS,
  ...DEMING_LESSONS,
];
