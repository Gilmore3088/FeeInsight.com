import { createHash } from "crypto";
import { sql } from "@/lib/data-store/connection";
import { SITE_URL } from "@/lib/constants";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { getTransactionalFromAddress, sendResendEmail, type EmailDeliveryStatus } from "@/lib/email/resend";
import { renderLeadEmailHtml, renderLeadEmailText } from "@/lib/email/lead-notification";
import { feeAlertUnsubscribeUrls, getSubscriptionTokenSecret } from "@/lib/email/subscription-token";

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
 */

export interface CandidateRow {
  subscription_id: number | string;
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
  institutions: InstitutionAlert[];
}

interface MovementJson {
  canonical_fee_key?: unknown;
  fee_name?: unknown;
  previous_amount?: unknown;
  new_amount?: unknown;
  amount_delta?: unknown;
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
    const key = `${row.subscription_id}:${String(json.batch_id ?? row.signal_id)}`;
    const set = movedKeysByBatch.get(key) ?? new Set<string>();
    for (const movement of (Array.isArray(json.movements) ? json.movements : []) as MovementJson[]) {
      if (typeof movement.canonical_fee_key === "string") set.add(movement.canonical_fee_key);
    }
    movedKeysByBatch.set(key, set);
  }

  for (const row of rows) {
    const userId = Number(row.user_id);
    const institutionId = Number(row.institution_id);
    const subscriptionId = Number(row.subscription_id);
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
        institutions: [],
      } satisfies FeeAlertDigest);
    if (!digest.subscriptionIds.includes(subscriptionId)) digest.subscriptionIds.push(subscriptionId);
    digest.signalIds.push(String(row.signal_id));
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
        const previousAmount = Number(movement.previous_amount);
        const newAmount = Number(movement.new_amount);
        if (!category || !follows(row.fee_categories, category)) continue;
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
      const moved = movedKeysByBatch.get(`${row.subscription_id}:${String(json.batch_id ?? row.signal_id)}`) ?? new Set();
      const keys = Array.isArray(json.canonical_fee_keys) ? json.canonical_fee_keys : [];
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
    `You get these because you saved these institutions on Fee Insight. Manage alerts: ${site}/account#alerts\nStop all fee alerts: ${urls.unsubscribePage}`,
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
}

const CANDIDATE_LIMIT = 5000;

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
    SELECT institution_id, fee_category, MIN(amount) AS amount
    FROM published_fee_catalog
    WHERE review_status = 'approved' AND amount IS NOT NULL
      AND institution_id = ANY(${[...institutionIds]}::bigint[])
      AND fee_category = ANY(${[...categories]}::text[])
    GROUP BY institution_id, fee_category
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

/** Reads signals, emails readers, advances the high-water mark. Never throws on delivery. */
export async function runFeeAlertDispatch({
  dryRun = false,
  maxRecipients = 200,
}: { dryRun?: boolean; maxRecipients?: number } = {}): Promise<FeeAlertDispatchResult> {
  const digests = groupFeeAlertCandidates(await loadCandidates());
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
  };
  if (dryRun) {
    result.reason = "dry run";
    return result;
  }

  // Signals that touched only fees nobody follows will never produce an email: move past them.
  for (const digest of quiet) await advanceHighWaterMark(digest.subscriptionIds, digest.maxSignalAt);

  const from = getTransactionalFromAddress();
  const secret = getSubscriptionTokenSecret();
  if (!from || !secret) {
    result.notConfigured = withNews.length > 0;
    result.reason = !from
      ? "TRANSACTIONAL_EMAIL_FROM is not configured."
      : "LEAD_EMAIL_TOKEN_SECRET (or BFI_COOKIE_SECRET) is not configured, so unsubscribe links cannot be signed.";
    return result;
  }

  const site = SITE_URL.replace(/\/$/, "");
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
      await advanceHighWaterMark(digest.subscriptionIds, digest.maxSignalAt);
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
  if (result.dryRun) {
    return `Atlas found ${result.readers} reader(s) to alert about ${result.changes} change(s) and ${result.newlyPublished} newly verified fee(s) (dry run, nothing sent).`;
  }
  if (result.readers === 0) return "Atlas found no fee changes for readers' saved institutions.";
  if (result.notConfigured) {
    const reason = (result.reason ?? "email is not configured").replace(/\.+$/, "");
    return `Atlas found ${result.readers} reader(s) with fee changes but did not email them: ${reason}.`;
  }
  const deferred = result.deferred > 0 ? ` ${result.deferred} reader(s) wait for the next run.` : "";
  return `Atlas emailed ${result.sent} fee alert(s) covering ${result.institutions} institution(s): ${result.changes} change(s), ${result.newlyPublished} newly verified fee(s), ${result.failed} failed.${deferred}`;
}
