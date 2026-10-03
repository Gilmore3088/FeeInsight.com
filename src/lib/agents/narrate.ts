import type { AdminAgent } from "./types";

/**
 * Turns run-ledger events into one plain-English sentence each, for the crew
 * activity log and the Atlas daily brief. Deterministic: no model, no cost.
 * Templates read the numbers each step already records in `agent_run_events.detail`.
 */

type Detail = Record<string, unknown>;

function n(detail: Detail, key: string): number {
  const value = Number(detail[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? singular : plural}`;
}

/** "in Georgia"-style scope, falling back to "across all states". */
function where(stateCode: string | null | undefined): string {
  return stateCode ? `in ${stateCode}` : "across all states";
}

function joinParts(parts: Array<string | null | false>): string {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length > 0 ? `: ${kept.join(", ")}` : "";
}

/** One sentence for a finished step, from the step key and its recorded detail. */
export function narrateStepFinished(
  stepKey: string,
  detail: Detail,
  stateCode?: string | null,
): string | null {
  const scope = where(stateCode);
  switch (stepKey) {
    case "enhance":
      return `Checked institution records ${scope}: ${count(n(detail, "total_institutions"), "institution")}, ${count(n(detail, "backlog_missing_urls"), "missing fee URL")}.`;
    case "discover":
    case "rescue": {
      const processed = n(detail, "processed_institutions");
      if (processed === 0) return `Looked for missing fee schedules ${scope}; none were due.`;
      return `Searched ${count(processed, "website")} ${scope} and found ${count(n(detail, "discovered_fee_urls"), "fee schedule")}${joinParts([
        n(detail, "retry_after") > 0 && `${n(detail, "retry_after")} to retry later`,
        n(detail, "dead_institutions") > 0 && `${n(detail, "dead_institutions")} with no schedule found`,
        n(detail, "needs_human") > 0 && `${n(detail, "needs_human")} need a person`,
      ])}.`;
    }
    case "fetch": {
      const processed = n(detail, "processed_institutions");
      if (processed === 0) return `Checked fee schedules ${scope}; none were due for a refresh.`;
      if (n(detail, "unchanged_documents") > 0) {
        return `Checked ${count(processed, "fee schedule")} ${scope}: ${n(detail, "fetched_documents").toLocaleString("en-US")} new, ${n(detail, "unchanged_documents").toLocaleString("en-US")} unchanged${joinParts([
          n(detail, "failed_fetches") > 0 && `${n(detail, "failed_fetches")} failed`,
          n(detail, "skipped_fetches") > 0 && `${n(detail, "skipped_fetches")} skipped`,
          n(detail, "stored_documents") > 0 && `${n(detail, "stored_documents")} saved to the vault`,
        ]).replace(/^: /, ", ")}.`;
      }
      return `Downloaded ${count(n(detail, "fetched_documents"), "fee schedule")} ${scope}${joinParts([
        n(detail, "failed_fetches") > 0 && `${n(detail, "failed_fetches")} failed`,
        n(detail, "skipped_fetches") > 0 && `${n(detail, "skipped_fetches")} skipped`,
        n(detail, "stored_documents") > 0 && `${n(detail, "stored_documents")} saved to the vault`,
      ])}.`;
    }
    case "read": {
      const processed = n(detail, "processed_documents");
      if (processed === 0) {
        return n(detail, "wrong_documents") > 0
          ? `Re-checked earlier pages ${scope}: ${count(n(detail, "wrong_documents"), "page")} not a fee schedule${n(detail, "sent_back_to_magellan") > 0 ? `, ${n(detail, "sent_back_to_magellan")} sent back to Magellan` : ""}.`
          : `Had no new documents to read ${scope}.`;
      }
      return `Read ${count(n(detail, "text_artifacts"), "document")} ${scope}${joinParts([
        n(detail, "needs_ocr") > 0 && `${n(detail, "needs_ocr")} are scans that need OCR`,
        n(detail, "failed_reads") > 0 && `${n(detail, "failed_reads")} failed`,
        n(detail, "empty_documents") > 0 && `${n(detail, "empty_documents")} were empty`,
        n(detail, "skipped_known_failures") > 0 && `${n(detail, "skipped_known_failures")} skipped (failed before, unchanged since)`,
        n(detail, "wrong_documents") > 0 && `${n(detail, "wrong_documents")} were not fee pages`,
        n(detail, "sent_back_to_magellan") > 0 && `${n(detail, "sent_back_to_magellan")} sent back to Magellan to find the real fee page`,
        n(detail, "read_from_vault") > 0 && `${n(detail, "read_from_vault")} read from our stored copy`,
      ])}.`;
    }
    case "extract": {
      const processed = n(detail, "processed_text_artifacts");
      if (processed === 0) return `Had no new documents to pull fees from ${scope}.`;
      return `Pulled ${count(n(detail, "inserted_raw_fee_observations"), "fee")} from ${count(processed, "document")} ${scope}${joinParts([
        n(detail, "skipped_fee_candidates") > 0 && `${n(detail, "skipped_fee_candidates")} lines set aside`,
        n(detail, "skipped_known_inputs") > 0 && `${n(detail, "skipped_known_inputs")} documents already done`,
      ])}.`;
    }
    case "classify":
    case "verify": {
      const processed = n(detail, "processed_raw_fees");
      if (processed === 0) return `Had no new fees to check ${scope}.`;
      return `Verified ${count(n(detail, "verified_fee_observations"), "fee")} of ${processed.toLocaleString("en-US")} checked ${scope}${joinParts([
        n(detail, "skipped_raw_fees") > 0 && `${n(detail, "skipped_raw_fees")} held for review`,
      ])}.`;
    }
    case "publish":
    case "publish-index":
    case "publish-context": {
      const processed = n(detail, "processed_verified_fees");
      if (processed === 0) return `Had nothing new to publish ${scope}.`;
      return `Published ${count(n(detail, "published_fees"), "fee")} ${scope}${joinParts([
        n(detail, "skipped_verified_fees") > 0 && `${n(detail, "skipped_verified_fees")} already published or not eligible`,
      ])}.`;
    }
    case "public-discovery":
    case "public-audit":
      return `Checked ${count(n(detail, "processed_routes"), "Fee Insight page")} ${scope}; ${count(n(detail, "public_findings"), "issue")} found.`;
    case "public-cluster":
    case "public-diagnose":
      return null;
    case "daily-brief":
      return detail.delivery_status === "sent"
        ? "Sent the daily brief."
        : `Wrote the daily brief but did not email it (${String(detail.delivery_status ?? "unknown")}).`;
    default:
      return null;
  }
}

export interface NarratableEvent {
  eventType: string;
  status: string;
  message: string;
  detail: Detail;
  stepKey: string | null;
  stateCode: string | null;
}

/**
 * A sentence for any ledger event worth showing a person, or null for noise
 * (step started, run bookkeeping that the step lines already cover).
 */
export function narrateEvent(event: NarratableEvent): string | null {
  switch (event.eventType) {
    case "step.finished":
      return event.stepKey ? narrateStepFinished(event.stepKey, event.detail, event.stateCode) : null;
    case "step.failed":
      return `Stopped with an error${event.stepKey ? ` while working on "${event.stepKey}"` : ""}: ${shorten(event.message)}`;
    case "step.reaped":
      return "A step got stuck, so it was restarted.";
    case "step.dead":
      return "A step got stuck three times and was stopped. It needs a look.";
    case "run.blocked":
      return `Couldn't start: ${shorten(event.message)}`;
    case "run.completed":
      return event.stateCode ? `Finished the ${event.stateCode} run.` : "Finished the run.";
    default:
      return null;
  }
}

function shorten(message: string, max = 140): string {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Which crew member a step key belongs to, for steps recorded without an agent. */
export const STEP_OWNER: Record<string, AdminAgent> = {
  enhance: "atlas",
  "daily-brief": "atlas",
  discover: "magellan",
  rescue: "magellan",
  fetch: "magellan",
  "public-discovery": "magellan",
  "public-audit": "magellan",
  read: "rosetta",
  extract: "knox",
  review: "knox",
  classify: "darwin",
  verify: "darwin",
  "public-cluster": "darwin",
  publish: "hamilton",
  "publish-index": "hamilton",
  "publish-context": "hamilton",
  "public-diagnose": "hamilton",
};
