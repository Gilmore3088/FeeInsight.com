import { getAccountLineups } from "@/lib/data-store/account-lineup";
import { getLocalMarketMembers } from "@/lib/data-store/custom-report-market";
import { buildCheckingLineup, type CheckingLineupView, type LineupPeer } from "./checking-lineup";

/**
 * The checking account lineup for the market report and Pro My fees: the institution's
 * consumer checking accounts against its local competitors', read live from
 * published_fee_catalog. Read-only. Null when the read fails, so the rest of the page stands.
 */
export async function loadCheckingLineup(institutionId: number, peers: LineupPeer[]): Promise<CheckingLineupView | null> {
  try {
    const accounts = await getAccountLineups([institutionId, ...peers.map((peer) => peer.institutionId)]);
    return buildCheckingLineup(institutionId, peers, accounts);
  } catch (error) {
    console.error("[checking-lineup] read failed", {
      institutionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The lineup against the institution's local market, by the report's own market definition. */
export async function loadMarketCheckingLineup(institutionId: number): Promise<CheckingLineupView | null> {
  try {
    const market = await getLocalMarketMembers(institutionId);
    if (!market) return null;
    const peers = market.members
      .filter((member) => !member.is_subject)
      .map((member) => ({ institutionId: member.institution_id, name: member.institution_name }));
    return await loadCheckingLineup(institutionId, peers);
  } catch (error) {
    console.error("[checking-lineup] market read failed", {
      institutionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
