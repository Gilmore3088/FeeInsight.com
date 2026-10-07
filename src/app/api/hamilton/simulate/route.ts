import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/hamilton/simulate
 *
 * Generates Hamilton's interpretation of a fee change scenario.
 * Called ONLY on slider commit (onValueCommit), NOT on every drag.
 *
 * Request body:
 *   feeCategory: string
 *   currentFee: number
 *   proposedFee: number
 *   institutionId?: string | null   (the selected Hamilton institution)
 *   peerSetId?: string | null       (the selected peer baseline)
 *
 * The peer distribution, confidence tier and institution profile are loaded on the
 * server; the client never supplies the numbers the model is given.
 *
 * Response: data stream — plain text prose interpretation
 * Only the interpretation field streams. Structured fields (tradeoffs, recommendedPosition)
 * are computed client-side in simulation.ts.
 *
 * Auth: premium/admin required
 * Cost: daily circuit breaker ($50 shared with other Hamilton routes)
 */

import { recordProRequest } from "@/lib/agents/run-store";
import { checkProAiQuota, quotaExceededMessage } from "@/lib/hamilton/quota";
import { streamText } from "ai";
import { guardProviderCall, recordProviderUsage, estimateAnthropicCostMicrousd } from "@/lib/ai-provider-usage";
import { getAnthropicLanguageModel, getHamiltonModel } from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { logUsage } from "@/lib/research/history";
import { getDistributionForCategory } from "@/app/pro/(hamilton)/simulate/actions";
import { canSimulate } from "@/lib/hamilton/confidence";
import { getInstitutionById } from "@/lib/data-store";
import { getRequestSubjectKey } from "@/lib/api-hardening/audit";
import { HAMILTON_SYSTEM_PROMPT } from "@/lib/hamilton/voice";

export const maxDuration = 120;

const HAMILTON_MODEL = getHamiltonModel();

function isFeeAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100_000;
}

async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const quota = await checkProAiQuota(user);
  if (!quota.allowed) {
    return new Response(quotaExceededMessage(quota), { status: 429 });
  }

  let body: {
    feeCategory?: unknown;
    currentFee?: unknown;
    proposedFee?: unknown;
    institutionId?: unknown;
    peerSetId?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const feeCategory = typeof body.feeCategory === "string" ? body.feeCategory : "";
  const currentFee = Number(body.currentFee);
  const proposedFee = Number(body.proposedFee);
  if (!feeCategory || !isFeeAmount(currentFee) || !isFeeAmount(proposedFee)) {
    return new Response("Missing or invalid fields: feeCategory, currentFee, proposedFee", {
      status: 400,
    });
  }
  const institutionId = typeof body.institutionId === "string" && body.institutionId ? body.institutionId : null;
  const peerSetId = typeof body.peerSetId === "string" && body.peerSetId ? body.peerSetId : null;

  const resolved = await getDistributionForCategory(feeCategory, { institutionId, peerSetId });
  if ("error" in resolved) {
    // The action's error names internal categories; the reader gets a plain sentence.
    console.warn("[hamilton-simulate] no distribution", { feeCategory, error: resolved.error });
    return new Response("There isn't enough published data for this fee to test a price yet.", { status: 422 });
  }
  const gate = canSimulate(resolved.confidenceTier);
  if (!gate.allowed) {
    return new Response(gate.reason, { status: 422 });
  }
  const distributionData = resolved.distribution;
  const institution = institutionId && /^\d+$/.test(institutionId)
    ? await getInstitutionById(Number(institutionId)).catch(() => null)
    : null;

  const { median_amount, p25_amount, p75_amount } = distributionData;
  const institutionCount = distributionData.institution_count;
  const peerLabel = distributionData.peer_label || "verified peer baseline";
  const direction =
    proposedFee > currentFee
      ? "increasing"
      : proposedFee < currentFee
      ? "decreasing"
      : "maintaining";
  const changeDollars = Math.abs(proposedFee - currentFee).toFixed(2);
  const displayCategory = feeCategory.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Hamilton's shared voice carries the no-advice rule (voice.ts); this answer adds only its format.
  const systemPrompt = `${HAMILTON_SYSTEM_PROMPT}

THIS ANSWER: a short read of one price the user is testing.
- Plain prose, 3 to 4 sentences, no headers, bullets or lists.
- Say where the tested price sits against the peer 25th percentile, median and 75th percentile, and how many institutions stand behind them.
- Characterize the revenue direction only (revenue-positive, revenue-neutral or revenue-compressing); give no dollar projections.
- Do not cite complaint volumes, attrition, migration patterns or regulatory actions: that data is not supplied here.
- Never say whether to make the change. Describe what this price would mean and the question it puts to management.`;

  const institutionLine = institution
    ? `Institution: ${institution.institution_name} (${institution.charter_type === "credit_union" ? "credit union" : "bank"}${institution.asset_size_tier ? `, ${institution.asset_size_tier}` : ""})`
    : "";

  const userPrompt = `${institutionLine}

Fee category: ${displayCategory}
Current fee: $${currentFee.toFixed(2)}
Proposed fee: $${proposedFee.toFixed(2)} (${direction} by $${changeDollars})

Peer group: ${peerLabel}
Peer distribution (${institutionCount} institutions):
- P25: $${p25_amount?.toFixed(2) ?? "N/A"}
- Median: $${median_amount?.toFixed(2) ?? "N/A"}
- P75: $${p75_amount?.toFixed(2) ?? "N/A"}

What would this price mean competitively, and what question does it put to management?`.trim();

  const providerContext = {
    provider: "anthropic" as const,
    model: HAMILTON_MODEL,
    agent: "hamilton",
    operation: "simulate_fee_change",
    routeId: "api.hamilton.simulate",
    userId: user.id,
    subjectKey: getRequestSubjectKey(request),
  };
  let providerStartedAt: number;
  try {
    providerStartedAt = await guardProviderCall(providerContext);
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Automation is stopped",
      { status: 423 },
    );
  }

  let providerFailed = false;
  const result = await streamText({
    model: getAnthropicLanguageModel(HAMILTON_MODEL, "hamilton"),
    system: systemPrompt,
    prompt: userPrompt,
    // Opus 5.5 always thinks first; thinking counts toward this cap.
    maxOutputTokens: 4000,
    onFinish: async ({ totalUsage }) => {
      const inputTokens = totalUsage?.inputTokens ?? 0;
      const outputTokens = totalUsage?.outputTokens ?? 0;
      const costCents = Math.round(
        (estimateAnthropicCostMicrousd(HAMILTON_MODEL, { inputTokens, outputTokens }) ?? 0) / 10_000,
      );
      if (!providerFailed) {
        await recordProviderUsage(
          providerContext,
          "completed",
          { inputTokens, outputTokens },
          { latencyMs: Date.now() - providerStartedAt },
        );
      }
      logUsage(user.id, null, "hamilton-simulate", inputTokens, outputTokens, costCents).catch(
        () => {}
      );
      await recordProRequest({
        operation: "simulate_interpretation",
        title: `Hamilton simulate: ${feeCategory}`,
        status: providerFailed ? "failed" : "completed",
        summary: `Interpreted a ${feeCategory} change from $${currentFee.toFixed(2)} to $${proposedFee.toFixed(2)}.`,
        userId: user.id,
        institutionId,
        detail: { model: HAMILTON_MODEL, input_tokens: inputTokens, output_tokens: outputTokens, cost_cents: costCents },
      });
    },
    onError: async ({ error }) => {
      providerFailed = true;
      await recordProRequest({
        operation: "simulate_interpretation",
        title: `Hamilton simulate: ${feeCategory}`,
        status: "failed",
        summary: `Interpretation failed: ${error instanceof Error ? error.message : String(error)}`,
        userId: user.id,
        institutionId,
      });
      await recordProviderUsage(providerContext, "failed", {}, {
        latencyMs: Date.now() - providerStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return result.toTextStreamResponse();
}

export const POST = withApiRoutePolicy("api.hamilton.simulate", "POST", handlePOST);
