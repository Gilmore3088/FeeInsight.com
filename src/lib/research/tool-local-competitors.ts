/**
 * Local competitors for an institution: the institutions with branches in the counties that hold
 * most of its deposits (FDIC Summary of Deposits), with their verified published fee amounts
 * beside its own. Read-only. Shared by Hamilton's chat (hamilton-agent.ts) and its written
 * answer (research/agents.ts, #1084).
 */
import { tool } from "ai";
import { z } from "zod";
import { getInstitutionById } from "@/lib/data-store";
import { getInstitutionOwnFees } from "@/lib/data-store/fee-index";
import { competitorAmountBasis, getLocalMarketCompetitors } from "@/lib/data-store/local-market";
import { selectMarketStated } from "@/lib/hamilton/local-market-request";
import { severalFeesOf, type SeveralFees } from "@/lib/own-fee";

/**
 * The institution's own fees read the way every other Hamilton answer reads them
 * (getInstitutionOwnFees, the competitors' row filter): each stated price, and a category it
 * states several different fees in as their range and names, never whichever row came first (#1994).
 */
const toCents = (amount: number) => Math.round(amount * 100) / 100;

/** The several-fees span in cents, as your_fees is, so the two read alike. */
function severalInCents(span: SeveralFees): SeveralFees {
  return {
    low: toCents(span.low),
    high: toCents(span.high),
    fees: span.fees.map((line) => ({ ...line, amount: toCents(line.amount) })),
  };
}

async function subjectFees(institutionId: number): Promise<{ fees: Record<string, number>; several: Record<string, SeveralFees> }> {
  const fees: Record<string, number> = {};
  const several: Record<string, SeveralFees> = {};
  for (const [category, fee] of await getInstitutionOwnFees(institutionId)) {
    if (fee.price !== null) fees[category] = toCents(fee.price);
    const span = severalFeesOf(fee);
    if (span) several[category] = severalInCents(span);
  }
  return { fees, several };
}

export const getLocalCompetitors = tool({
  description:
    "Name an institution's local competitors (institutions with branches in the counties holding most of its deposits, from the FDIC Summary of Deposits) with their published fee amounts beside the institution's own: your_fees holds its stated prices and your_several_fees a category it states several different amounts for (their range and each fee by name). For competitors, fees holds each stated price, and a fee a competitor states several different amounts for is in several_fees (their range and each fee by name), not in fees. Each competitor carries its institution_id, and fee_basis says how each amount in its fees was computed from its published rows: \"max\" (the highest overdraft tier) or \"median\". These are aggregates, not single fee records. Use it whenever the user asks how an institution compares locally, in its county or market, or against named competitors.",
  inputSchema: z.object({
    institution_id: z.number().int().positive().describe("The institution's id"),
  }),
  execute: async ({ institution_id }) => {
    const institution = await getInstitutionById(institution_id);
    if (!institution) return { error: "Institution not found." };
    const own = await subjectFees(institution_id);
    const yourFees = {
      your_fees: own.fees,
      ...(Object.keys(own.several).length > 0 ? { your_several_fees: own.several } : {}),
    };
    const market = await getLocalMarketCompetitors({
      institutionId: institution_id,
      certNumber: institution.cert_number,
      city: institution.city,
      stateCode: institution.state_code,
      categories: [...Object.keys(own.fees), ...Object.keys(own.several)],
    });
    if (!market) {
      return { institution: institution.institution_name, institution_id, ...yourFees, message: "No local market could be located for this institution." };
    }
    return {
      // Ids as well as names, so the written answer's binding knows whose fee a sentence states (#1077).
      institution: institution.institution_name,
      institution_id,
      ...yourFees,
      market: market.label,
      market_basis: market.basis,
      county_fips: market.county_fips,
      sod_year: market.sod_year,
      source: `FDIC Summary of Deposits ${market.sod_year}; verified published fee amounts`,
      // fees: each stated price. several_fees: a fee the competitor states several different
      // amounts for, as its range and each fee by name; their median is no price of its own (#1931).
      competitors: market.competitors.map((c) => {
        const stated = selectMarketStated(c.fees, c.several, Object.keys(c.fees));
        return {
          institution_id: c.institution_id,
          name: c.institution_name.replace(/\s+/g, " ").trim(),
          fees: stated.fees,
          // Each amount is the highest overdraft tier or a median of the competitor's rows, never one fee record.
          fee_basis: Object.fromEntries(Object.keys(stated.fees).map((category) => [category, competitorAmountBasis(category)])),
          ...(Object.keys(stated.several).length > 0 ? { several_fees: stated.several } : {}),
          document_url: c.document_url,
          document_date: c.document_date,
        };
      }),
    };
  },
});
