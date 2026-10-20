import type { Article } from "@/lib/data-store/articles";
import { RESEARCH_IMPRINT } from "@/lib/constants";

/**
 * A reserved slug that renders the article template with fixture content, so the layout can be
 * reviewed on a Vercel preview without publishing anything. It exists only on preview and local
 * development; in production the slug answers 404. It is never read from or written to the
 * database, is marked noindex, and is not in the sitemap (which lists rows of research_articles).
 */
export const PREVIEW_FIXTURE_SLUG = "__preview-fixture";

export function previewFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "preview" || env.NODE_ENV === "development";
}

/** Every exhibit carries this source line, so no fixture figure reads as a finding. */
const FIXTURE_SOURCE = "Source: Fixture figures for template review. Not Bank Fee Index data.";

const stateRows = Array.from(
  { length: 12 },
  (_, i) => `| Sample state ${String.fromCharCode(65 + i)} | ${20 + i} | $0 | $${25 + i} | $50 |`,
);

// The weekly fee brief's shape: opening line, chart + table + one sentence per section, a prose
// section with a list, a long table that collapses, the method section and "As of".
const CONTENT = [
  "This is a fixture brief. It shows how a research article lays out; every figure below is a placeholder.",
  "## Sample section with a chart and a table",
  "```bars Sample median fee, by size (fixture)\nSmaller institutions | 30 | $30\nLarger institutions | 35 | $35\n```",
  "| Size (fixture) | Institutions | Median fee |\n|---|---|---|\n| Smaller institutions | 200 | $30 |\n| Larger institutions | 30 | $35 |",
  "Larger sample institutions sit at a $35 fixture median, smaller ones at $30. The first sentence of each finding is also a takeaway at the top.",
  "A further paragraph after an exhibit waits behind a disclosure, so the chart and table carry the section.",
  FIXTURE_SOURCE,
  "## Sample prose section",
  "Fixture medians run from $25 to $36 across the sample states. A section with no exhibit shows its paragraphs and lists in full.",
  "- **Sample state A** has the lowest fixture median.\n- **Sample state L** has the highest fixture median.",
  "## Sample long table",
  "Sample state L has the highest fixture median, $36.",
  ["| State | Institutions | Lowest | Median | Highest |", "|---|---|---|---|---|", ...stateRows].join("\n"),
  FIXTURE_SOURCE,
  "## How these numbers are built",
  "In a real brief, this section explains how the figures were built. In this fixture, the figures are placeholders.",
  "As of October 2026.",
].join("\n\n");

export const PREVIEW_FIXTURE_ARTICLE: Article = {
  id: 0,
  slug: PREVIEW_FIXTURE_SLUG,
  title: "Sample research brief: how an article on fees lays out",
  subtitle: "A preview fixture of the research article template. Nothing here is published data.",
  content: CONTENT,
  category: "analysis",
  tags: '["overdraft"]',
  author: RESEARCH_IMPRINT,
  status: "draft",
  generated_by: null,
  conversation_id: null,
  published_at: "2026-10-17T12:00:00Z",
  created_at: "2026-10-17T12:00:00Z",
  updated_at: "2026-10-17T12:00:00Z",
  view_count: 0,
};
