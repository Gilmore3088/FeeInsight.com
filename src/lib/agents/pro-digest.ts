import { sql } from "@/lib/data-store/connection";
import { isConfirmedMovement, withConfirmedMovements } from "./fee-movement-check";
import { SITE_URL } from "@/lib/constants";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { canAccessPremium } from "@/lib/access";
import type { User } from "@/lib/auth";
import { getTransactionalFromAddress, sendResendEmail } from "@/lib/email/resend";
import { renderLeadEmailHtml, renderLeadEmailText } from "@/lib/email/lead-notification";
import {
  PRO_DIGEST_UNSUBSCRIBE_ACTION,
  feeAlertUnsubscribeUrls,
  getSubscriptionTokenSecret,
} from "@/lib/email/subscription-token";
import { isProEmailSendingEnabled, PRO_EMAILS_OFF_REASON } from "@/lib/email/pro-email-flag";
import { maskEmail, type EmailPreview } from "@/lib/agents/fee-alerts";

/**
 * Atlas's Monday digest for Pro readers: one email per reader covering the week.
 *
 *   1. What moved in their state and Fed district: Hamilton's published fee movements
 *      (`hamilton_fee_movement_detected`) from the last 7 days, netted per fee.
 *   2. Their institution's position: for each headline fee it publishes, how many state
 *      peers charge less, against last Monday's snapshot.
 *   3. Their watched competitors: headline fees that changed or were first published
 *      since last Monday's snapshot.
 *
 * Deterministic (no model). Dollar fees only: rates live in published_fee_rate_catalog
 * and are never pooled with these amounts. A reader with nothing in any section gets no
 * email. The snapshot for this Monday is stored on every live run (sending on or off),
 * so the first digest after the switch goes on already has a week to compare against.
 * Sending needs PRO_EMAILS_ENABLED; while it is off, the run counts and renders only.
 */

export interface DigestReaderRow {
  user_id: number | string;
  email: string;
  display_name: string | null;
  role: string | null;
  subscription_status: string | null;
  past_due_since: string | null;
  state_code: string | null;
  fed_district: number | string | null;
  own_institution_id: number | string | null;
  own_institution_name: string | null;
  own_state_code: string | null;
  own_fed_district: number | string | null;
  watched_ids: unknown;
}

export interface DigestReader {
  userId: number;
  email: string;
  displayName: string;
  stateCode: string | null;
  fedDistrict: number | null;
  own: { institutionId: number; name: string } | null;
  watchedIds: number[];
}

export interface MarketMove {
  institutionId: number;
  institutionName: string;
  stateCode: string | null;
  fedDistrict: number | null;
  category: string;
  previousAmount: number;
  newAmount: number;
}

/** One headline fee at the reader's institution against its state peers. */
export interface PositionEntry {
  amount: number;
  /** State peers (not counting the institution) whose fee is lower. */
  lower: number;
  /** Institutions in the state with this fee, the reader's own included. */
  of: number;
}

export interface DigestSnapshot {
  stateCode: string | null;
  own: { institutionId: number; positions: Record<string, PositionEntry> } | null;
  watched: Record<string, { name: string; fees: Record<string, number> }>;
}

export interface PositionChange {
  category: string;
  now: PositionEntry;
  before: PositionEntry;
}

export interface CompetitorChange {
  institutionId: number;
  institutionName: string;
  category: string;
  /** Null when the fee was first published this week. */
  previousAmount: number | null;
  newAmount: number;
}

export interface ProDigest {
  reader: DigestReader;
  weekStart: string;
  stateMoves: MarketMove[];
  districtMoves: MarketMove[];
  positionChanges: PositionChange[];
  competitorChanges: CompetitorChange[];
}

const HEADLINE: ReadonlySet<string> = new Set(HEADLINE_FEE_KEYS);
const MAX_MOVES_LISTED = 5;
const MAX_READERS = 500;
const MAX_PREVIEWS = 3;

/** Monday (UTC) of the week containing `now`, as YYYY-MM-DD. */
export function digestWeekStart(now: Date = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIds(value: unknown): number[] {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const ids = list.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
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

/** Pure: reader rows into readers who keep Pro access (the same rule as every Pro screen). */
export function toDigestReaders(rows: DigestReaderRow[]): DigestReader[] {
  const readers: DigestReader[] = [];
  for (const row of rows) {
    const pro = canAccessPremium({
      role: row.role,
      subscription_status: row.subscription_status ?? "none",
      past_due_since: row.past_due_since,
    } as unknown as User);
    if (!pro || !row.email) continue;
    const ownId = toNumberOrNull(row.own_institution_id);
    readers.push({
      userId: Number(row.user_id),
      email: row.email,
      displayName: row.display_name || row.email.split("@")[0],
      // The market is the reader's institution's; the account's own state is the fallback.
      stateCode: (row.own_state_code || row.state_code || "").trim().toUpperCase() || null,
      fedDistrict: toNumberOrNull(row.own_fed_district) ?? toNumberOrNull(row.fed_district),
      own: ownId ? { institutionId: ownId, name: row.own_institution_name || `Institution ${ownId}` } : null,
      watchedIds: parseIds(row.watched_ids).filter((id) => id !== ownId),
    });
  }
  return readers;
}

export interface MovementSignalRow {
  institution_id: number | string;
  institution_name: string;
  state_code: string | null;
  fed_district: number | string | null;
  signal_at: string | Date;
  source_json: unknown;
}

/**
 * Pure: a week of movement signals into one net move per institution and fee: the
 * earliest previous amount to the latest new amount. A fee that went up and back down
 * nets to no move and is dropped.
 */
export function netMarketMoves(rows: MovementSignalRow[]): MarketMove[] {
  const ordered = [...rows].sort(
    (a, b) => new Date(a.signal_at).getTime() - new Date(b.signal_at).getTime(),
  );
  const moves = new Map<string, MarketMove>();
  for (const row of ordered) {
    const json = parseJson(row.source_json);
    const movements = Array.isArray(json.movements) ? json.movements : [];
    for (const raw of movements as Array<Record<string, unknown>>) {
      const category = typeof raw.canonical_fee_key === "string" ? raw.canonical_fee_key : null;
      const previousAmount = toNumberOrNull(raw.previous_amount);
      const newAmount = toNumberOrNull(raw.new_amount);
      if (!category || previousAmount === null || newAmount === null) continue;
      // A re-read, recategorization or other page's copy is not a price change.
      if (!isConfirmedMovement(raw)) continue;
      const institutionId = Number(row.institution_id);
      const key = `${institutionId}:${category}`;
      const existing = moves.get(key);
      if (existing) {
        existing.newAmount = newAmount;
      } else {
        moves.set(key, {
          institutionId,
          institutionName: row.institution_name,
          stateCode: row.state_code ? row.state_code.trim().toUpperCase() : null,
          fedDistrict: toNumberOrNull(row.fed_district),
          category,
          previousAmount,
          newAmount,
        });
      }
    }
  }
  return [...moves.values()].filter((move) => Math.round((move.newAmount - move.previousAmount) * 100) !== 0);
}

/** Pure: the reader's institution against state peers, one entry per headline fee it has. */
export function computePositions(
  institutionId: number,
  stateFees: Array<{ institution_id: number | string; fee_category: string; amount: number | string }>,
): Record<string, PositionEntry> {
  const byCategory = new Map<string, Map<number, number>>();
  for (const row of stateFees) {
    const amount = Number(row.amount);
    if (!HEADLINE.has(row.fee_category) || !Number.isFinite(amount)) continue;
    const map = byCategory.get(row.fee_category) ?? new Map<number, number>();
    const id = Number(row.institution_id);
    map.set(id, Math.min(map.get(id) ?? Infinity, amount));
    byCategory.set(row.fee_category, map);
  }
  const positions: Record<string, PositionEntry> = {};
  for (const [category, amounts] of byCategory) {
    const own = amounts.get(institutionId);
    if (own === undefined) continue;
    let lower = 0;
    for (const [id, amount] of amounts) if (id !== institutionId && amount < own) lower += 1;
    positions[category] = { amount: own, lower, of: amounts.size };
  }
  return positions;
}

/** Pure: position entries whose peer count below the institution changed since the snapshot. */
export function diffPositions(
  now: Record<string, PositionEntry>,
  before: Record<string, PositionEntry> | null,
): PositionChange[] {
  if (!before) return [];
  const changes: PositionChange[] = [];
  for (const category of HEADLINE_FEE_KEYS) {
    const current = now[category];
    const previous = before[category];
    if (!current || !previous) continue;
    if (current.lower !== previous.lower || current.amount !== previous.amount) {
      changes.push({ category, now: current, before: previous });
    }
  }
  return changes;
}

/**
 * Pure: watched institutions' headline fees against the snapshot. An institution not in
 * last week's snapshot (newly watched) reports nothing until next week.
 */
export function diffCompetitors(
  now: DigestSnapshot["watched"],
  before: DigestSnapshot["watched"] | null,
): CompetitorChange[] {
  if (!before) return [];
  const changes: CompetitorChange[] = [];
  for (const [id, current] of Object.entries(now)) {
    const previous = before[id];
    if (!previous) continue;
    for (const category of HEADLINE_FEE_KEYS) {
      const amount = current.fees[category];
      if (amount === undefined) continue;
      const prior = previous.fees[category];
      if (prior === undefined) {
        changes.push({ institutionId: Number(id), institutionName: current.name, category, previousAmount: null, newAmount: amount });
      } else if (Math.round((amount - prior) * 100) !== 0) {
        changes.push({ institutionId: Number(id), institutionName: current.name, category, previousAmount: prior, newAmount: amount });
      }
    }
  }
  return changes;
}

export function digestHasNews(digest: ProDigest): boolean {
  return (
    digest.stateMoves.length + digest.districtMoves.length + digest.positionChanges.length + digest.competitorChanges.length > 0
  );
}

function plainLabel(category: string): string {
  return getDisplayName(category).replace(/\s*\([^)]*\)/g, "");
}

function moveLine(move: { institutionName: string; category: string; previousAmount: number | null; newAmount: number }): string {
  if (move.previousAmount === null) {
    return `${move.institutionName}, ${plainLabel(move.category).toLowerCase()}: now published at ${formatAmount(move.newAmount)}`;
  }
  const delta = Math.round((move.newAmount - move.previousAmount) * 100) / 100;
  const direction = delta > 0 ? "higher" : "lower";
  return `${move.institutionName}, ${plainLabel(move.category).toLowerCase()}: ${formatAmount(move.previousAmount)} to ${formatAmount(move.newAmount)} (${formatAmount(Math.abs(delta))} ${direction})`;
}

function moveSummary(moves: MarketMove[], place: string): string {
  const institutions = new Set(moves.map((move) => move.institutionId)).size;
  const higher = moves.filter((move) => move.newAmount > move.previousAmount).length;
  const lower = moves.length - higher;
  return `${place}: ${moves.length} published fee change(s) at ${institutions} institution(s) this week, ${higher} higher and ${lower} lower.`;
}

function largestFirst(moves: MarketMove[]): MarketMove[] {
  return [...moves].sort(
    (a, b) => Math.abs(b.newAmount - b.previousAmount) - Math.abs(a.newAmount - a.previousAmount) || a.institutionName.localeCompare(b.institutionName),
  );
}

/** Pure: subject and body for one reader's digest. */
export function buildProDigestEmail(
  digest: ProDigest,
  urls: { site: string; unsubscribePage: string },
): { subject: string; text: string; html: string } {
  const site = urls.site.replace(/\/$/, "");
  const stateName = digest.reader.stateCode ? STATE_NAMES[digest.reader.stateCode] ?? digest.reader.stateCode : null;
  const districtName = digest.reader.fedDistrict ? DISTRICT_NAMES[digest.reader.fedDistrict] ?? `District ${digest.reader.fedDistrict}` : null;

  const lines: string[] = [];
  if (digest.positionChanges.length > 0 && digest.reader.own) {
    lines.push(`${digest.reader.own.name} against ${stateName ?? "state"} peers`);
    for (const change of digest.positionChanges) {
      lines.push(
        `${plainLabel(change.category)} ${formatAmount(change.now.amount)}: ${change.now.lower} of ${change.now.of} institutions charge less (last week ${formatAmount(change.before.amount)}, ${change.before.lower} of ${change.before.of}).`,
      );
    }
    lines.push("");
  }
  if (digest.competitorChanges.length > 0) {
    lines.push("Your watched institutions");
    for (const change of digest.competitorChanges.slice(0, MAX_MOVES_LISTED * 2)) lines.push(moveLine(change));
    const more = digest.competitorChanges.length - MAX_MOVES_LISTED * 2;
    if (more > 0) lines.push(`and ${more} more on your watchlist: ${site}/pro/monitor`);
    lines.push("");
  }
  if (digest.stateMoves.length > 0 && stateName) {
    lines.push(moveSummary(digest.stateMoves, stateName));
    for (const move of largestFirst(digest.stateMoves).slice(0, MAX_MOVES_LISTED)) lines.push(moveLine(move));
    lines.push("");
  }
  if (digest.districtMoves.length > 0 && districtName) {
    lines.push(moveSummary(digest.districtMoves, `Rest of the ${districtName} Fed district`));
    for (const move of largestFirst(digest.districtMoves).slice(0, MAX_MOVES_LISTED)) lines.push(moveLine(move));
    lines.push("");
  }
  lines.push(
    "Figures are published dollar fees from each institution's own fee schedule; percentage fees are left out.",
  );
  lines.push("");
  lines.push(
    `You get this Monday digest with your Hamilton subscription. Stop the digest: ${urls.unsubscribePage}`,
  );

  const totalMoves = digest.stateMoves.length + digest.districtMoves.length;
  let subject: string;
  if (digest.positionChanges.length > 0 && digest.reader.own) {
    subject = `This week: ${digest.reader.own.name}'s position moved on ${digest.positionChanges.length} fee(s)`;
  } else if (digest.competitorChanges.length > 0) {
    subject = `This week: ${digest.competitorChanges.length} fee change(s) at institutions you watch`;
  } else {
    subject = `This week: ${totalMoves} published fee change(s) in ${stateName ?? districtName ?? "your market"}`;
  }

  const content = {
    subject,
    eyebrow: "Monday digest",
    lines,
    cta: { label: "Open Hamilton", href: `${site}/pro/monitor` },
  };
  return { subject, text: renderLeadEmailText(content), html: renderLeadEmailHtml(content) };
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadReaders(): Promise<DigestReader[]> {
  // Columns added by migration 20270110000009 are read through to_jsonb.
  const rows = await sql<DigestReaderRow[]>`
    SELECT u.id AS user_id, u.email, u.display_name, u.role,
           COALESCE(u.subscription_status, 'none') AS subscription_status,
           to_jsonb(u.*) ->> 'past_due_since' AS past_due_since,
           u.state_code, u.fed_district,
           own.institution_id AS own_institution_id, own.institution_name AS own_institution_name,
           own.state_code AS own_state_code, own.fed_district AS own_fed_district,
           w.institution_ids AS watched_ids
    FROM users u
    LEFT JOIN LATERAL (
      SELECT m.institution_id, ct.institution_name, ct.state_code, ct.fed_district
      FROM institution_workspace_memberships m
      JOIN institution_sources ct ON ct.id = m.institution_id
      WHERE m.user_id = u.id AND m.membership_status = 'active'
      ORDER BY m.granted_at DESC NULLS LAST, m.id DESC
      LIMIT 1
    ) own ON TRUE
    LEFT JOIN LATERAL (
      SELECT institution_ids FROM hamilton_watchlists WHERE user_id::text = u.id::text LIMIT 1
    ) w ON TRUE
    WHERE u.is_active = TRUE AND u.email IS NOT NULL
      AND (to_jsonb(u.*) ->> 'pro_digest_off_at') IS NULL
      AND (u.role IN ('admin', 'analyst', 'premium') OR u.subscription_status IN ('active', 'past_due'))
    ORDER BY u.id
    LIMIT ${MAX_READERS}
  `;
  return toDigestReaders(rows);
}

async function loadMarketMoves(states: string[], districts: number[], since: string): Promise<MarketMove[]> {
  if (states.length === 0 && districts.length === 0) return [];
  const rows = await sql<MovementSignalRow[]>`
    SELECT s.institution_id, ct.institution_name, ct.state_code, ct.fed_district,
           s.created_at AS signal_at, s.source_json
    FROM hamilton_signals s
    JOIN institution_sources ct ON ct.id::text = s.institution_id
    WHERE s.signal_type = 'hamilton_fee_movement_detected'
      AND s.created_at >= ${since}::timestamptz
      AND (ct.state_code = ANY(${states}::text[]) OR ct.fed_district = ANY(${districts}::int[]))
    ORDER BY s.created_at
  `;
  return netMarketMoves(await withConfirmedMovements(rows));
}

interface FeeRow {
  institution_id: number | string;
  institution_name: string;
  state_code: string | null;
  fee_category: string;
  amount: number | string;
}

/** Live headline dollar fees for whole states and for single institutions, one row per fee. */
async function loadHeadlineFees(states: string[], institutionIds: number[]): Promise<FeeRow[]> {
  if (states.length === 0 && institutionIds.length === 0) return [];
  return sql<FeeRow[]>`
    SELECT c.institution_id, ct.institution_name, ct.state_code, c.fee_category, MIN(c.amount) AS amount
    FROM published_fee_catalog c
    JOIN institution_sources ct ON ct.id = c.institution_id
    WHERE c.review_status = 'approved'
      AND c.amount IS NOT NULL
      AND c.amount_kind IS DISTINCT FROM 'percent'
      AND c.fee_category = ANY(${[...HEADLINE_FEE_KEYS]}::text[])
      AND (ct.state_code = ANY(${states}::text[]) OR c.institution_id = ANY(${institutionIds}::bigint[]))
    GROUP BY c.institution_id, ct.institution_name, ct.state_code, c.fee_category
  `;
}

async function loadPreviousSnapshots(userIds: number[], weekStart: string): Promise<Map<number, DigestSnapshot>> {
  if (userIds.length === 0) return new Map();
  const rows = await sql<{ user_id: number | string; snapshot: unknown }[]>`
    SELECT DISTINCT ON (user_id) user_id, snapshot
    FROM pro_digest_snapshots
    WHERE user_id = ANY(${userIds}::bigint[])
      AND week_start < ${weekStart}::date
      AND week_start >= ${weekStart}::date - 14
    ORDER BY user_id, week_start DESC
  `.catch(() => [] as { user_id: number | string; snapshot: unknown }[]);
  return new Map(rows.map((row) => [Number(row.user_id), parseJson(row.snapshot) as unknown as DigestSnapshot]));
}

async function saveSnapshot(userId: number, weekStart: string, snapshot: DigestSnapshot): Promise<void> {
  await sql`
    INSERT INTO pro_digest_snapshots (user_id, week_start, snapshot)
    VALUES (${userId}, ${weekStart}::date, ${JSON.stringify(snapshot)}::jsonb)
    ON CONFLICT (user_id, week_start) DO UPDATE SET snapshot = EXCLUDED.snapshot, created_at = NOW()
  `;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface ProDigestResult {
  dryRun: boolean;
  weekStart: string;
  /** Pro readers considered. */
  readers: number;
  /** Readers with something in at least one section. */
  withNews: number;
  /** Readers skipped because nothing moved for them. */
  quiet: number;
  sent: number;
  failed: number;
  /** True when PRO_EMAILS_ENABLED is off: counted and rendered, not sent. */
  held: boolean;
  notConfigured: boolean;
  reason: string | null;
  snapshotsSaved: number;
  previews: EmailPreview[];
}

export async function runProDigest({
  dryRun = false,
  now = new Date(),
}: { dryRun?: boolean; now?: Date } = {}): Promise<ProDigestResult> {
  const weekStart = digestWeekStart(now);
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const site = SITE_URL.replace(/\/$/, "");
  const readers = await loadReaders();

  const states = [...new Set(readers.map((r) => r.stateCode).filter((s): s is string => Boolean(s)))];
  const districts = [...new Set(readers.map((r) => r.fedDistrict).filter((d): d is number => d !== null))];
  const watchedIds = [...new Set(readers.flatMap((r) => r.watchedIds))];
  const ownIds = readers.map((r) => r.own?.institutionId).filter((id): id is number => Boolean(id));
  // Whole-state fee tables only where a reader has an institution to place in them.
  const positionStates = [...new Set(readers.filter((r) => r.own && r.stateCode).map((r) => r.stateCode as string))];

  const [moves, fees, previous] = await Promise.all([
    loadMarketMoves(states, districts, since),
    loadHeadlineFees(positionStates, [...new Set([...watchedIds, ...ownIds])]),
    loadPreviousSnapshots(readers.map((r) => r.userId), weekStart),
  ]);

  const digests: ProDigest[] = [];
  const snapshots = new Map<number, DigestSnapshot>();
  for (const reader of readers) {
    const before = previous.get(reader.userId) ?? null;
    let positions: Record<string, PositionEntry> = {};
    if (reader.own && reader.stateCode) {
      const stateFees = fees.filter((row) => (row.state_code || "").trim().toUpperCase() === reader.stateCode);
      positions = computePositions(reader.own.institutionId, stateFees);
    }
    const watched: DigestSnapshot["watched"] = {};
    for (const id of reader.watchedIds) {
      const rows = fees.filter((row) => Number(row.institution_id) === id);
      if (rows.length === 0) continue;
      watched[String(id)] = {
        name: rows[0].institution_name,
        fees: Object.fromEntries(rows.map((row) => [row.fee_category, Number(row.amount)])),
      };
    }
    const snapshot: DigestSnapshot = {
      stateCode: reader.stateCode,
      own: reader.own ? { institutionId: reader.own.institutionId, positions } : null,
      watched,
    };
    snapshots.set(reader.userId, snapshot);

    // A position is compared only for the same institution in the same state.
    const comparable =
      before?.own && reader.own && before.own.institutionId === reader.own.institutionId && before.stateCode === reader.stateCode
        ? before.own.positions
        : null;
    digests.push({
      reader,
      weekStart,
      stateMoves: reader.stateCode ? moves.filter((move) => move.stateCode === reader.stateCode) : [],
      districtMoves:
        reader.fedDistrict !== null
          ? moves.filter((move) => move.fedDistrict === reader.fedDistrict && move.stateCode !== reader.stateCode)
          : [],
      positionChanges: diffPositions(positions, comparable),
      competitorChanges: diffCompetitors(watched, before?.watched ?? null),
    });
  }

  const withNews = digests.filter(digestHasNews);
  const sending = isProEmailSendingEnabled();
  const result: ProDigestResult = {
    dryRun,
    weekStart,
    readers: readers.length,
    withNews: withNews.length,
    quiet: digests.length - withNews.length,
    sent: 0,
    failed: 0,
    held: !dryRun && !sending,
    notConfigured: false,
    reason: dryRun ? "dry run" : sending ? null : PRO_EMAILS_OFF_REASON,
    snapshotsSaved: 0,
    previews: [],
  };
  if (dryRun || !sending) {
    result.previews = withNews.slice(0, MAX_PREVIEWS).map((digest) => {
      const email = buildProDigestEmail(digest, { site, unsubscribePage: `${site}/email-preferences?preview=1` });
      return { to: maskEmail(digest.reader.email), subject: email.subject, text: email.text };
    });
  }
  if (dryRun) return result;

  for (const [userId, snapshot] of snapshots) {
    await saveSnapshot(userId, weekStart, snapshot);
    result.snapshotsSaved += 1;
  }
  if (!sending) return result;

  const from = getTransactionalFromAddress();
  const secret = getSubscriptionTokenSecret();
  if (!from || !secret) {
    result.notConfigured = withNews.length > 0;
    result.reason = !from
      ? "TRANSACTIONAL_EMAIL_FROM is not configured."
      : "LEAD_EMAIL_TOKEN_SECRET (or BFI_COOKIE_SECRET) is not configured, so unsubscribe links cannot be signed.";
    return result;
  }

  for (const digest of withNews) {
    const unsubscribe = feeAlertUnsubscribeUrls(digest.reader.userId, digest.reader.email, secret, PRO_DIGEST_UNSUBSCRIBE_ACTION);
    const email = buildProDigestEmail(digest, { site, unsubscribePage: unsubscribe.page });
    const delivery = await sendResendEmail(
      {
        from,
        to: digest.reader.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        // One digest per reader per week, even if the run is retried.
        idempotencyKey: `pro-digest-${digest.reader.userId}-${weekStart}`,
        headers: {
          "List-Unsubscribe": `<${unsubscribe.oneClick}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      "the Monday digest",
    );
    if (delivery.status === "sent") {
      result.sent += 1;
    } else if (delivery.status === "not_configured") {
      result.notConfigured = true;
      result.reason = delivery.reason;
      break;
    } else {
      result.failed += 1;
    }
  }
  return result;
}

/** One-line run-ledger summary for the step. */
export function summarizeProDigest(result: ProDigestResult): string {
  const counts = `${result.withNews} of ${result.readers} Pro reader(s) had something new for the week of ${result.weekStart}; ${result.quiet} had nothing and are skipped`;
  if (result.dryRun) return `Atlas found ${counts} (dry run, nothing sent or stored).`;
  if (result.held) return `Atlas found ${counts}. Nothing sent because PRO_EMAILS_ENABLED is off; ${result.snapshotsSaved} snapshot(s) stored for next week.`;
  if (result.notConfigured) {
    const reason = (result.reason ?? "email is not configured").replace(/\.+$/, "");
    return `Atlas found ${counts} but did not email them: ${reason}.`;
  }
  return `Atlas emailed ${result.sent} Monday digest(s), ${result.failed} failed. ${counts}.`;
}
