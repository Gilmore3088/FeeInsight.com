/**
 * Editor Review Module — second model pass on Hamilton drafts.
 *
 * The editor is a critic, not a writer (per D-12).
 * It uses a distinct system prompt and a lower-cost editor model.
 * Flagged sections with severity 'major' block the job from reaching 'complete'.
 *
 * Threat T-13-08: JSON parse failure defaults to approved=false (fail-safe).
 *
 * Editor v2 (Phase 37): adds three new validation checks:
 *   - Check 4: Thesis alignment (VOICE-02) — contradictions flagged as major
 *   - Check 5: Revenue prioritization (VOICE-03) — pricing-before-revenue flagged as minor
 *   - Check 6: Missing implication / "so what?" (VOICE-04) — data-only endings flagged as minor
 *
 * Thesis context is injected into the user message when a ThesisOutput is provided.
 * Per D-03: new checks are additive — existing checks 1-3 are unchanged.
 * Per T-37-01: thesis fields are Hamilton-internal, not user-controlled — no sanitization needed.
 */

import {
  extractAnthropicText,
  getAnthropicMessagesClient,
} from "@/lib/ai-provider";
import { trackAnthropicRequest } from "@/lib/ai-provider-usage";
import { HAMILTON_RULES, HAMILTON_FORBIDDEN } from "../hamilton/voice";
import type { SectionType, ValidatedSection } from "../hamilton/types";
import type { ThesisOutput } from "../hamilton/types";

// Cost-efficient pattern-matching model (not the expensive Hamilton writer model — per plan)
const EDITOR_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FlaggedSection {
  sectionType: SectionType;
  reason: string;
  severity: "minor" | "major";
}

export interface EditorReviewResult {
  /** False if any flaggedSection has severity='major', or if the model response is unparseable. */
  approved: boolean;
  flaggedSections: FlaggedSection[];
  /** One-sentence overall assessment from the editor. */
  reviewNote: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── System Prompt ─────────────────────────────────────────────────────────────

const RULES_LIST = HAMILTON_RULES.map((rule, i) => `${i + 1}. ${rule}`).join("\n");
const FORBIDDEN_LIST = HAMILTON_FORBIDDEN.map((term) => `- "${term}"`).join("\n");

const EDITOR_SYSTEM_PROMPT = `You are the editorial director at Fee Insight. Your job is to review AI-generated research sections before publication to bank executives.

Review each section for:
1. Unsupported claims — any statistic in the narrative not present in the source data
2. Voice drift — phrases that violate Hamilton's style rules (listed below)
3. Forbidden phrases — any use of prohibited language
4. Thesis alignment — if a GLOBAL THESIS block is provided above the sections, does each section's argument support or connect to it? Flag any section whose core claim contradicts the thesis with severity=major. Include the specific contradiction in the reason field — quote both the thesis claim and the section claim that contradicts it. Do not flag sections that simply don't mention the thesis — only flag direct contradictions.
5. Revenue prioritization — if a section's source data contains revenue, service charge, or income figures, does the section's first substantive claim address revenue? Flag sections where a pricing observation (a fee amount) appears before any mention of revenue with severity=minor and reason 'revenue prioritization: pricing leads, revenue buried — move revenue context to opening claim'.
6. Missing implication — does every section end with a statement of consequence for the reader's decisions? Flag any section whose final sentence is a data description with no implication (no words like 'signals', 'suggests', 'means', 'requires', 'should', 'will', 'must') with severity=minor and reason 'missing implication: section ends in data description — add a so-what statement'.

Hamilton style rules:
${RULES_LIST}

Forbidden phrases:
${FORBIDDEN_LIST}

Respond ONLY with valid JSON matching this schema:
{
  "flaggedSections": [
    {
      "sectionType": "<section type string>",
      "reason": "<specific problem>",
      "severity": "minor" | "major"
    }
  ],
  "reviewNote": "<one sentence overall assessment>"
}

major = unsupported statistics or claims, or direct contradictions of the global thesis (checks 1 and 4). minor = style/voice issues, revenue prioritization, or missing implication (checks 2, 3, 5, and 6).
If no issues found, return {"flaggedSections": [], "reviewNote": "All sections approved."}.`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the user message for the editor review.
 *
 * When thesis is non-null, prepends a GLOBAL THESIS block so the editor can
 * evaluate each section for alignment (check 4 — VOICE-02).
 * Per T-37-01: thesis content is Hamilton-generated, not user input — no sanitization needed.
 */
function buildUserMessage(sections: ValidatedSection[], thesis: ThesisOutput | null = null): string {
  const lines: string[] = [];

  if (thesis !== null) {
    lines.push("GLOBAL THESIS (evaluate each section for alignment — flag direct contradictions as major):");
    lines.push(`Core thesis: ${thesis.core_thesis}`);
    lines.push("Key tensions:");
    for (const t of thesis.tensions) {
      lines.push(`  - ${t.force_a} vs ${t.force_b}: ${t.implication}`);
    }
    lines.push(`Revenue model: ${thesis.revenue_model}`);
    lines.push("");
  }

  lines.push(
    `Review the following ${sections.length} Hamilton narrative section(s) for publication quality:\n`,
  );

  sections.forEach((section, index) => {
    lines.push(`--- SECTION ${index + 1} ---`);
    lines.push(`Type: ${section.input.type}`);
    lines.push(`Title: ${section.input.title}`);
    lines.push(`Narrative:\n${section.narrative}`);
    lines.push(`Source data available: ${JSON.stringify(section.input.data)}`);
    lines.push("");
  });

  return lines.join("\n");
}

function parseSafely(text: string): { flaggedSections: FlaggedSection[]; reviewNote: string } | null {
  try {
    const parsed = JSON.parse(text) as { flaggedSections: FlaggedSection[]; reviewNote: string };
    if (!Array.isArray(parsed.flaggedSections) || typeof parsed.reviewNote !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ─── Main Function ─────────────────────────────────────────────────────────────

/**
 * Run the editorial review pass on a set of Hamilton-generated sections.
 *
 * @param sections - Validated sections to review
 * @param thesis - Optional global thesis for alignment checking (VOICE-02). Pass null to skip thesis checks.
 *
 * Returns approved=false if:
 *   - Any flagged section has severity='major' (unsupported claim or thesis contradiction)
 *   - The Claude response cannot be parsed as valid JSON (T-13-08 fail-safe)
 */
export async function runEditorReview(
  sections: ValidatedSection[],
  thesis: ThesisOutput | null = null,
): Promise<EditorReviewResult> {
  const client = getAnthropicMessagesClient("Hamilton editor review");
  const userMessage = buildUserMessage(sections, thesis);

  const response = await trackAnthropicRequest(
    {
      model: EDITOR_MODEL,
      agent: "hamilton",
      operation: "review_report_draft",
      routeId: "api.reports.generate",
    },
    () => client.messages.create({
      model: EDITOR_MODEL,
      max_tokens: MAX_TOKENS,
      system: EDITOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  );

  const rawText = extractAnthropicText(response);

  // T-13-08: JSON parse failure → fail-safe approved=false
  const parsed = parseSafely(rawText);
  if (!parsed) {
    return {
      approved: false,
      flaggedSections: [
        {
          sectionType: "overview" as SectionType,
          reason: "Editor response unparseable — review manually before publishing",
          severity: "major",
        },
      ],
      reviewNote: "Editor response could not be parsed as valid JSON.",
      model: EDITOR_MODEL,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  const hasMajorFlag = parsed.flaggedSections.some((f) => f.severity === "major");

  return {
    approved: !hasMajorFlag,
    flaggedSections: parsed.flaggedSections,
    reviewNote: parsed.reviewNote,
    model: EDITOR_MODEL,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
