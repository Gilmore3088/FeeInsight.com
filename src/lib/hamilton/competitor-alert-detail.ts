/**
 * The figures a competitor change alert carries in `hamilton_signals.source_json`, read back
 * for the Monitor exhibit. Pure, so components and tests can use it without the database.
 */

export interface CompetitorChangeDetail {
  competitorName: string | null;
  bankName: string | null;
  feeKey: string;
  previousAmount: number;
  newAmount: number;
  ownAmount: number | null;
  changedAt: string | null;
  scheduleUrl: string | null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  };
}
