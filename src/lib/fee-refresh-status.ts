/**
 * Where an operator's fee action has reached (H03-T08, #978). A hold, release, correction or
 * reversal changes `published_fee_records` at once, but each reader sees it through its own path:
 *
 * - The live fee list (`published_fee_catalog`, a view): institution pages, reports, the API and
 *   Hamilton's peer comparisons read it directly, so it changes when the action commits.
 * - Hamilton's national index (`fee_index_cache`): rebuilt by the action itself; when that fails,
 *   by a retry or the next publish run. Readers memoise it for a minute.
 * - The public pages' read caches (Next cache tags): cleared after the action commits, and expire
 *   within the hour regardless.
 * - Hamilton Pro: reads the live fee list and the national index, so it has reached the change
 *   only when both have.
 *
 * The fee list is a view, so it cannot lag the commit; it is still read rather than assumed.
 * Each status is read from evidence (the catalog itself, the cache's `computed_at`, the run's
 * events), never assumed. Pure: no database imports. The reader is
 * `src/lib/data-store/fee-correction-audit.ts`.
 */

export type AuditAction = "hold" | "release" | "correct" | "reverse";

export type SurfaceKey = "fee_list" | "national_index" | "public_pages" | "pro";

/** reached: the reader shows the change. waiting: it will, with no action needed. failed: needs a retry. hidden: live, but this reader leaves the fee out for another reason. */
export type SurfaceState = "reached" | "waiting" | "failed" | "hidden";

export interface SurfaceStatus {
  surface: SurfaceKey;
  label: string;
  state: SurfaceState;
  detail: string;
}

/** One `agent_run_events` row from the action's run or a retry of it. */
export interface RefreshEvent {
  eventType: string;
  status: string;
  createdAt: string;
}

/** What the live fee list holds now, for the rows the action touched. */
export interface CatalogEvidence {
  /** The row the action took out (held, or replaced by a correction) is in the fee list now. Null when the action took nothing out. */
  removedStillListed: boolean | null;
  /** The row the action made live (released, or the new version) is in the fee list. Null when the action made nothing live. */
  addedListed: boolean | null;
  /** The row the action made live is still live in `published_fee_records` (no later change replaced or held it). */
  addedStillLive: boolean | null;
}

export interface RefreshInput {
  action: AuditAction;
  actionAt: string;
  events: RefreshEvent[];
  /** The newest `fee_index_cache.computed_at`, or null when the cache is empty or unreadable. */
  indexComputedAt: string | null;
  catalog: CatalogEvidence;
  now?: Date;
}

export interface RefreshStatus {
  surfaces: SurfaceStatus[];
  /** True when an operator retry would help: the index rebuild failed, or the caches were not cleared and have not yet expired. */
  needsRetry: boolean;
}

/** How long the public pages' read caches keep an entry (`PUBLIC_READ_CEILING_SECONDS`). */
export const PUBLIC_CACHE_CEILING_MS = 60 * 60 * 1000;
/** How long a server memoises the national index (`NATIONAL_INDEX_CACHE_TTL_MS`). */
export const INDEX_MEMO_MS = 60 * 1000;

function ms(value: string | null | undefined): number {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(at) ? at : NaN;
}

/** The newest event of one type, by time. */
function latest(events: RefreshEvent[], type: string): RefreshEvent | null {
  let found: RefreshEvent | null = null;
  for (const event of events) {
    if (event.eventType !== type) continue;
    if (!found || ms(event.createdAt) >= ms(found.createdAt)) found = event;
  }
  return found;
}

function utc(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function feeListStatus(input: RefreshInput): SurfaceStatus {
  const { removedStillListed, addedListed, addedStillLive } = input.catalog;
  const base = { surface: "fee_list" as const, label: "Live fee list" };
  // The catalog leaves out every held or superseded row, so a row it lists again was put back
  // by a later change (a release); the view cannot lag the commit.
  if (removedStillListed && addedListed === null) {
    return { ...base, state: "reached", detail: "A later change put this fee back in the fee list." };
  }
  if (addedListed === null) return { ...base, state: "reached", detail: "The fee is out of the fee list." };
  if (addedListed) return { ...base, state: "reached", detail: "The fee list shows this value." };
  if (addedStillLive === false) return { ...base, state: "reached", detail: "A later change replaced or held this value." };
  return { ...base, state: "hidden", detail: "Live, but the fee list leaves it out under another rule (for example, too few fees for this institution)." };
}

function indexStatus(input: RefreshInput, actionAt: number, now: number): SurfaceStatus {
  const base = { surface: "national_index" as const, label: "National index" };
  const computedAt = ms(input.indexComputedAt);
  const rebuild = latest(input.events, "index.refresh");
  const rebuiltSince = Number.isFinite(computedAt) && computedAt >= actionAt;
  if (rebuild?.status === "completed" || rebuiltSince) {
    const at = Number.isFinite(computedAt) && computedAt >= actionAt ? computedAt : ms(rebuild?.createdAt);
    if (Number.isFinite(at) && now - at < INDEX_MEMO_MS) {
      return { ...base, state: "waiting", detail: `Rebuilt at ${utc(at)}; servers pick it up within a minute.` };
    }
    return { ...base, state: "reached", detail: Number.isFinite(at) ? `Rebuilt at ${utc(at)}.` : "Rebuilt." };
  }
  if (rebuild?.status === "failed") {
    return { ...base, state: "failed", detail: "The rebuild failed. Retry it, or the next publish run rebuilds it." };
  }
  return { ...base, state: "waiting", detail: "No rebuild is recorded yet; the next publish run rebuilds it." };
}

function pagesStatus(input: RefreshInput, actionAt: number, now: number): SurfaceStatus {
  const base = { surface: "public_pages" as const, label: "Public pages" };
  const cleared = latest(input.events, "cache.invalidate");
  if (cleared?.status === "completed") {
    return { ...base, state: "reached", detail: `Caches cleared at ${utc(ms(cleared.createdAt))}.` };
  }
  const expires = actionAt + PUBLIC_CACHE_CEILING_MS;
  if (now >= expires) return { ...base, state: "reached", detail: "Every cached page has expired since the change." };
  return {
    ...base,
    state: "failed",
    detail: `Caches not cleared${cleared ? " (the clear failed)" : ""}. They expire by ${utc(expires)}, or retry now.`,
  };
}

function proStatus(feeList: SurfaceStatus, index: SurfaceStatus): SurfaceStatus {
  const base = { surface: "pro" as const, label: "Hamilton Pro" };
  if (feeList.state === "failed" || index.state === "failed") {
    return { ...base, state: "failed", detail: "Waits on the fee list and the national index (see their status)." };
  }
  if (feeList.state === "hidden") return { ...base, state: "hidden", detail: "The fee list leaves this fee out, so Pro does too." };
  if (index.state === "waiting") return { ...base, state: "waiting", detail: "Peer comparisons show it; national figures wait on the index." };
  return { ...base, state: "reached", detail: "Peer comparisons and national figures both show it." };
}

/** Each reader's status for one operator action, from the evidence read for it. Pure. */
export function refreshStatus(input: RefreshInput): RefreshStatus {
  const now = (input.now ?? new Date()).getTime();
  const actionAt = ms(input.actionAt);
  const feeList = feeListStatus(input);
  const index = indexStatus(input, actionAt, now);
  const pages = pagesStatus(input, actionAt, now);
  const pro = proStatus(feeList, index);
  return {
    surfaces: [feeList, index, pages, pro],
    needsRetry: index.state === "failed" || pages.state === "failed",
  };
}

/** Which rows an action took out of and put into the fee list. Pure. */
export function rowsTouched(action: AuditAction, previousId: number | null, currentId: number | null): { removed: number | null; added: number | null } {
  switch (action) {
    case "hold":
      return { removed: currentId, added: null };
    case "release":
      return { removed: null, added: currentId };
    case "correct":
    case "reverse":
      return { removed: previousId, added: currentId };
  }
}
