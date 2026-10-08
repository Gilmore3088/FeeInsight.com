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

/** A 0..1 rate as "93.5%", or "n/a" when there is nothing to divide. */
function percentOf(value: unknown): string {
  if (value == null || value === "") return "n/a";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${(parsed * 100).toFixed(1)}%` : "n/a";
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
    case "state-expert": {
      if (typeof detail.expert_name !== "string") return `State expert had nothing to refresh ${scope}.`;
      return `${detail.expert_name} refreshed the ${String(detail.state_code ?? stateCode ?? "state")} memory: ${count(n(detail, "institutions"), "institution")}, ${count(n(detail, "published_fees"), "published fee")}, peer levels for ${count(n(detail, "fee_categories_with_peers"), "fee category", "fee categories")}${joinParts([
        typeof detail.top_platform === "string" && `most common platform ${detail.top_platform}`,
        typeof detail.top_reader_strategy === "string" && `best reader ${detail.top_reader_strategy}`,
      ]).replace(/^: /, ", ")}.`;
    }
    case "discover-paid":
    case "read-paid":
    case "extract-paid":
    case "verify-paid": {
      const job = stepKey === "discover-paid"
        ? "find fee schedules"
        : stepKey === "read-paid"
          ? "read documents"
          : stepKey === "extract-paid" ? "extract fees" : "review disputed fees";
      const processed = n(detail, "processed");
      const dollars = (n(detail, "cost_microusd") / 1_000_000).toFixed(2);
      if (detail.budget_stopped === true && processed === 0) return `Paid pass to ${job} ${scope} did not run: ${String(detail.budget_reason ?? "budget cap")}.`;
      if (processed === 0) return `Paid pass to ${job} ${scope}: nothing the free passes left.`;
      return `Paid pass to ${job} ${scope}: ${n(detail, "succeeded")} of ${processed} succeeded for $${dollars}${detail.budget_stopped === true ? ", stopped at the budget cap" : ""}.`;
    }
    case "discover":
    case "rescue": {
      const processed = n(detail, "processed_institutions");
      if (processed === 0) return `Looked for missing fee schedules ${scope}; none were due.`;
      return `Searched ${count(processed, "website")} ${scope} and found ${count(n(detail, "discovered_fee_urls"), "fee schedule")}${joinParts([
        n(detail, "retry_after") > 0 && `${n(detail, "retry_after")} to retry later`,
        n(detail, "dead_institutions") > 0 && `${n(detail, "dead_institutions")} with no schedule found`,
        n(detail, "needs_human") > 0 && `${n(detail, "needs_human")} need a person`,
        n(detail, "second_documents_found") > 0 && `${count(n(detail, "second_documents_found"), "more fee page")} (account pages, fee documents, agreements) for banks with few fees`,
      ])}.`;
    }
    case "fetch": {
      const processed = n(detail, "processed_institutions");
      const companions = n(detail, "companion_pages_fetched") + n(detail, "companion_pages_unchanged");
      const companionNote = companions > 0 ? ` Also checked ${count(companions, "account page or fee document")}, ${n(detail, "companion_pages_fetched")} new.` : "";
      if (processed === 0) return `Checked fee schedules ${scope}; none were due for a refresh.${companionNote}`;
      if (n(detail, "unchanged_documents") > 0) {
        return `Checked ${count(processed, "fee schedule")} ${scope}: ${n(detail, "fetched_documents").toLocaleString("en-US")} new, ${n(detail, "unchanged_documents").toLocaleString("en-US")} unchanged${joinParts([
          n(detail, "failed_fetches") > 0 && `${n(detail, "failed_fetches")} failed`,
          n(detail, "skipped_fetches") > 0 && `${n(detail, "skipped_fetches")} skipped`,
          n(detail, "stored_documents") > 0 && `${n(detail, "stored_documents")} saved to the vault`,
        ]).replace(/^: /, ", ")}.${companionNote}`;
      }
      return `Downloaded ${count(n(detail, "fetched_documents"), "fee schedule")} ${scope}${joinParts([
        n(detail, "failed_fetches") > 0 && `${n(detail, "failed_fetches")} failed`,
        n(detail, "skipped_fetches") > 0 && `${n(detail, "skipped_fetches")} skipped`,
        n(detail, "stored_documents") > 0 && `${n(detail, "stored_documents")} saved to the vault`,
      ])}.${companionNote}`;
    }
    case "read": {
      const processed = n(detail, "processed_documents");
      if (processed === 0) {
        const formatsNote = n(detail, "formats_backfilled") > 0
          ? ` Noted the document type for ${count(n(detail, "formats_backfilled"), "institution")} read earlier.`
          : "";
        return n(detail, "wrong_documents") > 0
          ? `Re-checked earlier pages ${scope}: ${count(n(detail, "wrong_documents"), "page")} not a fee schedule${n(detail, "sent_back_to_magellan") > 0 ? `, ${n(detail, "sent_back_to_magellan")} sent back to Magellan` : ""}.${formatsNote}`
          : `Had no new documents to read ${scope}.${formatsNote}`;
      }
      return `Read ${count(n(detail, "text_artifacts"), "document")} ${scope}${joinParts([
        n(detail, "ocr_read") > 0 && `${n(detail, "ocr_read")} scans read with free OCR`,
        n(detail, "js_fallback_read") > 0 && `${n(detail, "js_fallback_read")} JavaScript pages read from their data or PDF version`,
        n(detail, "needs_ocr") > 0 && `${n(detail, "needs_ocr")} are scans that need OCR`,
        n(detail, "handed_to_magellan") > 0 && `${n(detail, "handed_to_magellan")} JavaScript-only pages handed to Magellan`,
        n(detail, "failed_reads") > 0 && `${n(detail, "failed_reads")} failed`,
        n(detail, "empty_documents") > 0 && `${n(detail, "empty_documents")} were empty`,
        n(detail, "skipped_known_failures") > 0 && `${n(detail, "skipped_known_failures")} skipped (failed before, unchanged since)`,
        n(detail, "wrong_documents") > 0 && `${n(detail, "wrong_documents")} were not fee pages`,
        n(detail, "sent_back_to_magellan") > 0 && `${n(detail, "sent_back_to_magellan")} sent back to Magellan to find the real fee page`,
        n(detail, "read_from_vault") > 0 && `${n(detail, "read_from_vault")} read from our stored copy`,
        n(detail, "reread_documents") > 0 && `${n(detail, "reread_documents")} re-read with the new table reader`,
        n(detail, "formats_backfilled") > 0 && `document type noted for ${n(detail, "formats_backfilled")} institutions read earlier`,
      ])}.`;
    }
    case "extract": {
      const processed = n(detail, "processed_text_artifacts");
      if (processed === 0) return `Had no new documents to pull fees from ${scope}.`;
      return `Pulled ${count(n(detail, "inserted_raw_fee_observations"), "fee")} from ${count(processed, "document")} ${scope}${joinParts([
        n(detail, "skipped_fee_candidates") > 0 && `${n(detail, "skipped_fee_candidates")} lines set aside`,
        n(detail, "held_for_review") > 0 && `${n(detail, "held_for_review")} free, range or percentage fees recorded separately (free fees go on to Darwin)`,
        n(detail, "replaced_older_rows") > 0 && `${n(detail, "replaced_older_rows")} fees from older copies replaced`,
        n(detail, "skipped_known_inputs") > 0 && `${n(detail, "skipped_known_inputs")} documents already done`,
      ])}.`;
    }
    case "classify":
    case "verify": {
      const processed = n(detail, "processed_raw_fees");
      if (processed === 0) return `Had no new fees to check ${scope}.`;
      return `Verified ${count(n(detail, "verified_fee_observations"), "fee")} of ${processed.toLocaleString("en-US")} checked ${scope}${joinParts([
        n(detail, "verified_free_fees") > 0 && `${n(detail, "verified_free_fees")} of them free ($0)`,
        n(detail, "skipped_raw_fees") > 0 && `${n(detail, "skipped_raw_fees")} not verified`,
      ])}.`;
    }
    case "publish":
    case "publish-index":
    case "publish-context": {
      const processed = n(detail, "processed_verified_fees");
      if (processed === 0) return `Had nothing new to publish ${scope}.`;
      return `Published ${count(n(detail, "published_fees"), "fee")} ${scope}${joinParts([
        n(detail, "superseded_fees") > 0 && `${n(detail, "superseded_fees")} replaced an older price`,
        n(detail, "published_free_fees") > 0 && `${n(detail, "published_free_fees")} free ($0)`,
        n(detail, "duplicate_collapses") > 0 && `${n(detail, "duplicate_collapses")} duplicate copies closed`,
        n(detail, "rules_recheck_rollbacks") > 0 &&
          `${n(detail, "rules_recheck_rollbacks")} older fees today's rules no longer read rolled back`,
        n(detail, "skipped_verified_fees") > 0 && `${n(detail, "skipped_verified_fees")} already published or not eligible`,
        detail.index_refreshed === true && `index refreshed (${count(n(detail, "index_categories"), "category", "categories")})`,
      ])}.`;
    }
    case "category-guard": {
      const failing = n(detail, "failing_fees");
      if (failing === 0) return `Checked ${count(n(detail, "scanned_fees"), "live fee")}; every one matches its category.`;
      return detail.dry_run === true
        ? `Found ${count(failing, "live fee")} filed under the wrong category (dry run, nothing rolled back).`
        : `Rolled back ${count(n(detail, "rolled_back_fees"), "live fee")} filed under the wrong category.`;
    }
    case "public-discovery":
    case "public-audit":
      return `Checked ${count(n(detail, "processed_routes"), "Fee Insight page")} ${scope}; ${count(n(detail, "public_findings"), "issue")} found.`;
    case "public-cluster":
    case "public-diagnose":
      return null;
    case "registry-fdic-universe":
    case "registry-fdic-financials":
    case "registry-ncua-financials":
    case "registry-fdic-sod":
    case "registry-ncua-branches":
    case "registry-ncua-branch-geocode":
    case "registry-cfpb":
    case "registry-sec-links":
    case "registry-sec-filings":
    case "registry-beige-book":
    case "registry-fred":
    case "registry-reg-news":
    case "registry-fomc-minutes":
    case "registry-fed-publications":
    case "registry-federal-register":
    case "registry-federal-bills":
    case "registry-state-bills":
    case "registry-state-regulators":
    case "registry-state-reg-news":
    case "registry-state-bill-news":
    case "registry-enforcement":
    case "registry-state-enforcement":
      return narrateRegistryStep(stepKey, detail);
    case "score-answer-key": {
      if (detail.schema_ready === false) return "Skipped the answer-key score (migration not applied yet).";
      const banks = n(detail, "banks_scored");
      if (banks === 0) return "Had no confirmed answer-key banks to score yet.";
      return `Scored the pipeline against ${count(banks, "hand-checked bank")}: ${percentOf(detail.precision)} precision, ${percentOf(detail.recall)} recall.`;
    }
    case "study-fee-dependence":
    case "study-local-income":
    case "study-concentration":
    case "study-fee-income":
    case "study-inferred-volume": {
      if (detail.schema_ready === false) return "Read the study; its tables are not created yet, so nothing was stored.";
      const verb = detail.stored === true ? "Stored" : detail.already_current === true ? "Already had" : "Read";
      return `${verb} the ${String(detail.study_key ?? stepKey).replace(/_/g, " ")} study for ${String(detail.as_of ?? "this period")} (${count(n(detail, "n"), "observation")}).`;
    }
    case "hamilton-answer-eval":
      return `Asked Hamilton ${count(n(detail, "answers"), "question")} for ${count(n(detail, "institutions"), "institution")}; ${n(detail, "passed")} answers met the bar.`;
    case "scoreboard-snapshot": {
      const coverage = (detail.coverage ?? {}) as Detail;
      const accuracy = (detail.accuracy ?? {}) as Detail;
      return `${detail.stored === true ? "Recorded" : "Read"} the daily scoreboard: coverage ${percentOf(coverage.rate)}, accuracy ${percentOf(accuracy.precision)} precision.`;
    }
    case "content-market-spread": {
      const picked = (detail.picked ?? null) as Detail | null;
      if (detail.draftId !== null && detail.draftId !== undefined && picked) return `Drafted a market-spread post for ${String(picked.metro)} for James to approve.`;
      return `Drafted no market-spread post this week (${String(detail.reason ?? "no metro passed the checks")}).`;
    }
    case "content-fee-depth": {
      const picked = (detail.picked ?? null) as Detail | null;
      if (detail.draftId !== null && detail.draftId !== undefined && picked) return `Drafted a fee-depth post for ${String(picked.metro)} for James to approve.`;
      return `Drafted no fee-depth post this week (${String(detail.reason ?? "no metro passed the checks")}).`;
    }
    case "content-od-by-state": {
      if (detail.draftId !== null && detail.draftId !== undefined) return `Drafted this week's fees-by-state article for James to publish.`;
      return `Drafted no fees-by-state article (${String(detail.reason ?? "the data did not pass the checks")}).`;
    }
    case "growth-contacts": {
      if (detail.schemaReady === false) return "Read no websites; the contacts tables are not there yet.";
      const checked = n(detail, "checked");
      if (!checked) return "No prospect was due a contact check.";
      return `Read ${count(checked, "prospect website")} and kept ${count(n(detail, "people"), "published executive address", "published executive addresses")}.`;
    }
    case "growth-intake": {
      if (detail.alreadyFiled === true) return `Found ${String(detail.agent)}'s ${String(detail.kind ?? "item").replace(/_/g, " ")} already in the queue.`;
      if (detail.draftId !== null && detail.draftId !== undefined) return `Filed ${String(detail.agent)}'s ${String(detail.kind ?? "item").replace(/_/g, " ")} into the queue for James to review.`;
      return "Filed nothing into the queue.";
    }
    case "growth-score": {
      const scored = Array.isArray(detail.scored) ? detail.scored.length : 0;
      const unscored = Array.isArray(detail.unscored) ? detail.unscored.length : 0;
      if (detail.schemaReady === false) return "Scored nothing; the queue's score columns are not there yet.";
      if (!scored && !unscored) return "No posted item was due a score this week.";
      return `Scored ${count(scored, "posted item")} from tracked visits and leads${unscored ? `; ${count(unscored, "item")} had no measure and stays unscored` : ""}.`;
    }
    case "marketing-score": {
      const scored = n(detail, "scored");
      return scored === 0 ? "Stored this month's market snapshot; no sent campaigns to score yet." : `Scored ${count(scored, "sent campaign")} and stored this month's market snapshot.`;
    }
    case "marketing-write": {
      const drafts = Array.isArray(detail.drafts) ? detail.drafts.length : 0;
      if (detail.already_drafted === true || detail.alreadyDrafted === true) return "This month's campaigns are already drafted and waiting for James.";
      return `Drafted ${count(drafts, "marketing campaign")} for James to approve.`;
    }
    case "marketing-states": {
      const drafts = Array.isArray(detail.drafts) ? detail.drafts.length : 0;
      return drafts ? `Drafted ${count(drafts, "state edition")} for James to approve.` : "No state editions to draft this month.";
    }
    case "marketing-send": {
      const sent = Array.isArray(detail.sent) ? detail.sent.length : 0;
      return `Sent ${count(sent, "approved marketing campaign")}.`;
    }
    case "lead-watch": {
      const owed = n(detail, "overdue") + n(detail, "email_failed");
      if (owed === 0) return "Checked the leads; none is waiting on a reply.";
      return detail.alert === "sent"
        ? `Emailed James about ${count(owed, "lead")} waiting on a reply.`
        : `Found ${count(owed, "lead")} waiting on a reply but could not email James (${String(detail.alert_reason ?? detail.alert ?? "unknown")}).`;
    }
    case "indexnow-ping": {
      const submitted = n(detail, "submitted");
      if (submitted > 0) return `Told Bing about ${count(submitted, "changed page")}.`;
      return detail.skipped === "no pages changed"
        ? "No institution pages changed in the last day."
        : `Did not notify Bing (${String(detail.skipped ?? "unknown")}).`;
    }
    case "briefing-refresh": {
      const stored = n(detail, "stored");
      const quarter = String(detail.quarter ?? "this quarter");
      if (detail.dryRun === true) return `Dry run: built ${quarter} briefings without storing them.`;
      return stored === 0
        ? `Every workspace already has its ${quarter} briefing.`
        : `Stored ${count(stored, `${quarter} briefing`)}.`;
    }
    case "competitor-alerts": {
      const alerts = n(detail, "alerts");
      if (detail.dryRun === true) return `Dry run: ${count(alerts, "competitor change alert")} would show in Monitor.`;
      return alerts === 0
        ? "Checked local competitors; no verified fee change to show."
        : `Showed ${count(alerts, "competitor change alert")} in Monitor.`;
    }
    case "pro-digest": {
      const withNews = n(detail, "withNews");
      if (detail.dryRun === true) return `Dry run: ${count(withNews, "Pro reader")} would get a Monday digest.`;
      if (detail.held === true) return `Counted ${count(withNews, "Pro reader")} for the Monday digest; sending is switched off.`;
      return `Sent ${count(n(detail, "sent"), "Monday digest")}.`;
    }
    case "daily-brief":
      return detail.delivery_status === "sent"
        ? "Sent the daily brief."
        : `Wrote the daily brief but did not email it (${String(detail.delivery_status ?? "unknown")}).`;
    default:
      return null;
  }
}

/** One sentence for a regulator-data (registry-*) step. */
function narrateRegistryStep(stepKey: string, detail: Detail): string | null {
  const partition = String(detail.partition_key ?? "");
  switch (stepKey) {
    case "registry-fdic-universe":
      return `Synced ${count(n(detail, "active_institutions"), "FDIC-insured bank")}${joinParts([
        n(detail, "inserted_institutions") > 0 && `${n(detail, "inserted_institutions")} added`,
        n(detail, "deactivated_institutions") > 0 && `${n(detail, "deactivated_institutions")} marked closed or merged`,
      ])}.`;
    case "registry-fdic-financials":
    case "registry-ncua-financials": {
      const agency = stepKey === "registry-fdic-financials" ? "FDIC" : "NCUA";
      if (detail.empty) return `Checked for ${partition || "new"} ${agency} call reports; not published yet.`;
      return `Loaded ${count(n(detail, "parsed_rows"), `${agency} call report`)} for ${partition || "the quarter"}${joinParts([
        n(detail, "unmatched_rows") > 0 && `${n(detail, "unmatched_rows")} not yet matched to an institution`,
        n(detail, "inserted_institutions") > 0 && `${n(detail, "inserted_institutions")} new credit unions`,
        n(detail, "deactivated_institutions") > 0 && `${n(detail, "deactivated_institutions")} credit unions marked inactive`,
      ])}.`;
    }
    case "registry-fdic-sod":
      if (detail.empty) return `Checked for ${partition} branch deposit data; not published yet.`;
      return `Mapped ${count(n(detail, "branches"), "bank branch", "bank branches")} for ${partition}.`;
    case "registry-ncua-branches":
      if (detail.empty) return `Checked for ${partition} NCUA branch data; not published yet.`;
      return `Loaded ${count(n(detail, "branches"), "credit union branch", "credit union branches")} for ${partition}.`;
    case "registry-ncua-branch-geocode":
      if (n(detail, "attempted") === 0) return "No credit union branches were waiting for map coordinates.";
      return `Mapped ${count(n(detail, "matched"), "credit union branch", "credit union branches")}; ${n(detail, "remaining")} still to go.`;
    case "registry-cfpb":
      return `Recorded ${count(n(detail, "complaints"), "CFPB complaint")} for ${partition} across ${count(n(detail, "institutions"), "institution")}${joinParts([
        n(detail, "review_companies") > 0 && `${n(detail, "review_companies")} company names need review`,
      ])}.`;
    case "registry-sec-links":
      return `Linked ${count(n(detail, "accepted_links"), "SEC filer")} to bank holding companies${joinParts([
        n(detail, "review_links") > 0 && `${n(detail, "review_links")} need review`,
      ])}.`;
    case "registry-sec-filings":
      return `Refreshed SEC filings for ${count(n(detail, "ciks"), "holding company", "holding companies")}: ${count(n(detail, "filings"), "filing")}.`;
    case "registry-beige-book":
      return detail.empty ? null : `Loaded the ${String(detail.release_date ?? partition)} Beige Book (${count(n(detail, "sections"), "section")}).`;
    case "registry-fred":
      return `Refreshed ${count(n(detail, "refreshed_series"), "economic indicator")} from FRED.`;
    case "registry-reg-news":
      return `Stored ${count(n(detail, "inserted"), "new regulator press release")} of ${n(detail, "fetched")} read.`;
    case "registry-fomc-minutes":
      return `Stored ${count(n(detail, "stored"), "new set of FOMC minutes", "new sets of FOMC minutes")}; ${n(detail, "remaining")} still to pull.`;
    case "registry-fed-publications":
      return `Stored ${count(n(detail, "inserted"), "new regional Fed publication")} of ${n(detail, "fetched")} read.`;
    case "registry-federal-register": {
      const stages = (detail.stages ?? {}) as Record<string, unknown>;
      const open = typeof stages.comment_open === "number" ? stages.comment_open : 0;
      const stored = detail.shadow ? "stored none (shadow mode)" : `stored ${n(detail, "stored")}`;
      return `Read ${count(n(detail, "fetched"), "Federal Register rule")}, ${open} open for comment; ${stored}.`;
    }
    case "registry-federal-bills": {
      if (detail.missing_key) return "Skipped federal bills: the Congress.gov key is not set.";
      const stored = detail.shadow ? "stored none (shadow mode)" : `stored ${n(detail, "stored")}`;
      return `Found ${count(n(detail, "fetched"), "federal bank fee bill")} in ${n(detail, "scanned")} bills; ${stored}.`;
    }
    case "registry-state-bills": {
      if (detail.missing_key) return "Skipped state bills: the Open States key is not set.";
      const stored = detail.shadow ? "stored none (shadow mode)" : `stored ${n(detail, "stored")}`;
      const states = Array.isArray(detail.states) ? detail.states.length : 0;
      return `Read ${count(states, "state")} and found ${count(n(detail, "fetched"), "state bank fee bill")}; ${stored}.`;
    }
    case "registry-state-regulators":
      return `Synced ${count(n(detail, "agencies"), "state regulator")}.`;
    case "registry-state-reg-news": {
      const stored = detail.shadow ? "stored none (shadow mode)" : `stored ${n(detail, "stored")}`;
      return `Read news from ${n(detail, "read")} of ${count(n(detail, "agencies"), "state regulator site")}: ${count(n(detail, "fetched"), "item")}, ${n(detail, "fee_related")} about fees; ${stored}.`;
    }
    case "registry-state-bill-news": {
      const stored = detail.shadow ? "stored none (shadow mode)" : `stored ${n(detail, "stored")}`;
      return `Found ${count(n(detail, "fetched"), "news story", "news stories")} on state fee bills (${n(detail, "bills_with_news")} of ${n(detail, "bills")} bills covered); ${stored}.`;
    }
    case "registry-enforcement":
      return `Refreshed ${count(n(detail, "upserted"), "enforcement action")} from the OCC and the Federal Reserve.`;
    case "registry-state-enforcement": {
      const states = Array.isArray(detail.by_state) ? (detail.by_state as Array<{ pages?: number }>).filter((s) => (s.pages ?? 0) > 0).length : 0;
      return `Read ${count(states, "state banking department")} and refreshed ${count(n(detail, "upserted"), "state enforcement order")}.`;
    }
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
  "state-expert": "atlas",
  "daily-brief": "atlas",
  "lead-watch": "atlas",
  "indexnow-ping": "atlas",
  "pro-digest": "atlas",
  "competitor-alerts": "hamilton",
  "briefing-refresh": "hamilton",
  "content-fee-depth": "growth",
  "content-market-spread": "growth",
  "content-od-by-state": "growth",
  "growth-contacts": "growth",
  "growth-intake": "growth",
  "growth-score": "growth",
  "marketing-score": "growth",
  "marketing-write": "growth",
  "marketing-send": "growth",
  "marketing-states": "growth",
  "score-answer-key": "atlas",
  "scoreboard-snapshot": "atlas",
  "hamilton-answer-eval": "hamilton",
  "study-fee-dependence": "hamilton",
  "study-local-income": "hamilton",
  "study-concentration": "hamilton",
  "study-fee-income": "hamilton",
  "study-inferred-volume": "hamilton",
  discover: "magellan",
  "discover-paid": "magellan",
  rescue: "magellan",
  fetch: "magellan",
  "public-discovery": "magellan",
  "public-audit": "magellan",
  "registry-fdic-universe": "magellan",
  "registry-fdic-financials": "magellan",
  "registry-ncua-financials": "magellan",
  "registry-fdic-sod": "magellan",
  "registry-ncua-branches": "magellan",
  "registry-ncua-branch-geocode": "magellan",
  "registry-cfpb": "magellan",
  "registry-sec-links": "magellan",
  "registry-sec-filings": "magellan",
  "registry-beige-book": "magellan",
  "registry-fred": "magellan",
  "registry-reg-news": "magellan",
  "registry-fomc-minutes": "magellan",
  "registry-fed-publications": "magellan",
  "registry-federal-register": "magellan",
  "registry-federal-bills": "magellan",
  "registry-state-bills": "magellan",
  "registry-state-regulators": "magellan",
  "registry-state-reg-news": "magellan",
  "registry-state-bill-news": "magellan",
  "registry-enforcement": "magellan",
  "registry-state-enforcement": "magellan",
  read: "rosetta",
  "read-paid": "rosetta",
  extract: "knox",
  "extract-paid": "knox",
  review: "knox",
  classify: "darwin",
  "verify-paid": "darwin",
  verify: "darwin",
  "public-cluster": "darwin",
  publish: "hamilton",
  "publish-index": "hamilton",
  "publish-context": "hamilton",
  "report-render": "hamilton",
  "report-close": "hamilton",
  "category-guard": "hamilton",
  "public-diagnose": "hamilton",
};
