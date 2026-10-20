import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { buildNetworkMentions, type NetworkFeeRow, type NetworkMentions } from "@/lib/guides/atm-networks";

/** A consumer guide never shows a schedule line named for business or commercial accounts. */
const CONSUMER_LINE = String.raw`ef.fee_name !~* '\m(commercial|business|corporate)\M'`;

/**
 * Out-of-network ATM lines whose own words name Allpoint, MoneyPass or CO-OP, with the
 * institution and the source. Same audience and source boundary as the guide's medians
 * (STATS_ROW_FILTER: sourced, consumer/both/unknown audience, no business-only schedule).
 * The SQL narrows to lines that mention any of the three; the exact matching is
 * `buildNetworkMentions`, so the page and its tests share one matcher.
 */
export async function getAtmNetworkMentions(): Promise<NetworkMentions[]> {
  const rows = (await sql`
    SELECT ef.institution_id, i.institution_name, i.state_code, ef.fee_name, ef.amount,
           ef.conditions, ef.waiver_text,
           COALESCE(ef.document_url, ef.source_url) AS document_url
    FROM published_fee_catalog ef
    JOIN institution_sources i ON i.id = ef.institution_id
    WHERE ef.fee_category = 'atm_non_network' AND ef.review_status = 'approved'
      AND ef.amount IS NOT NULL AND ef.amount >= 0
      AND ${sql.unsafe(STATS_ROW_FILTER)}
      AND ${sql.unsafe(CONSUMER_LINE)}
      AND concat_ws(' ', ef.fee_name, ef.conditions, ef.waiver_text) ~* '(allpoint|money ?pass|co-?op)'
  `) as NetworkFeeRow[];
  return buildNetworkMentions(
    rows.map((r) => ({ ...r, institution_name: institutionDisplayName(r.institution_name) })),
  );
}
