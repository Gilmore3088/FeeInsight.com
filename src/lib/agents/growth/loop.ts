import { isMarketingStep, isProviderStep } from "@/lib/agents/types";

/**
 * The growth loop in the order it runs, for the daily dry run (`/api/admin/crew/growth-loop`).
 * Every free marketing step that can run without an input is here. Left out: `marketing-write`
 * (a paid model step), `marketing-send` (it sends and has no dry run) and `growth-intake` (it
 * files one item an agent hands it).
 */
export const GROWTH_LOOP_STEPS: ReadonlyArray<{ key: string; title: string }> = [
  { key: "growth-intel", title: "SHERLOCK: read regulator items and competitor pages for the market brief" },
  { key: "growth-contacts", title: "NIELSEN: find published decision-makers for 5 prospects" },
  { key: "growth-contact-picks", title: "NIELSEN: rank saved contacts and mark each prospect's primary and backup" },
  { key: "growth-outreach", title: "CARNEGIE: draft 5 first emails and the day-7 follow-ups" },
  { key: "content-market-spread", title: "MURROW: pick a market-spread post" },
  { key: "content-fee-depth", title: "MURROW: pick a fee-depth post" },
  { key: "content-od-by-state", title: "ERNEST: build the fees-by-state article" },
  { key: "growth-tools", title: "EDISON: run the free price check for today's state" },
  { key: "growth-conversion", title: "NORMAN: check every buying page and outreach link, and the funnel" },
  { key: "growth-score", title: "Score posted items and sent outreach emails" },
  { key: "growth-learning", title: "DRAPER: write what the week taught" },
  { key: "marketing-score", title: "Score last month's campaigns and the market snapshot" },
  { key: "marketing-states", title: "Plan this month's state editions" },
];

/** True when every loop step is a free marketing step (checked in tests). */
export const loopIsFree = () => GROWTH_LOOP_STEPS.every((step) => isMarketingStep(step.key) && !isProviderStep(step.key));
