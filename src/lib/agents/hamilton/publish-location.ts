import type { sql } from "@/lib/data-store/connection";
import { FEE_SOURCE_LOCATION_MAX_IDS, getFeeSourceLocations, type FeeSourceLocationResult } from "@/lib/data-store/source-line-traces";
import { inSavepoint } from "@/lib/agents/savepoint";
import { SOURCE_LOCATION_VERSION, type SourceLocationMiss } from "@/lib/source-location";

type SqlTag = typeof sql;

/**
 * Where each fee a publish step just put live is printed in its stored schedule (Nov 2 2026 pipeline
 * wiring audit: publish required no trace, and Hamilton cited no line). Found with the same
 * deterministic locator Hamilton's citations use (`source-location.ts`) and recorded on the run
 * ledger as one `hamilton.publish_location` event per step: the page and line each fee was found at,
 * in which stored text (id and SHA-256), and why the others were not found. No column holds a fee's
 * location yet, so the event is the record; Hamilton's citations find it again on read.
 *
 * Moves no fee: a fee whose line is not found still publishes and is only counted, so a citation
 * of it names no line. Never fails the publish: a read or write error is reported in the result.
 */

export const PUBLISH_LOCATION_EVENT = "hamilton.publish_location";
/** Fees listed one by one in the event (the counts cover every fee). */
export const PUBLISH_LOCATION_EVENT_ROWS = 500;

export interface PublishLocationCheck {
  version: typeof SOURCE_LOCATION_VERSION;
  checked: number;
  located: number;
  withPage: number;
  misses: Partial<Record<SourceLocationMiss, number>>;
  error?: string;
}

/** The step's counts from each fee's result. Pure. */
export function summarizePublishLocations(results: ReadonlyMap<number, FeeSourceLocationResult>, checked: number): PublishLocationCheck {
  const check: PublishLocationCheck = { version: SOURCE_LOCATION_VERSION, checked, located: 0, withPage: 0, misses: {} };
  for (const result of results.values()) {
    if (result.location) {
      check.located += 1;
      if (result.location.page !== null) check.withPage += 1;
    } else {
      check.misses[result.miss] = (check.misses[result.miss] ?? 0) + 1;
    }
  }
  // A published id the catalog did not return (taken down in the same step) counts as not found.
  const unread = checked - results.size;
  if (unread > 0) check.misses.not_found = (check.misses.not_found ?? 0) + unread;
  return check;
}

/** The step's message on the run ledger. */
export function publishLocationMessage(check: PublishLocationCheck): string {
  const misses = Object.entries(check.misses).map(([miss, count]) => `${count} ${miss.replace(/_/g, " ")}`).join(", ");
  return `Source location: ${check.located} of ${check.checked} published fee(s) found in their stored schedule (${check.withPage} with a page)${misses ? `; not found: ${misses}` : ""}.`;
}

export async function recordPublishLocations(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; feePublishedIds: number[] },
): Promise<PublishLocationCheck | null> {
  const ids = [...new Set(options.feePublishedIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return null;
  const results = new Map<number, FeeSourceLocationResult>();
  try {
    for (let i = 0; i < ids.length; i += FEE_SOURCE_LOCATION_MAX_IDS) {
      const chunk = ids.slice(i, i + FEE_SOURCE_LOCATION_MAX_IDS);
      for (const [id, result] of await inSavepoint(db, (scope) => getFeeSourceLocations(chunk, scope))) results.set(id, result);
    }
  } catch (error) {
    return { version: SOURCE_LOCATION_VERSION, checked: ids.length, located: 0, withPage: 0, misses: {}, error: error instanceof Error ? error.message : String(error) };
  }
  const check = summarizePublishLocations(results, ids.length);
  const rows = [...results.entries()].slice(0, PUBLISH_LOCATION_EVENT_ROWS).map(([id, result]) => result.location
    ? {
      fee_published_id: id,
      text_id: result.location.textId,
      text_sha256: result.location.textSha256,
      char_start: result.location.charStart,
      char_end: result.location.charEnd,
      page: result.location.page,
      page_line: result.location.pageLine,
      text_line: result.location.textLine,
      basis: result.location.basis,
    }
    : { fee_published_id: id, miss: result.miss });
  await inSavepoint(db, (scope) => scope`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (
      ${options.runId}, ${options.stepId ?? null}, ${PUBLISH_LOCATION_EVENT}, 'completed',
      ${publishLocationMessage(check)},
      ${JSON.stringify({ ...check, fees: rows })}::jsonb
    )
  `).catch((error: unknown) => {
    check.error = error instanceof Error ? error.message : String(error);
  });
  return check;
}
