import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Rosetta's role lessons: how to turn documents into text better, each from an issue whose root
 * cause was here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How
 * work runs").
 */
export const ROSETTA_LESSONS: AgentLesson[] = [
  {
    id: "issue-1053",
    agent: "rosetta",
    stage: "fee-page check",
    lesson: "An account or product page that shows a monthly fee or two is not the bank's fee schedule: reject it at the fee-page check, before Knox reads it, so the bank goes back to Magellan for the real schedule.",
    why: "The fee-page check let product pages through as fee documents: of 1,235 institutions held by the 3-fee minimum, 1,041 sat on a product or account URL, and 137 institutions' only fees were later taken down as product-page fees (Oct 12 review).",
    evidence: { issues: [1053, 1050], prs: [1150], files: ["docs/plans/rosetta-review-2026-10-12.md", "src/lib/agents/learning/fee-page.ts"] },
    appliesTo: ["read"],
    since: "2026-10-13",
  },
  {
    id: "issue-2325",
    agent: "rosetta",
    stage: "paid read",
    lesson: "Only a reply the model finished, or one cut off at its length limit that still passes the content checks, is usable text; a refusal, pause or unknown finish is not a read. A reply whose cost cannot be read has an unknown cost, never $0.",
    why: "Refusal, pause, missing and unknown finishes reached the completed-text writers, and omitted or malformed usage became a zero cost estimate.",
    evidence: { issues: [2325], prs: [2339], files: ["src/lib/agents/rosetta/paid-read.ts"] },
    appliesTo: ["read-paid"],
    since: "2026-10-19",
  },
  {
    id: "pr-858-columns-read-apart",
    agent: "rosetta",
    stage: "read",
    lesson: "When a page prints a table and a list side by side, split it at the gutter and read each column on its own; never join lines across the gutter because they share a baseline.",
    why: "The PDF reader grouped Northern Trust's page by baseline, so a dot-leader fee list became the last cell of an account table's rows and Knox read 2 fees instead of 8.",
    evidence: { issues: [], prs: [858], files: ["docs/project/findings/2026-10-09-leader-fee-list-beside-table.md"] },
    appliesTo: "all",
    since: "2026-10-09",
  },
  {
    id: "pr-911-font-control-characters",
    agent: "rosetta",
    stage: "read",
    lesson: "Check extracted text for control characters and shifted font glyphs. Decode them only when the page proves the map (shifted words that decode to words it also prints in clear), and otherwise flag the text instead of passing it on as clean.",
    why: "A PDF font wrote spaces as U+0003 and shifted its letters and digits, so 14 live fee names at 5 institutions carried control characters, and another font family extracted ligatures as single letters in 8 more. Retidy v12 spaced the names and v13 decoded the map only where the page proved it.",
    evidence: { issues: [], prs: [903, 911], files: ["docs/project/findings/2026-10-09-pdf-font-control-character-names.md"] },
    appliesTo: "all",
    since: "2026-10-09",
  },
  {
    id: "pr-969-reread-keeps-better-text",
    agent: "rosetta",
    stage: "read",
    lesson: "A re-read of unchanged document bytes never replaces a text that pairs each fee name with its price by one that reads names and prices in separate runs; compare the two readings before writing.",
    why: "Re-reads rewrote texts in place column by column, and 516 fees at 192 banks failed their source check; Georgia United lost all 20 live fees. Only 348 of the 516 still passed against the line Knox stored, and UAT scored restores from that line 6/10 and 5/10, so a lost reading cannot be rebuilt afterwards from the stored line alone.",
    evidence: { issues: [], prs: [968, 969], files: ["docs/project/findings/2026-10-09-reread-takedowns.md"] },
    appliesTo: "all",
    since: "2026-10-09",
  },
];
