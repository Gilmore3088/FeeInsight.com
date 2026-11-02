import type { InstitutionText } from "@/lib/agents/hamilton/source-check";
import { readLiveAudit, type LiveAuditFixture, type LiveAuditRow } from "./shadow-lab/live-audit";
import { FRESH_AUDIT_VERSION, scoreFreshAudit, type FreshAuditFee } from "./fresh-audit";
import type { AuditVerdict } from "./accuracy-measure";

/**
 * Robot-human agreement (pipeline quality plan step 2): replay Deming's fresh audit
 * (`scoreFreshAudit`, the daily audit's own scoring) on James's frozen W43 live check
 * (`__fixtures__/live-audit-2026-w43.json`) and compare its verdict with his, row by row.
 *
 * A row is scored when the fixture saved the schedule text it names, James's verdict is one a
 * published dollar fee can get (MATCH, WRONG_AMOUNT, WRONG_CATEGORY, BAD_NAME, NOT_A_FEE) and the
 * live amount is one dollar figure. MISSING rows are fees the site does not carry, so the audit,
 * which samples live fees, cannot score them; CANT_VERIFY, STALE_SOURCE, WRONG_AUDIENCE and
 * WRONG_DOCUMENT rows have no saved text. Each is counted, never guessed.
 *
 * The replay knows only what the fixture kept of the live fee: its name, amount and category.
 * It does not know the live row's stored frequency, so by default a period the line prints
 * ("$10.00 per month") is not scored (`frequency: "unknown"`); `frequency: "not_shown"` scores it
 * as if the site showed none, the other bound. A unit, condition, tier or audience is scored from the
 * name alone, as the site shows it. No model calls, no database.
 */

export type HumanClass = "right" | "amount" | "category" | "name" | "notAFee";

const HUMAN: Record<string, HumanClass> = {
  MATCH: "right",
  WRONG_AMOUNT: "amount",
  WRONG_CATEGORY: "category",
  BAD_NAME: "name",
  NOT_A_FEE: "notAFee",
};

/** James scored a lost unit, frequency, condition or tier as a wrong amount, so the robot's `qualifier` is his WRONG_AMOUNT. */
export function robotClass(verdict: AuditVerdict): HumanClass | "evidence" | "unknown" {
  if (verdict === "qualifier") return "amount";
  return verdict;
}

const PLAIN_DOLLARS = /^\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

function liveDollars(row: LiveAuditRow): number | null {
  const match = (row.amount_on_site ?? "").trim().match(PLAIN_DOLLARS);
  return match ? Number(`${match[1].replace(/,/g, "")}.${match[2] ?? "0"}`) : null;
}

export interface AgreementRow {
  caseKey: string;
  documentKey: string;
  human: HumanClass;
  robot: HumanClass | "evidence" | "unknown";
  robotVerdict: AuditVerdict;
  /** The audit's miss reason, when the robot called the row a miss. */
  reason: string | null;
  feeName: string;
  amount: number;
  category: string;
  scheduleAmount: string | null;
}

export interface AgreementReport {
  /** Rows replayed (scorable). */
  scored: number;
  /** Robot verdict class equals James's verdict class. */
  agree: number;
  agreement: number | null;
  /** Both call the row right, or both call it wrong (any class). */
  agreeRightWrong: number;
  agreementRightWrong: number | null;
  /** James's MATCH rows / scored, on the same replayed rows. */
  humanRight: number;
  /** The robot's right verdicts / scored. */
  robotRight: number;
  /** Rows not scored, by verdict and why. */
  excluded: Record<string, number>;
  /** "human→robot:reason" counts of the rows that disagree, largest first. */
  disagreements: Array<{ key: string; count: number }>;
  rows: AgreementRow[];
}

/** James's own W43 accuracy over every row he could check: MATCH / (all rows - MISSING - CANT_VERIFY). */
export function humanW43Accuracy(fixture: LiveAuditFixture): { right: number; checked: number } {
  const rows = fixture.rows;
  const right = rows.filter((r) => r.verdict === "MATCH").length;
  const checked = rows.filter((r) => r.verdict !== "MISSING" && r.verdict !== "CANT_VERIFY").length;
  return { right, checked };
}

export type FrequencyMode = "unknown" | "not_shown";

export function w43Agreement(fixture: LiveAuditFixture = readLiveAudit(), { frequency = "unknown" }: { frequency?: FrequencyMode } = {}): AgreementReport {
  const documentIds = new Map(fixture.documents.map((d, i) => [d.document_key, i + 1]));
  const textsByInstitution = new Map<number, InstitutionText[]>();
  for (const d of fixture.documents) {
    const id = documentIds.get(d.document_key) as number;
    textsByInstitution.set(d.institution_id, [...(textsByInstitution.get(d.institution_id) ?? []), { source_document_id: id, normalized_text: d.text }]);
  }
  const excluded: Record<string, number> = {};
  const skip = (row: LiveAuditRow, why: string) => { const key = `${row.verdict}: ${why}`; excluded[key] = (excluded[key] ?? 0) + 1; };
  const fees: FreshAuditFee[] = [];
  const meta = new Map<number, { row: LiveAuditRow; human: HumanClass; amount: number }>();
  fixture.rows.forEach((row, index) => {
    const human = HUMAN[row.verdict];
    if (!human) return skip(row, "not a verdict on a published dollar fee, or no saved text");
    if (row.not_replayable || !row.document_key || !documentIds.has(row.document_key)) return skip(row, "no saved schedule text");
    const amount = liveDollars(row);
    if (amount == null) return skip(row, "live amount is not one dollar figure");
    const id = index + 1;
    meta.set(id, { row, human, amount });
    fees.push({
      fee_id: id,
      fee_published_id: id,
      lineage_ref: id,
      fee_raw_id: id,
      institution_id: row.institution_id,
      source: "knox",
      source_document_id: documentIds.get(row.document_key) as number,
      canonical_fee_key: row.category ?? "",
      fee_name: row.fee_name ?? "",
      amount,
      amount_kind: "flat",
      rate_percent: null,
      document_url: (row as LiveAuditRow & { source_url?: string | null }).source_url ?? null,
      ...(frequency === "not_shown" ? { frequency: null } : {}),
    } as FreshAuditFee);
  });
  const score = scoreFreshAudit(fees, textsByInstitution);
  const reasons = new Map(score.misses.map((miss) => [miss.feePublishedId, miss.reason]));
  const rows: AgreementRow[] = score.observations.map(([id, verdict]) => {
    const { row, human, amount } = meta.get(id)!;
    return {
      caseKey: row.case_key, documentKey: row.document_key as string, human, robot: robotClass(verdict), robotVerdict: verdict,
      reason: reasons.get(id) ?? null, feeName: row.fee_name ?? "", amount, category: row.category ?? "", scheduleAmount: row.schedule_amount ?? null,
    };
  });
  const scored = rows.length;
  const agree = rows.filter((r) => r.robot === r.human).length;
  const agreeRightWrong = rows.filter((r) => (r.robot === "right") === (r.human === "right")).length;
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.robot === r.human) continue;
    const key = `${r.human}→${r.robotVerdict}${r.reason ? `:${r.reason}` : ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    scored, agree, agreement: scored ? agree / scored : null,
    agreeRightWrong, agreementRightWrong: scored ? agreeRightWrong / scored : null,
    humanRight: rows.filter((r) => r.human === "right").length,
    robotRight: rows.filter((r) => r.robot === "right").length,
    excluded,
    disagreements: [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    rows,
  };
}

/** The committed receipt (`robot-human-agreement.json`): what the scorecard shows, kept equal to the replay by its test. */
export interface AgreementReceipt {
  fixture: string;
  audit_version: number;
  measured_on: string;
  scored: number;
  agree: number;
  agreement: number;
  agree_right_wrong: number;
  robot_right: number;
  human_right_same_rows: number;
  /** James over every row he could check (all but MISSING and CANT_VERIFY); `scored` is the subset with saved text and one dollar figure. */
  human_w43: { right: number; checked: number };
  /** Rows not scored, by verdict and reason; with `scored` they sum to every fixture row. */
  excluded: Record<string, number>;
  /** The other bound: the stored frequency read as not shown, so every printed period counts. */
  not_shown_bound: { agree: number; agreement: number; robot_right: number };
  /** Agreement must not fall below this many rows (the ratchet). */
  floor_agree: number;
  target: number;
  top_disagreements: Array<{ key: string; count: number }>;
}

export const AGREEMENT_TARGET = 0.95;
const round4 = (value: number | null) => (value == null ? 0 : Math.round(value * 10_000) / 10_000);

/** The receipt's measured fields, recomputed from the fixture (everything but `measured_on` and `floor_agree`). */
export function agreementReceiptFields(fixture: LiveAuditFixture = readLiveAudit()): Omit<AgreementReceipt, "measured_on" | "floor_agree" | "fixture"> {
  const report = w43Agreement(fixture);
  const bound = w43Agreement(fixture, { frequency: "not_shown" });
  return {
    audit_version: FRESH_AUDIT_VERSION,
    scored: report.scored,
    agree: report.agree,
    agreement: round4(report.agreement),
    agree_right_wrong: report.agreeRightWrong,
    robot_right: report.robotRight,
    human_right_same_rows: report.humanRight,
    human_w43: humanW43Accuracy(fixture),
    excluded: Object.fromEntries(Object.entries(report.excluded).sort(([a], [b]) => a.localeCompare(b))),
    not_shown_bound: { agree: bound.agree, agreement: round4(bound.agreement), robot_right: bound.robotRight },
    target: AGREEMENT_TARGET,
    top_disagreements: report.disagreements.slice(0, 8),
  };
}
