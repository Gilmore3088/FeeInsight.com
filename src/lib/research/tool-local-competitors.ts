/**
 * Local competitors for an institution: the institutions with branches in the counties that hold
 * most of its deposits (FDIC Summary of Deposits), with their verified published fee amounts
 * beside its own. Read-only. Shared by Hamilton's chat (hamilton-agent.ts) and its written
 * answer (research/agents.ts, #1084).
 */
import { tool } from "ai";
import { z } from "zod";
import { getFeesByInstitution, getInstitutionById } from "@/lib/data-store";
import { getLocalMarketCompetitors } from "@/lib/data-store/local-market";
import { selectMarketStated } from "@/lib/hamilton/local-market-request";
import { isSpecialUnitFrequency } from "@/lib/fee-unit";

export const getLocalCompetitors = tool({
  description:
    "Name an institution's local competitors (institutions with branches in the counties holding most of its deposits, from the FDIC Summary of Deposits) with their published fee amounts beside the institution's own: fees holds each stated price, and a fee a competitor states several different amounts for is in several_fees (their range and each fee by name), not in fees. Use it whenever the user asks how an institution compares locally, in its county or market, or against named competitors.",
  inputSchema: z.object({
    institution_id: z.number().int().positive().describe("The institution's id"),
  }),
  execute: async ({ institution_id }) => {
    const institution = await getInstitutionById(institution_id);
    if (!institution) return { error: "Institution not found." };
    const own = (await getFeesByInstitution(institution_id)).filter(
      (fee) => fee.review_status === "approved" && fee.fee_category && fee.amount !== null && !isSpecialUnitFrequency(fee.frequency),
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
      // fees: each stated price. several_fees: a fee the competitor states several different
      // amounts for, as its range and each fee by name; their median is no price of its own (#1931).
      competitors: market.competitors.map((c) => {
        const stated = selectMarketStated(c.fees, c.several, Object.keys(c.fees));
        return {
          name: c.institution_name.replace(/\s+/g, " ").trim(),
          fees: stated.fees,
          ...(Object.keys(stated.several).length > 0 ? { several_fees: stated.several } : {}),
        };
      }),
    };
  },
});
