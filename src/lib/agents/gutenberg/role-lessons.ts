import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Gutenberg's role lessons: how to keep the live fee catalog better, each from an issue whose root
 * cause was in publishing. A PR that closes such an issue adds its lesson in the same PR
 * (AGENTS.md, "How work runs").
 */
export const GUTENBERG_LESSONS: AgentLesson[] = [
  {
    id: "issue-2356",
    agent: "gutenberg",
    stage: "publish",
    lesson: "Check that the verified row chosen for publishing is still the current one before any early exit on its category; a caller holding an older snapshot defers instead of writing.",
    why: "In the international publication adapter the non-international category exit came before the snapshot check, so a caller holding the prior international row reached its ordinary write after the verified category had changed to domestic.",
    evidence: { issues: [2356], prs: [2386], files: ["src/lib/agents/knox/international-wire-scope.db.test.ts"] },
    appliesTo: ["publish", "publish-sweeps"],
    since: "2026-10-19",
  },
  {
    id: "issue-1069",
    agent: "gutenberg",
    stage: "publish",
    lesson: "Refuse at publish any fee a live sweep would take down under a rule that already exists (a duplicate of a live fee, a product page, another bank's or an unconfirmed host's document, a business schedule), reading the same rule function the sweep uses. A sweep is for old rows caught by a new rule, and for the few cases that need the page read (such as a business fee shown only in a footnote), not a second gate.",
    why: "The publish check and the later sweeps disagreed on the same rules, so about 7,900 fees a week went live and were taken down within hours or days: 5,943 duplicates, 832 other-bank or unconfirmed-host documents, 745 product pages and 366 business schedules (Oct 12 review).",
    evidence: { issues: [1069, 975], prs: [1224, 1620, 1737, 1789], files: ["docs/plans/hamilton-review-2026-10-12.md", "src/lib/agents/hamilton/publish-sweep-rules.ts", "src/lib/agents/hamilton/exact-duplicate.ts", "src/lib/agents/hamilton/product-page.ts"] },
    appliesTo: ["publish", "publish-sweeps"],
    since: "2026-10-20",
  },
  {
    id: "issue-1068",
    agent: "gutenberg",
    stage: "refresh",
    lesson: "When a newer copy of a page carries the same fee at the same amount, move the live row to the newer copy in place; write a new row only when the price really changed.",
    why: "Every re-read published a new row and closed the old one even when nothing changed: 32,556 refreshed-by closures in 7 days and 11,994 institution-fee-amount combinations with three or more rows, inflating every published count, the daily email and the take-down rate (Oct 12 review).",
    evidence: { issues: [1068, 975], prs: [1223], files: ["docs/plans/hamilton-review-2026-10-12.md", "src/lib/agents/hamilton/refresh-copy.ts"] },
    appliesTo: ["publish", "publish-sweeps"],
    since: "2026-10-17",
  },
  {
    id: "restore-name-first",
    agent: "gutenberg",
    stage: "source check",
    lesson: "Put a taken-down fee back live on its stored line only when that line reads name first and its name does not say free; a line that opens on a price may carry the row above's price.",
    why: "The lost-read restore trusted the stored line alone, and in a sample of 20 of its 159 restores 4 lines opened on a price (\"$30 Replacement Credit Card Rush | $25 Replace Key\") and one was \"Notary Fee Free for members\" at the $5 non-member price.",
    evidence: { issues: [978], prs: [], files: ["src/lib/agents/hamilton/source-check.ts"] },
    appliesTo: ["publish", "publish-index", "publish-context"],
    since: "2026-10-20",
  },
  {
    id: "product-page-same-item",
    agent: "gutenberg",
    stage: "product-page conflict",
    lesson: "A product page conflicts with the schedule only when the schedule prices the same item at another price; a different item in the same category, or a premium tier's own page, is not a conflict.",
    why: "The conflict check compared by category alone, so 12 of 20 sampled takedowns were a returned-item fee against a bill-pay NSF line, or a tier page against the standard schedule.",
    evidence: { issues: [978], prs: [2440], files: ["src/lib/agents/hamilton/product-page-conflict.ts"] },
    appliesTo: ["publish", "publish-index", "publish-context"],
    since: "2026-10-20",
  },
  {
    id: "restore-still-printed",
    agent: "gutenberg",
    stage: "source check",
    lesson: "Put a fee back live only when the bank's current document still finds its name and prints its price; a stored line reached through \"for\" (\"$25.00 for Incoming Wires\") carries the next row's price.",
    why: "The re-sample of restores after the name-first rule found 8 of 20 that the bank's current document could not prove (names missing, or names with no prices), and one \"$A for X / $B for Y\" table that bound the next row's $50 to the incoming wire.",
    evidence: { issues: [978], prs: [2443], files: ["src/lib/agents/hamilton/source-check.ts"] },
    appliesTo: ["publish", "publish-index", "publish-context"],
    since: "2026-10-20",
  },
];
