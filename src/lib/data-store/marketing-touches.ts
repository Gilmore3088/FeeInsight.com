/**
 * Tracked-link visits (marketing_touches) and each lead's first tracked source
 * (leads.first_utm_*). No personal data is stored: see src/lib/marketing-touch.ts.
 */

import type { MarketingTouch } from "@/lib/marketing-touch";
import { sql } from "./connection";

/** Stores one tracked-link visit. */
export async function insertMarketingTouch(touch: MarketingTouch): Promise<void> {
  await sql`
    INSERT INTO marketing_touches
      (utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, referrer_host)
    VALUES (
      ${touch.utm_source}, ${touch.utm_medium}, ${touch.utm_campaign}, ${touch.utm_content},
      ${touch.utm_term}, ${touch.landing_path}, ${touch.referrer_host}
    )`;
}

/**
 * Saves a lead's first tracked source. First touch wins: the row is written only while it
 * has no tracked source yet, and all five values come from one touch (never mixed).
 * Returns true when the lead took this touch.
 */
export async function recordLeadFirstTouch(leadId: number, touch: MarketingTouch): Promise<boolean> {
  const rows = await sql<{ id: number | string }[]>`
    UPDATE leads SET
      first_utm_source = ${touch.utm_source},
      first_utm_medium = ${touch.utm_medium},
      first_utm_campaign = ${touch.utm_campaign},
      first_utm_content = ${touch.utm_content},
      first_landing_path = ${touch.landing_path}
    WHERE id = ${leadId}
      AND first_utm_source IS NULL
      AND first_utm_medium IS NULL
      AND first_utm_campaign IS NULL
      AND first_utm_content IS NULL
      AND first_landing_path IS NULL
    RETURNING id`;
  return rows.length > 0;
}
