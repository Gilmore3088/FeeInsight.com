/**
 * The figures a competitor change alert carries in `hamilton_signals.source_json`, read back
 * for the Monitor exhibit. Pure, so components and tests can use it without the database.
 */

/** One side of the alert's baseline (#1898): the price, its schedule and edition, and when we read it. */
export interface BaselineSideDetail {
  amount: number;
  scheduleUrl: string | null;
  /** The edition date the schedule states, YYYY-MM-DD. */
  edition: string | null;
  /** The day the price went live in the index, YYYY-MM-DD. */
  readOn: string | null;
}

export interface CompetitorChangeDetail {
  competitorName: string | null;
  bankName: string | null;
  feeKey: string;
  previousAmount: number;
  newAmount: number;
  ownAmount: number | null;
  changedAt: string | null;
  scheduleUrl: string | null;
  /** What we knew before and what replaced it; null on alerts raised before #1898. */
  baseline: { before: BaselineSideDetail; after: BaselineSideDetail } | null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function day(value: unknown): string | null {
  const text = str(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function baselineSide(value: unknown): BaselineSideDetail | null {
  if (!value || typeof value !== "object") return null;
  const side = value as Record<string, unknown>;
  const amount = num(side.amount);
  if (amount === null) return null;
  const url = str(side.schedule_url);
  return {
    amount,
    scheduleUrl: url && /^https?:\/\//i.test(url) ? url : null,
    edition: day(side.edition),
    readOn: day(side.read_on),
  };
}

function parseBaseline(value: unknown): CompetitorChangeDetail["baseline"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const before = baselineSide(raw.before);
  const after = baselineSide(raw.after);
  return before && after ? { before, after } : null;
}

/** Null when the row lacks the prices (older or malformed rows fall back to the plain card). */
export function parseCompetitorChangeDetail(sourceJson: unknown): CompetitorChangeDetail | null {
  let json = sourceJson;
  if (typeof json === "string") {
    try {
      json = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (!json || typeof json !== "object") return null;
  const row = json as Record<string, unknown>;
  const previousAmount = num(row.previous_amount);
  const newAmount = num(row.new_amount);
  const feeKey = str(row.canonical_fee_key);
  if (previousAmount === null || newAmount === null || !feeKey) return null;
  return {
    competitorName: str(row.competitor_name),
    bankName: str(row.bank_name),
    feeKey,
    previousAmount,
    newAmount,
    ownAmount: num(row.own_amount),
    changedAt: str(row.changed_at),
    scheduleUrl: str(row.schedule_url),
    baseline: parseBaseline(row.baseline),
  };
}
