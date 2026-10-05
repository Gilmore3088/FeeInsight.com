/**
 * Hamilton Agent — Tool registry and system prompt builder.
 *
 * Provides the LLM with access to:
 * - Fee data tools (national index, peer index, institution lookup)
 * - Fed district data + Beige Book
 * - Report generation trigger
 * - Admin pipeline tools
 */

import { tool } from "ai";
import { z } from "zod";
import { HAMILTON_SYSTEM_PROMPT } from "@/lib/hamilton/voice";
import { publicTools } from "@/lib/research/tools";
import { internalTools } from "@/lib/research/tools-internal";
import { searchExternalIntelligence } from "@/lib/data-store/intelligence";
import { getFeesByInstitution, getInstitutionById } from "@/lib/data-store";
import { getLocalMarketCompetitors } from "@/lib/data-store/local-market";
import {
  LEGACY_GENERATABLE_REPORT_TYPES,
  legacyReportTypeError,
} from "@/lib/report-engine/legacy-generation-policy";

/**
 * Build the Hamilton system prompt for chat context.
 *
 * Starts with the locked HAMILTON_SYSTEM_PROMPT from voice.ts, then appends:
 * - Tool usage instructions
 * - Response format guidance
 * - Date anchor
 */
export function buildHamiltonSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0];

  return `${HAMILTON_SYSTEM_PROMPT}

TOOL USAGE:
Hamilton has access to tools for querying live fee data, Federal Reserve district data, and institution records. Always query tools to ground analysis in live data before composing a response. Do not invent statistics.

RESPONSE FORMAT:
- Simple factual queries (single fee, single institution, quick comparison): respond conversationally in 2-4 paragraphs.
- Complex analyses (geographic scope, peer comparison, multi-category trends): produce a structured mini-report in markdown with ### headings, data tables, and a "## Key Finding" pull-quote section at the conclusion.
- The triggerReport tool is only for legacy admin publication reports: national index, state index, and monthly pulse. Do not use it for institution, peer, competitive, consulting, or board briefs; those belong in Hamilton Reports where selected institution context and evidence policy are enforced.

LOCAL COMPETITORS:
When the user asks about an institution's position, call getLocalCompetitors and compare it with its named local competitors before national or peer figures. Name them and their prices.

EXTERNAL INTELLIGENCE:
When you use the searchIntelligence tool and reference external sources, ALWAYS cite them inline as [Source: {source_name}, {date}]. Example: "According to the CFPB's annual overdraft study [Source: CFPB Overdraft Fee Study, 2024-12], overdraft revenue declined 7.2% year-over-year." Never present external intelligence as your own analysis — always attribute.

Today's date: ${today}. Always ground analysis in tool results — never invent statistics.`;
}

/**
 * Build the Hamilton tool set — all public + admin internal tools + report trigger.
 */
export function buildHamiltonTools() {
  const searchIntelligence = tool({
    description:
      "Search external intelligence (industry research, CFPB surveys, ABA studies, regulatory guidance, news articles) stored in the platform. Returns matching documents with source attribution. Use this tool when the user asks about industry trends, regulatory developments, or external research — or when you want to supplement internal fee data with broader context.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Search query — keywords or phrases to match against external documents"
        ),
      category: z
        .enum(["research", "survey", "regulation", "news", "analysis"])
        .optional()
        .describe("Filter by document category"),
    }),
    execute: async ({ query, category }) => {
      const results = await searchExternalIntelligence(query, {
        category: category ?? undefined,
      });

      if (results.length === 0) {
        return {
          results: [],
          message: "No external intelligence found matching that query.",
        };
      }

      return {
        results: results.map((r) => ({
          source_name: r.source_name,
          source_date: r.source_date,
          category: r.category,
          tags: r.tags,
          snippet: r.headline,
          source_url: r.source_url,
        })),
        citation_note:
          "When referencing these sources, cite as [Source: {source_name}, {date}] per citation guidelines.",
      };
    },
  });

  const getLocalCompetitors = tool({
    description:
      "Name an institution's local competitors (institutions with branches in the counties holding most of its deposits, from the FDIC Summary of Deposits) with their published fee amounts beside the institution's own. Use it whenever the user asks how an institution compares locally, in its market, or against named competitors.",
    inputSchema: z.object({
      institution_id: z.number().int().positive().describe("The institution's id"),
    }),
    execute: async ({ institution_id }) => {
      const institution = await getInstitutionById(institution_id);
      if (!institution) return { error: "Institution not found." };
      const own = (await getFeesByInstitution(institution_id)).filter(
        (fee) => fee.review_status === "approved" && fee.fee_category && fee.amount !== null,
      );
      const yourFees: Record<string, number> = {};
      for (const fee of own) yourFees[fee.fee_category as string] ??= Number(fee.amount);
      const market = await getLocalMarketCompetitors({
        institutionId: institution_id,
        certNumber: institution.cert_number,
        city: institution.city,
        stateCode: institution.state_code,
        categories: Object.keys(yourFees),
      });
      if (!market) {
        return { institution: institution.institution_name, your_fees: yourFees, message: "No local market could be located for this institution." };
      }
      return {
        institution: institution.institution_name,
        your_fees: yourFees,
        market: market.label,
        source: `FDIC Summary of Deposits ${market.sod_year}; verified published fee amounts`,
        competitors: market.competitors.map((c) => ({ name: c.institution_name.replace(/\s+/g, " ").trim(), fees: c.fees })),
      };
    },
  });

  const triggerReport = tool({
    description:
      "Trigger a legacy admin publication report for the public report catalog. Only supports national index, state index, and monthly pulse jobs. Do not use for peer briefs, institution briefs, competitive briefs, or consulting reports; those must use Hamilton Reports with selected institution context.",
    inputSchema: z.object({
      report_type: z
        .enum(LEGACY_GENERATABLE_REPORT_TYPES)
        .describe("The type of report to generate"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe(
          "Report parameters. For state_index: { state_code: 'TX' }. Monthly pulse and national index usually use an empty object."
        ),
    }),
    execute: async ({ report_type, params }) => {
      // T-17-01: validate report_type against explicit allowlist
      if (!LEGACY_GENERATABLE_REPORT_TYPES.includes(report_type)) {
        return {
          error: legacyReportTypeError(),
        };
      }

      const baseUrl =
        process.env.BFI_APP_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        "http://localhost:3000";

      try {
        const response = await fetch(`${baseUrl}/api/reports/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Pass internal cron secret so the report route accepts this request
            "X-Cron-Secret": process.env.BFI_REVALIDATE_TOKEN ?? "",
          },
          body: JSON.stringify({ report_type, params: params ?? {} }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          return {
            error: `Report generation failed (${response.status}): ${errBody}`,
          };
        }

        const data = (await response.json()) as { jobId?: string; error?: string };
        if (data.error) {
          return { error: data.error };
        }

        return {
          success: true,
          jobId: data.jobId,
          message: `Report '${report_type}' is now generating. Job ID: ${data.jobId}. The report will be available in the Reports & Briefs tab once complete.`,
        };
      } catch (err) {
        return { error: `Failed to trigger report: ${String(err)}` };
      }
    },
  });

  return {
    ...publicTools,
    ...internalTools,
    triggerReport,
    searchIntelligence,
    getLocalCompetitors,
  };
}
