import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Darwin's role lessons: how to verify and classify fees better, each from an issue whose root
 * cause was here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How
 * work runs").
 */
export const DARWIN_LESSONS: AgentLesson[] = [
  {
    id: "issue-2342",
    agent: "darwin",
    stage: "verify",
    lesson: "A restriction printed on the fee's own price line, such as \"$10.00 (Consumer Only) per statement\", decides its audience; a mixed-schedule fallback never widens it to both audiences.",
    why: "The audience reader recognised \"(Consumer)\" but not \"(Consumer Only)\" and missed a restriction on the fee's own next line, so Oakwood's Check Images fee was verified and published for both audiences on the strength of an unrelated balance line.",
    evidence: { issues: [2342], prs: [2374], files: [] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2368",
    agent: "darwin",
    stage: "verify",
    lesson: "Read the fee's own source clause before deciding a rule does not apply to it; stale category keys on the row never overrule the fee's own wording.",
    why: "The final verification helper returned not_applicable for an International Wire Outgoing row because its stale minimum_balance keys triggered an early exit before the own international wire clause was read.",
    evidence: { issues: [2368], prs: [2386], files: [] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2277",
    agent: "darwin",
    stage: "verify",
    lesson: "Re-check a row's current eligibility hold after taking its lock and before writing a verified row; a row selected earlier in the run may be stale.",
    why: "A stale selected row waited for the raw row's lock, then inserted a verified monthly fee after that raw row had become eligibility-held, because insertVerifiedFee checked only the product identity.",
    evidence: { issues: [2277], prs: [2280], files: ["src/lib/agents/darwin/verify.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2309",
    agent: "darwin",
    stage: "verify receipts",
    lesson: "Every result a verify or classify step produces, its recheck counts included, goes into the saved step receipt; a missing count is unknown, never zero.",
    why: "runDarwinVerify returned its recheck results, but the run-store projection dropped them before the step was saved, so the receipts Darwin's guide promises were missing.",
    evidence: { issues: [2309], prs: [2312], files: ["src/lib/agents/run-store.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "pr-898-file-by-whose-item",
    agent: "darwin",
    stage: "classify",
    lesson: "File a fee by whose item and whose account it is, not by matching words: a returned bond or coupon is a deposited item coming back, a business or commercial wire is not a consumer wire, and a $0 line under the bank's own ATM heading is not a non-network ATM fee.",
    why: "Word matching filed bond returns as NSF and about 40 business wire prices as consumer wires, and 41 live free atm_non_network rows named no other bank or network, among them Regions' own-ATM balance inquiry, \"ATM Enrollment\" and \"Check Card/ATM First Card\".",
    evidence: { issues: [], prs: [792, 805, 898], files: ["docs/project/findings/2026-10-09-bond-return-filed-nsf.md", "docs/project/findings/2026-10-09-business-wire-as-consumer-price.md", "docs/project/findings/2026-10-09-own-atm-free-line-as-non-network.md", "src/lib/fee-category-guard.ts"] },
    appliesTo: "all",
    since: "2026-10-09",
  },
  {
    id: "pr-883-rule-version-recheck",
    agent: "darwin",
    stage: "verify",
    lesson: "Record the version of every rule a rejection or hold rests on (the category guard, an amount envelope, the source check) and re-select the row once when that rule changes; otherwise a fix only reaches new reads.",
    why: "Verify skipped every row it had already decided, so 1,380 rows held under an old envelope and 1,126 not_in_source rejections stayed put after the rules that stopped them were fixed.",
    evidence: { issues: [], prs: [803, 883], files: ["docs/project/findings/2026-10-09-envelope-change-never-reached-held-rows.md", "docs/project/findings/2026-10-09-not-in-source-rejections-never-re-read.md"] },
    appliesTo: "all",
    since: "2026-10-09",
  },
  {
    id: "pr-928-fee-own-cell",
    agent: "darwin",
    stage: "verify",
    lesson: "Take a fee's amount from its own cell: a $0 whose line also prices the fee when a condition is not met, a non-member price, an opening deposit or the next column's price is not this fee's amount. Hand-check the first rows a re-select verifies before it carries on.",
    why: "The not_in_source re-select verified conditional $0 readings and neighbouring prices, scoring 16 of 20 against source, and the first recheck read non-member prices and other columns as the fee's own.",
    evidence: { issues: [], prs: [928, 944, 951], files: ["docs/project/findings/2026-10-09-not-in-source-rejections-never-re-read.md"] },
    appliesTo: "all",
    since: "2026-10-09",
  },
  {
    id: "issue-1295",
    agent: "darwin",
    stage: "verify",
    lesson: "When Knox re-files a row under a new category, judge it again under that category: a decision made under the old category says nothing about the new one, and a take-over that changed the category is proof of the change.",
    why: "Rows Darwin rejected as too-cheap account research fees stayed rejected after Knox took them over as returned mail, fax and image copy fees, because a take-over drops the old category flags and Darwin judged a raw row once per rule version.",
    evidence: { issues: [1295], prs: [1296, 1629], files: ["src/lib/agents/darwin/category-change.ts"] },
    appliesTo: "all",
    since: "2026-10-20",
  },
];
