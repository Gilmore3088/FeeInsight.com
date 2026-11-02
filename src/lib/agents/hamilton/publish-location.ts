import type { sql } from "@/lib/data-store/connection";
import { FEE_SOURCE_LOCATION_MAX_IDS, getFeeSourceLocations, type FeeSourceLocationResult } from "@/lib/data-store/source-line-traces";
import { inSavepoint } from "@/lib/agents/savepoint";
import { SOURCE_LOCATION_VERSION, type SourceLocationMiss } from "@/lib/source-location";

type SqlTag = typeof sql;

/**
 * Where each fee a publish step just put live is printed in the bank's fee schedule (Nov 2 2026 pipeline
 * wiring audit: publish required no trace, and Hamilton cited no line). Found with the same
 * deterministic locator Hamilton's citations use (`source-location.ts`) and recorded on the run
 * ledger as one `hamilton.publish_location` event per step: the page and line each fee was found at,
 * in which stored text (id and SHA-256), and why the others were not found. No column holds a fee's
 * location yet, so the event is the record; Hamilton's citations find it again on read.
 *
 * Moves no fee: a fee whose line is not found still publishes and is only counted, so a citation
 * of it names no line. Never fails the publish: a read or write error is reported in the result,
 * and a failed read is still recorded as a failed event, so the ledger shows the step was tried.
 * Keeps the publish step's deadline: once it passes, no further document is read, and the fees
 * left are counted as not checked (their citations still find them on read).
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
  /** Published fees not looked up because the step's deadline passed. */
  notChecked: number;
  error?: string;
}

/** The step's counts from each fee's result. Pure. */
export function summarizePublishLocations(results: ReadonlyMap<number, FeeSourceLocationResult>, published: number, outOfTime = false): PublishLocationCheck {
  const check: PublishLocationCheck = { version: SOURCE_LOCATION_VERSION, checked: results.size, located: 0, withPage: 0, misses: {}, notChecked: 0 };
  for (const result of results.values()) {
    if (result.location) {
      check.located += 1;
      if (result.location.page !== null) check.withPage += 1;
    } else {
      check.misses[result.miss] = (check.misses[result.miss] ?? 0) + 1;
    }
  }
  // A published id with no result: out of time, or not live (taken down in the same step).
  const unread = published - results.size;
  if (unread > 0) {
    if (outOfTime) check.notChecked = unread;
    else {
      check.checked += unread;
      check.misses.not_found = (check.misses.not_found ?? 0) + unread;
    }
  }
  return check;
}

/** The step's message on the run ledger. */
export function publishLocationMessage(check: PublishLocationCheck): string {
  const misses = Object.entries(check.misses).map(([miss, count]) => `${count} ${miss.replace(/_/g, " ")}`).join(", ");
  return `Source location: ${check.located} of ${check.checked} published fee(s) found in the bank's fee schedule (${check.withPage} with a page)${misses ? `; not found: ${misses}` : ""}${check.notChecked ? `; ${check.notChecked} not checked, the step's deadline passed` : ""}.`;
}

export async function recordPublishLocations(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; feePublishedIds: number[]; deadlineAt?: number; now?: () => number },
): Promise<PublishLocationCheck | null> {
  const ids = [...new Set(options.feePublishedIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return null;
  const now = options.now ?? Date.now;
  const timeLeft = () => options.deadlineAt == null || now() < options.deadlineAt;
  const results = new Map<number, FeeSourceLocationResult>();
  let outOfTime = false;
  try {
    for (let i = 0; i < ids.length; i += FEE_SOURCE_LOCATION_MAX_IDS) {
      if (!timeLeft()) break;
      const chunk = ids.slice(i, i + FEE_SOURCE_LOCATION_MAX_IDS);
      const found = await inSavepoint(db, (scope) => getFeeSourceLocations(chunk, scope, { deadlineAt: options.deadlineAt, now }));
      for (const [id, result] of found) results.set(id, result);
    }
    outOfTime = !timeLeft();
  } catch (error) {
    const failed: PublishLocationCheck = { version: SOURCE_LOCATION_VERSION, checked: 0, located: 0, withPage: 0, misses: {}, notChecked: ids.length, error: error instanceof Error ? error.message : String(error) };
    await writeEvent(db, options, "failed", `Source location: read failed, ${ids.length} published fee(s) not checked: ${failed.error}`, failed, []).catch(() => undefined);
    return failed;
  }
  const check = summarizePublishLocations(results, ids.length, outOfTime);
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
  await writeEvent(db, options, "completed", publishLocationMessage(check), check, rows).catch((error: unknown) => {
    check.error = error instanceof Error ? error.message : String(error);
  });
  return check;
}

/** The step's one `hamilton.publish_location` event, in its own savepoint. */
function writeEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  status: "completed" | "failed",
  message: string,
  check: PublishLocationCheck,
  rows: unknown[],
) {
  return inSavepoint(db, (scope) => scope`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (
      ${options.runId}, ${options.stepId ?? null}, ${PUBLISH_LOCATION_EVENT}, ${status},
      ${message},
      ${JSON.stringify({ ...check, fees: rows })}::jsonb
    )
  `);
}
