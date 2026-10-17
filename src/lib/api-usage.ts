import { sql } from "@/lib/data-store/connection";

/** Postgres "undefined_column": usage_events has no api_key_id until its migration runs. */
const UNDEFINED_COLUMN = "42703";

function isUndefinedColumn(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === UNDEFINED_COLUMN;
}

/**
 * Records one API call in usage_events. `keyId` is the issued api_keys row that made the call
 * (null for a signed-in site session or an anonymous caller), so usage can be split per key.
 */
export async function logApiUsage(
  organizationId: number | null,
  anonymousId: string | null,
  eventType: string,
  metadata?: object,
  keyId?: number | null,
): Promise<void> {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  try {
    if (keyId != null) {
      try {
        await sql`
          INSERT INTO usage_events (organization_id, anonymous_id, event_type, metadata, api_key_id)
          VALUES (${organizationId}, ${anonymousId}, ${eventType}, ${metadataJson}, ${keyId})
        `;
        return;
      } catch (err) {
        // Before the api_key_id migration runs, still record the call without the key.
        if (!isUndefinedColumn(err)) throw err;
      }
    }
    await sql`
      INSERT INTO usage_events (organization_id, anonymous_id, event_type, metadata)
      VALUES (
        ${organizationId},
        ${anonymousId},
        ${eventType},
        ${metadataJson}
      )
    `;
  } catch (err) {
    // Log but don't throw — usage metering should never break the API
    console.error("Failed to log API usage:", err);
  }
}
