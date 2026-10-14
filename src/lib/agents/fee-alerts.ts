import { createHash } from "crypto";
import { sql } from "@/lib/data-store/connection";
import { statsRowFilter } from "@/lib/data-store/fee-stats";
import { isConsumerFee, type FeeAudience } from "@/lib/fee-audience";
import { isConfirmedMovement, withConfirmedMovements } from "./fee-movement-check";
import { SITE_URL } from "@/lib/constants";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { getTransactionalFromAddress, sendResendEmail, type EmailDeliveryStatus } from "@/lib/email/resend";
import { renderLeadEmailHtml, renderLeadEmailText } from "@/lib/email/lead-notification";
import { feeAlertUnsubscribeUrls, getSubscriptionTokenSecret } from "@/lib/email/subscription-token";
import { isProEmailSendingEnabled } from "@/lib/email/pro-email-flag";
import { canAccessPremium } from "@/lib/access";
import type { User } from "@/lib/auth";

/**
 * Atlas's fee-change alerts: one email per reader per run, covering every saved bank or
 * credit union where a fee they follow was first published or changed since their last
 * alert. Deterministic (no model), driven by the signals Hamilton writes when it publishes:
 *
 *   hamilton_fee_movement_detected  -> a live published amount changed
 *   hamilton_publication_completed  -> fees were published; keys with no movement in the
 *                                      same batch are first publications
 *
 * The high-water mark is `institution_fee_alert_subscriptions.last_alerted_at`, set to the
 * newest signal included in a sent email (not the send time), and only after Resend
 * accepts the message. A failed or unconfigured send leaves the reader for the next run;
 * the per-digest idempotency key makes a retried identical email a no-op at Resend.
 *
 * Pro readers' Monitor watchlists (`hamilton_watchlists`) feed the same engine: each
 * watched institution counts as a saved one, merged into the same one email, with its
 * own high-water mark `hamilton_watchlists.last_alerted_at`. Watchlist alerts send only
 * while PRO_EMAILS_ENABLED is on; while it is off, the run counts and renders them only.
 */

export interface CandidateRow {
  /** Null for a watchlist row. */
  subscription_id: number | string | null;
  user_id: number | string;
  institution_id: number | string;
  fee_categories: string[] | null;
  email: string;
  display_name: string | null;
  institution_name: string;
  signal_id: string;
  signal_type: string;
  signal_at: string | Date;
  source_json: unknown;
  /** Where the reader saved this institution; absent means a free subscription. */
  source?: "subscription" | "watchlist";
}

export interface FeeChange {
  category: string;
  feeName: string;
  previousAmount: number;
  newAmount: number;
  delta: number;
}

export interface InstitutionAlert {
  institutionId: number;
  institutionName: string;
  changes: FeeChange[];
  /** Followed fees published for the first time; amounts filled in after grouping. */
  newlyPublished: Array<{ category: string; amount: number | null }>;
}

export interface FeeAlertDigest {
  userId: number;
  email: string;
  displayName: string;
  /** Every subscription whose signals were read, including ones with nothing to send. */
  subscriptionIds: number[];
  signalIds: string[];
  /** created_at of the newest signal read: the next high-water mark. */
  maxSignalAt: string;
  /** Newest watchlist signal read, or null when no watchlist row fed this digest. */
  watchlistMaxSignalAt: string | null;
  institutions: InstitutionAlert[];
}

interface MovementJson {
  canonical_fee_key?: unknown;
  fee_name?: unknown;
  fee_audience?: FeeAudience;
  previous_amount?: unknown;
  new_amount?: unknown;
  amount_delta?: unknown;
  confirmed?: unknown;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function follows(categories: string[] | null, category: string): boolean {
  return categories === null || categories.includes(category);
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Batch key per saved institution, so a movement and a publication in one batch pair up. */
function savedKey(row: CandidateRow): string {
  return row.source === "watchlist" ? `w:${row.user_id}:${row.institution_id}` : String(row.subscription_id);
}

/**
 * Pure: candidate rows (one per subscription x newer signal) into one digest per reader.
 * Keeps only fees the reader follows; a digest may end up with no institutions, which
 * still advances its subscriptions' high-water mark so they are not re-read forever.
 */
export function groupFeeAlertCandidates(rows: CandidateRow[]): FeeAlertDigest[] {
  const digests = new Map<number, FeeAlertDigest>();
  // Per subscription and batch: movement keys, so publication keys in the same batch that
  // also moved are reported once, as a change.
  const movedKeysByBatch = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.signal_type !== "hamilton_fee_movement_detected") continue;
    const json = parseJson(row.source_json);
    const key = `${savedKey(row)}:${String(json.batch_id ?? row.signal_id)}`;
    const set = movedKeysByBatch.get(key) ?? new Set<string>();
    for (const movement of (Array.isArray(json.movements) ? json.movements : []) as MovementJson[]) {
      if (typeof movement.canonical_fee_key === "string") set.add(movement.canonical_fee_key);
    }
    movedKeysByBatch.set(key, set);
  }

  for (const row of rows) {
    const userId = Number(row.user_id);
    const institutionId = Number(row.institution_id);
    const isWatchlist = row.source === "watchlist";
    const signalAt = toIso(row.signal_at);
    const digest =
      digests.get(userId) ??
      ({
        userId,
        email: row.email,
        displayName: row.display_name || row.email.split("@")[0],
        subscriptionIds: [],
        signalIds: [],
        maxSignalAt: signalAt,
        watchlistMaxSignalAt: null,
        institutions: [],
      } satisfies FeeAlertDigest);
    if (isWatchlist) {
      if (!digest.watchlistMaxSignalAt || signalAt > digest.watchlistMaxSignalAt) digest.watchlistMaxSignalAt = signalAt;
    } else {
      const subscriptionId = Number(row.subscription_id);
      if (!digest.subscriptionIds.includes(subscriptionId)) digest.subscriptionIds.push(subscriptionId);
    }
    // A signal reaches a reader once even when they both saved and watch the institution.
    if (!digest.signalIds.includes(String(row.signal_id))) digest.signalIds.push(String(row.signal_id));
    if (signalAt > digest.maxSignalAt) digest.maxSignalAt = signalAt;

    let institution = digest.institutions.find((item) => item.institutionId === institutionId);
    const ensureInstitution = () => {
      if (!institution) {
        institution = { institutionId, institutionName: row.institution_name, changes: [], newlyPublished: [] };
        digest.institutions.push(institution);
      }
      return institution;
    };

    const json = parseJson(row.source_json);
    if (row.signal_type === "hamilton_fee_movement_detected") {
      for (const movement of (Array.isArray(json.movements) ? json.movements : []) as MovementJson[]) {
        const category = typeof movement.canonical_fee_key === "string" ? movement.canonical_fee_key : null;
        if (!isConsumerFee(movement.fee_audience)) continue;
        const previousAmount = Number(movement.previous_amount);
        const newAmount = Number(movement.new_amount);
        if (!category || !follows(row.fee_categories, category)) continue;
        // A re-read, recategorization or other page's copy is not a price change.
        if (!isConfirmedMovement(movement)) continue;
        if (!Number.isFinite(previousAmount) || !Number.isFinite(newAmount)) continue;
        const target = ensureInstitution();
        // A later movement of the same fee in this run supersedes the earlier one.
        target.changes = target.changes.filter((change) => change.category !== category);
        target.changes.push({
          category,
          feeName: typeof movement.fee_name === "string" && movement.fee_name ? movement.fee_name : getDisplayName(category),
          previousAmount,
          newAmount,
          delta: Math.round((newAmount - previousAmount) * 100) / 100,
        });
      }
    } else if (row.signal_type === "hamilton_publication_completed") {
      const moved = movedKeysByBatch.get(`${savedKey(row)}:${String(json.batch_id ?? row.signal_id)}`) ?? new Set();
      const keys = Array.isArray(json.consumer_canonical_fee_keys) ? json.consumer_canonical_fee_keys : [];
      for (const key of keys) {
        if (typeof key !== "string" || moved.has(key) || !follows(row.fee_categories, key)) continue;
        const target = ensureInstitution();
        if (!target.newlyPublished.some((item) => item.category === key)) {
          target.newlyPublished.push({ category: key, amount: null });
        }
      }
    }

    digests.set(userId, digest);
  }

  // A fee that was first published and then changed in the same window is a change.
  for (const digest of digests.values()) {
    for (const institution of digest.institutions) {
      const changed = new Set(institution.changes.map((change) => change.category));
      institution.newlyPublished = institution.newlyPublished.filter((item) => !changed.has(item.category));
    }
    digest.institutions = digest.institutions.filter(
      (institution) => institution.changes.length > 0 || institution.newlyPublished.length > 0,
    );
  }
  return [...digests.values()];
}

export function feeAlertIdempotencyKey(userId: number, signalIds: string[]): string {
  const hash = createHash("sha256").update([...signalIds].sort().join(",")).digest("hex").slice(0, 16);
  return `fee-alert-${userId}-${hash}`;
}

function plainLabel(category: string): string {
  return getDisplayName(category).replace(/\s*\([^)]*\)/g, "");
}

/** "overdraft fee", "monthly maintenance fee": the label as a noun in a sentence. */
function feeNoun(category: string): string {
  const label = plainLabel(category).toLowerCase();
  return /\bfee$/.test(label) ? label : `${label} fee`;
}

function changeLine(change: FeeChange): string {
  const direction = change.delta > 0 ? "up" : "down";
  return `${plainLabel(change.category)}: ${formatAmount(change.previousAmount)} → ${formatAmount(change.newAmount)} (${direction} ${formatAmount(Math.abs(change.delta))})`;
}

const MAX_NEW_FEES_LISTED = 5;

/** Pure: subject and body for one reader's digest. */
export function buildFeeAlertEmail(
  digest: FeeAlertDigest,
  urls: { site: string; unsubscribePage: string },
): { subject: string; text: string; html: string } {
  const site = urls.site.replace(/\/$/, "");
  const first = digest.institutions[0];
  const totalChanges = digest.institutions.reduce((sum, item) => sum + item.changes.length, 0);
  const totalNew = digest.institutions.reduce((sum, item) => sum + item.newlyPublished.length, 0);

  let subject: string;
  if (digest.institutions.length === 1 && totalChanges === 1 && totalNew === 0) {
    const change = first.changes[0];
    subject = `${first.institutionName} ${change.delta > 0 ? "raised" : "lowered"} its ${feeNoun(change.category)} to ${formatAmount(change.newAmount)}`;
  } else if (digest.institutions.length === 1 && totalChanges === 0) {
    subject = `${first.institutionName} now has verified fees you follow`;
  } else if (digest.institutions.length === 1) {
    subject = `Fee changes at ${first.institutionName}`;
  } else {
    subject = `Fee changes at ${digest.institutions.length} of your saved institutions`;
  }

  const lines: string[] = [];
  for (const institution of digest.institutions) {
    const profile = `${site}/institution/${institution.institutionId}`;
    lines.push(institution.institutionName);
    for (const change of institution.changes) {
      lines.push(`${changeLine(change)}\n${profile}?fee=${change.category}#fee-${change.category}`);
    }
    if (institution.newlyPublished.length > 0) {
      const listed = institution.newlyPublished.slice(0, MAX_NEW_FEES_LISTED).map((item) =>
        item.amount === null ? plainLabel(item.category) : `${plainLabel(item.category)} ${formatAmount(item.amount)}`,
      );
      const more = institution.newlyPublished.length - listed.length;
      lines.push(
        `Now verified: ${listed.join(", ")}${more > 0 ? `, and ${more} more` : ""}.\n${profile}`,
      );
    }
    lines.push("");
  }
  lines.push(`Compare any fee with the national median at ${site}/fees.`);
  lines.push("");
  lines.push(
    digest.watchlistMaxSignalAt
      ? `You get these because you saved these institutions on Fee Insight or watch them in Hamilton. Manage alerts: ${site}/account#alerts\nYour watchlist: ${site}/pro/monitor\nStop all fee alerts: ${urls.unsubscribePage}`
      : `You get these because you saved these institutions on Fee Insight. Manage alerts: ${site}/account#alerts\nStop all fee alerts: ${urls.unsubscribePage}`,
  );

  const content = {
    subject,
    lines,
    cta: { label: "Manage your alerts", href: `${site}/account#alerts` },
  };
  return { subject, text: renderLeadEmailText(content), html: renderLeadEmailHtml(content) };
}

export interface FeeAlertDispatchResult {
  dryRun: boolean;
  /** Readers with at least one followed change. */
  readers: number;
  sent: number;
  failed: number;
  notConfigured: boolean;
  reason: string | null;
  institutions: number;
  changes: number;
  newlyPublished: number;
  /** Readers left for the next run because of the per-run cap. */
  deferred: number;
  /** Pro readers whose email would carry watchlist news (counted even while sending is off). */
  watchlistReaders: number;
  /** True when PRO_EMAILS_ENABLED is off: watchlist news was counted and rendered, not sent. */
  watchlistHeld: boolean;
  /** Up to three rendered emails (dry run, or watchlist emails held by the switch). */
  previews: EmailPreview[];
}

export interface EmailPreview {
  /** The address with its local part masked, for the run ledger. */
  to: string;
  subject: string;
  text: string;
}

const CANDIDATE_LIMIT = 5000;
const MAX_PREVIEWS = 3;
/** A watchlist with no alert sent yet reads at most this far back. */
const WATCHLIST_FIRST_LOOKBACK_DAYS = 7;

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

async function loadCandidates(): Promise<CandidateRow[]> {
  return sql<CandidateRow[]>`
    SELECT sub.id AS subscription_id, sub.user_id, sub.institution_id, sub.fee_categories,
           u.email, u.display_name, ct.institution_name,
           s.id::text AS signal_id, s.signal_type, s.created_at AS signal_at, s.source_json
    FROM institution_fee_alert_subscriptions sub
    JOIN users u ON u.id = sub.user_id AND u.is_active = TRUE AND u.email IS NOT NULL
    JOIN institution_sources ct ON ct.id = sub.institution_id
    JOIN hamilton_signals s
      ON s.institution_id = sub.institution_id::text
     AND s.signal_type IN ('hamilton_fee_movement_detected', 'hamilton_publication_completed')
     AND s.created_at > COALESCE(sub.last_alerted_at, sub.created_at)
    WHERE sub.is_active = TRUE
    ORDER BY sub.user_id, s.created_at
    LIMIT ${CANDIDATE_LIMIT}
  `;
}

interface WatchlistCandidateRow extends CandidateRow {
  role: string | null;
  subscription_status: string | null;
  past_due_since: string | null;
}

/**
 * Pro readers' watched institutions, as candidate rows. Columns added by migration
 * 20270110000009 are read through to_jsonb so this query also runs before it applies.
 * An empty fee_categories list means every fee, like a null list on a subscription.
 */
async function loadWatchlistCandidates(): Promise<CandidateRow[]> {
  const rows = await sql<WatchlistCandidateRow[]>`
    SELECT NULL AS subscription_id, u.id AS user_id, ct.id AS institution_id,
           CASE WHEN jsonb_typeof(w.fee_categories) = 'array' AND jsonb_array_length(w.fee_categories) > 0
                THEN ARRAY(SELECT jsonb_array_elements_text(w.fee_categories))
                ELSE NULL END AS fee_categories,
           u.email, u.display_name, ct.institution_name,
           s.id::text AS signal_id, s.signal_type, s.created_at AS signal_at, s.source_json,
           'watchlist' AS source,
           u.role, COALESCE(u.subscription_status, 'none') AS subscription_status,
           to_jsonb(u.*) ->> 'past_due_since' AS past_due_since
    FROM hamilton_watchlists w
    JOIN users u
      ON u.id::text = w.user_id::text AND u.is_active = TRUE AND u.email IS NOT NULL
     AND (to_jsonb(u.*) ->> 'watchlist_alerts_off_at') IS NULL
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(w.institution_ids) = 'array' THEN w.institution_ids ELSE '[]'::jsonb END
    ) AS watched(institution_id)
    JOIN institution_sources ct ON ct.id::text = watched.institution_id
    JOIN hamilton_signals s
      ON s.institution_id = ct.id::text
     AND s.signal_type IN ('hamilton_fee_movement_detected', 'hamilton_publication_completed')
     AND s.created_at > COALESCE(
           (to_jsonb(w.*) ->> 'last_alerted_at')::timestamptz,
           GREATEST(w.created_at, NOW() - make_interval(days => ${WATCHLIST_FIRST_LOOKBACK_DAYS}))
         )
    WHERE u.role IN ('admin', 'analyst', 'premium') OR u.subscription_status IN ('active', 'past_due')
    ORDER BY u.id, s.created_at
    LIMIT ${CANDIDATE_LIMIT}
  `;
  // Pro is decided by the same rule as every Pro screen (past_due keeps a grace window).
  return rows.filter((row) =>
    canAccessPremium({
      role: row.role,
      subscription_status: row.subscription_status,
      past_due_since: row.past_due_since,
    } as unknown as User),
  ).map((row) => ({ ...row, source: "watchlist" as const }));
}

async function fillPublishedAmounts(digests: FeeAlertDigest[]): Promise<void> {
  const institutionIds = new Set<number>();
  const categories = new Set<string>();
  for (const digest of digests) {
    for (const institution of digest.institutions) {
      for (const item of institution.newlyPublished) {
        institutionIds.add(institution.institutionId);
        categories.add(item.category);
      }
    }
  }
  if (institutionIds.size === 0) return;
  const rows = await sql<{ institution_id: number; fee_category: string; amount: number | string }[]>`
    SELECT ef.institution_id, ef.fee_category,
           CASE WHEN ef.fee_category = 'overdraft' THEN MAX(ef.amount)
                ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) END AS amount
    FROM published_fee_catalog ef
    WHERE ef.review_status = 'approved'
      AND ef.amount IS NOT NULL AND ef.amount >= 0
      AND ${sql.unsafe(statsRowFilter("ef"))}
      AND ef.institution_id = ANY(${[...institutionIds]}::bigint[])
      AND ef.fee_category = ANY(${[...categories]}::text[])
    GROUP BY ef.institution_id, ef.fee_category
  `;
  const amounts = new Map(rows.map((row) => [`${Number(row.institution_id)}:${row.fee_category}`, Number(row.amount)]));
  for (const digest of digests) {
    for (const institution of digest.institutions) {
      for (const item of institution.newlyPublished) {
        item.amount = amounts.get(`${institution.institutionId}:${item.category}`) ?? null;
      }
    }
  }
}

async function advanceHighWaterMark(subscriptionIds: number[], maxSignalAt: string): Promise<void> {
  if (subscriptionIds.length === 0) return;
  await sql`
    UPDATE institution_fee_alert_subscriptions
    SET last_alerted_at = ${maxSignalAt}
    WHERE id = ANY(${subscriptionIds}::bigint[])
      AND (last_alerted_at IS NULL OR last_alerted_at < ${maxSignalAt})
  `;
}

async function advanceWatchlistMark(userId: number, maxSignalAt: string | null): Promise<void> {
  if (!maxSignalAt) return;
  await sql`
    UPDATE hamilton_watchlists
    SET last_alerted_at = ${maxSignalAt}
    WHERE user_id::text = ${String(userId)}
      AND (last_alerted_at IS NULL OR last_alerted_at < ${maxSignalAt})
  `;
}

async function advanceMarks(digest: FeeAlertDigest): Promise<void> {
  await advanceHighWaterMark(digest.subscriptionIds, digest.maxSignalAt);
  await advanceWatchlistMark(digest.userId, digest.watchlistMaxSignalAt);
}

function renderPreviews(digests: FeeAlertDigest[], site: string): EmailPreview[] {
  return digests.slice(0, MAX_PREVIEWS).map((digest) => {
    const email = buildFeeAlertEmail(digest, { site, unsubscribePage: `${site}/email-preferences?preview=1` });
    return { to: maskEmail(digest.email), subject: email.subject, text: email.text };
  });
}

/** Reads signals, emails readers, advances the high-water mark. Never throws on delivery. */
export async function runFeeAlertDispatch({
  dryRun = false,
  maxRecipients = 200,
}: { dryRun?: boolean; maxRecipients?: number } = {}): Promise<FeeAlertDispatchResult> {
  const sendWatchlist = isProEmailSendingEnabled();
  const loadedSubscriptionRows = await loadCandidates();
  const loadedWatchlistRows = await loadWatchlistCandidates().catch((error: unknown) => {
    console.error("[fee-alerts] watchlist candidates failed", error instanceof Error ? error.message : String(error));
    return [] as CandidateRow[];
  });
  // Mark which movements are real price changes on the same page (fee-movement-check.ts).
  const checked = await withConfirmedMovements([...loadedSubscriptionRows, ...loadedWatchlistRows]);
  const subscriptionRows = checked.slice(0, loadedSubscriptionRows.length);
  const watchlistRows = checked.slice(loadedSubscriptionRows.length);
  const site = SITE_URL.replace(/\/$/, "");

  // Count and render every Pro reader's watchlist news, whether or not it may be sent.
  const watchlistDigests = groupFeeAlertCandidates([...subscriptionRows, ...watchlistRows]).filter(
    (digest) => digest.watchlistMaxSignalAt !== null && digest.institutions.length > 0,
  );
  const watchlistHeld = !sendWatchlist && watchlistDigests.length > 0;
  if (dryRun || watchlistHeld) await fillPublishedAmounts(watchlistDigests);

  // Live sends include watchlist rows only while the switch is on; a dry run shows them all.
  const rows = dryRun || sendWatchlist ? [...subscriptionRows, ...watchlistRows] : subscriptionRows;
  const digests = groupFeeAlertCandidates(rows);
  const withNews = digests.filter((digest) => digest.institutions.length > 0);
  const quiet = digests.filter((digest) => digest.institutions.length === 0);
  await fillPublishedAmounts(withNews);

  const result: FeeAlertDispatchResult = {
    dryRun,
    readers: withNews.length,
    sent: 0,
    failed: 0,
    notConfigured: false,
    reason: null,
    institutions: withNews.reduce((sum, digest) => sum + digest.institutions.length, 0),
    changes: withNews.reduce((sum, d) => sum + d.institutions.reduce((n, i) => n + i.changes.length, 0), 0),
    newlyPublished: withNews.reduce((sum, d) => sum + d.institutions.reduce((n, i) => n + i.newlyPublished.length, 0), 0),
    deferred: Math.max(0, withNews.length - maxRecipients),
    watchlistReaders: watchlistDigests.length,
    watchlistHeld: !dryRun && watchlistHeld,
    previews: dryRun ? renderPreviews(withNews, site) : watchlistHeld ? renderPreviews(watchlistDigests, site) : [],
  };
  if (dryRun) {
    result.reason = "dry run";
    return result;
  }

  // Signals that touched only fees nobody follows will never produce an email: move past them.
  for (const digest of quiet) await advanceMarks(digest);

  const from = getTransactionalFromAddress();
  const secret = getSubscriptionTokenSecret();
  if (!from || !secret) {
    result.notConfigured = withNews.length > 0;
    result.reason = !from
      ? "TRANSACTIONAL_EMAIL_FROM is not configured."
      : "LEAD_EMAIL_TOKEN_SECRET (or BFI_COOKIE_SECRET) is not configured, so unsubscribe links cannot be signed.";
    return result;
  }

  for (const digest of withNews.slice(0, maxRecipients)) {
    const unsubscribe = feeAlertUnsubscribeUrls(digest.userId, digest.email, secret);
    const email = buildFeeAlertEmail(digest, { site, unsubscribePage: unsubscribe.page });
    const delivery = await sendResendEmail(
      {
        from,
        to: digest.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        idempotencyKey: feeAlertIdempotencyKey(digest.userId, digest.signalIds),
        headers: {
          "List-Unsubscribe": `<${unsubscribe.oneClick}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      "a fee-change alert",
    );
    const status: EmailDeliveryStatus = delivery.status;
    if (status === "sent") {
      result.sent += 1;
      await advanceMarks(digest);
    } else if (status === "not_configured") {
      result.notConfigured = true;
      result.reason = delivery.status === "not_configured" ? delivery.reason : null;
      break;
    } else {
      result.failed += 1;
    }
  }
  return result;
}

/** One-line run-ledger summary for the step. */
export function summarizeFeeAlertDispatch(result: FeeAlertDispatchResult): string {
  const held = result.watchlistHeld
    ? ` ${result.watchlistReaders} Pro reader(s) have watchlist news held because PRO_EMAILS_ENABLED is off.`
    : "";
  if (result.dryRun) {
    return `Atlas found ${result.readers} reader(s) to alert about ${result.changes} change(s) and ${result.newlyPublished} newly verified fee(s), ${result.watchlistReaders} of them from Pro watchlists (dry run, nothing sent).`;
  }
  if (result.readers === 0) return `Atlas found no fee changes for readers' saved institutions.${held}`;
  if (result.notConfigured) {
    const reason = (result.reason ?? "email is not configured").replace(/\.+$/, "");
    return `Atlas found ${result.readers} reader(s) with fee changes but did not email them: ${reason}.${held}`;
  }
  const deferred = result.deferred > 0 ? ` ${result.deferred} reader(s) wait for the next run.` : "";
  return `Atlas emailed ${result.sent} fee alert(s) covering ${result.institutions} institution(s): ${result.changes} change(s), ${result.newlyPublished} newly verified fee(s), ${result.failed} failed.${deferred}${held}`;
}
