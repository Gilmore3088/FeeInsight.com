import { sql } from "@/lib/data-store/connection";
import { getFeeCategorySummaries } from "@/lib/data-store/fees";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { upsertGuide, getGuideBySlug } from "@/lib/data-store/guides";
import { getAnthropicMessagesClient, extractAnthropicText } from "@/lib/ai-provider";
import { FEE_FAMILIES, DISPLAY_NAMES, getDisplayName } from "@/lib/fee-taxonomy";
import {
  guideCategories,
  guideText,
  guideWordCount,
  parseTokens,
  isValidStat,
  resolveTokens,
  REQUIRED_CONSUMER_SECTIONS,
} from "@/lib/guides";
import type { Guide, GuideSection } from "@/lib/guides/types";

type SqlTag = typeof sql;

/**
 * Guide drafting agent.
 *
 * Follows the same shape as `runHamiltonPublish`: an agent module invoked by the run
 * ledger, never a script. Every stage records an event, and the run's step result
 * carries the summary the console renders.
 *
 * Two rules are structural rather than advisory:
 *
 *  - **Never auto-publishes.** A draft lands in `in_review` and a human publishes it.
 *    These are financial-advice pages; the Knox ready-review precedent applies.
 *  - **Validation gates the write.** A draft whose tokens do not resolve, whose
 *    categories are not in the taxonomy, or which is missing a mandated section is
 *    recorded as rejected and the previously published guide is left untouched.
 */

export const GUIDE_DRAFT_MIN_WORDS = 800;
export const GUIDE_DRAFT_MAX_WORDS = 1200;
export const GUIDE_DRAFT_MODEL = "claude-opus-5";

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

export interface GuideValidationIssue {
  code:
    | "unknown_category"
    | "undeclared_category"
    | "unresolved_token"
    | "invalid_stat"
    | "missing_section"
    | "word_count"
    | "hardcoded_amount"
    | "malformed";
  detail: string;
}

export interface RunGuideDraftOptions {
  runId: number;
  /** Fee category the guide is about. Must exist in the taxonomy. */
  primaryCategory: string;
  slug?: string;
  /** Validate and report without writing. */
  dryRun?: boolean;
  db?: SqlTag;
}

export interface RunGuideDraftResult {
  slug: string;
  primaryCategory: string;
  status: "drafted" | "rejected" | "skipped";
  wordCount: number;
  issues: GuideValidationIssue[];
  dryRun: boolean;
  /** Whether a previously published guide was left in place because the draft failed. */
  publishedGuidePreserved: boolean;
}

/**
 * Validate a drafted guide against every invariant the shipped catalog is held to.
 *
 * This is the same rule set `guides.test.ts` enforces at build time, applied at draft
 * time so a generated guide cannot enter review in a state the catalog would reject.
 */
export function validateDraftedGuide(
  guide: Guide,
  summaries: FeeCategorySummary[],
): GuideValidationIssue[] {
  const issues: GuideValidationIssue[] = [];
  const declared = new Set(guideCategories(guide));

  for (const category of declared) {
    if (!TAXONOMY.has(category)) {
      issues.push({
        code: "unknown_category",
        detail: `${category} is not in the fee taxonomy`,
      });
    }
    if (!DISPLAY_NAMES[category]) {
      issues.push({
        code: "unknown_category",
        detail: `${category} has no display name`,
      });
    }
  }

  for (const text of guideText(guide)) {
    for (const token of parseTokens(text)) {
      if (!isValidStat(token.stat)) {
        issues.push({
          code: "invalid_stat",
          detail: `${token.raw} cites an unknown statistic`,
        });
        continue;
      }
      if (!declared.has(token.category)) {
        issues.push({
          code: "undeclared_category",
          detail: `${token.raw} cites a fee the guide does not declare`,
        });
      }
    }
    const { unresolved } = resolveTokens(text, summaries);
    for (const token of unresolved) {
      issues.push({
        code: "unresolved_token",
        detail: `${token.raw} has no data behind it`,
      });
    }
    // A priced literal is the defect this whole model exists to prevent.
    const priced = text.match(/\$\d+\.\d{2}/g);
    if (priced) {
      issues.push({
        code: "hardcoded_amount",
        detail: `prose states ${priced.join(", ")} instead of citing live data`,
      });
    }
  }

  if (guide.audience === "consumer") {
    const anchors = new Set(guide.sections.map((s) => s.id));
    for (const required of REQUIRED_CONSUMER_SECTIONS) {
      if (!anchors.has(required)) {
        issues.push({
          code: "missing_section",
          detail: `consumer guides must carry a "${required}" section`,
        });
      }
    }
  }

  const words = guideWordCount(guide);
  if (words < GUIDE_DRAFT_MIN_WORDS || words > GUIDE_DRAFT_MAX_WORDS) {
    issues.push({
      code: "word_count",
      detail: `${words} words, outside ${GUIDE_DRAFT_MIN_WORDS}-${GUIDE_DRAFT_MAX_WORDS}`,
    });
  }

  return issues;
}

async function recordEvent(
  db: SqlTag,
  runId: number,
  eventType: string,
  status: string,
  message: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db`
    INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
    VALUES (${runId}, ${eventType}, ${status}, ${message}, ${JSON.stringify(detail)}::jsonb)
  `;
}

function briefFor(category: string, summaries: FeeCategorySummary[]): string {
  const summary = summaries.find((s) => s.fee_category === category);
  const name = getDisplayName(category);
  if (!summary) return `${name} (${category}) — no published observations yet`;
  return [
    `${name} (${category})`,
    `  median {{${category}.median}}, P25 {{${category}.p25}}, P75 {{${category}.p75}}`,
    `  range {{${category}.min}} to {{${category}.max}}`,
    `  ${summary.institution_count} institutions, ${summary.zero_count} charging nothing`,
  ].join("\n");
}

function draftPrompt(
  primaryCategory: string,
  related: string[],
  summaries: FeeCategorySummary[],
): string {
  const categories = [primaryCategory, ...related];
  return [
    "Write a consumer guide for Fee Insight about a US bank fee, following the",
    "consumer-guide skill: plain language, second person, 8th-grade reading level,",
    `${GUIDE_DRAFT_MIN_WORDS}-${GUIDE_DRAFT_MAX_WORDS} words.`,
    "",
    "CRITICAL RULE: never write a dollar figure. Cite live data with tokens of the form",
    "{{fee_category.stat}} where stat is one of median, p25, p75, min, max, institutions,",
    "zero_count. You may only cite the categories listed below.",
    "",
    "Available data:",
    ...categories.map((c) => briefFor(c, summaries)),
    "",
    "Return JSON only, with this shape:",
    JSON.stringify(
      {
        title: "Short H1, no colon",
        seoTitle: "Longer keyword-bearing title",
        description: "One or two sentences",
        sections: [
          {
            id: "what-it-is",
            heading: "What is this fee?",
            blocks: [{ type: "paragraph", text: "..." }],
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Block types: paragraph {text}, list {items[], ordered?}, callout {tone, text}",
    "where tone is tip|warning|regulatory, and benchmark {category, rows[{condition, meaning}]}.",
    "",
    `Required section anchors: ${REQUIRED_CONSUMER_SECTIONS.join(", ")}.`,
    "The regulatory section must explain the rules in plain language by common name",
    "(Regulation E, Regulation DD) with no CFR citations.",
  ].join("\n");
}

function parseDraft(raw: string): Partial<Guide> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Partial<Guide>;
  } catch {
    return null;
  }
}

export async function runGuideDraft(
  options: RunGuideDraftOptions,
): Promise<RunGuideDraftResult> {
  const db = options.db ?? sql;
  const { runId, primaryCategory } = options;
  const dryRun = Boolean(options.dryRun);
  const slug = options.slug ?? `${primaryCategory.replace(/_/g, "-")}-fees`;

  const base: Omit<RunGuideDraftResult, "status" | "wordCount" | "issues"> = {
    slug,
    primaryCategory,
    dryRun,
    publishedGuidePreserved: false,
  };

  if (!TAXONOMY.has(primaryCategory)) {
    const issues: GuideValidationIssue[] = [
      { code: "unknown_category", detail: `${primaryCategory} is not in the fee taxonomy` },
    ];
    await recordEvent(db, runId, "guide.rejected", "failed", "Unknown fee category", {
      primary_category: primaryCategory,
      issues,
    });
    return { ...base, status: "rejected", wordCount: 0, issues };
  }

  // Step 1 — read benchmarks. published_fee_catalog only, like every other fee read.
  const summaries = await getFeeCategorySummaries();
  const primary = summaries.find((s) => s.fee_category === primaryCategory);
  await recordEvent(db, runId, "guide.benchmarks_read", "running", "Benchmarks read", {
    primary_category: primaryCategory,
    institution_count: primary?.institution_count ?? 0,
    has_median: primary?.median_amount !== null && primary?.median_amount !== undefined,
  });

  if (!primary || primary.median_amount === null) {
    const issues: GuideValidationIssue[] = [
      {
        code: "unresolved_token",
        detail: `${primaryCategory} has no published median to cite`,
      },
    ];
    await recordEvent(db, runId, "guide.skipped", "skipped", "No benchmark to write about", {
      primary_category: primaryCategory,
      issues,
    });
    return { ...base, status: "skipped", wordCount: 0, issues };
  }

  const family = Object.entries(FEE_FAMILIES).find(([, members]) =>
    members.includes(primaryCategory),
  )?.[0];
  const related = (FEE_FAMILIES[family ?? ""] ?? [])
    .filter((c) => c !== primaryCategory)
    .filter((c) => summaries.some((s) => s.fee_category === c))
    .slice(0, 3);

  // Step 2 — draft. Provider access is centralized; never a direct SDK import.
  const client = getAnthropicMessagesClient("guide draft agent");
  const response = await client.messages.create({
    model: GUIDE_DRAFT_MODEL,
    max_tokens: 8000,
    messages: [
      { role: "user", content: draftPrompt(primaryCategory, related, summaries) },
    ],
  });
  const drafted = parseDraft(extractAnthropicText(response));

  await recordEvent(db, runId, "guide.drafted", "running", "Draft returned by provider", {
    primary_category: primaryCategory,
    parsed: drafted !== null,
    section_count: drafted?.sections?.length ?? 0,
  });

  const existing = await getGuideBySlug(slug, { includeUnpublished: true });
  const preserved = existing?.status === "published";

  if (!drafted || !Array.isArray(drafted.sections) || drafted.sections.length === 0) {
    const issues: GuideValidationIssue[] = [
      { code: "malformed", detail: "provider response was not a usable guide object" },
    ];
    await recordEvent(db, runId, "guide.rejected", "failed", "Draft could not be parsed", {
      primary_category: primaryCategory,
      issues,
      published_guide_preserved: preserved,
    });
    return {
      ...base,
      status: "rejected",
      wordCount: 0,
      issues,
      publishedGuidePreserved: preserved,
    };
  }

  const candidate: Guide = {
    slug,
    title: String(drafted.title ?? getDisplayName(primaryCategory)).replace(/:.*$/, "").trim(),
    seoTitle: String(drafted.seoTitle ?? drafted.title ?? getDisplayName(primaryCategory)),
    description: String(drafted.description ?? ""),
    primaryCategory,
    relatedCategories: related,
    audience: "consumer",
    accessTier: "public",
    family: family ?? "Other Fees",
    featured: false,
    sections: drafted.sections as GuideSection[],
    author: "Fee Insight Research",
    reviewedAt: new Date().toISOString(),
    publishedAt: existing?.publishedAt || "",
    methodologyHref: "/methodology",
    carriesRegulatoryContent: true,
  };

  // Step 3 — validate. The gate, not a warning.
  const issues = validateDraftedGuide(candidate, summaries);
  const wordCount = guideWordCount(candidate);

  if (issues.length > 0) {
    await recordEvent(db, runId, "guide.rejected", "failed", "Draft failed validation", {
      primary_category: primaryCategory,
      slug,
      word_count: wordCount,
      issue_count: issues.length,
      issues: issues.slice(0, 20),
      published_guide_preserved: preserved,
    });
    return {
      ...base,
      status: "rejected",
      wordCount,
      issues,
      publishedGuidePreserved: preserved,
    };
  }

  if (dryRun) {
    await recordEvent(db, runId, "guide.validated", "completed", "Draft valid (dry run)", {
      primary_category: primaryCategory,
      slug,
      word_count: wordCount,
    });
    return { ...base, status: "drafted", wordCount, issues: [] };
  }

  // Step 4 — persist as in_review. Never 'published'; a human does that.
  await upsertGuide({
    ...candidate,
    status: "in_review",
    generatedBy: "guide-draft-agent",
    agentRunId: runId,
  });

  await recordEvent(
    db,
    runId,
    "guide.persisted",
    "completed",
    "Draft saved for human review",
    {
      primary_category: primaryCategory,
      slug,
      word_count: wordCount,
      status: "in_review",
      requires_regulatory_approval: true,
    },
  );

  return { ...base, status: "drafted", wordCount, issues: [] };
}
